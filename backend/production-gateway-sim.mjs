import crypto from "node:crypto";
import http from "node:http";
import { BACKEND_CONTRACT } from "./contracts.mjs";

const port = Number(process.env.CLAWDESK_PRODUCTION_GATEWAY_PORT ?? 19130);
const host = "127.0.0.1";
const backendBaseUrl = (process.env.CLAWDESK_BACKEND_BASE_URL ?? "http://127.0.0.1:19120").replace(/\/+$/, "");
const baseUrl = `http://${host}:${port}`;
const wsUrl = `ws://${host}:${port}/events`;
const clients = new Set();
const verificationCodes = new Map();
let currentIdentityToken = "";
let currentLicenseKey = "";
let currentMachineFingerprintHash = "";
let currentLicenseStatus = createFreeLicenseStatus();

const pricingPlans = [
  { id: "hobby", name: "Hobby", priceUsd: 0, cadence: "free", description: "本機基礎功能與安全沙盒。" },
  { id: "pro-monthly", name: "Pro Monthly", priceUsd: 19, cadence: "monthly", description: "個人完整桌面 Agent，每月訂閱。" },
  { id: "pro-yearly", name: "Pro Yearly", priceUsd: 190, cadence: "yearly", description: "個人完整桌面 Agent，年繳優惠。" },
  { id: "lifetime-local", name: "Lifetime Local", priceUsd: 249, cadence: "one-time", description: "永久本機 Pro，含 12 個月支援更新。" },
  { id: "team", name: "Team", priceUsd: 40, cadence: "monthly", description: "多人協作與座席管理，按人計費。" },
  { id: "enterprise", name: "Enterprise", priceUsd: 50000, cadence: "contract", description: "企業合約、稽核與私有部署支援。" },
  { id: "byok-managed", name: "BYOK Managed", priceUsd: 30, cadence: "monthly", description: "自帶金鑰的受管執行個體。" },
];

const gatewayContract = {
  version: "2026-05-13.production-gateway-sim.v1",
  productName: "ClawDesk",
  compatibility: "OpenClaw-compatible desktop agent",
  mode: "production-gateway-sim",
  backendContractVersion: BACKEND_CONTRACT.version,
  endpoints: [
    { method: "GET", path: "/health" },
    { method: "GET", path: "/contract" },
    { method: "GET", path: "/events" },
    { method: "POST", path: "/chat" },
    { method: "POST", path: "/permission-result" },
    { method: "GET", path: "/identity/session" },
    { method: "POST", path: "/identity/register" },
    { method: "POST", path: "/identity/confirm" },
    { method: "POST", path: "/identity/login" },
    { method: "POST", path: "/identity/logout" },
    { method: "POST", path: "/identity/sso" },
    { method: "GET", path: "/identity/sso/providers" },
    { method: "GET", path: "/identity/verification-code" },
    { method: "GET", path: "/machine/fingerprint" },
    { method: "GET", path: "/license/status" },
    { method: "POST", path: "/license/activate-key" },
    { method: "POST", path: "/license/validate" },
    { method: "POST", path: "/license/refresh-offline-ticket" },
    { method: "POST", path: "/license/report-tamper" },
    { method: "GET", path: "/updates/check" },
    { method: "GET", path: "/legal/documents" },
    { method: "GET", path: "/legal/notices" },
    { method: "POST", path: "/diagnostics/create-report" },
  ],
};

function nowIso() {
  return new Date().toISOString();
}

function json(res, code, body) {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  res.end(payload);
}

function createFreeLicenseStatus() {
  return {
    paymentProvider: "paddle",
    licenseProvider: "keygen",
    plan: "hobby",
    status: "free",
    seats: 1,
    supportUpdatesUntil: "2026-05-12",
    eligibleLatestVersion: "1.0.0",
    features: ["safe-mode", "local-chat", "manual-permissions"],
    deviceLimit: 1,
    machines: [],
    lastValidationCode: "PROD_SIM_HOBBY",
  };
}

function frontendIdentityFromBackend(account) {
  if (!account) {
    return {
      authenticated: false,
      displayName: "未登入",
      mode: "personal",
      role: "viewer",
      isDeveloper: false,
      ssoProvider: "none",
    };
  }
  return {
    authenticated: true,
    userId: account.accountId ?? account.id,
    displayName: account.displayName ?? account.email?.split("@")?.[0] ?? "ClawDesk User",
    email: account.email,
    mode: account.mode === "enterprise" ? "enterprise" : "personal",
    role: account.role === "admin" ? "admin" : account.role === "owner" ? "owner" : "member",
    isDeveloper: false,
    emailVerified: true,
    emailVerificationPending: false,
    organization: account.organization,
    ssoProvider: account.ssoProvider ?? "none",
    lastLoginAt: nowIso(),
  };
}

function frontendLicenseFromBackend(backendPayload, machine) {
  const license = backendPayload?.license ?? backendPayload ?? {};
  const active = String(license.status ?? "").toLowerCase() === "active";
  return {
    paymentProvider: "paddle",
    licenseProvider: "keygen",
    plan: license.plan ?? "hobby",
    status: active ? "active" : license.status ?? "free",
    seats: license.plan === "team" ? 10 : 1,
    supportUpdatesUntil: license.supportUpdatesUntil ?? "2026-05-12",
    eligibleLatestVersion: active ? "1.4.0" : "1.0.0",
    offlineGraceUntil: active ? "2026-06-11" : undefined,
    features: active ? ["pro-agent", "workflow-builder", "mcp-connectors", "diagnostics"] : ["safe-mode", "local-chat"],
    deviceLimit: license.deviceLimit ?? 1,
    machines: machine
      ? [
          {
            machineId: machine.id ?? "prod-sim-machine",
            fingerprintHash: machine.machineFingerprintHash ?? currentMachineFingerprintHash,
            deviceName: "Windows 11 x64 workstation",
            platform: "Windows x64 MSVC",
            activatedAt: machine.activatedAt ?? nowIso(),
            lastSeenAt: machine.lastSeenAt ?? nowIso(),
          },
        ]
      : [],
    lastValidationCode: active ? "KEYGEN_VALID" : "PROD_SIM_HOBBY",
  };
}

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

async function backendRequest(path, options = {}) {
  const response = await fetch(`${backendBaseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  return { ok: response.ok, status: response.status, payload };
}

function websocketAccept(key) {
  return crypto.createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
}

function encodeFrame(payload) {
  const data = Buffer.from(payload);
  if (data.length < 126) return Buffer.concat([Buffer.from([0x81, data.length]), data]);
  const header = Buffer.alloc(4);
  header[0] = 0x81;
  header[1] = 126;
  header.writeUInt16BE(data.length, 2);
  return Buffer.concat([header, data]);
}

function decodeFrame(buffer) {
  const length = buffer[1] & 0x7f;
  let offset = 2;
  let payloadLength = length;
  if (length === 126) {
    payloadLength = buffer.readUInt16BE(offset);
    offset += 2;
  }
  const mask = buffer.subarray(offset, offset + 4);
  offset += 4;
  const payload = buffer.subarray(offset, offset + payloadLength);
  for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
  return payload.toString("utf8");
}

function send(socket, event) {
  if (!socket.destroyed) socket.write(encodeFrame(JSON.stringify(event)));
}

function broadcast(event) {
  for (const socket of clients) send(socket, event);
}

async function streamProductionDemo(conversationId, prompt) {
  const messageId = `prod-agent-${Date.now()}`;
  const response =
    `ClawDesk production gateway simulator 已接收「${prompt}」。` +
    " 這條路徑模擬正式外部 Gateway，不啟動桌面 sidecar，並維持同一份串流與 Canvas 合約。";
  for (const delta of response.match(/.{1,24}/g) ?? []) {
    broadcast({ type: "agent.message.delta", conversationId, messageId, delta });
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  broadcast({ type: "agent.message.done", conversationId, messageId });
  const surfaceId = "production-gateway-contract";
  broadcast({ type: "canvas.begin", surfaceId, title: "Production Gateway Contract" });
  broadcast({
    type: "canvas.patch",
    surfaceId,
    rootId: "root",
    components: [
      { id: "root", type: "Panel", props: { title: "正式 Gateway 模擬報告" }, children: ["summary", "metric", "list"] },
      { id: "summary", type: "Text", props: { text: "外部 Gateway 已提供 health、WebSocket、chat、permission 與 backend bridge。" } },
      { id: "metric", type: "Metric", props: { label: "Sidecar 啟動數", value: "0" } },
      { id: "list", type: "List", props: { items: ["Production Gateway URL 已生效", "Backend auth/licensing bridge 已連線", "Canvas payload 為宣告式 JSON"] } },
    ],
  });
  const request = {
    type: "permission.request",
    requestId: crypto.randomUUID(),
    action: "production_gateway_external_action",
    target: "prod-sim://permission-check",
    risk: "medium",
    summary: "正式 Gateway 模擬要求一次授權回覆，用來驗證桌面 IPC 會送回 active Gateway。",
  };
  broadcast(request);
}

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url ?? "/", baseUrl);
  const pathname = parsed.pathname;
  if (req.method === "OPTIONS") {
    json(res, 204, {});
    return;
  }

  try {
    if (req.method === "GET" && pathname === "/health") {
      const backend = await backendRequest("/health").catch((error) => ({ ok: false, status: 503, payload: { error: String(error) } }));
      json(res, backend.ok ? 200 : 503, {
        ok: backend.ok,
        name: "clawdesk-production-gateway-sim",
        productName: "ClawDesk",
        compatibility: "OpenClaw-compatible desktop agent",
        baseUrl,
        wsUrl,
        mode: "external-production-sim",
        sidecar: false,
        backend: backend.payload,
      });
      return;
    }

    if (req.method === "GET" && pathname === "/contract") {
      json(res, 200, gatewayContract);
      return;
    }

    if (req.method === "POST" && pathname === "/chat") {
      const body = await readJson(req);
      const conversationId = typeof body.conversationId === "string" ? body.conversationId : "production-sim";
      json(res, 202, { accepted: true, conversationId, mode: "external-production-sim" });
      void streamProductionDemo(conversationId, String(body.prompt ?? ""));
      return;
    }

    if (req.method === "POST" && pathname === "/permission-result") {
      const body = await readJson(req);
      broadcast(body);
      json(res, 200, { accepted: true, target: "active-production-gateway" });
      return;
    }

    if (req.method === "GET" && pathname === "/identity/session") {
      if (!currentIdentityToken) {
        json(res, 200, frontendIdentityFromBackend(null));
        return;
      }
      const backend = await backendRequest("/auth/session", { token: currentIdentityToken });
      json(res, backend.ok ? 200 : 401, backend.ok ? frontendIdentityFromBackend(backend.payload.session) : frontendIdentityFromBackend(null));
      return;
    }

    if (req.method === "POST" && pathname === "/identity/register") {
      const body = await readJson(req);
      const backend = await backendRequest("/auth/register", {
        method: "POST",
        body: { email: body.email, password: body.password, displayName: body.displayName, organization: body.organization },
      });
      if (backend.ok && backend.payload.debugVerificationToken) {
        verificationCodes.set(String(body.email).trim().toLowerCase(), backend.payload.debugVerificationToken);
      }
      json(res, backend.status, {
        authenticated: false,
        email: body.email,
        displayName: body.displayName ?? String(body.email ?? "").split("@")[0],
        mode: body.mode ?? "personal",
        role: "viewer",
        emailVerificationPending: true,
        emailVerified: false,
      });
      return;
    }

    if (req.method === "GET" && pathname === "/identity/verification-code") {
      const email = String(parsed.searchParams.get("email") ?? "").trim().toLowerCase();
      const code = verificationCodes.get(email);
      json(res, code ? 200 : 404, code ? { email, code, token: code, subject: "ClawDesk production sim verification" } : { error: "verification record not found" });
      return;
    }

    if (req.method === "POST" && pathname === "/identity/confirm") {
      const body = await readJson(req);
      const backend = await backendRequest("/auth/confirm", { method: "POST", body: { email: body.email, code: body.code || body.token } });
      json(res, backend.status, backend.ok ? { ...frontendIdentityFromBackend({ email: body.email, displayName: String(body.email).split("@")[0], mode: "consumer", role: "member" }), verification: { verified: true, at: nowIso() } } : backend.payload);
      return;
    }

    if (req.method === "POST" && pathname === "/identity/login") {
      const body = await readJson(req);
      const backend = await backendRequest("/auth/login", { method: "POST", body: { email: body.email, password: body.password } });
      if (backend.ok) currentIdentityToken = backend.payload.session.token;
      json(res, backend.status, backend.ok ? frontendIdentityFromBackend(backend.payload.session.account) : backend.payload);
      return;
    }

    if (req.method === "POST" && pathname === "/identity/logout") {
      currentIdentityToken = "";
      json(res, 200, frontendIdentityFromBackend(null));
      return;
    }

    if (req.method === "GET" && pathname === "/identity/sso/providers") {
      const backend = await backendRequest("/auth/sso/providers");
      json(res, backend.status, backend.payload);
      return;
    }

    if (req.method === "POST" && pathname === "/identity/sso") {
      const body = await readJson(req);
      const backend = await backendRequest("/auth/sso/finish", { method: "POST", body });
      if (backend.ok) currentIdentityToken = backend.payload.session.token;
      json(res, backend.status, backend.ok ? { ...frontendIdentityFromBackend(backend.payload.session.account), ssoMock: { provider: body.provider, status: "production-sim-ready" } } : backend.payload);
      return;
    }

    if (req.method === "GET" && pathname === "/machine/fingerprint") {
      const backend = await backendRequest("/machine/fingerprint");
      if (backend.ok) currentMachineFingerprintHash = backend.payload.fingerprintHash;
      json(res, backend.status, backend.payload);
      return;
    }

    if (req.method === "GET" && pathname === "/license/status") {
      json(res, 200, { status: currentLicenseStatus, pricingPlans });
      return;
    }

    if (req.method === "POST" && pathname === "/license/activate-key") {
      const body = await readJson(req);
      const fp =
        currentMachineFingerprintHash ||
        (await backendRequest("/machine/fingerprint")).payload?.fingerprintHash ||
        "prod-sim-machine";
      currentMachineFingerprintHash = fp;
      currentLicenseKey = String(body.licenseKey ?? "");
      const backend = await backendRequest("/licenses/activate-key", {
        method: "POST",
        body: { licenseKey: currentLicenseKey, machineFingerprintHash: fp },
      });
      if (backend.ok) currentLicenseStatus = frontendLicenseFromBackend(backend.payload, backend.payload.machine);
      json(res, backend.status, backend.ok ? { status: currentLicenseStatus, backend: backend.payload } : backend.payload);
      return;
    }

    if (req.method === "POST" && pathname === "/license/refresh-offline-ticket") {
      const backend = await backendRequest("/licenses/refresh-offline-ticket", {
        method: "POST",
        body: { licenseKey: currentLicenseKey, machineFingerprintHash: currentMachineFingerprintHash },
      });
      json(res, backend.status, backend.payload);
      return;
    }

    if (req.method === "POST" && pathname === "/license/validate") {
      currentLicenseStatus = { ...createFreeLicenseStatus(), status: "tampered", lastValidationCode: "KEYGEN_TAMPERED" };
      json(res, 200, { status: currentLicenseStatus });
      return;
    }

    if (req.method === "POST" && pathname === "/license/report-tamper") {
      const backend = await backendRequest("/licenses/report-tamper", { method: "POST", body: await readJson(req) });
      json(res, backend.status, { event: backend.payload });
      return;
    }

    for (const [gatewayPath, backendPath] of [
      ["/updates/check", "/updates/check"],
      ["/legal/documents", "/legal/documents"],
      ["/legal/notices", "/legal/notices"],
    ]) {
      if (req.method === "GET" && pathname === gatewayPath) {
        const backend = await backendRequest(backendPath);
        json(res, backend.status, backend.payload);
        return;
      }
    }

    if (req.method === "POST" && pathname === "/diagnostics/create-report") {
      const backend = await backendRequest("/diagnostics/create-report", { method: "POST", body: await readJson(req) });
      json(res, backend.status, { report: backend.payload });
      return;
    }

    json(res, 404, { error: "Not found", path: pathname });
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.on("upgrade", (req, socket) => {
  if (req.url !== "/events") {
    socket.destroy();
    return;
  }
  const key = req.headers["sec-websocket-key"];
  if (typeof key !== "string") {
    socket.destroy();
    return;
  }
  socket.write([
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${websocketAccept(key)}`,
    "",
    "",
  ].join("\r\n"));
  clients.add(socket);
  send(socket, { type: "gateway.status", status: "ready", baseUrl, wsUrl, mode: "external-production-sim" });
  socket.on("data", (buffer) => {
    try {
      broadcast(JSON.parse(decodeFrame(buffer)));
    } catch {
      // Ignore malformed WebSocket client frames.
    }
  });
  socket.on("close", () => clients.delete(socket));
  socket.on("error", () => clients.delete(socket));
});

server.listen(port, host, () => {
  console.log(`ClawDesk production gateway simulator 已啟動：${baseUrl} -> backend ${backendBaseUrl}`);
});

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
