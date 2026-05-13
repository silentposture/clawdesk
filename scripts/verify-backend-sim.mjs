import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { BACKEND_CONTRACT_VERSION, validateBackendContractShape } from "../backend/contracts.mjs";

const port = 19110;
const root = new URL("file:///");
root.pathname = process.cwd() + "/";
const serviceUrl = `http://127.0.0.1:${port}`;
const stateFile = `${process.cwd()}/.clawdesk-backend/state.test.json`;
const checks = [];

function assert(condition, message) {
  if (!condition) {
    throw new Error(`ASSERT_FAIL: ${message}`);
  }
}

async function request(path, options = {}) {
  const url = `${serviceUrl}${path}`;
  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    ...options,
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return { status: res.status, body };
}

function pass(name) {
  checks.push({ name, ok: true });
}

function fail(name, reason) {
  checks.push({ name, ok: false, reason });
}

async function waitForHealth(signal) {
  const timeout = Date.now() + 8000;
  while (Date.now() < timeout) {
    try {
      const { status, body } = await request("/health");
      if (status === 200 && body.version) return;
      await delay(150, signal);
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      await delay(150, signal);
    }
  }
  throw new Error("Backend simulator health timeout");
}

function evaluateTestCase(name, assertion) {
  try {
    assertion();
    pass(name);
    return true;
  } catch (error) {
    fail(name, error.message);
    return false;
  }
}

const server = spawn(
  "node",
  ["backend/server.mjs"],
  {
    env: {
      ...process.env,
      CLAWDESK_BACKEND_PORT: String(port),
      CLAWDESK_BACKEND_STATE_FILE: stateFile,
      CLAWDESK_LICENSE_HMAC_KEY: "verify-sim-hmac-secret",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
server.stderr.on("data", (chunk) => process.stderr.write(`[backend] ${chunk}`));

let exitCode = 0;
server.on("exit", (code) => {
  exitCode = code ?? 0;
});

let success = true;
const controller = new AbortController();

try {
  await waitForHealth(controller.signal);

  const health = await request("/health");
  evaluateTestCase("後端健康檢查", () => {
    assert(health.status === 200, "health status should be 200");
    assert(health.body.service.includes("ClawDesk"), "service name should contain ClawDesk");
    assert(health.body.contractVersion === BACKEND_CONTRACT_VERSION, "contract version should match shared contract");
    assert(health.body.paymentProvider === "paddle", "payment provider should be Paddle");
    assert(health.body.licenseProvider === "keygen", "license provider should be Keygen");
  });

  const contract = await request("/contract");
  evaluateTestCase("正式後端合約 manifest", () => {
    assert(contract.status === 200, "contract endpoint should be available");
    const validation = validateBackendContractShape(contract.body);
    assert(validation.ok === true, `contract should validate: ${validation.missingEndpoints.join(", ")}`);
  });

  const email = `verify-${randomUUID().slice(0, 8)}@example.com`;
  const password = "Password123!";
  const register = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password, displayName: "Verifier" }),
  });
  evaluateTestCase("Email 註冊流程", () => {
    assert(register.status === 200, "register should be ok");
    assert(!!register.body.debugVerificationToken, "verification token should be returned");
  });

  const confirm = await request("/auth/confirm", {
    method: "POST",
    body: JSON.stringify({ email, code: register.body.debugVerificationToken }),
  });
  evaluateTestCase("信箱驗證確認", () => {
    assert(confirm.status === 200, "confirm should be ok");
    assert(confirm.body.status === "verified", "status should be verified");
  });

  const login = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  evaluateTestCase("帳號登入", () => {
    assert(login.status === 200, "login should be ok");
    assert(login.body.session?.token?.length > 10, "session token should exist");
  });

  const token = login.body.session?.token ?? "";
  const session = await request(`/auth/session?token=${token}`);
  evaluateTestCase("Session 查詢", () => {
    assert(session.status === 200, "session should be valid");
    assert(session.body.session.email === email, "email should match");
  });

  const ssoProviders = await request("/auth/sso/providers");
  evaluateTestCase("SSO 提供者清單", () => {
    assert(ssoProviders.status === 200, "sso provider list should be available");
    assert(Array.isArray(ssoProviders.body.providers) && ssoProviders.body.providers.length >= 3, "providers should exist");
  });

  const fp = await request("/machine/fingerprint");
  evaluateTestCase("機器雜湊產生", () => {
    assert(fp.status === 200, "fingerprint should be available");
    assert(typeof fp.body.fingerprintHash === "string" && fp.body.fingerprintHash.length > 20, "fingerprint hash should be valid");
  });

  const activate = await request("/licenses/activate-key", {
    method: "POST",
    body: JSON.stringify({ licenseKey: "CLWD-PRO-YEARLY-2026-DEV", machineFingerprintHash: fp.body.fingerprintHash }),
  });
  evaluateTestCase("授權啟用", () => {
    assert(activate.status === 200, "activate should be ok");
    assert(activate.body.license?.plan === "pro-yearly", "plan should be pro-yearly");
    assert(activate.body.offlineTicket?.token, "offline ticket should be returned");
  });

  const validate = await request("/licenses/validate", {
    method: "POST",
    body: JSON.stringify({
      offlineTicket: activate.body.offlineTicket.token,
      machineFingerprintHash: fp.body.fingerprintHash,
    }),
  });
  evaluateTestCase("離線票券驗證", () => {
    assert(validate.status === 200, "validate should be ok");
    assert(validate.body.status === "active", "status should be active");
    assert(validate.body.machineMatched === true, "machine should match");
  });

  const webhook = await request("/webhooks/paddle", {
    method: "POST",
    body: JSON.stringify({
      eventType: "subscription.canceled",
      licenseKey: "CLWD-PRO-YEARLY-2026-DEV",
      note: "simulate cancellation",
    }),
  });
  evaluateTestCase("Webhook 更新授權", () => {
    assert(webhook.status === 200, "webhook should be accepted");
    assert(webhook.body.status === "ok", "webhook status should be ok");
  });

  const legal = await request("/legal/documents");
  const notices = await request("/legal/notices");
  evaluateTestCase("法務文件與通知", () => {
    assert(legal.status === 200, "legal docs should be available");
    assert(Array.isArray(legal.body.documents), "documents should be array");
    assert(notices.status === 200, "legal notices should be available");
    assert(Array.isArray(notices.body.notices), "notices should be array");
  });

  const updateCheck = await request("/updates/check");
  evaluateTestCase("更新檢查", () => {
    assert(updateCheck.status === 200, "update check should be ok");
    assert(typeof updateCheck.body.latestVersion === "string", "latestVersion should be string");
  });
} catch (error) {
  success = false;
  fail("verify-backend-sim", error.message);
} finally {
  const report = {
    service: "verify-backend-sim",
    createdAt: new Date().toISOString(),
    result: success ? "PASS" : "FAIL",
    checks,
    counts: { total: checks.length, failed: checks.filter((i) => !i.ok).length },
  };
  console.log("Backend sim verification:");
  for (const item of checks) {
    if (item.ok) console.log(`PASS ${item.name}`);
    else console.log(`FAIL ${item.name} -> ${item.reason}`);
  }
  console.log(JSON.stringify(report, null, 2));
  controller.abort();
  server.kill("SIGTERM");
  await delay(300);
  if (!success && server.killed === false) {
    server.kill("SIGKILL");
  }
  if (!success || exitCode !== 0) {
    process.exit(1);
  }
}
