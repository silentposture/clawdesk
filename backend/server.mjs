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
const baseUrl = `http://${host}:${port}`;
const adapters = createBackendAdapters({ env: process.env });
const nowIso = () => new Date().toISOString();

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

function normalizeLemonLicenseKey(input) {
  return String(input ?? "").trim().toUpperCase().replace(/\s+/g, "-");
}

function isMockLemonLicenseKey(input) {
  return /^CLWD-BETA-[A-Z0-9]{4}-[0-9]{4}$/.test(normalizeLemonLicenseKey(input));
}

function hashLicenseKeyForStorage(licenseKey) {
  return `lk_${hash(`clawdesk-beta-direct:${normalizeLemonLicenseKey(licenseKey)}`).slice(0, 24)}`;
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
  const plan = overrides.plan ?? (normalized.includes("LIFE") ? "lifetime-local" : "pro-yearly");
  const issuedAt = overrides.issuedAt ?? nowIso();
  return {
    keyId: `lem_${hash(normalized).slice(0, 10)}`,
    plan,
    status: overrides.status ?? "active",
    deviceLimit: overrides.deviceLimit ?? 1,
    supportUpdatesUntil: overrides.supportUpdatesUntil ?? supportUntil(plan, issuedAt),
    expiresAt: overrides.expiresAt ?? (plan === "lifetime-local" ? null : supportUntil(plan, issuedAt)),
    features: overrides.features ?? ["chat", "permission-advanced", "workflows", "agents", "diagnostics", "updates", "beta-direct"],
  };
}

const seedLicenses = {
  "CLWD-HOBBY-OPEN-CLAW-0000": {
    keyId: "k-lcl-hobby-0",
    plan: "hobby",
    status: "free",
    deviceLimit: 1,
    supportUpdatesUntil: null,
    expiresAt: null,
    features: ["chat", "chat-history", "permissions"],
  },
  "CLWD-PRO-MONTHLY-2026-DEV": {
    keyId: "k-lcl-pro-m01",
    plan: "pro-monthly",
    status: "active",
    deviceLimit: 3,
    supportUpdatesUntil: supportUntil("pro-monthly", new Date().toISOString()),
    expiresAt: supportUntil("pro-monthly", new Date().toISOString()),
    features: ["chat", "permission-advanced", "workflows", "agents", "diagnostics-basic", "updates"],
  },
  "CLWD-PRO-YEARLY-2026-DEV": {
    keyId: "k-lcl-pro-y01",
    plan: "pro-yearly",
    status: "active",
    deviceLimit: 3,
    supportUpdatesUntil: supportUntil("pro-yearly", new Date().toISOString()),
    expiresAt: supportUntil("pro-yearly", new Date().toISOString()),
    features: ["chat", "permission-advanced", "workflows", "agents", "diagnostics", "ergo", "updates"],
  },
  "CLWD-LIFETIME-LOCAL-2026": {
    keyId: "k-lcl-lf-01",
    plan: "lifetime-local",
    status: "active",
    deviceLimit: 3,
    supportUpdatesUntil: supportUntil("lifetime-local", new Date().toISOString()),
    expiresAt: null,
    features: ["chat", "permission-advanced", "workflows", "agents", "diagnostics", "ergo", "updates", "local-only"],
  },
  "CLWD-BETA-PRO1-2026": createLemonSeed("CLWD-BETA-PRO1-2026"),
};

const defaultState = {
  accounts: [],
  sessions: [],
  verificationTokens: [],
  machines: [],
  licenses: [],
  licenseEvents: [],
  webhooks: [],
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

function ensureDeveloperBypass(account) {
  if (!devBypassEmail) return false;
  return account && account.email === devBypassEmail && devBypassPassword;
}

function ensureSeedDefaults() {
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
      state.machines = parsed.machines ?? [];
      state.licenses = parsed.licenses ?? [];
      state.licenseEvents = parsed.licenseEvents ?? [];
      state.webhooks = parsed.webhooks ?? [];
      state.diagnostics = parsed.diagnostics ?? [];
      state.audit = parsed.audit ?? [];
      state.updates = {
        ...(defaultState.updates ?? {}),
        ...(parsed.updates ?? {}),
      };
      ensureDeveloperBypass();
    })
    .catch(() => {
      state = structuredClone(defaultState);
      ensureDeveloperBypass();
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
      const token = randomId("verify");
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
      const bypassOk = account && ensureDeveloperBypass(account) && password === devBypassPassword;
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
          paymentProvider: isLemonKey ? "lemon-squeezy" : "paddle",
          licenseProvider: isLemonKey ? "lemon-license" : "keygen",
          entitlement: isLemonKey ? betaEntitlementFromPayload(payload) : undefined,
        },
        machine,
        offlineTicket: {
          token: isLemonKey ? undefined : ticket.token,
          signature: isLemonKey ? undefined : ticket.signature,
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
        const validation = adapters.keygen.validateOfflineTicket({
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
        serverAction: "mark-review",
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

  "POST:/webhooks/paddle": async (req, res) => {
    try {
      const { body, rawBody } = await readBodyWithRaw(req);
      const eventType = String(body?.eventType ?? "").trim();
      const licenseKey = String(body?.licenseKey ?? "").trim();
      const note = String(body?.note ?? "").trim();
      if (!eventType || !licenseKey) {
        json(res, 400, { error: "eventType and licenseKey required" });
        return;
      }
      const seed = seedLicenses[licenseKey];
      if (!seed) {
        json(res, 404, { error: "license not found" });
        return;
      }
      state.webhooks.unshift({
        id: randomId("wk"),
        provider: "paddle",
        eventType,
        licenseKey,
        note,
        receivedAt: nowIso(),
      });
      const signatureCheck = adapters.paddle.verifyWebhookSignature({
        signatureHeader: req.headers["paddle-signature"],
        rawBody,
      });
      if (!signatureCheck.ok && adapters.mode === "production") {
        json(res, signatureCheck.statusCode ?? 401, signatureCheck);
        return;
      }
      const mutation = adapters.paddle.mapWebhookEvent(eventType);
      if (!mutation) {
        json(res, 422, { error: "unsupported Paddle event type", eventType });
        return;
      }
      if (mutation.planHint) seed.plan = mutation.planHint;
      if (mutation.status) seed.status = mutation.status;
      if (mutation.refreshSupportUpdatesUntil) {
        seed.supportUpdatesUntil = supportUntil(seed.plan === "hobby" ? "pro-yearly" : seed.plan, new Date().toISOString());
      }
      auditTrail("webhook.paddle", { eventType, licenseKey });
      saveWithRetry();
      json(res, 200, { status: "ok", license: { key: licenseKey, status: seed.status, supportUpdatesUntil: seed.supportUpdatesUntil } });
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
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
      const plan =
        String(body?.data?.attributes?.variant_name ?? body?.plan ?? "").toLowerCase().includes("lifetime")
          ? "lifetime-local"
          : "pro-yearly";
      const seed = seedLicenses[licenseKey] ?? createLemonSeed(licenseKey, { plan });
      seed.plan = plan;
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

  "POST:/webhooks/keygen": async (req, res) => {
    try {
      const body = await readBody(req);
      const eventType = String(body?.eventType ?? "").trim();
      const licenseKey = String(body?.licenseKey ?? "").trim();
      if (!eventType || !licenseKey) {
        json(res, 400, { error: "eventType and licenseKey required" });
        return;
      }
      const exists = state.licenses.find((item) => item.payload.encodedKey === licenseKey);
      state.webhooks.unshift({ id: randomId("wk"), provider: "keygen", eventType, licenseKey, receivedAt: nowIso() });
      if (!exists) {
        json(res, 404, { error: "license not found" });
        return;
      }
      const mutation = adapters.keygen.mapWebhookEvent(eventType);
      if (!mutation) {
        json(res, 422, { error: "unsupported Keygen event type", eventType });
        return;
      }
      if (mutation.signatureStatus) exists.signatureStatus = mutation.signatureStatus;
      if (mutation.status) exists.payload.status = mutation.status;
      if (mutation.increaseDeviceLimit) {
        exists.payload.deviceLimit = exists.payload.deviceLimit + mutation.increaseDeviceLimit;
      }
      auditTrail("webhook.keygen", { eventType, licenseKey });
      saveWithRetry();
      json(res, 200, { status: "ok" });
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
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
        recentErrors: state.audit.slice(0, 10),
        redactionStatus: "redacted",
        legalConsentSummary,
        userDescription: body?.userDescription ? String(body.userDescription).slice(0, 400) : "",
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
        { package: "Paddle", license: "Commercial SaaS", purpose: "正式版金流與稅務，MVP 使用 mock" },
        { package: "Keygen", license: "Commercial SaaS", purpose: "正式版授權管控，MVP 使用 mock" },
      ],
    });
  },
};

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, baseUrl);
  const pathname = parsed.pathname;
  const key = `${req.method}:${pathname}`;
  const handler = handlers[key];
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
