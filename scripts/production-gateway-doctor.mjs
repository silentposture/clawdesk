import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const cwd = process.cwd();
const timeoutMs = Number(process.env.CLAWDESK_GATEWAY_DOCTOR_TIMEOUT_MS ?? 8000);

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env) && value) process.env[key] = value;
  }
  return true;
}

function normalizeBaseUrl(rawValue) {
  const value = String(rawValue ?? "").trim().replace(/\/+$/, "");
  if (!value) return { ok: false, issue: "missing", value: "" };
  try {
    const url = new URL(value);
    const issues = [];
    if (url.protocol !== "https:") issues.push("must-use-https");
    if (url.hostname === "clawdesk.example" || url.hostname === "www.clawdesk.example") {
      issues.push("must-use-api-host-not-homepage");
    }
    if (url.pathname && url.pathname !== "/") issues.push("base-url-should-not-include-path");
    return {
      ok: issues.length === 0,
      issue: issues.join(","),
      value,
      host: url.hostname,
      healthUrl: `${url.origin}/health`,
      contractUrl: `${url.origin}/contract`,
    };
  } catch {
    return { ok: false, issue: "invalid-url", value };
  }
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: { Accept: "application/json", ...(options.headers ?? {}) },
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") ?? "";
    const text = await response.text();
    let payload = null;
    if (contentType.includes("application/json") && text) {
      payload = JSON.parse(text);
    }
    return {
      ok: response.ok,
      status: response.status,
      contentType,
      payload,
      bodyPreview: payload ? undefined : text.slice(0, 120),
    };
  } finally {
    clearTimeout(timer);
  }
}

function validateHealthPayload(payload) {
  const issues = [];
  if (!payload || typeof payload !== "object") issues.push("health-must-return-json-object");
  if (payload && payload.ok !== true && payload.status !== "ok" && payload.name !== "clawdesk-production-gateway-sim") {
    issues.push("health-must-indicate-ok");
  }
  if (JSON.stringify(payload ?? {}).includes("clawdesk-mock-gateway")) {
    issues.push("health-must-not-identify-mock-gateway");
  }
  return issues;
}

function validateContractPayload(payload) {
  if (!payload || typeof payload !== "object") return ["contract-must-return-json-object"];
  if (!Array.isArray(payload.endpoints)) return ["contract-must-include-endpoints-array"];
  const endpointKeys = new Set(payload.endpoints.map((endpoint) => `${endpoint.method}:${endpoint.path}`));
  const required = ["GET:/health", "POST:/chat", "POST:/permission-result", "POST:/license/activate-key", "POST:/diagnostics/create-report"];
  return required.filter((key) => !endpointKeys.has(key)).map((key) => `contract-missing:${key}`);
}

const loadedEnvFiles = [
  [".env.production", loadDotEnv(path.join(cwd, ".env.production"))],
  [".env", loadDotEnv(path.join(cwd, ".env"))],
].filter(([, loaded]) => loaded).map(([name]) => name);

const base = normalizeBaseUrl(process.env.CLAWDESK_GATEWAY_BASE_URL);
const checks = [];
const blockers = [];

checks.push({
  name: "gateway-base-url",
  ok: base.ok,
  host: base.host,
  issue: base.issue || null,
});
if (!base.ok) blockers.push(`gateway-base-url:${base.issue}`);

if (base.ok) {
  try {
    const health = await fetchJson(base.healthUrl);
    const healthIssues = health.ok ? validateHealthPayload(health.payload) : [`health-http-${health.status}`];
    checks.push({
      name: "gateway-health",
      ok: health.ok && healthIssues.length === 0,
      status: health.status,
      contentType: health.contentType,
      issues: healthIssues,
      bodyPreview: health.bodyPreview,
    });
    blockers.push(...healthIssues.map((issue) => `gateway-health:${issue}`));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push({ name: "gateway-health", ok: false, error: message });
    blockers.push(`gateway-health:${message}`);
  }

  try {
    const contract = await fetchJson(base.contractUrl);
    const contractIssues = contract.ok ? validateContractPayload(contract.payload) : [`contract-http-${contract.status}`];
    checks.push({
      name: "gateway-contract",
      ok: contract.ok && contractIssues.length === 0,
      status: contract.status,
      contentType: contract.contentType,
      issues: contractIssues,
      bodyPreview: contract.bodyPreview,
    });
    blockers.push(...contractIssues.map((issue) => `gateway-contract:${issue}`));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push({ name: "gateway-contract", ok: false, error: message });
    blockers.push(`gateway-contract:${message}`);
  }
}

const report = {
  createdAt: new Date().toISOString(),
  result: blockers.length === 0 ? "PASS" : "BLOCKED",
  loadedEnvFiles,
  gateway: {
    configured: Boolean(process.env.CLAWDESK_GATEWAY_BASE_URL),
    host: base.host ?? "",
    healthUrl: base.healthUrl ?? "",
    contractUrl: base.contractUrl ?? "",
  },
  checks,
  blockers,
  nextActions: blockers.length === 0
    ? ["Run npm run beta:env:doctor, then npm run release:guard:beta after Lemon/signing env are present."]
    : [
        "Point CLAWDESK_GATEWAY_BASE_URL to a real HTTPS API host, for example https://api.clawdesk.example.",
        "Ensure the Gateway exposes GET /health and GET /contract with the ClawDesk production contract.",
      ],
};

const reportDir = path.join(cwd, "artifacts", "production-gateway-doctor");
await fsp.mkdir(reportDir, { recursive: true });
const reportPath = path.join(reportDir, `${new Date().toISOString().replace(/[:.]/g, "_")}-production-gateway-doctor.json`);
await fsp.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(`Production Gateway doctor report: ${reportPath}`);
console.log(`Result: ${report.result}`);
if (loadedEnvFiles.length > 0) console.log(`Loaded env files: ${loadedEnvFiles.join(", ")}`);
if (blockers.length > 0) {
  console.log("Blockers:");
  for (const blocker of blockers) console.log(`- ${blocker}`);
}

process.exitCode = blockers.length === 0 ? 0 : 1;
