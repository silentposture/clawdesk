import dns from "node:dns/promises";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import tls from "node:tls";

const cwd = process.cwd();
const host = process.env.CLAWDESK_PUBLIC_GATEWAY_HOST || "api.clawdesk.example";
const reportDir = path.join(cwd, "artifacts", "gateway-public-doctor");
const timeoutMs = Number(process.env.CLAWDESK_PUBLIC_GATEWAY_TIMEOUT_MS ?? 8000);

function withTimeout(promise, label) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

async function resolveRecords(recordType) {
  try {
    return { ok: true, records: await dns.resolve(host, recordType) };
  } catch (error) {
    return { ok: false, records: [], error: error instanceof Error ? error.message : String(error) };
  }
}

async function tcpProbe(port) {
  return withTimeout(new Promise((resolve, reject) => {
    const socket = net.connect({ host, port }, () => {
      socket.end();
      resolve({ ok: true, port });
    });
    socket.on("error", (error) => reject(error));
  }), `tcp:${port}`);
}

async function tlsProbe() {
  return withTimeout(new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port: 443, servername: host }, () => {
      const cert = socket.getPeerCertificate();
      const authorizationError = socket.authorizationError;
      socket.end();
      resolve({
        ok: socket.authorized,
        authorized: socket.authorized,
        authorizationError: authorizationError || null,
        subject: cert?.subject ?? {},
        issuer: cert?.issuer ?? {},
        validFrom: cert?.valid_from ?? "",
        validTo: cert?.valid_to ?? "",
        subjectaltname: cert?.subjectaltname ?? "",
      });
    });
    socket.on("error", (error) => reject(error));
  }), "tls:443");
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
    const text = await response.text();
    const contentType = response.headers.get("content-type") ?? "";
    let payload = null;
    if (contentType.includes("application/json") && text) payload = JSON.parse(text);
    return {
      ok: response.ok,
      status: response.status,
      contentType,
      payload,
      bodyPreview: payload ? undefined : text.slice(0, 160),
    };
  } finally {
    clearTimeout(timer);
  }
}

function healthIssues(result) {
  const issues = [];
  if (!result.ok) issues.push(`health-http-${result.status}`);
  if (!result.contentType.includes("application/json")) issues.push("health-not-json");
  if (!result.payload || typeof result.payload !== "object") issues.push("health-missing-json-payload");
  if (JSON.stringify(result.payload ?? {}).includes("clawdesk-mock-gateway")) issues.push("health-identifies-mock-gateway");
  return issues;
}

const checks = [];
const blockers = [];

const a = await resolveRecords("A");
checks.push({ name: "dns-a", ...a });
if (!a.ok || a.records.length === 0) blockers.push("dns-a-missing");

const aaaa = await resolveRecords("AAAA");
checks.push({ name: "dns-aaaa", ...aaaa, required: false });

try {
  const tcp = await tcpProbe(443);
  checks.push({ name: "tcp-443", ...tcp });
} catch (error) {
  checks.push({ name: "tcp-443", ok: false, error: error instanceof Error ? error.message : String(error) });
  blockers.push("tcp-443-unreachable");
}

try {
  const tls = await tlsProbe();
  checks.push({ name: "tls-certificate", ...tls });
  if (!tls.ok) blockers.push(`tls-invalid:${tls.authorizationError ?? "unknown"}`);
  if (tls.subjectaltname && !tls.subjectaltname.includes(host)) blockers.push("tls-san-missing-host");
} catch (error) {
  checks.push({ name: "tls-certificate", ok: false, error: error instanceof Error ? error.message : String(error) });
  blockers.push("tls-probe-failed");
}

try {
  const health = await fetchJson(`https://${host}/health`);
  const issues = healthIssues(health);
  checks.push({ name: "https-health", ...health, issues });
  blockers.push(...issues);
} catch (error) {
  checks.push({ name: "https-health", ok: false, error: error instanceof Error ? error.message : String(error) });
  blockers.push("https-health-failed");
}

const report = {
  createdAt: new Date().toISOString(),
  host,
  publicUrl: `https://${host}`,
  result: blockers.length === 0 ? "PASS" : "BLOCKED",
  checks,
  blockers,
  nextActions: blockers.length === 0
    ? ["Set CLAWDESK_GATEWAY_BASE_URL to this host and run npm run gateway:doctor."]
    : [
        "Create DNS A/AAAA record for api.clawdesk.example.",
        "Install a valid TLS certificate for api.clawdesk.example.",
        "Start the production Gateway and expose GET /health through HTTPS.",
      ],
};

await fs.mkdir(reportDir, { recursive: true });
const reportPath = path.join(reportDir, `${new Date().toISOString().replace(/[:.]/g, "_")}-gateway-public-doctor.json`);
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(`Gateway public doctor report: ${reportPath}`);
console.log(`Result: ${report.result}`);
if (blockers.length > 0) {
  console.log("Blockers:");
  for (const blocker of blockers) console.log(`- ${blocker}`);
}

process.exitCode = blockers.length === 0 ? 0 : 1;
