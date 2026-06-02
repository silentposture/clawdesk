import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const port = Number(process.env.CLAWDESK_VERIFY_LEMON_PORT ?? 19140);
const baseUrl = `http://127.0.0.1:${port}`;
const secret = "verify-lemon-webhook-secret";
const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "clawdesk-lemon-prod-"));
const stateFile = path.join(stateDir, "state.json");
const checks = [];

function pass(name, details = {}) {
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

function sign(rawBody) {
  return crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
}

async function request(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    body: options.rawBody ?? (options.body ? JSON.stringify(options.body) : undefined),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  return { ok: response.ok, status: response.status, payload };
}

async function waitForHealth() {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    try {
      const health = await request("/health");
      if (health.ok) return health.payload;
    } catch {
      // retry until backend is ready
    }
    await delay(100);
  }
  throw new Error("Lemon production backend health timeout");
}

async function postLemonWebhook(body, signature = null) {
  const rawBody = JSON.stringify(body);
  return request("/webhooks/lemon", {
    method: "POST",
    rawBody,
    headers: signature ? { "X-Signature": signature } : {},
  });
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(1000)]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

const server = spawn(process.execPath, ["backend/server.mjs"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    CLAWDESK_BACKEND_PORT: String(port),
    CLAWDESK_BACKEND_STATE_FILE: stateFile,
    CLAWDESK_BACKEND_ADAPTER_MODE: "production",
    CLAWDESK_GATEWAY_BASE_URL: "https://api.example.test",
    LEMON_SQUEEZY_WEBHOOK_SECRET: secret,
    LEMON_SQUEEZY_STORE_ID: "store_1",
    LEMON_SQUEEZY_PRODUCT_ID: "product_1",
    LEMON_SQUEEZY_VARIANT_ID_PRO_YEARLY: "variant_yearly",
    LEMON_SQUEEZY_VARIANT_ID_LIFETIME: "variant_lifetime",
    NODE_ENV: "production",
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: process.platform === "win32",
});
server.stderr.on("data", (chunk) => process.stderr.write(`[lemon-prod] ${chunk}`));

try {
  await waitForHealth();

  await check("production readiness requires complete beta direct Lemon env", async () => {
    const health = await request("/health");
    if (!health.ok) throw new Error("health failed");
    if (health.payload.adapterMode !== "production") throw new Error("backend did not start in production adapter mode");
    if (health.payload.betaDirectEnv.ready !== true) throw new Error(`betaDirectEnv missing: ${health.payload.betaDirectEnv.missing.join(",")}`);
    const serialized = JSON.stringify(health.payload);
    if (serialized.includes(secret)) throw new Error("health leaked Lemon webhook secret");
  });

  await check("unsigned Lemon webhook is rejected in production mode", async () => {
    const response = await postLemonWebhook({ eventType: "license_key_created", licenseKey: "CLWD-BETA-PRO1-2026" });
    if (response.status !== 401) throw new Error(`expected 401, got ${response.status}`);
    if (JSON.stringify(response.payload).includes(secret)) throw new Error("error payload leaked secret");
  });

  await check("mismatched Lemon webhook signature is rejected", async () => {
    const response = await postLemonWebhook(
      { eventType: "license_key_created", licenseKey: "CLWD-BETA-PRO1-2026" },
      "0".repeat(64),
    );
    if (response.status !== 401) throw new Error(`expected 401, got ${response.status}`);
    if (response.payload.faultCode !== "CLWD-LEM-1005") throw new Error(`unexpected fault ${response.payload.faultCode}`);
  });

  await check("valid license_key_created webhook creates licensed entitlement", async () => {
    const body = {
      meta: { event_name: "license_key_created" },
      licenseKey: "CLWD-BETA-PRO1-2026",
      machineFingerprintHash: "mfp_verify_lemon",
      data: { attributes: { variant_name: "Pro Yearly" } },
    };
    const rawBody = JSON.stringify(body);
    const response = await postLemonWebhook(body, sign(rawBody));
    if (!response.ok) throw new Error(`webhook failed ${response.status}`);
    if (response.payload.entitlement?.status !== "licensed") throw new Error("entitlement must be licensed");
    if (response.payload.license?.status !== "active") throw new Error("license must be active");
  });

  await check("valid refund webhook downgrades entitlement to safe-mode", async () => {
    const body = {
      meta: { event_name: "refund_created" },
      licenseKey: "CLWD-BETA-PRO1-2026",
      machineFingerprintHash: "mfp_verify_lemon",
      data: { attributes: { variant_name: "Pro Yearly" } },
    };
    const rawBody = JSON.stringify(body);
    const response = await postLemonWebhook(body, sign(rawBody));
    if (!response.ok) throw new Error(`refund webhook failed ${response.status}`);
    if (response.payload.entitlement?.status !== "safe-mode") throw new Error("refund must downgrade entitlement");
    if (response.payload.license?.status !== "safe-mode") throw new Error("license must be safe-mode");
  });

  await check("valid subscription_cancelled webhook remains safe-mode", async () => {
    const body = {
      meta: { event_name: "subscription_cancelled" },
      licenseKey: "CLWD-BETA-PRO1-2026",
      machineFingerprintHash: "mfp_verify_lemon",
      data: { attributes: { variant_name: "Pro Yearly" } },
    };
    const rawBody = JSON.stringify(body);
    const response = await postLemonWebhook(body, sign(rawBody));
    if (!response.ok) throw new Error(`cancel webhook failed ${response.status}`);
    if (response.payload.entitlement?.status !== "safe-mode") throw new Error("cancel must keep entitlement in safe-mode");
  });

  await check("disabled providers stay rejected", async () => {
    const paddle = await request("/webhooks/paddle", { method: "POST", body: { eventType: "order_created" } });
    const keygen = await request("/webhooks/keygen", { method: "POST", body: { eventType: "license.created" } });
    if (paddle.status !== 410) throw new Error(`Paddle expected 410, got ${paddle.status}`);
    if (keygen.status !== 410) throw new Error(`Keygen expected 410, got ${keygen.status}`);
  });
} finally {
  await stop(server);
  const report = {
    service: "verify-lemon-production",
    createdAt: new Date().toISOString(),
    result: checks.every((item) => item.ok) ? "PASS" : "FAIL",
    checks,
    counts: { total: checks.length, failed: checks.filter((item) => !item.ok).length },
  };
  const reportDir = path.join(process.cwd(), "artifacts", "lemon-production");
  await fs.mkdir(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `${new Date().toISOString().replace(/[:.]/g, "_")}-report.json`);
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Lemon production verification report: ${reportPath}`);
  console.log(`Result: ${report.result}`);
  if (report.result !== "PASS") process.exitCode = 1;
}
