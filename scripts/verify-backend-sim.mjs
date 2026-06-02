import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { BACKEND_CONTRACT_VERSION, validateBackendContractShape } from "../backend/contracts.mjs";
import { createCheckRecorder, summarizeChecks } from "./lib/verify-report.mjs";

const port = 19110;
const root = new URL("file:///");
root.pathname = process.cwd() + "/";
const serviceUrl = `http://127.0.0.1:${port}`;
const stateFile = `${process.cwd()}/.clawdesk-backend/state.test.json`;
const reportDir = path.join(process.cwd(), "artifacts", "backend-sim");
const { checks, pass, fail } = createCheckRecorder();

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

function evaluateTestCase(name, assertion, contractSurface = "mixed") {
  try {
    assertion();
    pass(name, undefined, contractSurface);
    return true;
  } catch (error) {
    fail(name, error.message, contractSurface);
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
    windowsHide: process.platform === "win32",
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
    assert(health.body.paymentProvider === "lemon-squeezy", "payment provider should be Lemon Squeezy");
    assert(health.body.licenseProvider === "lemon-license", "license provider should be Lemon license");
  }, "mixed");

  const contract = await request("/contract");
  evaluateTestCase("正式後端合約 manifest", () => {
    assert(contract.status === 200, "contract endpoint should be available");
    const validation = validateBackendContractShape(contract.body);
    assert(validation.ok === true, `contract should validate: ${validation.missingEndpoints.join(", ")}`);
  }, "canonical");

  const secretContract = await request("/provider/secret-refs/contract");
  const issuedSecretRef = await request("/provider/secret-refs/issue", {
    method: "POST",
    body: JSON.stringify({
      providerId: "openai-api",
      authMode: "api-key",
      model: "gpt-5.2",
      secretLabel: "sk-t...7890",
    }),
  });
  evaluateTestCase("Provider SecretRef 合約", () => {
    assert(secretContract.status === 200, "secret ref contract should be available");
    assert(secretContract.body.rawSecretResponse === false, "secret contract must not return raw secret");
    assert(issuedSecretRef.status === 200, "secret ref issue should be ok");
    assert(String(issuedSecretRef.body.secretRef).startsWith("psr_"), "secret ref should be opaque");
    assert(JSON.stringify(issuedSecretRef.body).includes("sk-test") === false, "secret ref response must not leak raw key");
  }, "canonical");

  const oauthSecretRef = await request("/provider/secret-refs/issue", {
    method: "POST",
    body: JSON.stringify({
      providerId: "openai-codex",
      authMode: "oauth",
      accountEmail: "codex@example.com",
      model: "gpt-5.3-codex",
    }),
  });
  const refreshedToken = await request("/provider/token-refresh", {
    method: "POST",
    body: JSON.stringify({ providerId: "openai-codex", secretRef: oauthSecretRef.body.secretRef }),
  });
  evaluateTestCase("Provider token refresh 只回傳 token reference", () => {
    assert(oauthSecretRef.status === 200, "oauth secret ref should issue");
    assert(refreshedToken.status === 200, "token refresh should be ok");
    assert(refreshedToken.body.status === "refreshed", "oauth refresh should be refreshed");
    assert(String(refreshedToken.body.accessTokenRef).startsWith("ptr_"), "refresh should return token reference");
    assert(JSON.stringify(refreshedToken.body).includes("codex@example.com") === false, "refresh must not leak account email");
  }, "canonical");

  const openAiRuntimeContract = await request("/provider/openai/runtime-contract");
  const openAiRuntimeValidate = await request("/provider/openai/validate-key", {
    method: "POST",
    body: JSON.stringify({ providerId: "openai-api", apiKey: "sk-test-1234567890", model: "gpt-5.2" }),
  });
  const openAiRuntimeChat = await request("/provider/openai/chat-test", {
    method: "POST",
    body: JSON.stringify({ providerId: "openai-api", apiKey: "sk-test-1234567890", model: "gpt-5.2", prompt: "ClawDesk runtime probe" }),
  });
  evaluateTestCase("OpenAI Responses API runtime dry-run", () => {
    assert(openAiRuntimeContract.status === 200, "OpenAI runtime contract should be available");
    assert(openAiRuntimeContract.body.apiStyle === "responses-api", "OpenAI runtime should use Responses API contract");
    assert(openAiRuntimeValidate.status === 200, "OpenAI validation dry-run should be ok");
    assert(openAiRuntimeValidate.body.status === "dry-run", "OpenAI validation should default to dry-run");
    assert(openAiRuntimeChat.status === 200, "OpenAI chat dry-run should be ok");
    assert(openAiRuntimeChat.body.status === "dry-run", "OpenAI chat should default to dry-run");
    assert(JSON.stringify(openAiRuntimeChat.body).includes("sk-test-1234567890") === false, "OpenAI runtime must not leak raw key");
  }, "canonical");

  const email = `verify-${randomUUID().slice(0, 8)}@example.com`;
  const password = "Password123!";
  const register = await request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password, displayName: "Verifier" }),
  });
  evaluateTestCase("Email 註冊流程", () => {
    assert(register.status === 200 || register.status === 201, "register should be ok");
    assert(register.body.ok === true, "register payload should be ok");
    assert(!!register.body.debugVerificationToken, "verification token should be returned");
  }, "canonical");

  const confirm = await request("/api/auth/verify-email", {
    method: "POST",
    body: JSON.stringify({ email, code: register.body.debugVerificationToken }),
  });
  evaluateTestCase("信箱驗證確認", () => {
    assert(confirm.status === 200, "confirm should be ok");
    assert(confirm.body.ok === true, "verify payload should be ok");
    assert(confirm.body.accountStatus === "active", "account status should be active");
  }, "canonical");

  const login = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  evaluateTestCase("帳號登入", () => {
    assert(login.status === 200, "login should be ok");
    assert(login.body.ok === true, "login payload should be ok");
    assert(login.body.session?.token?.length > 10, "session token should exist");
  }, "canonical");

  const token = login.body.session?.token ?? "";
  const session = await request("/api/auth/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  evaluateTestCase("Session 查詢", () => {
    assert(session.status === 200, "session should be valid");
    assert(session.body.ok === true, "session payload should be ok");
    assert(session.body.account?.email === email, "email should match");
  }, "canonical");

  const ssoProviders = await request("/auth/sso/providers");
  evaluateTestCase("SSO 提供者清單", () => {
    assert(ssoProviders.status === 200, "sso provider list should be available");
    assert(Array.isArray(ssoProviders.body.providers) && ssoProviders.body.providers.length >= 3, "providers should exist");
  }, "legacy");

  const fp = await request("/machine/fingerprint");
  evaluateTestCase("機器雜湊產生", () => {
    assert(fp.status === 200, "fingerprint should be available");
    assert(typeof fp.body.fingerprintHash === "string" && fp.body.fingerprintHash.length > 20, "fingerprint hash should be valid");
  }, "mixed");

  const activate = await request("/licenses/activate-key", {
    method: "POST",
    body: JSON.stringify({ licenseKey: "CLWD-BETA-PRO1-2026", machineFingerprintHash: fp.body.fingerprintHash }),
  });
  evaluateTestCase("授權啟用", () => {
    assert(activate.status === 200, "activate should be ok");
    assert(activate.body.license?.plan === "pro-yearly", "plan should be pro-yearly");
    assert(activate.body.offlineTicket?.token, "offline ticket should be returned");
  }, "legacy");

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
  }, "legacy");

  const webhook = await request("/webhooks/lemon", {
    method: "POST",
    body: JSON.stringify({
      eventType: "subscription_cancelled",
      licenseKey: "CLWD-BETA-PRO1-2026",
      note: "simulate cancellation",
    }),
  });
  evaluateTestCase("Webhook 更新授權", () => {
    assert(webhook.status === 200, "webhook should be accepted");
    assert(webhook.body.status === "ok", "webhook status should be ok");
  }, "legacy");

  const legal = await request("/legal/documents");
  const notices = await request("/legal/notices");
  evaluateTestCase("法務文件與通知", () => {
    assert(legal.status === 200, "legal docs should be available");
    assert(Array.isArray(legal.body.documents), "documents should be array");
    assert(notices.status === 200, "legal notices should be available");
    assert(Array.isArray(notices.body.notices), "notices should be array");
  }, "mixed");

  const updateCheck = await request("/updates/check");
  evaluateTestCase("更新檢查", () => {
    assert(updateCheck.status === 200, "update check should be ok");
    assert(typeof updateCheck.body.latestVersion === "string", "latestVersion should be string");
  }, "mixed");
} catch (error) {
  success = false;
  fail("verify-backend-sim", error.message, "mixed");
} finally {
  const counts = summarizeChecks(checks);
  const report = {
    service: "verify-backend-sim",
    createdAt: new Date().toISOString(),
    result: success ? "PASS" : "FAIL",
    checks,
    counts: { total: counts.total, failed: counts.failed },
    surfaces: counts.surfaces,
  };
  await fs.mkdir(reportDir, { recursive: true });
  const reportFile = path.join(reportDir, `${new Date().toISOString().replace(/[:.]/g, "_")}-report.json`);
  await fs.writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log("Backend sim verification:");
  for (const item of checks) {
    if (item.ok) console.log(`PASS ${item.name}`);
    else console.log(`FAIL ${item.name} -> ${item.reason}`);
  }
  console.log(JSON.stringify(report, null, 2));
  console.log(`Backend sim report: ${reportFile}`);
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
