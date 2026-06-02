import { spawn } from "node:child_process";
import { once } from "node:events";

const port = Number(process.env.CLAWDESK_VERIFY_PORT ?? process.env.OPENCLAW_VERIFY_PORT ?? 18890);
const baseUrl = `http://127.0.0.1:${port}`;
const wsUrl = `ws://127.0.0.1:${port}/events`;
const checks = [];
const minimumUpdateSupportDate = "2027-01-01";

function pass(name) {
  checks.push({ name, ok: true });
  console.log(`PASS ${name}`);
}

function fail(name, error) {
  checks.push({ name, ok: false, error: error instanceof Error ? error.message : String(error) });
  console.error(`FAIL ${name}: ${checks.at(-1).error}`);
}

async function check(name, fn) {
  try {
    await fn();
    pass(name);
  } catch (error) {
    fail(name, error);
  }
}

async function waitForHealth(timeoutMs = 7000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return response.json();
    } catch {
      // Retry until the sidecar is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error("mock Gateway did not become healthy");
}

async function waitForGatewayReadyWithReset(timeoutMs = 7000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const logout = await postJson("/identity/logout", {});
      if (logout.response.ok) {
        const status = await fetch(`${baseUrl}/identity/session`);
        const statusPayload = await status.json();
        if (status.ok && statusPayload && statusPayload.authenticated === false) {
          return;
        }
      }
    } catch {
      // Keep trying while the sidecar is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error("mock gateway reset handshake did not complete");
}

async function postJson(path, body = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  return { response, payload };
}

async function collectStreamEvents({ conversationId = "verify", prompt = "自動驗證串流、Canvas 與權限流程", requirePermission = true } = {}) {
  const ws = new WebSocket(wsUrl);
  const events = [];
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WebSocket did not open")), 3000);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.addEventListener("error", () => reject(new Error("WebSocket error before open")));
  });

  ws.addEventListener("message", (message) => {
    events.push(JSON.parse(message.data));
  });

  const { response } = await postJson("/chat", {
    conversationId,
    prompt,
  });
  if (response.status !== 202) throw new Error(`chat returned ${response.status}`);

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("stream did not finish in time")), 5000);
    const interval = setInterval(() => {
      const hasDone = events.some((event) => event.type === "agent.message.done");
      const hasCanvas = events.some((event) => event.type === "canvas.patch");
      const permission = events.some((event) => event.type === "permission.request");
      if (hasDone && hasCanvas && (requirePermission ? permission : true)) {
        clearInterval(interval);
        clearTimeout(timer);
        resolve();
      }
    }, 50);
  });

  if (requirePermission) {
    const permission = events.find((event) => event.type === "permission.request");
    const permissionResult = await postJson("/permission-result", {
      type: "permission.result",
      requestId: permission.requestId,
      allowed: false,
      reason: "自動測試拒絕高風險操作",
    });
    if (!permissionResult.response.ok) throw new Error("permission result was rejected");
  }

  ws.close();
  return events;
}

function extractAgentText(events) {
  return events
    .filter((event) => event.type === "agent.message.delta")
    .map((event) => event.delta)
    .join("");
}

const child = spawn(process.execPath, ["sidecars/mock-gateway/server.mjs"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    CLAWDESK_IDENTITY_BACKEND_URL: "",
    CLAWDESK_MOCK_STATE_FILE: "",
    CLAWDESK_MOCK_PORT: String(port),
    OPENCLAW_MOCK_PORT: String(port),
    NODE_ENV: "production",
    NODE_OPTIONS: "--max-old-space-size=128",
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: process.platform === "win32",
});

let bootOutput = "";
child.stdout.on("data", (chunk) => {
  bootOutput += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  bootOutput += chunk.toString();
});

try {
  await check("mock Gateway health", async () => {
    const health = await waitForHealth();
    if (health.name !== "clawdesk-mock-gateway") throw new Error("unexpected health payload");
    if (health.productName !== "ClawDesk") throw new Error("ClawDesk product name missing");
    if (!health.compatibility.includes("OpenClaw-compatible")) throw new Error("compatibility notice missing");
  });

  await check("reset mock state for deterministic MVP verification", async () => {
    await waitForGatewayReadyWithReset();
  });

  await check("Lemon Squeezy license activation, machine binding, and tamper handling", async () => {
    const fingerprintResponse = await fetch(`${baseUrl}/machine/fingerprint`);
    const fingerprint = await fingerprintResponse.json();
    if (!fingerprintResponse.ok || fingerprint.platform !== "Windows") throw new Error("Windows fingerprint missing");
    if (!fingerprint.fingerprintHash.startsWith("mfp_salted")) throw new Error("fingerprint must be salted hash only");

    const activated = await postJson("/license/activate-key", {
      licenseKey: "CLWD-BETA-PRO1-2026",
    });
    if (!activated.response.ok) throw new Error(`license activation rejected ${activated.response.status}`);
    if (activated.payload.status.licenseProvider !== "lemon-license") throw new Error("license provider should be Lemon license");
    if (activated.payload.status.paymentProvider !== "lemon-squeezy") throw new Error("payment provider should be Lemon Squeezy");
    if (activated.payload.status.machines.length !== 1) throw new Error("machine binding missing");

    const refreshed = await postJson("/license/refresh-offline-ticket", {});
    if (!refreshed.response.ok || !refreshed.payload.ticket.expiresAt) throw new Error("offline ticket did not refresh");

    const tampered = await postJson("/license/validate", { licenseFile: "TAMPERED-LICENSE-FILE" });
    if (!tampered.response.ok) throw new Error("tamper validation request failed");
    if (tampered.payload.status.status !== "tampered") throw new Error("tampered license should downgrade to safe mode");

    const reported = await postJson("/license/report-tamper", {});
    if (!reported.response.ok || reported.payload.event.faultCode !== "CLWD-LIC-1001") throw new Error("tamper report missing fault code");
  });

  await check("Lemon Squeezy mock webhook and update entitlement", async () => {
    const paid = await postJson("/webhooks/lemon/mock", { eventType: "license_key_created", licenseKey: "CLWD-BETA-PRO1-2026" });
    if (!paid.response.ok) throw new Error("Lemon Squeezy license webhook rejected");
    if (paid.payload.status.paymentProvider !== "lemon-squeezy") throw new Error("Lemon provider not mapped");

    const renewed = await postJson("/updates/mock-renew-support", {});
    if (!renewed.response.ok) throw new Error("support renewal rejected");
    const updateResponse = await fetch(`${baseUrl}/updates/check`);
    const update = await updateResponse.json();
    if (!updateResponse.ok || !update.canInstallLatest) throw new Error("latest update should be installable after renewal");
    if (!update.supportUpdatesUntil || Date.parse(update.supportUpdatesUntil) < Date.parse(minimumUpdateSupportDate)) {
      throw new Error("support expiry did not update");
    }
  });

  await check("legal notices and diagnostic privacy", async () => {
    const documentsResponse = await fetch(`${baseUrl}/legal/documents`);
    const documents = await documentsResponse.json();
    if (!documentsResponse.ok) throw new Error("legal documents failed");
    for (const id of [
      "installer-terms",
      "commercial-license",
      "subscription-compliance",
      "openclaw-compatible",
      "openclaw-mit-notice",
      "user-content-rights",
      "privacy",
    ]) {
      if (!documents.documents.some((document) => document.id === id)) throw new Error(`missing legal document ${id}`);
    }
    const noticesResponse = await fetch(`${baseUrl}/legal/notices`);
    const notices = await noticesResponse.json();
    if (!noticesResponse.ok) throw new Error("legal notices failed");
    if (!notices.notices.some((notice) => notice.package === "OpenClaw" && notice.license === "MIT")) {
      throw new Error("missing OpenClaw MIT notice");
    }

    const diagnostic = await postJson("/diagnostics/create-report", {
      faultCode: "CLWD-GW-2001",
      legalConsentSummary: {
        version: "2026-05-13.install-terms.v1",
        acceptedAt: "2026-05-13T00:00:00.000Z",
        documentHash: "sha256-demo",
        documents: ["docs/legal/INSTALLER_TERMS.md", "docs/legal/OPENCLAW_MIT_NOTICE.md"],
      },
      userDescription: "user@example.com C:\\Users\\demo\\private.txt CLWD-BETA-PRO1-2026 sk-test1234567890 sk-ant-test123456789 gsk_test123456789 AIzaTest123456789 lemon_customer_abc",
    });
    if (!diagnostic.response.ok) throw new Error("diagnostic report rejected");
    if (diagnostic.payload.report.legalConsentSummary?.documentHash !== "sha256-demo") {
      throw new Error("diagnostic missing legal consent summary");
    }
    const serialized = JSON.stringify(diagnostic.payload.report);
    for (const forbidden of ["user@example.com", "C:\\Users\\demo\\private.txt", "CLWD-BETA-PRO1-2026", "sk-test1234567890", "sk-ant-test123456789", "gsk_test123456789", "AIzaTest123456789", "lemon_customer_abc"]) {
      if (serialized.includes(forbidden)) throw new Error(`diagnostic leaked ${forbidden}`);
    }
  });

  await check("single identity entry (register/login/SSO)", async () => {
    const initial = await fetch(`${baseUrl}/identity/session`);
    const initialSession = await initial.json();
    if (!initial.ok) throw new Error("identity session endpoint failed");
    if (initialSession.authenticated) throw new Error("identity should start unauthenticated");

    const accountEmail = `clawdesk-user-${Date.now()}@example.com`;
    const registered = await postJson("/identity/register", {
      email: accountEmail,
      displayName: "測試使用者",
      password: "Passw0rd123",
      mode: "personal",
      organization: "個人測試",
    });
    if (!registered.response.ok) throw new Error("identity register failed");
    if (!registered.payload.emailVerificationPending || registered.payload.authenticated) {
      throw new Error("register should return pending verification session");
    }
    if (registered.payload.email !== accountEmail) throw new Error("registered email mismatch");
    if (registered.payload.mode !== "personal") throw new Error("identity mode should be personal");

    const preVerifyLogin = await postJson("/identity/login", {
      email: accountEmail,
      password: "Passw0rd123",
    });
    if (preVerifyLogin.response.ok) throw new Error("login should be blocked before email verification");

    const verificationResponse = await fetch(`${baseUrl}/identity/verification-code?email=${encodeURIComponent(accountEmail)}`);
    const verification = await verificationResponse.json();
    if (!verificationResponse.ok) {
      throw new Error(verification.error ?? "cannot fetch verification code");
    }
    if (!verification.code) {
      throw new Error("verification code not available");
    }

    const confirmed = await postJson("/identity/confirm", {
      email: accountEmail,
      code: verification.code,
    });
    if (!confirmed.response.ok || !confirmed.payload.authenticated) throw new Error("identity confirm failed");
    if (registered.payload.email !== accountEmail) throw new Error("registered email mismatch");
    const signedIn = await postJson("/identity/login", {
      email: accountEmail,
      password: "Passw0rd123",
    });
    if (!signedIn.response.ok || !signedIn.payload.authenticated) throw new Error("identity sign in failed");

    const sso = await postJson("/identity/sso", {
      provider: "azure",
      email: accountEmail,
      displayName: "測試 SSO 使用者",
      organization: "測試企業",
    });
    if (!sso.response.ok || !sso.payload.authenticated) throw new Error("identity sso failed");
    if (sso.payload.mode !== "enterprise") throw new Error("SSO should switch to enterprise mode");
    if (!sso.payload.ssoMock) throw new Error("SSO response should include mock info");
  });

  await check("developer account bypasses license key checks", async () => {
    const developerEmail = process.env.CLAWDESK_DEVELOPER_EMAIL ?? "support@clawdesk.example";
    const developerPassword = process.env.CLAWDESK_DEVELOPER_PASSWORD ?? "ChangeMe123!";
    const devLogin = await postJson("/identity/login", {
      email: developerEmail,
      password: developerPassword,
    });
    if (!devLogin.response.ok || !devLogin.payload.authenticated) throw new Error("developer login failed");

    const statusResponse = await fetch(`${baseUrl}/license/status`);
    const statusPayload = await statusResponse.json();
    if (!statusResponse.ok) throw new Error("license status failed after developer login");
    if (statusPayload.status.status !== "active") throw new Error("developer account should be activated");
    if (statusPayload.status.plan !== "lifetime-local") throw new Error("developer plan should be lifetime local");
    if (statusPayload.status.features?.length < 5) throw new Error("developer feature set missing");
  });

  await check("path governance, memory, context, agents, learning rehearsal, and ergonomics", async () => {
    const pathResponse = await fetch(`${baseUrl}/paths/resolve?path=${encodeURIComponent("~/Desktop/report.md")}&mutating=true`);
    const pathPayload = await pathResponse.json();
    if (!pathResponse.ok || !pathPayload.requiresApproval) throw new Error("outside path should require approval");

    const memory = await postJson("/memory/items", {
      agentId: "document-assistant",
      title: "文件格式",
      body: "Word 草稿先備份。",
      shared: false,
    });
    if (!memory.response.ok || memory.payload.item.source !== "markdown") throw new Error("memory item not created");

    const compressed = await postJson("/context/compress", {});
    if (!compressed.response.ok || !compressed.payload.lastCompressedAt) throw new Error("context compression failed");

    const agentsResponse = await fetch(`${baseUrl}/agents`);
    const agents = await agentsResponse.json();
    if (!agentsResponse.ok || agents.agents.length < 4) throw new Error("default agents missing");
    if (!agents.agents.some((agent) => agent.name === "文書助理")) throw new Error("document assistant missing");

    const knowledge = await postJson(`/agents/${agents.agents[0].id}/knowledge`, {
      title: "私人知識",
      shared: false,
    });
    if (!knowledge.response.ok || knowledge.payload.item.shared !== false) throw new Error("agent knowledge isolation failed");

    const rehearsal = await postJson("/learning/rehearse", {});
    if (!rehearsal.response.ok || rehearsal.payload.phase !== "預演") throw new Error("learning rehearsal missing");
    if (rehearsal.payload.safety.capturePasswords !== false) throw new Error("learning rehearsal privacy unsafe");

    const ergonomics = await postJson("/ergonomics/run-smoke", {});
    if (!ergonomics.response.ok || ergonomics.payload.score < 90) throw new Error("ergonomics score too low");

    const knowledgeSourcesResponse = await fetch(`${baseUrl}/knowledge/sources`);
    const knowledgeSourcesPayload = await knowledgeSourcesResponse.json();
    if (!knowledgeSourcesResponse.ok) throw new Error("knowledge sources endpoint failed");
    for (const requiredType of ["cloud-drive", "database", "image-corpus"]) {
      if (!knowledgeSourcesPayload.sources.some((source) => source.type === requiredType)) {
        throw new Error(`missing knowledge source type ${requiredType}`);
      }
    }

    const targetAgent = agents.agents[0];
    const firstSources = knowledgeSourcesPayload.sources.slice(0, 2).map((source) => source.id);
    const bindResponse = await postJson(`/agents/${targetAgent.id}/knowledge-sources`, { knowledgeBaseIds: firstSources });
    if (!bindResponse.response.ok) throw new Error("agent knowledge source binding rejected");
    if (bindResponse.payload.knowledgeBaseIds.length !== firstSources.length) {
      throw new Error("agent knowledge source binding not persisted");
    }

    const sourcesReadback = await fetch(`${baseUrl}/agents/${targetAgent.id}/knowledge-sources`);
    const sourcesReadbackPayload = await sourcesReadback.json();
    if (!sourcesReadback.ok || sourcesReadbackPayload.knowledgeBaseIds.length !== firstSources.length) {
      throw new Error("agent knowledge source readback mismatch");
    }

    const createdSource = await postJson("/knowledge/sources", {
      type: "database",
      name: "測試企業資料庫",
      description: "用於驗證企業級資料庫類型知識源。",
      provider: "Enterprise mock db",
      tags: ["測試", "資料庫"],
    });
    if (!createdSource.response.ok) throw new Error("create knowledge source rejected");
    if (!createdSource.payload.source.id.startsWith("kb-")) throw new Error("invalid generated knowledge source id");
  });

  await check("ChatGPT Pro desktop-only marker", async () => {
    const { response, payload } = await postJson("/auth/chatgpt-pro/configure");
    if (!response.ok) throw new Error(`status ${response.status}`);
    if (payload.status !== "configured") throw new Error("ChatGPT Pro marker not configured");
    if ("loginUrl" in payload) throw new Error("desktop-only mode must not return loginUrl");
  });

  await check("ChatGPT Pro website account registration", async () => {
    const { response, payload } = await postJson("/auth/chatgpt-pro/account", {
      accountEmail: "pro-user@example.com",
    });
    if (!response.ok) throw new Error(`status ${response.status}`);
    if (payload.status !== "connected") throw new Error("ChatGPT Pro account not connected");
    if (payload.accountEmail !== "pro-user@example.com") throw new Error("account email was not persisted");
  });

  await check("ChatGPT Pro keyless OAuth flow sets Cloud-Main routing", async () => {
    const { response, payload } = await postJson("/auth/chatgpt-pro/oauth-login", {
      accountEmail: "cloud-main-user@example.com",
      model: "gpt-5.4",
    });
    if (!response.ok) throw new Error(`status ${response.status}`);
    if (payload.status !== "connected") throw new Error("OAuth login did not connect");
    if (payload.activeProvider !== "chatgpt-pro") throw new Error("ChatGPT Pro should become active provider");
    if (!payload.model || payload.model !== "gpt-5.4") throw new Error("ChatGPT model should be set to routing target");
    if (!String(payload.displayName).includes("Cloud-Main")) throw new Error("Provider should be marked Cloud-Main");
    if (!String(payload.detail || "").includes("Cloud-Main")) throw new Error("Cloud-Main routing detail missing");
  });

  await check("LLM provider catalog and generic provider configuration", async () => {
    const providersResponse = await fetch(`${baseUrl}/llm-providers`);
    const providersPayload = await providersResponse.json();
    if (!providersResponse.ok) throw new Error("llm providers endpoint failed");
    const providerIds = new Set(providersPayload.providers.map((item) => item.id));
    for (const providerId of ["anthropic", "groq", "openrouter", "azure-openai", "local-model"]) {
      if (!providerIds.has(providerId)) throw new Error(`missing provider ${providerId}`);
    }

    const anthropic = await postJson("/auth/provider", {
      provider: "anthropic",
      apiKey: "sk-ant-mock-abc123456789",
      model: "claude-opus-4-6",
    });
    if (!anthropic.response.ok) throw new Error("generic anthropic provider configure failed");
    if (anthropic.payload.activeProvider !== "anthropic") throw new Error("activeProvider should be anthropic");
    if (!anthropic.payload.maskedKey) throw new Error("anthropic key should be masked");

    const azure = await postJson("/auth/provider", {
      provider: "azure-openai",
      endpoint: "https://example.openai.azure.com/openai/deployments/preview/chat/completions",
      model: "gpt-4.1",
      apiKey: "ak-mock-azure-key",
    });
    if (!azure.response.ok) throw new Error("generic azure provider configure failed");
    if (azure.payload.activeProvider !== "azure-openai") throw new Error("azure openai should be configured");

    const unsupported = await postJson("/auth/provider", { provider: "not-exist", model: "x" });
    if (unsupported.response.ok) throw new Error("unknown provider should be rejected");
  });

  await check("compatible runtime adapter contract and auth plan endpoints", async () => {
    const contractResponse = await fetch(`${baseUrl}/compat/runtime-contract`);
    const contract = await contractResponse.json();
    if (!contractResponse.ok) throw new Error("runtime contract endpoint failed");
    if (contract.adapterMode !== "windows-sidecar-contract") throw new Error("runtime adapter mode mismatch");
    if (!contract.eventTypes.includes("permission.request")) throw new Error("runtime event contract missing permission.request");
    if (!contract.summary["contract-compatible"] || !contract.summary["mock-backed"]) {
      throw new Error("runtime summary should distinguish contract-compatible and mock-backed surfaces");
    }

    const apiPlan = await postJson("/compat/runtime/auth-plan", { providerId: "openai-api" });
    if (!apiPlan.response.ok) throw new Error("OpenAI API auth plan rejected");
    if (apiPlan.payload.endpoint !== "/auth/openai-api-key") throw new Error("OpenAI API auth endpoint mismatch");
    if (apiPlan.payload.credentialPolicy !== "masked-in-memory") throw new Error("OpenAI API credential policy mismatch");
    if (apiPlan.payload.secretRefPolicy !== "gateway-secret-ref") throw new Error("OpenAI API SecretRef policy mismatch");

    const accountPlan = await postJson("/compat/runtime/auth-plan", { providerId: "openai-codex" });
    if (!accountPlan.response.ok) throw new Error("OpenAI account auth plan rejected");
    if (accountPlan.payload.endpoint !== "/auth/openai-codex/oauth-login") throw new Error("OpenAI account endpoint mismatch");
    if (accountPlan.payload.credentialPolicy !== "account-token-stub") throw new Error("OpenAI account credential policy mismatch");
    if (accountPlan.payload.secretRefPolicy !== "gateway-secret-ref") throw new Error("OpenAI account SecretRef policy mismatch");
  });

  await check("product comparison, coding workspace, context budget, and safety queue", async () => {
    const comparisonResponse = await fetch(`${baseUrl}/product-comparison`);
    const comparison = await comparisonResponse.json();
    if (!comparisonResponse.ok || comparison.items.length < 7) throw new Error("product comparison endpoint failed");
    if (!comparison.items.some((item) => item.claudeCode && item.openClaw && item.clawDesk)) {
      throw new Error("comparison matrix missing product columns");
    }
    if (comparison.summary.p0 < 4) throw new Error("comparison P0 priority count is too low");

    const workspaceResponse = await fetch(`${baseUrl}/coding-workspace`);
    const workspace = await workspaceResponse.json();
    if (!workspaceResponse.ok || workspace.mode !== "windows-coding-workspace") throw new Error("coding workspace endpoint failed");
    for (const subagentId of ["planner", "implementer", "reviewer", "tester"]) {
      if (!workspace.subagents.some((agent) => agent.id === subagentId)) throw new Error(`missing subagent ${subagentId}`);
    }
    for (const adapterName of ["health", "chat", "permissionResult", "providerStatus", "workflow", "diagnostics"]) {
      if (!workspace.gatewayAdapter.some((method) => method.name === adapterName)) throw new Error(`missing adapter ${adapterName}`);
    }
    for (const extendedAdapter of ["providerSecretRef", "providerOpenAiRuntime", "memory"]) {
      if (!workspace.gatewayAdapter.some((method) => method.name === extendedAdapter)) throw new Error(`missing extended adapter ${extendedAdapter}`);
    }

    const contextResponse = await fetch(`${baseUrl}/context-budget`);
    const context = await contextResponse.json();
    if (!contextResponse.ok || context.budget.recommendedAction !== "none") throw new Error("context budget endpoint failed");
    if (!context.budget.loadedTools.includes("permission-queue")) throw new Error("context budget missing permission queue");

    const safetyResponse = await fetch(`${baseUrl}/safety-policy`);
    const safety = await safetyResponse.json();
    if (!safetyResponse.ok || safety.summary.requiresApproval < safety.rules.length) throw new Error("safety policy summary invalid");
    if (!safety.rules.some((rule) => rule.denyPaths.includes(".env*") && rule.riskLevel === "blocked")) {
      throw new Error("safety policy must block .env*");
    }

    const gatewayAdapterResponse = await fetch(`${baseUrl}/gateway-adapter/contract`);
    const gatewayAdapter = await gatewayAdapterResponse.json();
    if (!gatewayAdapterResponse.ok || gatewayAdapter.mode !== "windows-sidecar-contract") {
      throw new Error("gateway adapter contract endpoint failed");
    }

    const fileSearch = await postJson("/coding-workspace/file-search", { query: "provider", maxResults: 5 });
    if (!fileSearch.response.ok || !Array.isArray(fileSearch.payload.results) || fileSearch.payload.results.length < 1) {
      throw new Error("coding workspace file-search endpoint failed");
    }

    const patchPreview = await postJson("/coding-workspace/patch-preview", {
      target: "src/lib/codingWorkspace.ts",
      summary: "MVP verification patch preview",
      riskLevel: "high",
    });
    if (!patchPreview.response.ok || !patchPreview.payload.preview?.queueItemId) {
      throw new Error("coding workspace patch-preview endpoint failed");
    }

    const queueDecision = await postJson("/safety-queue/decision", {
      id: patchPreview.payload.preview.queueItemId,
      decision: "approve",
      note: "verify-mvp",
    });
    if (!queueDecision.response.ok) throw new Error("safety queue decision endpoint failed");
    if (!queueDecision.payload.queue?.some((item) => item.id === patchPreview.payload.preview.queueItemId && item.status === "approved")) {
      throw new Error("safety queue decision did not update status");
    }
  });

  await check("OpenAI API provider model setting", async () => {
    const { response, payload } = await postJson("/auth/openai-api-key", {
      apiKey: "sk-test-1234567890",
      model: "gpt-5.2",
    });
    if (!response.ok) throw new Error(`status ${response.status}`);
    if (payload.model !== "gpt-5.2") throw new Error("model was not persisted");
    if (typeof payload.maskedKey !== "string" || !payload.maskedKey.includes("...") || !payload.maskedKey.endsWith("7890")) {
      throw new Error("key was not masked as expected");
    }
    if (!payload.secretRef?.startsWith("psr_")) throw new Error("provider SecretRef missing");
    if (JSON.stringify(payload).includes("sk-test-1234567890")) throw new Error("provider payload leaked raw key");

    const contractResponse = await fetch(`${baseUrl}/provider/secret-ref/contract`);
    const contract = await contractResponse.json();
    if (!contractResponse.ok || contract.rawSecretResponse !== false) throw new Error("provider SecretRef contract failed");

    const issued = await postJson("/provider/secret-ref/issue", {
      providerId: "openai-api",
      authMode: "api-key",
      model: "gpt-5.2",
      secretLabel: payload.maskedKey,
    });
    if (!issued.response.ok || !issued.payload.secretRef.startsWith("psr_")) throw new Error("provider SecretRef issue failed");
    if (JSON.stringify(issued.payload).includes("sk-test-1234567890")) throw new Error("SecretRef issue leaked raw key");

    const runtimeContract = await fetch(`${baseUrl}/provider/openai/runtime-contract`);
    const runtimeContractPayload = await runtimeContract.json();
    if (!runtimeContract.ok || runtimeContractPayload.apiStyle !== "responses-api") throw new Error("OpenAI runtime contract failed");
    if (runtimeContractPayload.rawSecretResponse !== false) throw new Error("OpenAI runtime contract must not return raw secrets");

    const runtimeValidate = await postJson("/provider/openai/validate-key", {
      providerId: "openai-api",
      apiKey: "sk-test-1234567890",
      model: "gpt-5.2",
    });
    if (!runtimeValidate.response.ok || runtimeValidate.payload.status !== "dry-run") throw new Error("OpenAI runtime validation dry-run failed");
    if (JSON.stringify(runtimeValidate.payload).includes("sk-test-1234567890")) throw new Error("OpenAI validation leaked raw key");

    const runtimeChat = await postJson("/provider/openai/chat-test", {
      providerId: "openai-api",
      apiKey: "sk-test-1234567890",
      model: "gpt-5.2",
      prompt: "ClawDesk runtime probe",
    });
    if (!runtimeChat.response.ok || runtimeChat.payload.status !== "dry-run") throw new Error("OpenAI runtime chat dry-run failed");
    if (!runtimeChat.payload.outputText?.includes("Dry-run OK")) throw new Error("OpenAI runtime chat probe missing dry-run output");
    if (JSON.stringify(runtimeChat.payload).includes("sk-test-1234567890")) throw new Error("OpenAI chat probe leaked raw key");
  });

  await check("Google Gemini provider key setting", async () => {
    const geminiApiKey = process.env.CLAWDESK_GEMINI_API_KEY;
    if (!geminiApiKey) {
      console.log("  skip: CLAWDESK_GEMINI_API_KEY not set");
      return;
    }
    const model = "gemini-1.5-flash";
    const { response, payload } = await postJson("/auth/gemini-api-key", {
      apiKey: geminiApiKey,
      model,
    });
    if (!response.ok) throw new Error(`status ${response.status}`);
    if (payload.activeProvider !== "google-gemini") throw new Error("gemini provider not activated");
    if (payload.model !== model) throw new Error("gemini model was not persisted");
    if (typeof payload.maskedKey !== "string" || payload.maskedKey.length < 10) throw new Error("invalid gemini masked key");
  });

  await check("local model endpoint accepts localhost only", async () => {
    const good = await postJson("/auth/local-model", {
      endpoint: "http://127.0.0.1:11434",
      model: "qwen3",
    });
    if (!good.response.ok) throw new Error("local endpoint rejected");

    const bad = await postJson("/auth/local-model", {
      endpoint: "https://example.com",
      model: "remote-model",
    });
    if (bad.response.ok) throw new Error("remote endpoint should be rejected");
  });

  await check("communication channel catalog and setup preview", async () => {
    const response = await fetch(`${baseUrl}/channels`);
    const payload = await response.json();
    if (!response.ok) throw new Error(`status ${response.status}`);
    for (const channelId of ["telegram", "discord", "whatsapp", "slack", "teams", "gmail", "line", "matrix"]) {
      if (!payload.channels.some((channel) => channel.id === channelId)) throw new Error(`missing channel ${channelId}`);
    }
    const telegram = payload.channels.find((channel) => channel.id === "telegram");
    if (!telegram?.guideSteps?.some((step) => step.id === "telegram-botfather")) {
      throw new Error("Telegram guided setup is missing BotFather step");
    }
    const configured = await postJson("/channels/configure", {
      channelId: "telegram",
      enabled: true,
      allowlist: ["@demo"],
      streamMode: "partial",
    });
    if (!configured.response.ok) throw new Error("channel configure rejected");
    if (!configured.payload.requiresApproval) throw new Error("Telegram setup should require approval");

    const testMessage = await postJson("/channels/test-message", {
      channelId: "slack",
      allowlist: ["#ops"],
      streamMode: "partial",
    });
    if (!testMessage.response.ok) throw new Error("channel test preview rejected");
    if (!testMessage.payload.summary.includes("不會送出")) throw new Error("test preview must not send externally");
  });

  await check("multi-entry accounts can authorize collaboration scopes", async () => {
    const response = await fetch(`${baseUrl}/accounts`);
    const payload = await response.json();
    if (!response.ok) throw new Error(`status ${response.status}`);
    for (const providerId of ["chatgpt", "google", "microsoft", "github", "slack", "email", "cloud"]) {
      if (!payload.providers.some((provider) => provider.id === providerId)) throw new Error(`missing provider ${providerId}`);
    }
    const connected = await postJson("/accounts/connect", {
      provider: "google",
      email: "collab@example.com",
      role: "editor",
      projectIds: ["clawdesk-desktop"],
      softwareTargets: ["Google Drive", "Gmail"],
      scopes: ["drive.read", "gmail.draft"],
    });
    if (!connected.response.ok) throw new Error("account connect rejected");
    if (connected.payload.account.email !== "collab@example.com") throw new Error("account email not persisted");
    if (!connected.payload.preview.requiresApproval) throw new Error("Gmail draft scope should require approval");
  });

  await check("Microsoft MCP connector catalog and permission preview", async () => {
    const catalogResponse = await fetch(`${baseUrl}/mcp/connectors`);
    const catalog = await catalogResponse.json();
    if (!catalogResponse.ok) throw new Error(`status ${catalogResponse.status}`);
    const office = catalog.connectors.find((connector) => connector.id === "microsoft-office");
    if (!office) throw new Error("missing Microsoft Office connector");
    const google = catalog.connectors.find((connector) => connector.id === "google-workspace");
    const browser = catalog.connectors.find((connector) => connector.id === "browser-vision");
    const developer = catalog.connectors.find((connector) => connector.id === "developer-tools");
    const engineering = catalog.connectors.find((connector) => connector.id === "engineering-tools");
    const cloud = catalog.connectors.find((connector) => connector.id === "cloud-services");
    if (!google) throw new Error("missing Google Workspace connector");
    if (!office.protocols?.length || !office.protocols.some((protocol) => protocol.id === "microsoft-graph")) {
      throw new Error("Microsoft Office connector missing Microsoft Graph protocol metadata");
    }
    if (!google.protocols?.length || !google.protocols.some((protocol) => protocol.id === "google-workspace-apis")) {
      throw new Error("Google Workspace connector missing Google Workspace API metadata");
    }
    if (!browser) throw new Error("missing browser and vision connector");
    if (!developer) throw new Error("missing developer tools connector");
    if (!engineering) throw new Error("missing engineering tools connector");
    if (!cloud) throw new Error("missing cloud services connector");
    for (const [connector, toolIds] of [
      [office, ["word.summarize", "excel.inspect", "powerpoint.outline", "outlook.draft-reply"]],
      [google, ["drive.search", "docs.summarize", "sheets.inspect", "gmail.draft", "calendar.plan"]],
      [browser, ["browser.search", "browser.open", "screen.vision"]],
      [developer, ["vscode.workspace.inspect", "github.issue.triage", "docker.compose.inspect", "terminal.command.plan"]],
      [engineering, ["autocad.drawing.inspect", "fusion360.model.review", "matlab.script.review", "jupyter.notebook.inspect"]],
      [cloud, ["aws.cost.inspect", "azure.resource.inspect", "gcp.project.inspect", "cloudflare.dns.preview", "vercel.deploy.inspect"]],
    ]) {
      for (const toolId of toolIds) {
        if (!connector.tools.some((tool) => tool.id === toolId)) throw new Error(`missing ${toolId}`);
      }
    }

    const connected = await postJson("/mcp/connect", { connectorId: "microsoft-office" });
    if (!connected.response.ok) throw new Error("Microsoft MCP connector did not connect");
    if (connected.payload.status !== "connected") throw new Error("connector status was not persisted");

    const preview = await postJson("/mcp/preview", {
      connectorId: "microsoft-office",
      toolId: "word.redline",
      target: "C:\\Users\\demo\\Documents\\report.docx",
    });
    if (!preview.response.ok) throw new Error("MCP preview rejected");
    if (!preview.payload.requiresApproval) throw new Error("Word redline should require approval");

    const terminalPreview = await postJson("/mcp/preview", {
      connectorId: "developer-tools",
      toolId: "terminal.command.plan",
      target: "~/ClawDesk Projects/桌面 GUI",
    });
    if (!terminalPreview.response.ok) throw new Error("developer MCP preview rejected");
    if (!terminalPreview.payload.requiresApproval || terminalPreview.payload.risk !== "high") {
      throw new Error("Terminal command plans must require high-risk approval");
    }
  });

  await check("workflow schedules can be created from templates", async () => {
    const response = await fetch(`${baseUrl}/workflows`);
    const payload = await response.json();
    if (!response.ok) throw new Error(`status ${response.status}`);
    if (!payload.templates.some((template) => template.id === "daily-document-brief")) {
      throw new Error("missing daily document workflow template");
    }
    const created = await postJson("/workflows", {
      name: "每日文件摘要",
      status: "draft",
      scheduleKind: "daily",
      scheduleText: "每天 09:00 執行",
      steps: payload.templates[0].steps,
    });
    if (!created.response.ok) throw new Error("workflow create rejected");
    if (created.payload.status !== "draft") throw new Error("workflow should start as draft");
  });

  await check("local media capabilities and learning mode workflow draft", async () => {
    const mediaResponse = await fetch(`${baseUrl}/media/capabilities`);
    const media = await mediaResponse.json();
    if (!mediaResponse.ok) throw new Error(`status ${mediaResponse.status}`);
    for (const kind of ["video", "audio", "image", "text-log"]) {
      if (!media.capabilities.some((capability) => capability.kind === kind && capability.localOnly)) {
        throw new Error(`missing local media capability ${kind}`);
      }
    }
    const video = media.capabilities.find((capability) => capability.kind === "video");
    if (!video.hardwareAcceleration || !video.formats.includes("mp4")) throw new Error("video capability should include accelerated mp4 support");
    if (!media.policy.keepLocalOnly) throw new Error("media policy should default to local-only");

    const started = await postJson("/learning/start", {});
    if (!started.response.ok || started.payload.status !== "recording") throw new Error("learning mode did not start recording");
    if (started.payload.capturePasswords || started.payload.captureScreenImages) throw new Error("learning mode privacy defaults are unsafe");

    const observed = await postJson("/learning/observe", {
      app: "File Explorer",
      kind: "file-action",
      description: "把下載檔案複製到專案 uploads",
      target: "~/Downloads/report.pdf",
      risk: "medium",
    });
    if (!observed.response.ok || observed.payload.actions.length !== 1) throw new Error("learning mode did not record action");

    const stopped = await postJson("/learning/stop", {});
    if (!stopped.response.ok) throw new Error("learning mode stop rejected");
    if (stopped.payload.session.status !== "draft-ready") throw new Error("learning mode should end with draft-ready");
    if (!stopped.payload.workflow.steps[0].requiresApproval) throw new Error("learned file action should require approval");
  });

  await check("compatible settings schema is available in guided sections", async () => {
    const response = await fetch(`${baseUrl}/compat/settings`);
    const payload = await response.json();
    if (!response.ok) throw new Error(`status ${response.status}`);
    for (const section of ["workspace", "models", "agents", "channels", "gateway", "security", "tools", "advanced"]) {
      if (!payload.sections.includes(section)) throw new Error(`missing settings section ${section}`);
    }
    const saved = await postJson("/compat/settings", {
      goal: "office",
      modelProvider: "chatgpt-pro",
      workspaceFolder: "~/ClawDesk Projects/桌面 GUI",
    });
    if (!saved.response.ok) throw new Error("settings profile save rejected");
    if (saved.payload.profile.goal !== "office") throw new Error("settings profile not persisted");
  });

  await check("stream events, Canvas patch, and permission round trip", async () => {
    const events = await collectStreamEvents();
    const types = new Set(events.map((event) => event.type));
    for (const expected of ["gateway.status", "agent.message.delta", "agent.message.done", "canvas.begin", "canvas.patch", "permission.request"]) {
      if (!types.has(expected)) throw new Error(`missing ${expected}`);
    }
  });

  await check("OpenAI provider route uses runtime chat text on /chat (dry-run)", async () => {
    const auth = await postJson("/auth/openai-api-key", {
      apiKey: "sk-test-openai-runtime-demo",
      provider: "openai-api",
      model: "gpt-5.2",
    });
    if (!auth.response.ok) throw new Error("openai provider auth not accepted");
    const events = await collectStreamEvents({
      conversationId: "verify-openai-chat",
      prompt: "測試 OpenAI runtime 的 /chat 串流結果",
      requirePermission: true,
    });
    const text = extractAgentText(events);
    if (!text.includes("Dry-run")) throw new Error("OpenAI /chat output does not include dry-run runtime marker");
  });
} finally {
  child.kill("SIGTERM");
  await Promise.race([
    once(child, "exit"),
    new Promise((resolve) => setTimeout(resolve, 1000)),
  ]);
}

const failed = checks.filter((item) => !item.ok);
if (failed.length > 0) {
  console.error("\nVerification failed");
  console.error(bootOutput.trim());
  process.exit(1);
}

console.log(`\n${checks.length} verification checks passed.`);
