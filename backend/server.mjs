import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { URL } from "node:url";
import {
  BACKEND_CONTRACT,
  createBackendHealthPayload,
} from "./contracts.mjs";
import { createBackendAdapters } from "./adapters/index.mjs";

const port = Number(process.env.CLAWDESK_BACKEND_PORT ?? 19090);
const host = "127.0.0.1";
const hmacSecret = process.env.CLAWDESK_LICENSE_HMAC_KEY ?? "change-me-please";
const envStateFile = process.env.CLAWDESK_BACKEND_STATE_FILE ?? "";
const stateFilePath = envStateFile
  ? path.resolve(envStateFile)
  : path.resolve(process.cwd(), ".clawdesk-backend", "state.json");
const devBypassEmail = process.env.CLAWDESK_DEV_BYPASS_EMAIL;
const devBypassPassword = process.env.CLAWDESK_DEV_BYPASS_PASSWORD ?? "";
const clawdeskOwnerEmail = "support@clawdesk.example";
const clawDeskProductKey = "clawdesk";
const baseUrl = `http://${host}:${port}`;
const adapters = createBackendAdapters({ env: process.env });
const nowIso = () => new Date().toISOString();
const openAiApiBaseUrl = (process.env.CLAWDESK_OPENAI_API_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const naviaSigningKeyPair = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const naviaPublicKeyPem = naviaSigningKeyPair.publicKey.export({ type: "spki", format: "pem" }).toString();
const naviaSigningKeyId = "clawdesk-local-ecdsa-v1";

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function sign(payload) {
  return crypto.createHmac("sha256", hmacSecret).update(payload).digest("hex");
}

function randomId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function json(res, code, body) {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Access-Control-Allow-Origin": "*",
  });
  res.end(payload);
}

function redact(value) {
  if (typeof value !== "string") return value;
  if (value.includes("@")) return `hash:${hash(value).slice(0, 16)}`;
  if (value.startsWith("sk-")) return `hash:${hash(value).slice(0, 12)}`;
  return value;
}

function redactDiagnosticText(input) {
  return String(input ?? "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]")
    .replace(/\bsk-ant-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(/\bsk-or-v1-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(/\bgsk_[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(/\bxai-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(/\bAIza[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(/\bCLWD-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}\b/g, "[REDACTED]")
    .replace(/\bCLWD-BETA-[A-Z0-9]{4}-[0-9]{4}\b/g, "[REDACTED]")
    .replace(/\/Users\/[^/\s]+\/[^\s]+/g, "[REDACTED]")
    .replace(/[A-Z]:\\(?:[^\\\s]+\\)*[^\\\s]+/gi, "[REDACTED]")
    .replace(/\b(?:paddle_customer|lem_customer|lemon_customer)_[A-Za-z0-9_-]+\b/g, "[REDACTED]");
}

function auditTrail(action, detail) {
  const safeDetail = Array.isArray(detail) ? detail : { ...detail };
  if (safeDetail.email) safeDetail.email = redact(safeDetail.email);
  if (safeDetail.accountEmail) safeDetail.accountEmail = redact(safeDetail.accountEmail);
  if (safeDetail.apiKey) safeDetail.apiKey = redact(safeDetail.apiKey);
  if (safeDetail.code) safeDetail.code = "redacted";
  state.audit.unshift({
    id: randomId("aud"),
    at: nowIso(),
    action,
    detail: safeDetail,
  });
  if (state.audit.length > 250) state.audit.length = 250;
}

function fingerprint() {
  const cpus = os.cpus();
  const raw = `${os.platform()}|${os.arch()}|${os.hostname()}|${cpus[0]?.model ?? "unknown"}|${cpus.length}`;
  return {
    fingerprintHash: `mfp_salted_${hash(raw)}`,
    hardwareSources: ["platform", "arch", "hostname", "cpu-model", "cpu-count"],
    platform: os.platform() === "win32" ? "Windows" : os.platform(),
    confidence: 0.85,
    createdAt: nowIso(),
  };
}

function supportUntil(plan, issuedAt) {
  const base = new Date(issuedAt);
  if (plan === "lifetime-local") {
    base.setUTCMonth(base.getUTCMonth() + 12);
    return base.toISOString();
  }
  if (plan === "pro-yearly") {
    base.setUTCFullYear(base.getUTCFullYear() + 1);
    return base.toISOString();
  }
  if (plan === "pro-monthly") {
    base.setUTCMonth(base.getUTCMonth() + 1);
    return base.toISOString();
  }
  return null;
}

function normalizePlanKey(value) {
  return String(value ?? "").trim().toLowerCase();
}

function resolveClawDeskPlan(input) {
  const planKey = normalizePlanKey(input);
  switch (planKey) {
    case "clawdesk.lifetime_updates_1y_1dev":
    case "clawdesk_perpetual_updates_1y_1dev":
    case "perpetual_updates_1y_1dev":
      return {
        canonicalPlanKey: "clawdesk.lifetime_updates_1y_1dev",
        licensePlan: "lifetime-local",
        licenseType: "perpetual_with_updates_1y",
        maxDevices: 1,
      };
    case "clawdesk.lifetime_updates_1y_2dev":
    case "clawdesk_perpetual_updates_1y_2dev":
    case "perpetual_updates_1y_2dev":
      return {
        canonicalPlanKey: "clawdesk.lifetime_updates_1y_2dev",
        licensePlan: "lifetime-local",
        licenseType: "perpetual_with_updates_1y",
        maxDevices: 2,
      };
    case "clawdesk.subscription.monthly.1dev":
    case "clawdesk_sub_30d_1dev":
    case "subscription_30d_1dev":
    case "sub_30d_1dev":
      return {
        canonicalPlanKey: "clawdesk.subscription.monthly.1dev",
        licensePlan: "pro-monthly",
        licenseType: "subscription",
        maxDevices: 1,
      };
    case "clawdesk.subscription.yearly.2dev":
    case "clawdesk_sub_365d_2dev":
    case "subscription_365d_2dev":
    case "sub_365d_2dev":
      return {
        canonicalPlanKey: "clawdesk.subscription.yearly.2dev",
        licensePlan: "pro-yearly",
        licenseType: "subscription",
        maxDevices: 2,
      };
    case "clawdesk.trial.14d.1dev":
    case "clawdesk_trial_14d_1dev":
    case "trial_14d_1dev":
      return {
        canonicalPlanKey: "clawdesk.trial.14d.1dev",
        licensePlan: "trial",
        licenseType: "trial",
        maxDevices: 1,
      };
    default:
      return {
        canonicalPlanKey: "clawdesk.lifetime_updates_1y_1dev",
        licensePlan: "lifetime-local",
        licenseType: "perpetual_with_updates_1y",
        maxDevices: 1,
      };
  }
}

function canonicalPlanKeyForLicense(licenseKey) {
  const normalized = normalizeLemonLicenseKey(licenseKey);
  return normalized.includes("LIFE")
    ? "clawdesk.lifetime_updates_1y_2dev"
    : "clawdesk.subscription.yearly.2dev";
}

function normalizeLemonLicenseKey(input) {
  return String(input ?? "").trim().toUpperCase().replace(/\s+/g, "-");
}

function isMockLemonLicenseKey(input) {
  return /^CLWD-BETA-[A-Z0-9]{4}-[0-9]{4}$/.test(normalizeLemonLicenseKey(input));
}

function hashLicenseKeyForStorage(licenseKey) {
  return `lk_${hash(`clawdesk-beta-direct:${normalizeLemonLicenseKey(licenseKey)}`).slice(0, 24)}`;
}

function normalizeProviderId(input) {
  const providerId = String(input ?? "").trim().toLowerCase();
  if (!/^[a-z0-9-]{2,80}$/.test(providerId)) {
    return "";
  }
  return providerId;
}

function providerSecretRefFor(payload) {
  const providerId = normalizeProviderId(payload.providerId);
  const authMode = String(payload.authMode ?? "api-key").trim();
  const source = `${providerId}|${authMode}|${payload.accountEmail ?? ""}|${payload.endpoint ?? ""}|${payload.model ?? ""}`;
  return `psr_${hash(`clawdesk-provider-secret-ref:${source}`).slice(0, 24)}`;
}

function providerSecretRefContract() {
  return {
    version: "2026-05-15.provider-secret-ref.v1",
    storage: "server-side-secret-ref",
    rawSecretResponse: false,
    issueEndpoint: "/provider/secret-refs/issue",
    refreshEndpoint: "/provider/token-refresh",
    redactionRequired: true,
    supportedAuthModes: ["api-key", "oauth", "local-endpoint"],
  };
}

function openAiRuntimeContract() {
  return {
    version: "2026-05-15.openai-runtime.v1",
    providerIds: ["openai", "openai-api"],
    apiStyle: "responses-api",
    apiBaseUrl: openAiApiBaseUrl,
    responseEndpoint: "/v1/responses",
    modelFallback: "gpt-4o-mini",
    rawSecretResponse: false,
    endpoints: [
      { method: "GET", path: "/provider/openai/runtime-contract" },
      { method: "POST", path: "/provider/openai/validate-key" },
      { method: "POST", path: "/provider/openai/chat-test" },
    ],
    liveMode: {
      defaultEnabled: false,
      enableFlag: "CLAWDESK_OPENAI_LIVE_TEST",
      secretSources: ["request.apiKey", "OPENAI_API_KEY"],
    },
  };
}

function normalizeOpenAiProviderId(value) {
  const providerId = String(value ?? "openai-api").trim().toLowerCase();
  return providerId === "openai" || providerId === "openai-api" ? providerId : "";
}

function normalizeOpenAiModel(value) {
  const model = String(value ?? "").trim();
  return model || "gpt-4o-mini";
}

function liveOpenAiRequested(body = {}) {
  const flag = String(process.env.CLAWDESK_OPENAI_LIVE_TEST ?? "").trim().toLowerCase();
  return body.live === true || ["1", "true", "yes"].includes(flag);
}

function openAiApiKeyFromBodyOrEnv(body = {}) {
  const requestKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  return requestKey || process.env.OPENAI_API_KEY || "";
}

function safeOpenAiErrorPayload(error, status = 502) {
  const message = error instanceof Error ? error.message : String(error ?? "OpenAI request failed");
  return {
    status: "failed",
    live: true,
    errorCode: "OPENAI_RUNTIME_FAILED",
    error: redactDiagnosticText(message).slice(0, 240),
    httpStatus: status,
    rawSecretResponse: false,
  };
}

function extractOpenAiResponseText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  const output = Array.isArray(payload?.output) ? payload.output : [];
  return output
    .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
    .map((content) => content.text)
    .filter((value) => typeof value === "string" && value.trim())
    .join("\n")
    .trim();
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const requestId = response.headers.get("x-request-id") || undefined;
    const payload = await response.json().catch(() => ({}));
    return { response, requestId, payload };
  } finally {
    clearTimeout(timeout);
  }
}

async function validateOpenAiKeyRuntime(body = {}) {
  const providerId = normalizeOpenAiProviderId(body.providerId);
  if (!providerId) return { code: 400, payload: { error: "Unsupported OpenAI provider", rawSecretResponse: false } };
  const model = normalizeOpenAiModel(body.model);
  const checkedAt = nowIso();
  if (!liveOpenAiRequested(body)) {
    return {
      code: 200,
      payload: {
        providerId,
        model,
        status: "dry-run",
        live: false,
        checkedAt,
        rawSecretResponse: false,
        message: "OpenAI API key shape accepted; live validation is disabled for this run.",
      },
    };
  }
  const apiKey = openAiApiKeyFromBodyOrEnv(body);
  if (!apiKey.startsWith("sk-")) {
    return { code: 400, payload: { error: "OpenAI API key is required for live validation", rawSecretResponse: false } };
  }
  try {
    const { response, requestId } = await fetchJsonWithTimeout(`${openAiApiBaseUrl}/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "X-Client-Request-Id": `clawdesk-openai-validate-${crypto.randomUUID()}`,
      },
    });
    if (!response.ok) {
      return { code: response.status, payload: safeOpenAiErrorPayload(`OpenAI validation failed with ${response.status}`, response.status) };
    }
    return {
      code: 200,
      payload: { providerId, model, status: "validated", live: true, checkedAt, requestId, rawSecretResponse: false },
    };
  } catch (error) {
    return { code: 502, payload: safeOpenAiErrorPayload(error) };
  }
}

async function runOpenAiChatRuntime(body = {}) {
  const providerId = normalizeOpenAiProviderId(body.providerId);
  if (!providerId) return { code: 400, payload: { error: "Unsupported OpenAI provider", rawSecretResponse: false } };
  const model = normalizeOpenAiModel(body.model);
  const checkedAt = nowIso();
  const prompt = typeof body.prompt === "string" && body.prompt.trim()
    ? body.prompt.trim()
    : "Reply with a short ClawDesk OpenAI runtime check.";
  if (!liveOpenAiRequested(body)) {
    return {
      code: 200,
      payload: {
        providerId,
        model,
        status: "dry-run",
        live: false,
        checkedAt,
        outputText: `Dry-run OK: ${model} would be called through ${openAiApiBaseUrl}/responses.`,
        rawSecretResponse: false,
      },
    };
  }
  const apiKey = openAiApiKeyFromBodyOrEnv(body);
  if (!apiKey.startsWith("sk-")) {
    return { code: 400, payload: { error: "OpenAI API key is required for live chat test", rawSecretResponse: false } };
  }
  try {
    const { response, payload, requestId } = await fetchJsonWithTimeout(`${openAiApiBaseUrl}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Client-Request-Id": `clawdesk-openai-chat-${crypto.randomUUID()}`,
      },
      body: JSON.stringify({ model, input: prompt, max_output_tokens: 64 }),
    });
    if (!response.ok) {
      return { code: response.status, payload: safeOpenAiErrorPayload(payload?.error?.message || `OpenAI chat failed with ${response.status}`, response.status) };
    }
    return {
      code: 200,
      payload: {
        providerId,
        model: payload?.model || model,
        status: "validated",
        live: true,
        checkedAt,
        requestId,
        responseId: payload?.id,
        outputText: extractOpenAiResponseText(payload).slice(0, 500),
        rawSecretResponse: false,
      },
    };
  } catch (error) {
    return { code: 502, payload: safeOpenAiErrorPayload(error) };
  }
}

function betaEntitlementFromPayload(payload) {
  const status = payload.status === "active" ? "licensed" : "safe-mode";
  const now = nowIso();
  return {
    provider: "lemon-squeezy",
    status,
    plan: payload.plan,
    expiresAt: payload.expiresAt,
    licenseKeyHash: hashLicenseKeyForStorage(payload.encodedKey),
    machineHash: payload.machineFingerprintHash,
    graceUntil: status === "licensed" ? new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString() : now,
    features: payload.features ?? [],
    lastVerifiedAt: now,
  };
}

function createLemonSeed(licenseKey, overrides = {}) {
  const normalized = normalizeLemonLicenseKey(licenseKey);
  const resolvedPlan = resolveClawDeskPlan(overrides.planKey ?? canonicalPlanKeyForLicense(normalized));
  const plan = overrides.plan ?? resolvedPlan.licensePlan;
  const issuedAt = overrides.issuedAt ?? nowIso();
  return {
    keyId: `lem_${hash(normalized).slice(0, 10)}`,
    plan,
    status: overrides.status ?? "active",
    planKey: overrides.planKey ?? resolvedPlan.canonicalPlanKey,
    licenseType: overrides.licenseType ?? resolvedPlan.licenseType,
    deviceLimit: overrides.deviceLimit ?? resolvedPlan.maxDevices,
    supportUpdatesUntil: overrides.supportUpdatesUntil ?? supportUntil(plan, issuedAt),
    expiresAt: overrides.expiresAt ?? (plan === "lifetime-local" ? null : supportUntil(plan, issuedAt)),
    features: overrides.features ?? ["chat", "permission-advanced", "workflows", "agents", "diagnostics", "updates", "beta-direct"],
  };
}

const seedLicenses = {
  "CLWD-BETA-PRO1-2026": createLemonSeed("CLWD-BETA-PRO1-2026"),
  "CLWD-BETA-LIFE-2026": createLemonSeed("CLWD-BETA-LIFE-2026"),
};

const defaultState = {
  accounts: [],
  sessions: [],
  verificationTokens: [],
  passwordResetTokens: [],
  entitlements: [],
  naviaLicenses: [],
  machines: [],
  licenses: [],
  licenseEvents: [],
  webhooks: [],
  providerSecretRefs: [],
  diagnostics: [],
  audit: [],
  updates: {
    latestVersion: "0.5.1",
    releaseNotes: [
      "新增後端模擬授權服務。",
      "補強機器綁定與簽章授權驗證。",
      "加入開發者繞過與 webhook 驗證事件追蹤。",
    ],
  },
  createdAt: nowIso(),
};

let state = structuredClone(defaultState);

function hashPassword(password) {
  return hash(`${password}|clawdesk`);
}

function authTokenFromRequest(req, parsed) {
  const authHeader = req.headers.authorization || parsed.searchParams.get("token") || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
}

function isOwnerEmail(email) {
  return String(email ?? "").trim().toLowerCase() === naviaOwnerEmail;
}

function createPasswordResetToken(email) {
  const normalizedEmail = String(email ?? "").trim().toLowerCase();
  const token = randomId("reset");
  const record = {
    token,
    email: normalizedEmail,
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + 1000 * 60 * 30).toISOString(),
    used: false,
  };
  state.passwordResetTokens = state.passwordResetTokens.filter((item) => item.email !== normalizedEmail);
  state.passwordResetTokens.unshift(record);
  if (state.passwordResetTokens.length > 1000) state.passwordResetTokens.length = 1000;
  return record;
}

function createVerificationToken(email) {
  const normalizedEmail = String(email ?? "").trim().toLowerCase();
  const token = randomId("verify");
  const record = {
    token,
    email: normalizedEmail,
    expiresAt: new Date(Date.now() + 1000 * 60 * 30).toISOString(),
  };
  state.verificationTokens = state.verificationTokens.filter((item) => item.email !== normalizedEmail);
  state.verificationTokens.unshift(record);
  if (state.verificationTokens.length > 1000) state.verificationTokens.length = 1000;
  return record;
}

function canonicalizeNaviaPayload(payload) {
  const normalized = {
    licenseId: payload.licenseId,
    planType: payload.planType,
    subjectEmailHash: payload.subjectEmailHash,
    hwidHash: payload.hwidHash,
    issuedAtUtc: normalizeDateTimeOffsetString(payload.issuedAtUtc),
    expiresAtUtc: normalizeDateTimeOffsetString(payload.expiresAtUtc),
    orderNo: payload.orderNo,
    nonce: payload.nonce,
    version: payload.version,
    productKey: payload.productKey ?? clawDeskProductKey,
    planKey: payload.planKey ?? "legacy",
    licenseType: payload.licenseType ?? payload.planType,
    features: Array.isArray(payload.features) ? payload.features : [],
    maxDevices: (payload.maxDevices ?? 0) > 0 ? payload.maxDevices : 1,
    updatesUntilUtc: payload.updatesUntilUtc ? normalizeDateTimeOffsetString(payload.updatesUntilUtc) : null,
    graceUntilUtc: payload.graceUntilUtc ? normalizeDateTimeOffsetString(payload.graceUntilUtc) : null,
    accountIdHash: payload.accountIdHash ?? "",
    machineBindingHash: payload.machineBindingHash ?? "",
    keyVersion: payload.keyVersion ?? naviaSigningKeyId,
  };
  return JSON.stringify(normalized)
    .replace(/\+/g, "\\u002B")
    .replace(/</g, "\\u003C")
    .replace(/>/g, "\\u003E")
    .replace(/&/g, "\\u0026");
}

function normalizeDateTimeOffsetString(value) {
  const match = String(value ?? "").match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,7}))?((?:Z)|(?:[+-]\d{2}:\d{2}))$/);
  if (!match) return value;
  const fraction = (match[2] ?? "").padEnd(7, "0");
  const offset = match[3] === "Z" ? "+00:00" : match[3];
  return `${match[1]}.${fraction}${offset}`;
}

function signNaviaPayload(payload) {
  const signature = crypto.sign("sha256", Buffer.from(canonicalizeNaviaPayload(payload), "utf8"), {
    key: naviaSigningKeyPair.privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return {
    payload,
    signature: signature.toString("base64"),
    keyId: naviaSigningKeyId,
  };
}

function ensureEntitlementRecord({
  accountId,
  email,
  productKey = clawDeskProductKey,
  planKey,
  status = "active",
  source = "manual",
  licenseId,
  expiresAtUtc,
  updatesUntilUtc,
  features = [],
  maxDevices = 1,
}) {
  const normalizedEmail = String(email ?? "").trim().toLowerCase();
  const key = normalizePlanKey(planKey);
  state.entitlements = state.entitlements.filter((item) => !(item.email === normalizedEmail && item.productKey === productKey && normalizePlanKey(item.planKey) === key));
  const record = {
    id: randomId("ent"),
    accountId,
    email: normalizedEmail,
    productKey,
    planKey,
    status,
    source,
    licenseId,
    expiresAtUtc: expiresAtUtc ?? null,
    updatesUntilUtc: updatesUntilUtc ?? null,
    features,
    maxDevices,
    updatedAtUtc: nowIso(),
  };
  state.entitlements.unshift(record);
  if (state.entitlements.length > 1000) state.entitlements.length = 1000;
  return record;
}

function entitlementsForEmail(email) {
  const normalizedEmail = String(email ?? "").trim().toLowerCase();
  const items = state.entitlements.filter((item) => item.email === normalizedEmail && item.productKey === clawDeskProductKey);
  if (isOwnerEmail(normalizedEmail)) {
    items.unshift({
      id: "owner-entitlement",
      accountId: "owner",
      email: normalizedEmail,
      productKey: clawDeskProductKey,
      planKey: "clawdesk.lifetime_updates_1y_2dev",
      status: "active",
      source: "owner-builtin",
      licenseId: "owner-certificate",
      expiresAtUtc: null,
      updatesUntilUtc: null,
      features: ["owner", "admin", "full-feature"],
      maxDevices: 99,
      updatedAtUtc: nowIso(),
    });
  }
  return items;
}

function buildNaviaLicensePayload({ licenseId, account, email, hwid, instanceId, orderNo, seed }) {
  const issuedAtUtc = nowIso();
  const accountEmail = String(email ?? account?.email ?? "").trim().toLowerCase();
  return {
    licenseId,
    planType: seed.licenseType,
    subjectEmailHash: hash(accountEmail),
    hwidHash: hash(hwid),
    issuedAtUtc,
    expiresAtUtc: seed.expiresAt ?? "9999-12-31T23:59:59+00:00",
    orderNo,
    nonce: randomId("nonce"),
    version: 2,
    productKey: clawDeskProductKey,
    planKey: seed.planKey,
    licenseType: seed.licenseType,
    features: seed.features,
    maxDevices: seed.deviceLimit,
    updatesUntilUtc: seed.supportUpdatesUntil,
    graceUntilUtc: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(),
    accountIdHash: hash(account?.id ?? accountEmail),
    machineBindingHash: hash(`${instanceId}|${hwid}`),
    keyVersion: naviaSigningKeyId,
  };
}

function readBody(req) {
  return readBodyWithRaw(req).then(({ body }) => body);
}

function readBodyWithRaw(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => {
      if (!data) {
        resolve({ body: {}, rawBody: "" });
        return;
      }
      try {
        resolve({ body: JSON.parse(data), rawBody: data });
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
  });
}

function accountByEmail(email) {
  return state.accounts.find((item) => item.email === email);
}

function createSession(accountId, ip = "127.0.0.1") {
  const token = `tk_${randomId("sess").replace(/-/g, "")}`;
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
  const session = {
    id: randomId("session"),
    accountId,
    token,
    ip,
    issuedAt: nowIso(),
    expiresAt,
  };
  state.sessions = state.sessions.filter((item) => item.accountId !== accountId || new Date(item.expiresAt) <= new Date());
  state.sessions.unshift(session);
  if (state.sessions.length > 1000) state.sessions.length = 1000;
  return session;
}

function readSession(token) {
  const session = state.sessions.find((item) => item.token === token && new Date(item.expiresAt) > new Date());
  if (!session) return null;
  const account = state.accounts.find((item) => item.id === session.accountId);
  if (!account) return null;
  return {
    ...session,
    email: account.email,
    displayName: account.displayName,
    role: account.role,
    mode: account.mode,
    organization: account.organization,
  };
}

function requireSessionAccount(req, res, parsed) {
  const token = authTokenFromRequest(req, parsed);
  const session = readSession(token);
  if (!session) {
    json(res, 401, { error: "Invalid session" });
    return null;
  }
  const account = accountByEmail(session.email);
  if (!account) {
    json(res, 401, { error: "Account not found" });
    return null;
  }
  return { session, account, token };
}

function licensePayload(licenseKey, machineFingerprintHash) {
  const seed = seedLicenses[licenseKey];
  if (!seed) return null;
  const issuedAt = nowIso();
  return {
    keyId: randomId("key"),
    encodedKey: licenseKey,
    signatureStatus: "valid",
    payloadHash: hash(`${seed.keyId}|${licenseKey}|${issuedAt}`),
    plan: seed.plan,
    status: seed.status,
    supportUpdatesUntil: seed.supportUpdatesUntil,
    expiresAt: seed.expiresAt,
    deviceLimit: seed.deviceLimit,
    issuedAt,
    features: seed.features,
    machineFingerprintHash,
  };
}

function issueSignedTicket(payload) {
  const body = JSON.stringify(payload);
  const signature = sign(body);
  return {
    payload,
    signature,
    token: `${payload.keyId}.${Buffer.from(body).toString("base64url")}.${signature}`,
    issuedAt: nowIso(),
  };
}

function parseTicket(rawToken) {
  if (typeof rawToken !== "string") return null;
  const parts = rawToken.split(".");
  if (parts.length !== 3) return null;
  const [keyId, encoded, signature] = parts;
  try {
    const body = Buffer.from(encoded, "base64url").toString("utf8");
    const payload = JSON.parse(body);
    const expected = sign(body);
    return {
      keyId,
      payload,
      signature,
      signatureMatch: expected === signature,
      rawBody: body,
    };
  } catch {
    return null;
  }
}

function updateBoundMachine(licenseKey, machineFingerprintHash) {
  const existing = state.machines.find(
    (item) => item.licenseKey === licenseKey && item.machineFingerprintHash === machineFingerprintHash,
  );
  if (existing) return existing;
  const machine = {
    id: randomId("m"),
    licenseKey,
    machineFingerprintHash,
    activatedAt: nowIso(),
    lastSeenAt: nowIso(),
  };
  state.machines.unshift(machine);
  if (state.machines.length > 1000) state.machines.length = 1000;
  return machine;
};

function getSeedFromTicketPayload(payload) {
  return state.licenses.find((item) => item.payload.encodedKey === payload.encodedKey);
}

function licenseStatusFromPayload(payload, machineFingerprintHash) {
  const now = Date.now();
  const updatesExpired = payload.supportUpdatesUntil && new Date(payload.supportUpdatesUntil).getTime() < now;
  const expired = payload.expiresAt && new Date(payload.expiresAt).getTime() < now;
  return {
    plan: payload.plan,
    status: expired ? "expired" : payload.status,
    seats: payload.deviceLimit ?? 1,
    supportUpdatesUntil: payload.supportUpdatesUntil,
    offlineGraceUntil: null,
    features: payload.features ?? [],
    tampered: false,
    supportExpired: updatesExpired,
    latestVersion: state.updates.latestVersion,
    eligibleLatestVersion: updatesExpired ? "0.4.9" : state.updates.latestVersion,
    machineMatched: payload.machineFingerprintHash === machineFingerprintHash,
  };
}

function isDeveloperBypassAccount(account) {
  if (!devBypassEmail) return false;
  return account && account.email === devBypassEmail && devBypassPassword;
}

function ensureBootstrapAccounts() {
  const existingOwner = state.accounts.find((item) => item.email === naviaOwnerEmail);
  if (!existingOwner) {
    state.accounts.unshift({
      id: "owner-account",
      email: naviaOwnerEmail,
      displayName: "NaviaWorks Owner",
      passwordHash: hashPassword("__owner_managed__"),
      mode: "owner",
      role: "owner",
      organization: "NaviaWorks",
      emailVerified: true,
      emailVerificationPending: false,
      accountStatus: "active",
      createdAt: nowIso(),
      createdBy: "bootstrap",
      notes: ["owner-builtin"],
    });
    auditTrail("bootstrap.owner-account", { email: naviaOwnerEmail });
  } else {
    existingOwner.displayName = existingOwner.displayName || "NaviaWorks Owner";
    existingOwner.mode = "owner";
    existingOwner.role = "owner";
    existingOwner.organization = existingOwner.organization || "NaviaWorks";
    existingOwner.emailVerified = true;
    existingOwner.emailVerificationPending = false;
    existingOwner.accountStatus = "active";
    existingOwner.notes = Array.from(new Set([...(existingOwner.notes ?? []), "owner-builtin"]));
  }

  const shouldHaveDev = devBypassEmail && devBypassPassword;
  if (!shouldHaveDev) return;
  const email = devBypassEmail.trim().toLowerCase();
  if (!state.accounts.some((item) => item.email === email)) {
    state.accounts.unshift({
      id: randomId("acct"),
      email,
      displayName: "Developer",
      passwordHash: hashPassword(devBypassPassword),
      mode: "enterprise",
      role: "admin",
      organization: "ClawDesk Internal",
      emailVerified: true,
      createdAt: nowIso(),
      createdBy: "bootstrap",
      notes: ["developer-bypass"],
    });
    auditTrail("bootstrap.developer-account", { email });
  }
}

function loadState() {
  return fs
    .readFile(stateFilePath, "utf8")
    .then((raw) => {
      const parsed = JSON.parse(raw);
      state = { ...defaultState, ...parsed };
      state.accounts = parsed.accounts ?? [];
      state.sessions = parsed.sessions ?? [];
      state.verificationTokens = parsed.verificationTokens ?? [];
      state.passwordResetTokens = parsed.passwordResetTokens ?? [];
      state.entitlements = parsed.entitlements ?? [];
      state.naviaLicenses = parsed.naviaLicenses ?? [];
      state.machines = parsed.machines ?? [];
      state.licenses = parsed.licenses ?? [];
      state.licenseEvents = parsed.licenseEvents ?? [];
      state.webhooks = parsed.webhooks ?? [];
      state.providerSecretRefs = parsed.providerSecretRefs ?? [];
      state.diagnostics = parsed.diagnostics ?? [];
      state.audit = parsed.audit ?? [];
      state.updates = {
        ...(defaultState.updates ?? {}),
        ...(parsed.updates ?? {}),
      };
      ensureBootstrapAccounts();
    })
    .catch(() => {
      state = structuredClone(defaultState);
      ensureBootstrapAccounts();
    });
}

function saveState() {
  return fs
    .mkdir(path.dirname(stateFilePath), { recursive: true })
    .then(() => fs.writeFile(stateFilePath, JSON.stringify(state, null, 2)))
    .catch(() => {});
}

function saveWithRetry() {
  setTimeout(() => {
    void saveState();
  }, 30);
}

const handlers = {
  "GET:/health": async (req, res) => {
    json(
      res,
      200,
      createBackendHealthPayload({
        port,
        now: nowIso(),
        adapterMode: adapters.mode,
        adapterReadiness: adapters.readiness,
        metrics: {
          accounts: state.accounts.length,
          activeSessions: state.sessions.filter((item) => new Date(item.expiresAt) > new Date()).length,
          licenses: state.licenses.length,
        },
      }),
    );
  },

  "GET:/contract": async (_req, res) => {
    json(res, 200, {
      ...BACKEND_CONTRACT,
      activeAdapterMode: adapters.mode,
      adapterReadiness: adapters.readiness,
    });
  },

  "POST:/auth/register": async (req, res) => {
    try {
      const body = await readBody(req);
      const email = String(body?.email ?? "").trim().toLowerCase();
      const password = String(body?.password ?? "").trim();
      if (!email.includes("@") || password.length < 8) {
        json(res, 400, { error: "Invalid email or password" });
        return;
      }
      const existed = accountByEmail(email);
      if (existed && existed.emailVerified) {
        json(res, 409, { error: "Account already verified" });
        return;
      }
      const record = {
        id: existed?.id ?? randomId("acct"),
        email,
        displayName: String(body?.displayName ?? "").trim() || email.split("@")[0],
        passwordHash: hashPassword(password),
        organization: body?.organization ? String(body.organization).trim() : undefined,
        emailVerified: false,
        emailVerificationPending: true,
        verificationCode: token,
        role: "user",
        mode: "consumer",
        createdAt: nowIso(),
      };
      state.verificationTokens = state.verificationTokens.filter((item) => item.email !== email);
      state.verificationTokens.unshift({
        token,
        email,
        expiresAt: new Date(Date.now() + 1000 * 60 * 30).toISOString(),
      });
      if (existed) {
        Object.assign(
          state.accounts[state.accounts.findIndex((item) => item.email === email)],
          record,
          { id: existed.id },
        );
      } else {
        state.accounts.unshift(record);
      }
      auditTrail("identity.register", { email });
      saveWithRetry();
      json(res, 200, {
        status: "pending-confirmation",
        email,
        message:
          "已建立帳號，請透過 /auth/confirm 完成驗證。",
        debugVerificationToken: token,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "Invalid JSON") {
        json(res, 400, { error: "Invalid JSON" });
      } else {
        json(res, 500, { error: "register failed" });
      }
    }
  },

  "POST:/auth/confirm": async (req, res) => {
    try {
      const body = await readBody(req);
      const email = String(body?.email ?? "").trim().toLowerCase();
      const code = String(body?.code ?? "").trim();
      const row = state.verificationTokens.find((item) => item.email === email && item.token === code);
      if (!row || new Date(row.expiresAt) <= new Date()) {
        json(res, 400, { error: "Code invalid or expired" });
        return;
      }
      const account = accountByEmail(email);
      if (!account) {
        json(res, 404, { error: "Account not found" });
        return;
      }
      account.emailVerified = true;
      account.emailVerificationPending = false;
      state.verificationTokens = state.verificationTokens.filter(
        (item) => item.email !== email,
      );
      auditTrail("identity.confirm", { email });
      saveWithRetry();
      json(res, 200, { status: "verified", email });
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
  },

  "POST:/auth/login": async (req, res) => {
    try {
      const body = await readBody(req);
      const email = String(body?.email ?? "").trim().toLowerCase();
      const password = String(body?.password ?? "").trim();
      const account = accountByEmail(email);
      const passwordOk = account && account.passwordHash === hashPassword(password);
      const bypassOk = account && isDeveloperBypassAccount(account) && password === devBypassPassword;
      if (!(passwordOk || bypassOk)) {
        json(res, 401, { error: "Invalid credentials" });
        return;
      }
      if (!account.emailVerified) {
        json(res, 403, { error: "Email not verified" });
        return;
      }
      const session = createSession(account.id, req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "");
      session.token = `${session.token}-dev`; // 保持格式一致，避免舊測試假設
      auditTrail("identity.login", { email, mode: account.mode, role: account.role });
      saveWithRetry();
      json(res, 200, { status: "ok", session: { token: session.token, account: readSession(session.token) } });
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
  },

  "GET:/auth/session": async (req, res, parsed) => {
    const authHeader = req.headers.authorization || parsed.searchParams.get("token") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
    const session = readSession(token);
    if (!session) {
      json(res, 401, { error: "Invalid session" });
      return;
    }
    json(res, 200, { status: "ok", session });
  },

  "POST:/api/auth/register": async (req, res) => {
    try {
      const body = await readBody(req);
      const email = String(body?.email ?? "").trim().toLowerCase();
      const password = String(body?.password ?? "").trim();
      if (!email.includes("@") || password.length < 8) {
        json(res, 400, { error: "Invalid email or password" });
        return;
      }
      const existed = accountByEmail(email);
      if (existed && existed.emailVerified) {
        json(res, 409, { error: "Account already verified" });
        return;
      }
      const token = randomId("verify");
      const record = {
        id: existed?.id ?? randomId("acct"),
        email,
        displayName: String(body?.displayName ?? "").trim() || email.split("@")[0],
        passwordHash: hashPassword(password),
        organization: body?.organization ? String(body.organization).trim() : undefined,
        emailVerified: false,
        emailVerificationPending: true,
        accountStatus: "pending_email_verification",
        verificationCode: "",
        role: "user",
        mode: "consumer",
        createdAt: nowIso(),
      };
      const verification = createVerificationToken(email);
      record.verificationCode = verification.token;
      if (existed) {
        Object.assign(state.accounts[state.accounts.findIndex((item) => item.email === email)], record, { id: existed.id });
      } else {
        state.accounts.unshift(record);
      }
      auditTrail("identity.register", { email });
      saveWithRetry();
      json(res, 200, {
        ok: true,
        accountStatus: "pending_email_verification",
        email,
        message: "請到信箱完成驗證。",
        debugVerificationToken: verification.token,
      });
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
  },

  "POST:/api/auth/resend-verification": async (req, res) => {
    try {
      const body = await readBody(req);
      const email = String(body?.email ?? "").trim().toLowerCase();
      if (!email.includes("@")) {
        json(res, 400, { ok: false, error: "Valid email is required" });
        return;
      }
      const account = accountByEmail(email);
      if (!account) {
        json(res, 404, { ok: false, error: "Account not found" });
        return;
      }
      if (account.emailVerified) {
        json(res, 409, { ok: false, error: "Account already verified" });
        return;
      }
      const verification = createVerificationToken(email);
      account.emailVerificationPending = true;
      account.accountStatus = "pending_email_verification";
      account.verificationCode = verification.token;
      auditTrail("identity.resend-verification", { email });
      saveWithRetry();
      json(res, 200, {
        ok: true,
        email,
        accountStatus: "pending_email_verification",
        message: "Verification challenge re-issued.",
        debugVerificationToken: verification.token,
      });
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
  },

  "GET:/api/auth/verify-email": async (_req, res, parsed) => {
    const token = String(parsed.searchParams.get("token") ?? "").trim();
    const row = state.verificationTokens.find((item) => item.token === token);
    if (!row || new Date(row.expiresAt) <= new Date()) {
      json(res, 400, { ok: false, error: "Token invalid or expired" });
      return;
    }
    const account = accountByEmail(row.email);
    if (!account) {
      json(res, 404, { ok: false, error: "Account not found" });
      return;
    }
    account.emailVerified = true;
    account.emailVerificationPending = false;
    account.accountStatus = "active";
    state.verificationTokens = state.verificationTokens.filter((item) => item.token !== token);
    auditTrail("identity.verify-email", { email: account.email, method: "get" });
    saveWithRetry();
    json(res, 200, { ok: true, email: account.email, accountStatus: "active" });
  },

  "POST:/api/auth/verify-email": async (req, res) => {
    try {
      const body = await readBody(req);
      const email = String(body?.email ?? "").trim().toLowerCase();
      const token = String(body?.token ?? body?.code ?? "").trim();
      const row = state.verificationTokens.find((item) => item.email === email && item.token === token);
      if (!row || new Date(row.expiresAt) <= new Date()) {
        json(res, 400, { ok: false, error: "Token invalid or expired" });
        return;
      }
      const account = accountByEmail(email);
      if (!account) {
        json(res, 404, { ok: false, error: "Account not found" });
        return;
      }
      account.emailVerified = true;
      account.emailVerificationPending = false;
      account.accountStatus = "active";
      state.verificationTokens = state.verificationTokens.filter((item) => item.email !== email);
      auditTrail("identity.verify-email", { email, method: "post" });
      saveWithRetry();
      json(res, 200, { ok: true, email, accountStatus: "active" });
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
  },

  "POST:/api/auth/login": async (req, res) => {
    try {
      const body = await readBody(req);
      const email = String(body?.email ?? "").trim().toLowerCase();
      const password = String(body?.password ?? "").trim();
      const account = accountByEmail(email);
      const passwordOk = account && account.passwordHash === hashPassword(password);
      const bypassOk = account && isDeveloperBypassAccount(account) && password === devBypassPassword;
      if (!(passwordOk || bypassOk)) {
        auditTrail("identity.login.failed", { email });
        json(res, 401, { ok: false, error: "Invalid credentials" });
        return;
      }
      if (!account.emailVerified && !isOwnerEmail(email)) {
        json(res, 403, { ok: false, error: "Email not verified" });
        return;
      }
      account.accountStatus = "active";
      const session = createSession(account.id, req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "");
      auditTrail("identity.login", { email, mode: account.mode, role: account.role });
      saveWithRetry();
      json(res, 200, {
        ok: true,
        session: {
          token: session.token,
          cookieName: "__Host-navia_session",
          account: readSession(session.token),
        },
      });
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
  },

  "GET:/api/auth/me": async (req, res, parsed) => {
    const resolved = requireSessionAccount(req, res, parsed);
    if (!resolved) return;
    const { session, account } = resolved;
    json(res, 200, {
      ok: true,
      account: {
        id: account.id,
        email: account.email,
        displayName: account.displayName,
        organization: account.organization,
        role: account.role,
        mode: account.mode,
        emailVerified: account.emailVerified !== false,
        accountStatus: account.accountStatus ?? (account.emailVerified === false ? "pending_email_verification" : "active"),
      },
      session: {
        token: session.token,
        expiresAt: session.expiresAt,
        cookieName: "__Host-navia_session",
      },
    });
  },

  "POST:/api/auth/logout": async (req, res, parsed) => {
    const token = authTokenFromRequest(req, parsed);
    const before = state.sessions.length;
    state.sessions = state.sessions.filter((item) => item.token !== token);
    auditTrail("identity.logout", { removed: before !== state.sessions.length });
    saveWithRetry();
    json(res, 200, { ok: true, loggedOut: before !== state.sessions.length });
  },

  "POST:/api/auth/password/forgot": async (req, res) => {
    try {
      const body = await readBody(req);
      const email = String(body?.email ?? "").trim().toLowerCase();
      if (!email.includes("@")) {
        json(res, 400, { ok: false, error: "Valid email is required" });
        return;
      }
      const account = accountByEmail(email);
      if (!account || (!account.emailVerified && !isOwnerEmail(email))) {
        auditTrail("identity.password-forgot.ignored", { email });
        json(res, 200, {
          ok: true,
          email,
          message: "If the account exists, a reset challenge has been issued.",
        });
        return;
      }
      const reset = createPasswordResetToken(email);
      auditTrail("identity.password-forgot", { email });
      saveWithRetry();
      json(res, 200, {
        ok: true,
        email,
        challengeType: "email_code",
        expiresAt: reset.expiresAt,
        message: "Password reset challenge issued.",
        debugResetToken: reset.token,
      });
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
  },

  "POST:/api/auth/password/reset": async (req, res) => {
    try {
      const body = await readBody(req);
      const email = String(body?.email ?? "").trim().toLowerCase();
      const token = String(body?.token ?? body?.code ?? "").trim();
      const password = String(body?.password ?? "").trim();
      if (!email.includes("@") || !token || password.length < 8) {
        json(res, 400, { ok: false, error: "email, token and password are required" });
        return;
      }
      const account = accountByEmail(email);
      if (!account) {
        json(res, 404, { ok: false, error: "Account not found" });
        return;
      }
      const reset = state.passwordResetTokens.find(
        (item) =>
          item.email === email &&
          item.token === token &&
          item.used !== true &&
          new Date(item.expiresAt).getTime() > Date.now(),
      );
      if (!reset) {
        auditTrail("identity.password-reset.failed", { email, reason: "invalid-token" });
        json(res, 400, { ok: false, error: "Token invalid or expired" });
        return;
      }
      account.passwordHash = hashPassword(password);
      account.accountStatus = account.emailVerified === false && !isOwnerEmail(email) ? "pending_email_verification" : "active";
      reset.used = true;
      state.passwordResetTokens = state.passwordResetTokens.filter((item) => item.email !== email);
      state.sessions = state.sessions.filter((item) => item.accountId !== account.id);
      auditTrail("identity.password-reset", { email });
      saveWithRetry();
      json(res, 200, {
        ok: true,
        email,
        passwordUpdated: true,
        accountStatus: account.accountStatus,
        sessionsRevoked: true,
      });
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
  },

  "GET:/api/account/entitlements": async (req, res, parsed) => {
    const resolved = requireSessionAccount(req, res, parsed);
    if (!resolved) return;
    const items = entitlementsForEmail(resolved.account.email).map((item) => ({
      productKey: item.productKey,
      planKey: item.planKey,
      status: item.status,
      expiresAtUtc: item.expiresAtUtc,
      updatesUntilUtc: item.updatesUntilUtc,
      maxDevices: item.maxDevices,
      features: item.features,
      source: item.source,
      owner: item.source === "owner-builtin",
    }));
    json(res, 200, { ok: true, productKey: clawDeskProductKey, entitlements: items });
  },

  "GET:/api/license/public-keys": async (_req, res) => {
    json(res, 200, {
      algorithm: "ECDSA_P256_SHA256",
      activeKeyId: naviaSigningKeyId,
      keys: [
        {
          keyId: naviaSigningKeyId,
          algorithm: "ECDSA_P256_SHA256",
          active: true,
          publicKeyPem: naviaPublicKeyPem,
        },
      ],
    });
  },

  "POST:/api/license/activate": async (req, res) => {
    try {
      const body = await readBody(req);
      const email = String(body?.email ?? "").trim().toLowerCase();
      const hwid = String(body?.hwid ?? "").trim();
      const instanceId = String(body?.instanceId ?? "").trim();
      const productKey = String(body?.productKey ?? "").trim().toLowerCase();
      const orderNo = String(body?.orderNo ?? body?.licenseKey ?? "").trim();
      if (!email.includes("@") || !hwid || !instanceId || !orderNo || productKey !== clawDeskProductKey) {
        json(res, 400, { ok: false, error: "email, hwid, instanceId, orderNo and productKey are required" });
        return;
      }
      const account = accountByEmail(email);
      if (!account) {
        json(res, 404, { ok: false, error: "Account not found" });
        return;
      }
      if (!account.emailVerified && !isOwnerEmail(email)) {
        json(res, 403, { ok: false, error: "Email not verified" });
        return;
      }
      const normalizedLicenseKey = normalizeLemonLicenseKey(orderNo);
      const seed = isOwnerEmail(email)
        ? createLemonSeed(normalizedLicenseKey || "CLWD-OWNER-LIFE-2026", { planKey: "clawdesk.lifetime_updates_1y_2dev", deviceLimit: 99, features: ["owner", "admin", "full-feature"] })
        : (seedLicenses[normalizedLicenseKey] ?? createLemonSeed(normalizedLicenseKey));
      if (!isOwnerEmail(email)) {
        seedLicenses[normalizedLicenseKey] = seed;
      }
      const bindings = state.naviaLicenses.filter((item) => item.licenseKey === normalizedLicenseKey);
      if (bindings.length >= seed.deviceLimit && !bindings.some((item) => item.hwid === hwid)) {
        json(res, 409, { ok: false, error: "device_limit_exceeded" });
        return;
      }
      const machine = updateBoundMachine(normalizedLicenseKey, hwid);
      machine.instanceId = instanceId;
      machine.lastSeenAt = nowIso();
      const licenseId = randomId("navlic");
      const payload = buildNaviaLicensePayload({ licenseId, account, email, hwid, instanceId, orderNo: normalizedLicenseKey, seed });
      const certificate = signNaviaPayload(payload);
      const certificateJson = JSON.stringify(certificate);
      state.naviaLicenses = state.naviaLicenses.filter((item) => !(item.licenseKey === normalizedLicenseKey && item.email === email && item.hwid === hwid));
      state.naviaLicenses.unshift({
        licenseId,
        licenseKey: normalizedLicenseKey,
        email,
        accountId: account.id,
        hwid,
        instanceId,
        machineId: machine.id,
        planKey: seed.planKey,
        status: "active",
        expiresAtUtc: payload.expiresAtUtc,
        updatesUntilUtc: payload.updatesUntilUtc,
        maxDevices: seed.deviceLimit,
        features: seed.features,
        certificateJson,
        activatedAtUtc: nowIso(),
      });
      ensureEntitlementRecord({
        accountId: account.id,
        email,
        planKey: seed.planKey,
        status: "active",
        source: "license.activate",
        licenseId,
        expiresAtUtc: payload.expiresAtUtc,
        updatesUntilUtc: payload.updatesUntilUtc,
        features: seed.features,
        maxDevices: seed.deviceLimit,
      });
      auditTrail("license.activate.api", { email, licenseId, planKey: seed.planKey, owner: isOwnerEmail(email) });
      saveWithRetry();
      json(res, 200, {
        ok: true,
        message: "activated",
        licenseId,
        instanceId,
        license: certificateJson,
        gracePolicy: {
          licenseType: seed.licenseType,
          expiresAtUtc: payload.expiresAtUtc,
          graceUntilUtc: payload.graceUntilUtc,
          updatesUntilUtc: payload.updatesUntilUtc,
        },
        features: seed.features,
        updatesUntilUtc: payload.updatesUntilUtc,
        maxDevices: seed.deviceLimit,
      });
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
  },

  "POST:/api/license/validate": async (req, res) => {
    try {
      const body = await readBody(req);
      const certificateJson = String(body?.licenseCertificateJson ?? "").trim();
      const hwid = String(body?.hwid ?? "").trim();
      const instanceId = String(body?.instanceId ?? "").trim();
      const productKey = String(body?.productKey ?? "").trim().toLowerCase();
      if (!certificateJson || !hwid || !instanceId || productKey !== clawDeskProductKey) {
        json(res, 400, { ok: false, error: "licenseCertificateJson, hwid, instanceId and productKey are required" });
        return;
      }
      const envelope = JSON.parse(certificateJson);
      const payload = envelope?.payload ?? {};
      const canonical = canonicalizeNaviaPayload(payload);
      const signatureBuffer = Buffer.from(String(envelope?.signature ?? ""), "base64");
      const signatureValid = crypto.verify("sha256", Buffer.from(canonical, "utf8"), {
        key: naviaPublicKeyPem,
        dsaEncoding: "ieee-p1363",
      }, signatureBuffer);
      const productMatched = String(payload.productKey ?? "").trim().toLowerCase() === clawDeskProductKey;
      const hwidMatched = String(payload.hwidHash ?? "") === hash(hwid);
      const machineBindingMatched = String(payload.machineBindingHash ?? "") === hash(`${instanceId}|${hwid}`);
      const updatesAllowed = !payload.updatesUntilUtc || Date.parse(String(body?.appReleaseDateUtc ?? nowIso())) <= Date.parse(payload.updatesUntilUtc);
      const expired = payload.expiresAtUtc && payload.expiresAtUtc !== "9999-12-31T23:59:59+00:00" && Date.parse(payload.expiresAtUtc) <= Date.now();
      const withinGrace = payload.graceUntilUtc ? Date.parse(payload.graceUntilUtc) > Date.now() : false;
      const record = state.naviaLicenses.find((item) => item.licenseId === payload.licenseId);
      const revoked = record ? record.status === "revoked" : false;
      if (record) {
        record.lastValidatedAtUtc = nowIso();
      }
      auditTrail("license.validate.api", { licenseId: payload.licenseId, signatureValid, hwidMatched, machineBindingMatched, revoked });
      saveWithRetry();
      json(res, 200, {
        ok: true,
        data: {
          active: signatureValid && productMatched && hwidMatched && machineBindingMatched && !revoked && (!expired || withinGrace),
          message: !signatureValid
            ? "signature_invalid"
            : revoked
              ? "revoked"
              : !productMatched
                ? "product_mismatch"
                : !hwidMatched || !machineBindingMatched
                  ? "wrong_machine"
                  : expired && !withinGrace
                    ? "expired"
                    : "validated",
          licenseId: payload.licenseId,
          productKey: payload.productKey ?? clawDeskProductKey,
          planKey: payload.planKey ?? resolveClawDeskPlan().canonicalPlanKey,
          licenseType: payload.licenseType ?? "perpetual_with_updates_1y",
          features: Array.isArray(payload.features) ? payload.features : [],
          revoked,
          expired: Boolean(expired),
          withinGrace,
          hwidMatched,
          instanceMatched: true,
          machineBindingMatched,
          updatesAllowed,
          productMatched,
          expiresAtUtc: payload.expiresAtUtc ?? null,
          updatesUntilUtc: payload.updatesUntilUtc ?? null,
          graceUntilUtc: payload.graceUntilUtc ?? null,
          maxDevices: Number(payload.maxDevices ?? 1),
          activeDeviceCount: state.naviaLicenses.filter((item) => item.licenseKey === record?.licenseKey).length || 1,
        },
      });
    } catch {
      json(res, 400, { ok: false, error: "certificate_invalid_json" });
    }
  },

  "POST:/api/license/refresh-certificate": async (req, res) => {
    try {
      const body = await readBody(req);
      const licenseId = String(body?.licenseId ?? "").trim();
      const hwid = String(body?.hwid ?? "").trim();
      const instanceId = String(body?.instanceId ?? "").trim();
      const record = state.naviaLicenses.find((item) => item.licenseId === licenseId && item.hwid === hwid && item.instanceId === instanceId);
      if (!record) {
        json(res, 404, { ok: false, error: "license_not_found" });
        return;
      }
      const account = accountByEmail(record.email);
      const seed = createLemonSeed(record.licenseKey, { planKey: record.planKey, deviceLimit: record.maxDevices, features: record.features });
      const payload = buildNaviaLicensePayload({ licenseId, account, email: record.email, hwid, instanceId, orderNo: record.licenseKey, seed });
      const certificateJson = JSON.stringify(signNaviaPayload(payload));
      record.certificateJson = certificateJson;
      record.expiresAtUtc = payload.expiresAtUtc;
      record.updatesUntilUtc = payload.updatesUntilUtc;
      record.lastValidatedAtUtc = nowIso();
      ensureEntitlementRecord({
        accountId: record.accountId,
        email: record.email,
        planKey: record.planKey,
        status: "active",
        source: "license.refresh",
        licenseId,
        expiresAtUtc: payload.expiresAtUtc,
        updatesUntilUtc: payload.updatesUntilUtc,
        features: record.features,
        maxDevices: record.maxDevices,
      });
      auditTrail("license.refresh.api", { licenseId, email: record.email });
      saveWithRetry();
      json(res, 200, {
        ok: true,
        message: "refreshed",
        licenseId,
        instanceId,
        license: certificateJson,
        gracePolicy: {
          licenseType: seed.licenseType,
          expiresAtUtc: payload.expiresAtUtc,
          graceUntilUtc: payload.graceUntilUtc,
          updatesUntilUtc: payload.updatesUntilUtc,
        },
        features: record.features,
        updatesUntilUtc: payload.updatesUntilUtc,
        maxDevices: record.maxDevices,
      });
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
  },

  "POST:/api/license/deactivate": async (req, res) => {
    try {
      const body = await readBody(req);
      const licenseId = String(body?.licenseId ?? "").trim();
      const hwid = String(body?.hwid ?? "").trim();
      const instanceId = String(body?.instanceId ?? "").trim();
      const index = state.naviaLicenses.findIndex((item) => item.licenseId === licenseId && item.hwid === hwid && item.instanceId === instanceId);
      if (index < 0) {
        json(res, 404, { ok: false, error: "license_not_found" });
        return;
      }
      const [record] = state.naviaLicenses.splice(index, 1);
      state.machines = state.machines.filter((item) => item.id !== record.machineId);
      auditTrail("license.deactivate.api", { licenseId, email: record.email });
      saveWithRetry();
      json(res, 200, { ok: true, message: "deactivated" });
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
  },

  "GET:/api/license/me": async (req, res, parsed) => {
    const resolved = requireSessionAccount(req, res, parsed);
    if (!resolved) return;
    const entitlements = entitlementsForEmail(resolved.account.email);
    const current = state.naviaLicenses.find((item) => item.email === resolved.account.email) ?? null;
    json(res, 200, {
      ok: true,
      productKey: clawDeskProductKey,
      entitlements: entitlements.map((item) => ({
        planKey: item.planKey,
        status: item.status,
        expiresAtUtc: item.expiresAtUtc,
        updatesUntilUtc: item.updatesUntilUtc,
        features: item.features,
        maxDevices: item.maxDevices,
      })),
      activeLicense: current
        ? {
            licenseId: current.licenseId,
            planKey: current.planKey,
            maxDevices: current.maxDevices,
            updatesUntilUtc: current.updatesUntilUtc,
            expiresAtUtc: current.expiresAtUtc,
          }
        : null,
    });
  },

  "POST:/auth/sso/start": async (req, res) => {
    try {
      const body = await readBody(req);
      const provider = String(body?.provider ?? "").trim().toLowerCase();
      const providerIds = adapters.identity.ssoProviders().map((item) => item.id);
      if (!providerIds.includes(provider)) {
        json(res, 400, { error: "Unsupported provider" });
        return;
      }
      const requestId = randomId("sso");
      state.webhooks.unshift({
        id: requestId,
        provider,
        type: "sso.start",
        status: "pending",
        createdAt: nowIso(),
      });
      saveWithRetry();
      json(res, 200, {
        status: "ok",
        requestId,
        provider,
        callbackUrl: `${baseUrl}/auth/sso/finish`,
      });
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
  },

  "POST:/auth/sso/finish": async (req, res) => {
    try {
      const body = await readBody(req);
      const provider = String(body?.provider ?? "").trim().toLowerCase();
      const email = String(body?.email ?? "").trim().toLowerCase();
      const organization = String(body?.organization ?? "").trim() || undefined;
      const oidcValidation = adapters.identity.validateOidcCallback({ provider, email, organization });
      if (!oidcValidation.ok && oidcValidation.statusCode) {
        json(res, oidcValidation.statusCode, oidcValidation);
        return;
      }
      if (!email.includes("@")) {
        json(res, 400, { error: "Invalid email" });
        return;
      }
      const existed = accountByEmail(email);
      if (existed) {
        existed.mode = "enterprise";
        existed.role = existed.role || "admin";
        existed.organization = organization ?? existed.organization;
        existed.ssoProvider = provider;
      } else {
        state.accounts.unshift({
          id: randomId("acct"),
          email,
          displayName: email.split("@")[0],
          passwordHash: hashPassword(`__sso_${email}`),
          mode: "enterprise",
          role: "admin",
          organization,
          emailVerified: true,
          emailVerificationPending: false,
          ssoProvider: provider,
          createdAt: nowIso(),
        });
      }
      const target = accountByEmail(email);
      const session = createSession(target.id);
      auditTrail("identity.sso", { provider, email });
      saveWithRetry();
      json(res, 200, { status: "ok", session: { token: session.token, account: readSession(session.token) } });
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
  },

  "GET:/auth/sso/providers": async (_req, res) => {
    json(res, 200, {
      providers: adapters.identity.ssoProviders(),
    });
  },

  "GET:/license/status": async (req, res, parsed) => {
    const licenseKey = parsed.searchParams.get("licenseKey");
    if (!licenseKey) {
      json(res, 400, { error: "licenseKey is required" });
      return;
    }
    const found = state.licenses.find((item) => item.payload.encodedKey === licenseKey);
    if (!found) {
      const seed = seedLicenses[licenseKey];
      if (!seed) {
        json(res, 404, { error: "license not found" });
        return;
      }
      json(res, 200, { plan: seed.plan, status: seed.status, supportUpdatesUntil: seed.supportUpdatesUntil, features: seed.features });
      return;
    }
    const summary = licenseStatusFromPayload(found.payload, parsed.searchParams.get("machineFingerprintHash"));
    json(res, 200, {
      ...summary,
      signatureStatus: found.signatureStatus,
      keyId: found.keyId,
    });
  },

  "POST:/licenses/activate-key": async (req, res) => {
    try {
      const body = await readBody(req);
      const licenseKey = String(body?.licenseKey ?? "").trim();
      const machineFingerprintHash = String(body?.machineFingerprintHash ?? "").trim();
      if (!licenseKey || !machineFingerprintHash) {
        json(res, 400, { error: "licenseKey and machineFingerprintHash are required" });
        return;
      }
      const isLemonKey = isMockLemonLicenseKey(licenseKey);
      if (!isLemonKey) {
        json(res, 400, { error: "Only Lemon Squeezy license keys are supported", faultCode: "CLWD-LEM-1006" });
        return;
      }
      const normalizedLemonKey = normalizeLemonLicenseKey(licenseKey);
      if (isLemonKey && !seedLicenses[normalizedLemonKey]) {
        seedLicenses[normalizedLemonKey] = createLemonSeed(normalizedLemonKey);
      }
      const effectiveLicenseKey = isLemonKey ? normalizedLemonKey : licenseKey;
      const seed = seedLicenses[effectiveLicenseKey];
      if (!seed) {
        json(res, 404, { error: "Unknown license key" });
        return;
      }
      const bindings = state.machines.filter((item) => item.licenseKey === effectiveLicenseKey);
      if (bindings.length >= seed.deviceLimit && !bindings.some((item) => item.machineFingerprintHash === machineFingerprintHash)) {
        json(res, 409, { error: "Device limit exceeded", faultCode: "CLWD-LIC-3003" });
        return;
      }
      const payload = licensePayload(effectiveLicenseKey, machineFingerprintHash);
      const ticket = issueSignedTicket(payload);
      const machine = updateBoundMachine(effectiveLicenseKey, machineFingerprintHash);
      const entry = {
        keyId: payload.keyId,
        payload,
        signatureStatus: "valid",
        machineId: machine.id,
        signature: ticket.signature,
        issuedAt: nowIso(),
      };
      state.licenses = state.licenses.filter((item) => item.payload.encodedKey !== effectiveLicenseKey);
      state.licenses.unshift(entry);
      state.licenseEvents.unshift({
        id: randomId("licevt"),
        type: "activate",
        licenseKey: effectiveLicenseKey,
        machineFingerprintHash,
        timestamp: nowIso(),
      });
      auditTrail("license.activate", { licenseKey: isLemonKey ? hashLicenseKeyForStorage(effectiveLicenseKey) : effectiveLicenseKey, machineId: machine.id });
      saveWithRetry();
      json(res, 200, {
        license: {
          keyId: payload.keyId,
          encodedKey: isLemonKey ? undefined : effectiveLicenseKey,
          licenseKeyHash: isLemonKey ? hashLicenseKeyForStorage(effectiveLicenseKey) : undefined,
          signatureStatus: "valid",
          payloadHash: payload.payloadHash,
          plan: seed.plan,
          status: seed.status,
          supportUpdatesUntil: seed.supportUpdatesUntil,
          expiresAt: seed.expiresAt,
          deviceLimit: seed.deviceLimit,
          paymentProvider: "lemon-squeezy",
          licenseProvider: "lemon-license",
          entitlement: isLemonKey ? betaEntitlementFromPayload(payload) : undefined,
        },
        machine,
        offlineTicket: {
          token: ticket.token,
          signature: ticket.signature,
          issuedAt: ticket.issuedAt,
          expiresAt: nowIso(),
        },
      });
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
  },

  "POST:/licenses/validate": async (req, res) => {
    try {
      const body = await readBody(req);
      const offlineTicket = String(body?.offlineTicket ?? "").trim();
      const machineFingerprintHash = String(body?.machineFingerprintHash ?? "").trim();
      if (adapters.mode === "production") {
        const validation = adapters.lemon.validateOfflineTicket({
          licenseFile: body?.licenseFile ?? offlineTicket,
          machineFingerprintHash,
        });
        if (!validation.ok) {
          json(res, validation.statusCode ?? 400, validation);
          return;
        }
        json(res, 200, {
          status: validation.payload?.status ?? "active",
          plan: validation.payload?.plan ?? validation.payload?.license?.plan ?? "enterprise",
          signatureStatus: validation.signatureStatus,
          machineMatched: validation.machineMatched,
          supportUpdatesUntil:
            validation.payload?.supportUpdatesUntil ??
            validation.payload?.meta?.supportUpdatesUntil ??
            validation.payload?.meta?.expiry ??
            null,
          features: validation.payload?.features ?? validation.payload?.license?.features ?? [],
        });
        return;
      }
      const parsed = parseTicket(offlineTicket);
      if (!parsed) {
        json(res, 400, { error: "Invalid offline ticket" });
        return;
      }
      if (!parsed.signatureMatch) {
        json(res, 400, { error: "Ticket signature invalid", faultCode: "CLWD-LIC-1001" });
        return;
      }
      const existing = getSeedFromTicketPayload(parsed.payload);
      const payload = parsed.payload;
      const isTampered = payload.machineFingerprintHash !== machineFingerprintHash && machineFingerprintHash.length > 0;
      const summary = licenseStatusFromPayload(payload, machineFingerprintHash);
      const status = { ...summary, tampered: isTampered, signatureStatus: parsed.signatureMatch ? "valid" : "invalid" };
      if (isTampered) {
        status.status = "tampered";
        state.licenseEvents.unshift({ id: randomId("tamper"), type: "tamper", licenseKey: payload.encodedKey, reason: "machine mismatch" });
      }
      if (existing) {
        existing.lastValidatedAt = nowIso();
        existing.signatureStatus = status.tampered ? "tampered" : "valid";
      }
      auditTrail("license.validate", { keyId: parsed.keyId, tampered: status.tampered });
      saveWithRetry();
      json(res, isTampered ? 426 : 200, status);
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
  },

  "POST:/licenses/refresh-offline-ticket": async (req, res) => {
    try {
      const body = await readBody(req);
      const licenseKey = String(body?.licenseKey ?? "").trim();
      const existing = state.licenses.find((item) => item.payload.encodedKey === licenseKey);
      if (!existing) {
        json(res, 404, { error: "license not found" });
        return;
      }
      const machineFingerprintHash = String(body?.machineFingerprintHash ?? "").trim() || existing.payload.machineFingerprintHash;
      existing.payload.machineFingerprintHash = machineFingerprintHash;
      existing.payload.payloadHash = hash(`${existing.payload.keyId}|${licenseKey}|${existing.payload.issuedAt}`);
      const ticket = issueSignedTicket(existing.payload);
      existing.signature = ticket.signature;
      existing.issuedAt = nowIso();
      state.licenseEvents.unshift({
        id: randomId("licevt"),
        type: "refresh-offline-ticket",
        licenseKey,
        machineFingerprintHash,
        timestamp: nowIso(),
      });
      auditTrail("license.refresh-offline", { licenseKey });
      saveWithRetry();
      json(res, 200, {
        ticket: {
          token: ticket.token,
          signature: ticket.signature,
          issuedAt: ticket.issuedAt,
          expiresAt: nowIso(),
        },
      });
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
  },

  "POST:/licenses/report-tamper": async (req, res) => {
    try {
      const body = await readBody(req);
      const event = {
        id: randomId("tamper"),
        reason: String(body?.reason ?? "unknown"),
        detectedAt: nowIso(),
        localAction: "safe-mode",
        serverAction: "report-to-lemon",
        faultCode: String(body?.faultCode ?? "CLWD-LIC-1001"),
      };
      state.licenseEvents.unshift(event);
      if (state.licenseEvents.length > 2000) state.licenseEvents.length = 2000;
      auditTrail("license.tamper", { reason: event.reason, faultCode: event.faultCode });
      saveWithRetry();
      json(res, 200, event);
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
  },

  "POST:/webhooks/paddle": async (_req, res) => {
    json(res, 410, { error: "Paddle is disabled. Lemon Squeezy is the only payment and license provider." });
  },

  "POST:/webhooks/lemon": async (req, res) => {
    try {
      const { body, rawBody } = await readBodyWithRaw(req);
      const eventType = String(body?.meta?.event_name ?? body?.eventType ?? body?.type ?? "").trim();
      const licenseKey = normalizeLemonLicenseKey(
        body?.licenseKey ??
          body?.license_key ??
          body?.data?.attributes?.license_key?.key ??
          body?.data?.attributes?.key ??
          body?.meta?.custom_data?.licenseKey ??
          "CLWD-BETA-PRO1-2026",
      );
      const machineFingerprintHash = String(body?.machineFingerprintHash ?? body?.meta?.custom_data?.machineFingerprintHash ?? "").trim();
      if (!eventType || !licenseKey) {
        json(res, 400, { error: "eventType and licenseKey required" });
        return;
      }
      const signatureCheck = adapters.lemon.verifyWebhookSignature({
        signatureHeader: req.headers["x-signature"],
        rawBody,
      });
      if (!signatureCheck.ok && adapters.mode === "production") {
        json(res, signatureCheck.statusCode ?? 401, signatureCheck);
        return;
      }
      const mutation = adapters.lemon.mapWebhookEvent(eventType);
      if (!mutation) {
        json(res, 422, { error: "unsupported Lemon Squeezy event type", eventType });
        return;
      }
      const planKey = String(body?.meta?.custom_data?.planKey ?? body?.planKey ?? "").trim()
        || canonicalPlanKeyForLicense(licenseKey);
      const resolvedPlan = resolveClawDeskPlan(planKey);
      const seed = seedLicenses[licenseKey] ?? createLemonSeed(licenseKey, { planKey: resolvedPlan.canonicalPlanKey });
      seed.plan = resolvedPlan.licensePlan;
      seed.planKey = resolvedPlan.canonicalPlanKey;
      seed.licenseType = resolvedPlan.licenseType;
      seed.deviceLimit = resolvedPlan.maxDevices;
      if (mutation.status) seed.status = mutation.status;
      if (mutation.refreshSupportUpdatesUntil) {
        seed.supportUpdatesUntil = supportUntil(seed.plan, new Date().toISOString());
        seed.expiresAt = seed.plan === "lifetime-local" ? null : seed.supportUpdatesUntil;
      }
      seedLicenses[licenseKey] = seed;
      let existing = state.licenses.find((item) => item.payload.encodedKey === licenseKey);
      if (!existing && mutation.entitlementStatus === "licensed") {
        const payload = licensePayload(licenseKey, machineFingerprintHash || fingerprint().fingerprintHash);
        const ticket = issueSignedTicket(payload);
        existing = {
          keyId: payload.keyId,
          payload,
          signatureStatus: "valid",
          machineId: machineFingerprintHash ? updateBoundMachine(licenseKey, machineFingerprintHash).id : null,
          signature: ticket.signature,
          issuedAt: nowIso(),
        };
        state.licenses.unshift(existing);
      }
      if (existing) {
        existing.payload.plan = seed.plan;
        existing.payload.status = seed.status;
        existing.payload.supportUpdatesUntil = seed.supportUpdatesUntil;
        existing.payload.expiresAt = seed.expiresAt;
        existing.payload.features = seed.features;
        existing.signatureStatus = seed.status === "safe-mode" ? "revoked" : "valid";
      }
      const entitlement = existing ? betaEntitlementFromPayload(existing.payload) : {
        provider: "lemon-squeezy",
        status: mutation.entitlementStatus,
        plan: seed.plan,
        expiresAt: seed.expiresAt,
        licenseKeyHash: hashLicenseKeyForStorage(licenseKey),
        graceUntil: nowIso(),
        features: seed.features,
        lastVerifiedAt: nowIso(),
      };
      const accountEmail = String(
        body?.meta?.custom_data?.email ??
        body?.data?.attributes?.user_email ??
        body?.data?.attributes?.customer_email ??
        "",
      ).trim().toLowerCase();
      const account = accountByEmail(accountEmail);
      if (accountEmail && account) {
        ensureEntitlementRecord({
          accountId: account.id,
          email: accountEmail,
          planKey: seed.planKey,
          status: mutation.entitlementStatus === "licensed" ? "active" : "safe-mode",
          source: "webhook.lemon",
          licenseId: existing?.keyId ?? seed.keyId,
          expiresAtUtc: seed.expiresAt,
          updatesUntilUtc: seed.supportUpdatesUntil,
          features: seed.features,
          maxDevices: seed.deviceLimit,
        });
      }
      state.webhooks.unshift({
        id: randomId("wk"),
        provider: "lemon-squeezy",
        eventType,
        licenseKeyHash: hashLicenseKeyForStorage(licenseKey),
        receivedAt: nowIso(),
      });
      auditTrail("webhook.lemon", { eventType, licenseKeyHash: hashLicenseKeyForStorage(licenseKey), entitlementStatus: entitlement.status });
      saveWithRetry();
      json(res, 200, {
        status: "ok",
        provider: "lemon-squeezy",
        eventType,
        entitlement,
        license: {
          keyId: seed.keyId,
          licenseKeyHash: hashLicenseKeyForStorage(licenseKey),
          plan: seed.plan,
          status: seed.status,
          supportUpdatesUntil: seed.supportUpdatesUntil,
        },
      });
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
  },

  "POST:/webhooks/keygen": async (_req, res) => {
    json(res, 410, { error: "Keygen is disabled. Lemon Squeezy is the only payment and license provider." });
  },

  "GET:/updates/check": async (_req, res) => {
    json(res, 200, {
      currentVersion: "0.5.0",
      latestVersion: state.updates.latestVersion,
      eligibleLatestVersion: state.updates.latestVersion,
      supportUpdatesUntil: "2026-12-31T23:59:59.999Z",
      canInstallLatest: true,
      releaseNotes: state.updates.releaseNotes.join("\n"),
      requiresRenewal: false,
    });
  },

  "GET:/updates/history": async (_req, res) => {
    json(res, 200, {
      history: [
        { version: "0.5.0", releasedAt: "2026-05-10", note: "Chat + backend simulator integration" },
        { version: "0.4.9", releasedAt: "2026-05-01", note: "Path governance and diagnostics privacy" },
      ],
    });
  },

  "GET:/provider/secret-refs/contract": async (_req, res) => {
    json(res, 200, providerSecretRefContract());
  },

  "POST:/provider/secret-refs/issue": async (req, res) => {
    try {
      const body = await readBody(req);
      const providerId = normalizeProviderId(body?.providerId);
      if (!providerId) {
        json(res, 400, { error: "providerId is required" });
        return;
      }
      const authMode = String(body?.authMode ?? "").trim();
      if (!["api-key", "oauth", "local-endpoint"].includes(authMode)) {
        json(res, 400, { error: "unsupported authMode" });
        return;
      }
      const issuedAt = nowIso();
      const secretRef = providerSecretRefFor({ ...body, providerId, authMode });
      const entry = {
        providerId,
        authMode,
        secretRef,
        model: String(body?.model ?? "").slice(0, 120),
        accountEmailHash: body?.accountEmail ? `hash:${hash(body.accountEmail).slice(0, 16)}` : undefined,
        endpointHash: body?.endpoint ? `hash:${hash(body.endpoint).slice(0, 16)}` : undefined,
        issuedAt,
        status: "active",
        tokenRefresh: {
          mode: authMode === "oauth" ? "refreshable" : "manual",
          lastRefreshStatus: authMode === "oauth" ? "ready" : "not-configured",
        },
      };
      state.providerSecretRefs = state.providerSecretRefs.filter((item) => item.secretRef !== secretRef);
      state.providerSecretRefs.unshift(entry);
      if (state.providerSecretRefs.length > 100) state.providerSecretRefs.length = 100;
      auditTrail("provider.secret-ref.issue", { providerId, authMode, secretRef });
      saveWithRetry();
      json(res, 200, entry);
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
  },

  "POST:/provider/token-refresh": async (req, res) => {
    try {
      const body = await readBody(req);
      const secretRef = String(body?.secretRef ?? "").trim();
      const entry = state.providerSecretRefs.find((item) => item.secretRef === secretRef);
      if (!entry) {
        json(res, 404, { error: "Unknown SecretRef" });
        return;
      }
      const expiresAt = new Date(Date.now() + 55 * 60 * 1000).toISOString();
      const response = {
        providerId: entry.providerId,
        secretRef,
        status: entry.authMode === "oauth" ? "refreshed" : "not-required",
        accessTokenRef: entry.authMode === "oauth" ? `ptr_${hash(`${secretRef}:${expiresAt}`).slice(0, 24)}` : undefined,
        expiresAt: entry.authMode === "oauth" ? expiresAt : undefined,
      };
      entry.tokenRefresh = {
        mode: entry.authMode === "oauth" ? "refreshable" : "manual",
        lastRefreshStatus: response.status === "refreshed" ? "refreshed" : "not-configured",
        expiresAt: response.expiresAt,
      };
      auditTrail("provider.token-refresh", { providerId: entry.providerId, secretRef, status: response.status });
      saveWithRetry();
      json(res, 200, response);
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
  },

  "GET:/provider/openai/runtime-contract": async (_req, res) => {
    json(res, 200, openAiRuntimeContract());
  },

  "POST:/provider/openai/validate-key": async (req, res) => {
    try {
      const result = await validateOpenAiKeyRuntime(await readBody(req));
      auditTrail("provider.openai.validate-key", {
        status: result.payload.status ?? "failed",
        live: Boolean(result.payload.live),
        requestId: result.payload.requestId,
      });
      json(res, result.code, result.payload);
    } catch {
      json(res, 400, { error: "Invalid JSON", rawSecretResponse: false });
    }
  },

  "POST:/provider/openai/chat-test": async (req, res) => {
    try {
      const result = await runOpenAiChatRuntime(await readBody(req));
      auditTrail("provider.openai.chat-test", {
        status: result.payload.status ?? "failed",
        live: Boolean(result.payload.live),
        requestId: result.payload.requestId,
      });
      json(res, result.code, result.payload);
    } catch {
      json(res, 400, { error: "Invalid JSON", rawSecretResponse: false });
    }
  },

  "POST:/diagnostics/create-report": async (req, res) => {
    try {
      const body = await readBody(req);
      const legalConsentSource = body?.legalConsentSummary;
      const legalConsentSummary =
        legalConsentSource && typeof legalConsentSource === "object"
          ? {
              version: String(legalConsentSource.version ?? "").slice(0, 80),
              acceptedAt: String(legalConsentSource.acceptedAt ?? "").slice(0, 40),
              documentHash: String(legalConsentSource.documentHash ?? "").slice(0, 96),
              documents: Array.isArray(legalConsentSource.documents)
                ? legalConsentSource.documents.map(String).slice(0, 10)
                : [],
            }
          : undefined;
      const report = {
        reportId: randomId("diag"),
        faultCode: String(body?.faultCode ?? "CLWD-UI-5000"),
        createdAt: nowIso(),
        appVersion: String(body?.appVersion ?? "0.5.0"),
        systemSummary: {
          os: os.version(),
          arch: os.arch(),
          platform: os.platform(),
          memoryMbBucket: `${Math.round(os.totalmem() / 1024 / 1024 / 512)}-512`,
          cpuModel: os.cpus()[0]?.model ?? "unknown",
          diskApprox: "unknown",
        },
        licenseSummary: { kind: "unknown" },
        gatewaySummary: { stateCount: state.licenses.length },
        recentErrors: state.audit.slice(0, 10).map((entry) => ({
          ...entry,
          detail: JSON.parse(redactDiagnosticText(JSON.stringify(entry.detail ?? {}))),
        })),
        redactionStatus: "redacted",
        legalConsentSummary,
        userDescription: body?.userDescription ? redactDiagnosticText(String(body.userDescription).slice(0, 400)) : "",
      };
      state.diagnostics.unshift(report);
      if (state.diagnostics.length > 200) state.diagnostics.length = 200;
      auditTrail("diagnostics.create", { reportId: report.reportId, faultCode: report.faultCode });
      saveWithRetry();
      json(res, 200, report);
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
  },

  "GET:/machine/fingerprint": async (_req, res) => {
    json(res, 200, fingerprint());
  },

  "GET:/legal/documents": async (_req, res) => {
    json(res, 200, {
      documents: [
        {
          id: "installer-terms",
          title: "安裝與使用同意條款",
          summary: "安裝、啟動、註冊、登入或使用 ClawDesk 前，使用者需同意 EULA、隱私、訂閱、授權與第三方 NOTICE。",
          details: ["條款檔打包於 app resources：legal/INSTALLER_TERMS.md。", "正式商業發行前需由律師依銷售地區審閱。"],
        },
        {
          id: "commercial-license",
          title: "ClawDesk 商業授權",
          summary: "ClawDesk GUI、記憶、Agent、授權、模仿學習與商業功能採閉源商業授權。",
        },
        {
          id: "subscription-compliance",
          title: "訂閱、自動續費與取消揭露",
          summary: "訂閱方案需在購買與安裝前揭露價格、續費週期、取消入口、退款規則與適用消費者權利。",
          sourceUrl: "https://www.ftc.gov/business-guidance/blog/2024/10/click-cancel-ftcs-amended-negative-option-rule-what-it-means-your-business",
        },
        {
          id: "openclaw-compatible",
          title: "OpenClaw-compatible 聲明",
          summary: "ClawDesk 以 OpenClaw-compatible 桌面 Agent 定位，不主張上游 OpenClaw 商標或所有權。",
        },
        {
          id: "openclaw-mit-notice",
          title: "OpenClaw MIT 開源說明與重製版權",
          summary: "若 ClawDesk 複製、改作或散布 OpenClaw MIT 程式碼，必須保留 MIT 授權文字與上游 copyright notice。",
          sourceUrl: "https://opensource.org/license/mit",
        },
        {
          id: "user-content-rights",
          title: "使用者內容權利",
          summary: "使用者保留輸入、上傳檔案、專案資料與 AI 輸出內容權利；ClawDesk 不主張使用者內容所有權。",
        },
        {
          id: "privacy",
          title: "隱私與診斷",
          summary: "診斷包不含聊天內容、完整路徑、完整金鑰、API key、Email 或螢幕截圖，送出前需要使用者確認。",
        },
      ],
    });
  },

  "GET:/legal/notices": async (_req, res) => {
    json(res, 200, {
      notices: [
        {
          package: "OpenClaw",
          license: "MIT",
          purpose: "OpenClaw-compatible 參考；若重製上游程式碼，需保留 upstream copyright 與 MIT notice",
        },
        { package: "Tauri", license: "MIT / Apache-2.0", purpose: "桌面 shell" },
        { package: "React", license: "MIT", purpose: "使用者介面" },
        { package: "Vite", license: "MIT", purpose: "前端建置" },
        { package: "Lemon Squeezy", license: "Commercial SaaS", purpose: "唯一付款、license key、退款/取消 webhook 與授權管控供應商" },
      ],
    });
  },
};

const routeAliases = {
  "POST:/api/payment/lemonsqueezy/webhook": "POST:/api/webhooks/lemonsqueezy",
  "POST:/api/webhooks/lemonsqueezy": "POST:/webhooks/lemon",
  "POST:/api/payment/newebpay/notify": "POST:/webhooks/newebpay",
};

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, baseUrl);
  const pathname = parsed.pathname;
  const key = `${req.method}:${pathname}`;
  const handler = handlers[key] ?? handlers[routeAliases[key]];
  if (!handler) {
    json(res, 404, { error: "Not found", path: pathname });
    return;
  }
  await handler(req, res, parsed);
});

await loadState();

server.listen(port, host, () => {
  console.log(`ClawDesk backend simulator 已啟動：${baseUrl}`);
});

process.on("SIGINT", async () => {
  await saveState();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await saveState();
  process.exit(0);
});
