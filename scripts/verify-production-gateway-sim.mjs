import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const backendPort = Number(process.env.CLAWDESK_PROD_SIM_BACKEND_PORT ?? 19120);
const gatewayPort = Number(process.env.CLAWDESK_PROD_SIM_GATEWAY_PORT ?? 19130);
const backendUrl = `http://127.0.0.1:${backendPort}`;
const gatewayUrl = `http://127.0.0.1:${gatewayPort}`;
const gatewayWsUrl = `ws://127.0.0.1:${gatewayPort}/events`;
const reportDir = path.join(process.cwd(), "artifacts", "production-gateway-sim");
const reportFile = path.join(reportDir, `${new Date().toISOString().replace(/[:.]/g, "_")}-report.json`);
const checks = [];

function pass(name, details) {
  checks.push({ name, ok: true, details });
  console.log(`PASS ${name}`);
}

function fail(name, error) {
  const message = error instanceof Error ? error.message : String(error);
  checks.push({ name, ok: false, error: message });
  console.log(`FAIL ${name}: ${message}`);
}

async function check(name, fn) {
  try {
    const details = await fn();
    pass(name, details);
  } catch (error) {
    fail(name, error);
  }
}

function spawnService(command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  return child;
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(1000)]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function request(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method ?? "GET",
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  return { ok: response.ok, status: response.status, payload };
}

async function waitForHealth(baseUrl, label) {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    try {
      const response = await request(baseUrl, "/health");
      if (response.ok) return response.payload;
    } catch {
      // retry
    }
    await delay(150);
  }
  throw new Error(`${label} health timeout`);
}

async function collectEvents(prompt) {
  const ws = new WebSocket(gatewayWsUrl);
  const events = [];
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WebSocket open timeout")), 4000);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.addEventListener("error", () => reject(new Error("WebSocket failed")));
  });
  ws.addEventListener("message", (message) => {
    events.push(JSON.parse(String(message.data)));
  });
  const chat = await request(gatewayUrl, "/chat", {
    method: "POST",
    body: { conversationId: "prod-gateway-sim", prompt },
  });
  if (chat.status !== 202) throw new Error(`chat status ${chat.status}`);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("stream timeout")), 5000);
    const interval = setInterval(() => {
      const types = new Set(events.map((event) => event.type));
      if (types.has("agent.message.done") && types.has("canvas.patch") && types.has("permission.request")) {
        clearTimeout(timer);
        clearInterval(interval);
        resolve();
      }
    }, 50);
  });
  const permission = events.find((event) => event.type === "permission.request");
  const permissionResult = await request(gatewayUrl, "/permission-result", {
    method: "POST",
    body: { type: "permission.result", requestId: permission.requestId, allowed: false, reason: "production sim deny" },
  });
  if (!permissionResult.ok) throw new Error("permission result rejected");
  ws.close();
  return events;
}

async function pidsFor(pattern) {
  if (process.platform === "win32") {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\//g, "[\\\\/]");
    const result = spawn("powershell.exe", [
      "-NoProfile",
      "-Command",
      `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match '${escaped}' } | Select-Object -ExpandProperty ProcessId`,
    ], { cwd: process.cwd(), stdio: ["ignore", "pipe", "ignore"] });
    let stdout = "";
    result.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    await new Promise((resolve) => result.once("exit", resolve));
    return stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }

  const result = spawn("pgrep", ["-f", pattern], { cwd: process.cwd(), stdio: ["ignore", "pipe", "ignore"] });
  let stdout = "";
  result.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  await new Promise((resolve) => result.once("exit", resolve));
  return stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

let backend;
let gateway;
try {
  const stateDir = path.join(process.cwd(), ".clawdesk-local-stack");
  await fs.mkdir(stateDir, { recursive: true });
  backend = spawnService(process.execPath, ["backend/server.mjs"], {
    CLAWDESK_BACKEND_PORT: String(backendPort),
    CLAWDESK_BACKEND_STATE_FILE: path.join(stateDir, "production-gateway-backend-state.json"),
    CLAWDESK_LICENSE_HMAC_KEY: "prod-gateway-sim-hmac",
    NODE_ENV: "production",
  });
  await waitForHealth(backendUrl, "backend");
  gateway = spawnService(process.execPath, ["backend/production-gateway-sim.mjs"], {
    CLAWDESK_PRODUCTION_GATEWAY_PORT: String(gatewayPort),
    CLAWDESK_BACKEND_BASE_URL: backendUrl,
    NODE_ENV: "production",
  });
  await waitForHealth(gatewayUrl, "production gateway");

  await check("production Gateway health is external and not sidecar mock", async () => {
    const health = await request(gatewayUrl, "/health");
    if (!health.ok) throw new Error(`health ${health.status}`);
    if (health.payload.name !== "clawdesk-production-gateway-sim") throw new Error("wrong gateway name");
    if (health.payload.sidecar !== false) throw new Error("gateway must not be sidecar");
    if (JSON.stringify(health.payload).includes("clawdesk-mock-gateway")) throw new Error("health leaked mock gateway identity");
    return health.payload;
  });

  await check("production Gateway contract exposes desktop streaming surface", async () => {
    const contract = await request(gatewayUrl, "/contract");
    if (!contract.ok) throw new Error(`contract ${contract.status}`);
    const keys = new Set(contract.payload.endpoints.map((endpoint) => `${endpoint.method}:${endpoint.path}`));
    for (const key of ["GET:/events", "POST:/chat", "POST:/permission-result", "GET:/identity/session", "POST:/license/activate-key"]) {
      if (!keys.has(key)) throw new Error(`missing ${key}`);
    }
  });

  const email = `prod-sim-${randomUUID().slice(0, 8)}@example.com`;
  const password = "Password123!";
  await check("identity bridge register confirm login", async () => {
    const registered = await request(gatewayUrl, "/identity/register", {
      method: "POST",
      body: { email, password, displayName: "Production Sim", mode: "personal" },
    });
    if (!registered.ok || !registered.payload.emailVerificationPending) throw new Error("register failed");
    const code = await request(gatewayUrl, `/identity/verification-code?email=${encodeURIComponent(email)}`);
    if (!code.ok || !code.payload.code) throw new Error("verification code missing");
    const confirmed = await request(gatewayUrl, "/identity/confirm", { method: "POST", body: { email, code: code.payload.code } });
    if (!confirmed.ok) throw new Error("confirm failed");
    const login = await request(gatewayUrl, "/identity/login", { method: "POST", body: { email, password } });
    if (!login.ok || !login.payload.authenticated) throw new Error("login failed");
    const session = await request(gatewayUrl, "/identity/session");
    if (!session.ok || session.payload.email !== email) throw new Error("session failed");
  });

  await check("Keygen/Paddle license bridge activates through production Gateway", async () => {
    const fp = await request(gatewayUrl, "/machine/fingerprint");
    if (!fp.ok || !fp.payload.fingerprintHash) throw new Error("fingerprint missing");
    const activated = await request(gatewayUrl, "/license/activate-key", {
      method: "POST",
      body: { licenseKey: "CLWD-PRO-YEARLY-2026-DEV" },
    });
    if (!activated.ok || activated.payload.status.status !== "active") throw new Error("activation failed");
    const status = await request(gatewayUrl, "/license/status");
    if (!status.ok || status.payload.status.licenseProvider !== "keygen") throw new Error("license status failed");
  });

  await check("WebSocket stream and permission roundtrip use production Gateway", async () => {
    const events = await collectEvents("驗證 production Gateway simulator");
    const types = new Set(events.map((event) => event.type));
    if (!types.has("gateway.status") || !types.has("agent.message.done") || !types.has("canvas.patch")) {
      throw new Error("required stream events missing");
    }
  });

  await check("production simulation does not launch desktop mock sidecar", async () => {
    const sidecarPids = await pidsFor("sidecars/mock-gateway/server.mjs");
    const ownPid = String(process.pid);
    const filtered = sidecarPids.filter((pid) => pid !== ownPid);
    if (filtered.length > 0) throw new Error(`mock sidecar running: ${filtered.join(",")}`);
    return { sidecarPids: filtered };
  });
} finally {
  await stop(gateway);
  await stop(backend);
  const report = {
    service: "verify-production-gateway-sim",
    createdAt: new Date().toISOString(),
    gatewayUrl,
    backendUrl,
    result: checks.every((check) => check.ok) ? "PASS" : "FAIL",
    checks,
    counts: { total: checks.length, failed: checks.filter((check) => !check.ok).length },
  };
  await fs.mkdir(reportDir, { recursive: true });
  await fs.writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Production Gateway sim report: ${reportFile}`);
  console.log(`Result: ${report.result}`);
  if (report.result !== "PASS") process.exitCode = 1;
}
