import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const port = Number(process.env.OPENCLAW_MOCK_PORT ?? 18890);
const host = "127.0.0.1";
const defaultProjectRoot = path.resolve(process.cwd(), "ClawDesk Projects", "desktop-mvp");
const projectRoot = path.resolve(process.env.CLAWDESK_PROJECT_ROOT ?? defaultProjectRoot);
const fallbackHome = path.join(os.tmpdir(), "ClawDesk");
const homeDir = process.env.CLAWDESK_HOME_DIR ?? os.homedir() ?? fallbackHome;
const clients = new Set();
const pendingPermissions = new Map();
const nowIso = () => new Date().toISOString();
const stateFilePath = process.env.CLAWDESK_MOCK_STATE_FILE
  ? path.resolve(process.env.CLAWDESK_MOCK_STATE_FILE)
  : "";
const identityBackendUrl = process.env.CLAWDESK_IDENTITY_BACKEND_URL
  ? process.env.CLAWDESK_IDENTITY_BACKEND_URL
  : "";
const normalizedBackendUrl = identityBackendUrl ? identityBackendUrl.replace(/\/+$/, "") : "";
const persistenceEnabled = Boolean(stateFilePath);
const identityBackendEnabled = Boolean(identityBackendUrl);
const backendLicenseState = {
  licenseKey: "",
  machineFingerprintHash: "",
  offlineTicket: "",
  status: null,
  sessionToken: "",
};
const backendIdentityVerificationCodes = new Map();
const openClawUpstreamSnapshot = {
  repository: "https://github.com/openclaw/openclaw",
  commit: "d4484158d9291820d7af236d4277704da019f609",
  license: "MIT",
  importedSurfaces: [
    "src/agents/model-auth.ts",
    "src/agents/auth-profiles/*",
    "src/plugin-sdk/provider-auth.ts",
    "src/commands/auth-choice-options.static.ts",
    "src/plugin-sdk/provider-catalog-shared.ts",
  ],
  windowsStatus: "adapted-for-clawdesk-windows-sidecar-contract",
};
const openClawFeatureParity = [
  ["model-auth-openai", "模型連線與 OpenAI 登入", "partial", "已納入 OpenAI API key 與 OpenAI/Codex OAuth 契約；尚未接 Windows Credential Manager / token refresh。"],
  ["provider-catalog", "Provider catalog / model catalog", "partial", "已有主要 provider 清單；尚未完整支援 live catalog/cache/cost/context window。"],
  ["gateway-protocol", "Gateway protocol / WebSocket / RPC", "mock", "目前是 OpenClaw-compatible mock Gateway；尚未載入 upstream gateway runtime。"],
  ["agents-runtime", "Agents runtime / subagents / harness", "mock", "已有 agent GUI 與 mock 任務；尚未執行 embedded runner/harness。"],
  ["plugins-sdk", "Plugin SDK / tools", "partial", "已有 MCP/tool preview；尚未載入完整 plugin runtime。"],
  ["extensions", "Extensions / external connectors", "mock", "已有 connector catalog/permission preview；upstream extensions 尚未打包。"],
  ["channels", "Messaging channels", "partial", "已有 Teams/Gmail/LINE/Telegram/Slack 入口；尚未接 webhook delivery runtime。"],
  ["cron-workflows", "Cron / workflow automation", "mock", "已有 workflow CRUD mock；尚未接 isolated-agent cron runner。"],
  ["memory", "Memory / embeddings / vector store", "mock", "已有 memory UI/mock；尚未接 embeddings/batch/vector store。"],
  ["security-auth", "Security / auth profiles / secret refs", "partial", "已有 redaction 與 masked key；尚未實作 upstream auth profile store。"],
  ["config-schema", "Config schema / guided setup", "partial", "已有設定導引；尚未完整匯入/匯出 upstream config schema。"],
  ["ui-control", "Control UI / TUI / model picker", "partial", "本機使用 React/Tauri GUI；未直接使用 upstream Lit UI/TUI。"],
  ["media-understanding", "Media understanding / generation", "mock", "已有能力宣告；未接 upstream provider runtime。"],
  ["tts-talk", "TTS / talk / realtime transcription", "deferred", "首發 Beta 不阻塞，後續接 Windows audio pipeline。"],
  ["pairing-device", "Pairing / device auth / node mode", "deferred", "Windows 首發先支援 loopback，不做 mobile node pairing。"],
  ["macos-ios-android", "Native Apple/Android apps", "not-applicable", "平台不同，不納入 Windows installer。"],
  ["sdk", "SDK / client API", "deferred", "Beta 穩定後再提供 local API SDK 或 upstream SDK 相容。"],
  ["windows-release", "Windows packaging / certification", "partial", "Tauri NSIS/release guard 已有；簽章/認證保留。"],
].map(([id, domain, status, difference]) => ({ id, domain, status, difference }));
const openClawRuntimeSurfaces = [
  {
    id: "provider-auth",
    upstreamPaths: ["src/agents/model-auth.ts", "src/agents/model-auth-env.ts", "src/agents/auth-profiles/*"],
    status: "contract-compatible",
    windowsAdapter: "Provider auth plans map API key, OAuth, local endpoint, and mock modes to desktop-safe endpoints. Tauri desktop stores provider secrets with Windows DPAPI.",
    remainingWork: "Replace OAuth account stubs with real token refresh and optional Windows Credential Manager integration.",
  },
  {
    id: "provider-catalog",
    upstreamPaths: ["src/model-catalog/*", "src/agents/models-config.providers.*", "src/plugin-sdk/provider-catalog-shared.ts"],
    status: "contract-compatible",
    windowsAdapter: "Provider catalog is exposed with upstream ids/source metadata.",
    remainingWork: "Import live model context window, pricing, feature flags, and cache policy metadata.",
  },
  {
    id: "gateway-events",
    upstreamPaths: ["src/gateway/control-ui-contract.ts", "src/gateway/client.ts", "src/gateway/call.ts"],
    status: "contract-compatible",
    windowsAdapter: "WebSocket events cover agent delta/done, canvas, permission, and gateway status events.",
    remainingWork: "Replace mock event producer with signed production Gateway runtime.",
  },
  {
    id: "agent-session-runtime",
    upstreamPaths: ["src/agents/*", "src/gateway/agent-*.ts", "src/gateway/chat-*.ts"],
    status: "mock-backed",
    windowsAdapter: "Session and agent UX use deterministic local mock flows for Windows Beta validation.",
    remainingWork: "Embed or launch upstream runner with Windows process supervision and cancellation.",
  },
  {
    id: "permissions-tools",
    upstreamPaths: ["src/gateway/permission*.ts", "src/plugin-sdk/*", "extensions/*"],
    status: "contract-compatible",
    windowsAdapter: "Permission request/result event contract is available and GUI approval flow is tested.",
    remainingWork: "Load real plugin/tool manifests and enforce a Windows sandbox policy.",
  },
  {
    id: "config-runtime",
    upstreamPaths: ["src/config/*", "src/commands/*"],
    status: "contract-compatible",
    windowsAdapter: "Guided settings and release config are mapped to Windows-first profile sections.",
    remainingWork: "Add import/export compatibility with upstream OpenClaw config files.",
  },
  {
    id: "memory-workflows",
    upstreamPaths: ["packages/memory-host-sdk/*", "src/cron/*"],
    status: "mock-backed",
    windowsAdapter: "Memory and workflow panels expose local desktop flows and deterministic mock Gateway state.",
    remainingWork: "Add local durable store, scheduler, and embeddings/vector integration.",
  },
  {
    id: "media-tts-pairing",
    upstreamPaths: ["src/media-understanding/*", "src/media-generation/*", "src/tts/*", "src/pairing/*"],
    status: "deferred",
    windowsAdapter: "Windows capability declarations are present; realtime audio/device pairing are not first Beta blockers.",
    remainingWork: "Implement Windows Media Foundation/WASAPI/WIC or ffmpeg sidecar, then pairing.",
  },
];
const accountProviders = [
  {
    id: "chatgpt",
    name: "ChatGPT Pro",
    defaultScopes: [
      { id: "ai.chat", label: "AI 對話", description: "允許在桌面端使用 AI 對話功能。", risk: "low" },
      { id: "ai.workflow", label: "工作流協助", description: "允許工作流引用 AI 產生草稿。", risk: "medium" },
    ],
  },
  {
    id: "google",
    name: "Google Workspace",
    defaultScopes: [
      { id: "drive.read", label: "Drive 讀取", description: "讀取授權檔案清單。", risk: "medium" },
      { id: "gmail.draft", label: "Gmail 草稿", description: "建立草稿但不自動寄送。", risk: "high" },
      { id: "calendar.suggest", label: "Calendar 建議", description: "產生排程建議。", risk: "medium" },
    ],
  },
  {
    id: "microsoft",
    name: "Microsoft 365",
    defaultScopes: [
      { id: "files.read", label: "檔案讀取", description: "讀取 OneDrive/Office 文件。", risk: "medium" },
      { id: "outlook.draft", label: "Outlook 草稿", description: "建立郵件草稿。", risk: "high" },
      { id: "teams.notify", label: "Teams 通知", description: "建立 Teams 訊息預覽。", risk: "high" },
    ],
  },
  {
    id: "github",
    name: "GitHub",
    defaultScopes: [
      { id: "repo.read", label: "Repo 讀取", description: "讀取 repository 與 PR。", risk: "medium" },
      { id: "issues.draft", label: "Issue 草稿", description: "建立 issue/留言草稿。", risk: "medium" },
    ],
  },
  {
    id: "slack",
    name: "Slack",
    defaultScopes: [
      { id: "channels.read", label: "頻道讀取", description: "讀取允許頻道名稱與狀態。", risk: "medium" },
      { id: "messages.draft", label: "訊息草稿", description: "建立訊息草稿不送出。", risk: "high" },
    ],
  },
  {
    id: "line",
    name: "LINE",
    defaultScopes: [
      { id: "line.profile", label: "Profile 讀取", description: "讀取允許使用者/群組識別。", risk: "medium" },
      { id: "line.message.preview", label: "訊息預覽", description: "建立訊息預覽。", risk: "medium" },
    ],
  },
  {
    id: "email",
    name: "Email / SMTP",
    defaultScopes: [
      { id: "mail.read", label: "信件讀取", description: "讀取允許信箱或資料夾。", risk: "high" },
      { id: "mail.draft", label: "草稿", description: "建立郵件草稿。", risk: "high" },
    ],
  },
  {
    id: "cloud",
    name: "雲端服務帳號",
    defaultScopes: [
      { id: "cloud.read", label: "資源讀取", description: "讀取資源與成本摘要。", risk: "medium" },
      { id: "cloud.plan", label: "變更計畫", description: "建立變更計畫但不直接套用。", risk: "high" },
    ],
  },
];
const llmProviderCatalog = [
  {
    id: "chatgpt-pro",
    shortName: "ChatGPT Pro",
    displayName: "ChatGPT Pro",
    authMode: "oauth",
    modelPlaceholder: "gpt-5.4",
    modelDefault: "gpt-5.4",
    accountPlaceholder: "ChatGPT Pro 帳號 Email",
    upstreamAuthKind: "oauth",
    upstreamProviderId: "openai-codex",
    upstreamSource: "src/agents/auth-profiles/oauth.ts",
    description: "無金鑰協議（Keyless）供應商。",
  },
  {
    id: "openai-codex",
    shortName: "OpenAI Codex",
    displayName: "OpenAI Codex",
    authMode: "oauth",
    modelPlaceholder: "gpt-5.3-codex",
    modelDefault: "gpt-5.3-codex",
    accountPlaceholder: "OpenAI Codex 帳號 Email",
    upstreamAuthKind: "oauth",
    upstreamProviderId: "openai-codex",
    upstreamSource: "src/agents/model-auth.ts",
    description: "Codex OAuth 模式（可作為 ChatGPT Pro 的上游供應鏈參考）。",
  },
  {
    id: "openai",
    shortName: "OpenAI API",
    displayName: "OpenAI API",
    authMode: "api-key",
    modelPlaceholder: "gpt-5.2",
    modelDefault: "gpt-5.2",
    keyPlaceholder: "sk-...",
    keyPrefixes: ["sk-"],
    upstreamAuthKind: "api_key",
    upstreamProviderId: "openai",
    upstreamSource: "src/agents/model-auth-env.ts",
    description: "OpenAI 官方 API 金鑰。",
  },
  {
    id: "openai-api",
    shortName: "OpenAI API",
    displayName: "OpenAI API",
    authMode: "api-key",
    modelPlaceholder: "gpt-5.2",
    modelDefault: "gpt-5.2",
    keyPlaceholder: "sk-...",
    keyPrefixes: ["sk-"],
    upstreamAuthKind: "api_key",
    upstreamProviderId: "openai",
    upstreamSource: "src/agents/model-auth.ts",
    description: "OpenAI API 相容欄位。",
  },
  {
    id: "anthropic",
    shortName: "Anthropic",
    displayName: "Anthropic",
    authMode: "api-key",
    modelPlaceholder: "claude-opus-4-6",
    modelDefault: "claude-opus-4-6",
    keyPlaceholder: "sk-ant-...",
    keyPrefixes: ["sk-ant-", "sk-ant-api03-"],
    description: "Anthropic Claude 系列 API。",
  },
  {
    id: "google",
    shortName: "Gemini",
    displayName: "Google Gemini",
    authMode: "api-key",
    modelPlaceholder: "gemini-1.5-flash",
    modelDefault: "gemini-1.5-flash",
    keyPlaceholder: "AIza...",
    keyPrefixes: ["AIza"],
    description: "Google Gemini API。",
  },
  {
    id: "google-gemini",
    shortName: "Gemini",
    displayName: "Google Gemini",
    authMode: "api-key",
    modelPlaceholder: "gemini-1.5-flash",
    modelDefault: "gemini-1.5-flash",
    keyPlaceholder: "AIza...",
    keyPrefixes: ["AIza"],
    description: "兼容 OpenClaw 命名。",
  },
  {
    id: "google-vertex",
    shortName: "Vertex AI",
    displayName: "Google Vertex AI",
    authMode: "api-key",
    modelPlaceholder: "vertex-flash",
    modelDefault: "vertex-flash",
    keyPlaceholder: "GOOGLE_API_KEY",
    keyPrefixes: ["AIza", "GOOGLE_API_KEY", "AIzaSy"],
    description: "Google Vertex AI API。",
  },
  {
    id: "google-gemini-cli",
    shortName: "Gemini CLI",
    displayName: "Gemini CLI",
    authMode: "oauth",
    modelPlaceholder: "gemini-1.5-flash",
    modelDefault: "gemini-1.5-flash",
    accountPlaceholder: "Google 帳號 Email",
    description: "Google OAuth CLI 供應商。",
  },
  {
    id: "openrouter",
    shortName: "OpenRouter",
    displayName: "OpenRouter",
    authMode: "api-key",
    modelPlaceholder: "anthropic/claude-3.5-sonnet",
    modelDefault: "anthropic/claude-3.5-sonnet",
    keyPlaceholder: "sk-or-v1-...",
    keyPrefixes: ["sk-or-v1-"],
    description: "聚合式入口。",
  },
  {
    id: "byteplus",
    shortName: "BytePlus",
    displayName: "BytePlus",
    authMode: "api-key",
    modelPlaceholder: "byteplus-plan/ark-code-latest",
    modelDefault: "byteplus-plan/ark-code-latest",
    keyPlaceholder: "BYTEPLUS_API_KEY",
    keyPrefixes: ["sk-", "bp_"],
    description: "BytePlus/Ark 平台。",
  },
  {
    id: "byteplus-plan",
    shortName: "BytePlus Plan",
    displayName: "BytePlus Plan",
    authMode: "api-key",
    modelPlaceholder: "byteplus-plan/ark-code-latest",
    modelDefault: "byteplus-plan/ark-code-latest",
    keyPlaceholder: "BYTEPLUS_API_KEY",
    keyPrefixes: ["sk-", "bp_"],
    description: "BytePlus coding surface。",
  },
  {
    id: "cloudflare-ai-gateway",
    shortName: "Cloudflare AI Gateway",
    displayName: "Cloudflare AI Gateway",
    authMode: "api-key",
    modelPlaceholder: "cloudflare/model",
    modelDefault: "cloudflare/model",
    keyPlaceholder: "CLOUDFLARE_AI_GATEWAY_API_KEY",
    description: "Cloudflare AI Gateway OpenAI 相容轉發。",
  },
  {
    id: "deepseek",
    shortName: "DeepSeek",
    displayName: "DeepSeek",
    authMode: "api-key",
    modelPlaceholder: "deepseek/deepseek-v4-flash",
    modelDefault: "deepseek/deepseek-v4-flash",
    keyPlaceholder: "DEEPSEEK_API_KEY",
    keyPrefixes: ["sk-"],
    description: "DeepSeek 深度推理供應商。",
  },
  {
    id: "deepinfra",
    shortName: "DeepInfra",
    displayName: "DeepInfra",
    authMode: "api-key",
    modelPlaceholder: "deepinfra/deepseek-ai/DeepSeek-V3.2",
    modelDefault: "deepinfra/deepseek-ai/DeepSeek-V3.2",
    keyPlaceholder: "DEEPINFRA_API_KEY",
    keyPrefixes: ["sk-"],
    description: "DeepInfra OpenAI 相容模型。",
  },
  {
    id: "github-copilot",
    shortName: "GitHub Copilot",
    displayName: "GitHub Copilot",
    authMode: "api-key",
    modelPlaceholder: "copilot/default",
    modelDefault: "copilot/default",
    keyPlaceholder: "COPILOT_GITHUB_TOKEN",
    description: "使用 GitHub Copilot Token 的模型代理。",
  },
  {
    id: "minimax",
    shortName: "MiniMax",
    displayName: "MiniMax",
    authMode: "api-key",
    modelPlaceholder: "minimax/MiniMax-M2.7",
    modelDefault: "minimax/MiniMax-M2.7",
    keyPlaceholder: "MINIMAX_API_KEY",
    keyPrefixes: ["sk-", "minimax_"],
    description: "MiniMax 模型服務。",
  },
  {
    id: "minimax-portal",
    shortName: "MiniMax Portal",
    displayName: "MiniMax Portal",
    authMode: "api-key",
    modelPlaceholder: "minimax/MiniMax-M2.7",
    modelDefault: "minimax/MiniMax-M2.7",
    keyPlaceholder: "MINIMAX_OAUTH_TOKEN",
    description: "MiniMax Coding Plan 專用入口。",
  },
  {
    id: "moonshot",
    shortName: "Moonshot",
    displayName: "Moonshot",
    authMode: "api-key",
    modelPlaceholder: "moonshot/kimi-k2.6",
    modelDefault: "moonshot/kimi-k2.6",
    keyPlaceholder: "MOONSHOT_API_KEY",
    keyPrefixes: ["sk-", "moonshot_"],
    description: "Moonshot Kimi model 平台。",
  },
  {
    id: "nvidia",
    shortName: "NVIDIA",
    displayName: "NVIDIA",
    authMode: "api-key",
    modelPlaceholder: "nvidia/nvidia/nemotron-3-super-120b-a12b",
    modelDefault: "nvidia/nvidia/nemotron-3-super-120b-a12b",
    keyPlaceholder: "NVIDIA_API_KEY",
    description: "NVIDIA 平台模型。",
  },
  {
    id: "qianfan",
    shortName: "Qianfan",
    displayName: "Qianfan",
    authMode: "api-key",
    modelPlaceholder: "qianfan/deepseek-v3.2",
    modelDefault: "qianfan/deepseek-v3.2",
    keyPlaceholder: "QIANFAN_API_KEY",
    keyPrefixes: ["sk-", "qf_"],
    description: "百度 Qianfan。",
  },
  {
    id: "qwen",
    shortName: "Qwen",
    displayName: "Qwen",
    authMode: "api-key",
    modelPlaceholder: "qwen/qwen3.5-plus",
    modelDefault: "qwen/qwen3.5-plus",
    keyPlaceholder: "QWEN_API_KEY",
    keyPrefixes: ["sk-", "qwen_"],
    description: "Qwen Cloud / DashScope。",
  },
  {
    id: "kimi",
    shortName: "Kimi",
    displayName: "Kimi Coding",
    authMode: "api-key",
    modelPlaceholder: "kimi/kimi-for-coding",
    modelDefault: "kimi/kimi-for-coding",
    keyPlaceholder: "KIMI_API_KEY",
    keyPrefixes: ["sk-", "kimi_"],
    description: "Kimi Coding 平台入口。",
  },
  {
    id: "kilocode",
    shortName: "Kilo Gateway",
    displayName: "Kilo Gateway",
    authMode: "api-key",
    modelPlaceholder: "kilocode/kilo/auto",
    modelDefault: "kilocode/kilo/auto",
    keyPlaceholder: "KILOCODE_API_KEY",
    description: "Kilo Gateway 聚合式入口。",
  },
  {
    id: "opencode",
    shortName: "OpenCode",
    displayName: "OpenCode",
    authMode: "api-key",
    modelPlaceholder: "opencode/claude-opus-4-6",
    modelDefault: "opencode/claude-opus-4-6",
    keyPlaceholder: "OPENCODE_API_KEY",
    keyPrefixes: ["sk-"],
    description: "OpenCode Zen runtime。",
  },
  {
    id: "opencode-go",
    shortName: "OpenCode Go",
    displayName: "OpenCode Go",
    authMode: "api-key",
    modelPlaceholder: "opencode-go/kimi-k2.6",
    modelDefault: "opencode-go/kimi-k2.6",
    keyPlaceholder: "OPENCODE_ZEN_API_KEY",
    keyPrefixes: ["sk-"],
    description: "OpenCode Go runtime。",
  },
  {
    id: "runway",
    shortName: "Runway",
    displayName: "Runway",
    authMode: "api-key",
    modelPlaceholder: "runway/gpt",
    modelDefault: "runway/gpt",
    keyPlaceholder: "RUNWAY_API_KEY",
    description: "Runway 模型供應層。",
  },
  {
    id: "stepfun",
    shortName: "StepFun",
    displayName: "StepFun",
    authMode: "api-key",
    modelPlaceholder: "stepfun/step-3.5-flash",
    modelDefault: "stepfun/step-3.5-flash",
    keyPlaceholder: "STEPFUN_API_KEY",
    keyPrefixes: ["sk-", "sf_"],
    description: "StepFun 模型入口。",
  },
  {
    id: "stepfun-plan",
    shortName: "StepFun Plan",
    displayName: "StepFun Plan",
    authMode: "api-key",
    modelPlaceholder: "stepfun/step-3.5-flash",
    modelDefault: "stepfun/step-3.5-flash",
    keyPlaceholder: "STEPFUN_API_KEY",
    keyPrefixes: ["sk-", "sf_"],
    description: "StepFun coding surface。",
  },
  {
    id: "together",
    shortName: "Together AI",
    displayName: "Together",
    authMode: "api-key",
    modelPlaceholder: "together/moonshotai/Kimi-K2.5",
    modelDefault: "together/moonshotai/Kimi-K2.5",
    keyPlaceholder: "TOGETHER_API_KEY",
    keyPrefixes: ["sk-"],
    description: "Together 代理。",
  },
  {
    id: "venice",
    shortName: "Venice AI",
    displayName: "Venice",
    authMode: "api-key",
    modelPlaceholder: "venice/default",
    modelDefault: "venice/default",
    keyPlaceholder: "VENICE_API_KEY",
    description: "Venice AI 平台。",
  },
  {
    id: "volcengine",
    shortName: "Volcengine",
    displayName: "Volcengine",
    authMode: "api-key",
    modelPlaceholder: "volcengine/doubao-seed-1-8-251228",
    modelDefault: "volcengine/doubao-seed-1-8-251228",
    keyPlaceholder: "VOLCANO_ENGINE_API_KEY",
    keyPrefixes: ["sk-", "vo_"],
    description: "火山引擎 Doubao 通道。",
  },
  {
    id: "volcengine-plan",
    shortName: "Volcengine Plan",
    displayName: "Volcengine Plan",
    authMode: "api-key",
    modelPlaceholder: "volcengine-plan/ark-code-latest",
    modelDefault: "volcengine-plan/ark-code-latest",
    keyPlaceholder: "VOLCANO_ENGINE_API_KEY",
    keyPrefixes: ["sk-", "vo_"],
    description: "火山引擎 coding surface。",
  },
  {
    id: "xiaomi",
    shortName: "Xiaomi",
    displayName: "Xiaomi",
    authMode: "api-key",
    modelPlaceholder: "xiaomi/mimo-v2-flash",
    modelDefault: "xiaomi/mimo-v2-flash",
    keyPlaceholder: "XIAOMI_API_KEY",
    keyPrefixes: ["sk-", "xm_"],
    description: "Xiaomi MiMo 平台。",
  },
  {
    id: "xai",
    shortName: "xAI",
    displayName: "xAI",
    authMode: "api-key",
    modelPlaceholder: "grok-beta",
    modelDefault: "grok-beta",
    keyPlaceholder: "xai-...",
    description: "xAI API。",
  },
  {
    id: "groq",
    shortName: "Groq",
    displayName: "Groq",
    authMode: "api-key",
    modelPlaceholder: "llama-3.1-70b-versatile",
    modelDefault: "llama-3.1-70b-versatile",
    keyPlaceholder: "gsk_...",
    keyPrefixes: ["gsk_"],
    description: "Groq API。",
  },
  {
    id: "mistral",
    shortName: "Mistral",
    displayName: "Mistral",
    authMode: "api-key",
    modelPlaceholder: "mistral-large-latest",
    modelDefault: "mistral-large-latest",
    keyPlaceholder: "mist_...",
    keyPrefixes: ["mist_"],
    description: "Mistral API。",
  },
  {
    id: "azure-openai",
    shortName: "Azure OpenAI",
    displayName: "Azure OpenAI",
    authMode: "local-endpoint",
    modelPlaceholder: "gpt-4.1",
    modelDefault: "gpt-4.1",
    endpointPlaceholder: "https://xxx.openai.azure.com/openai/deployments/xxx/chat/completions",
    description: "Azure OpenAI 相容 endpoint。",
  },
  {
    id: "cerebras",
    shortName: "Cerebras",
    displayName: "Cerebras",
    authMode: "api-key",
    modelPlaceholder: "llama-4-maverick",
    modelDefault: "llama-4-maverick",
    keyPlaceholder: "CEREBRAS_API_KEY",
    description: "Cerebras API。",
  },
  {
    id: "zai",
    shortName: "Z.AI",
    displayName: "Z.AI",
    authMode: "api-key",
    modelPlaceholder: "zai/glm-4.7",
    modelDefault: "zai/glm-4.7",
    keyPlaceholder: "ZAI_API_KEY",
    description: "Z.AI / GLM。",
  },
  {
    id: "vercel-ai-gateway",
    shortName: "Vercel AI Gateway",
    displayName: "Vercel AI Gateway",
    authMode: "api-key",
    modelPlaceholder: "anthropic/claude-sonnet-4-5",
    modelDefault: "anthropic/claude-sonnet-4-5",
    keyPlaceholder: "AI_GATEWAY_API_KEY",
    description: "Vercel AI Gateway API。",
  },
  {
    id: "huggingface",
    shortName: "Hugging Face",
    displayName: "Hugging Face",
    authMode: "api-key",
    modelPlaceholder: "deepseek-ai/DeepSeek-R1",
    modelDefault: "deepseek-ai/DeepSeek-R1",
    keyPlaceholder: "HF_TOKEN",
    description: "Hugging Face Inference。",
  },
  {
    id: "qwen-portal",
    shortName: "Qwen",
    displayName: "Qwen",
    authMode: "oauth",
    modelPlaceholder: "qwen/coder",
    modelDefault: "qwen/coder",
    accountPlaceholder: "Qwen 帳號 Email",
    description: "Qwen OAuth/Portal。",
  },
  {
    id: "ollama",
    shortName: "Ollama",
    displayName: "Ollama",
    authMode: "local-endpoint",
    modelPlaceholder: "llama3.3",
    modelDefault: "llama3.3",
    endpointPlaceholder: "http://127.0.0.1:11434",
    description: "本機模型 server（Ollama）。",
  },
  {
    id: "lmstudio",
    shortName: "LM Studio",
    displayName: "LM Studio",
    authMode: "local-endpoint",
    modelPlaceholder: "local-model",
    modelDefault: "local-model",
    endpointPlaceholder: "http://127.0.0.1:1234/v1",
    description: "本機 OpenAI 相容伺服器。",
  },
  {
    id: "vllm",
    shortName: "vLLM",
    displayName: "vLLM",
    authMode: "local-endpoint",
    modelPlaceholder: "your-model-id",
    modelDefault: "your-model-id",
    endpointPlaceholder: "http://127.0.0.1:8000/v1",
    description: "本機或自架 vLLM 相容 endpoint。",
  },
  {
    id: "sglang",
    shortName: "SGLang",
    displayName: "SGLang",
    authMode: "local-endpoint",
    modelPlaceholder: "your-model-id",
    modelDefault: "your-model-id",
    endpointPlaceholder: "http://127.0.0.1:30000/v1",
    description: "本機或自架 SGLang 相容 endpoint。",
  },
  {
    id: "local-model",
    shortName: "本機模型",
    displayName: "本機模型",
    authMode: "local-endpoint",
    modelPlaceholder: "llama3.2",
    modelDefault: "llama3.2",
    endpointPlaceholder: "http://127.0.0.1:11434",
    description: "通用本機/OpenAI 相容 endpoint。",
  },
  {
    id: "mock",
    shortName: "Mock Gateway",
    displayName: "Mock Gateway",
    authMode: "mock",
    modelPlaceholder: "mock-model",
    modelDefault: "mock-model",
    description: "本機 mock 環境。",
  },
];
const connectedAccounts = [];
const communicationChannels = [
  {
    id: "telegram",
    name: "Telegram",
    status: "needs-setup",
    description: "適合個人手機與小團隊，透過 BotFather 建立 bot token。",
    setupHint: "準備 bot token，並指定允許使用者或群組。",
    requiredFields: ["botToken", "allowedChats"],
    allowlistLabel: "允許使用者 / 群組",
    streamMode: "partial",
    risk: "medium",
  },
  {
    id: "discord",
    name: "Discord",
    status: "needs-setup",
    description: "適合社群、團隊伺服器與專案頻道。",
    setupHint: "準備 bot token、application id，並限制 server/channel。",
    requiredFields: ["botToken", "applicationId", "allowedChannels"],
    allowlistLabel: "允許伺服器 / 頻道",
    streamMode: "partial",
    risk: "medium",
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    status: "needs-setup",
    description: "適合手機訊息工作流，需 Meta/WhatsApp Business 設定。",
    setupHint: "準備 phone number id、access token、verify token。",
    requiredFields: ["phoneNumberId", "accessToken", "verifyToken"],
    allowlistLabel: "允許電話號碼",
    streamMode: "final",
    risk: "high",
  },
  {
    id: "slack",
    name: "Slack",
    status: "needs-setup",
    description: "適合公司工作區與營運通知。",
    setupHint: "準備 bot token、app token、signing secret。",
    requiredFields: ["botToken", "appToken", "signingSecret"],
    allowlistLabel: "允許 workspace / channel",
    streamMode: "partial",
    risk: "medium",
  },
  {
    id: "teams",
    name: "Microsoft Teams",
    status: "needs-setup",
    description: "適合 Microsoft 365 企業團隊。",
    setupHint: "準備 Teams app/bot 設定與允許 tenant/channel。",
    requiredFields: ["botAppId", "tenantId", "allowedTeams"],
    allowlistLabel: "允許 tenant / team / channel",
    streamMode: "final",
    risk: "high",
  },
  {
    id: "gmail",
    name: "Gmail / Email",
    status: "needs-setup",
    description: "適合收信摘要、草稿、通知，不自動寄送。",
    setupHint: "連接 Gmail 或 SMTP/IMAP，寄送前必須人工確認。",
    requiredFields: ["account", "draftOnly"],
    allowlistLabel: "允許寄件/收件網域",
    streamMode: "final",
    risk: "high",
  },
  {
    id: "line",
    name: "LINE",
    status: "needs-setup",
    description: "適合台灣/亞洲常用訊息入口。",
    setupHint: "準備 LINE Messaging API channel token 與 secret。",
    requiredFields: ["channelAccessToken", "channelSecret"],
    allowlistLabel: "允許 user/group id",
    streamMode: "final",
    risk: "medium",
  },
  {
    id: "matrix",
    name: "Matrix",
    status: "needs-setup",
    description: "適合自架或開源通訊環境。",
    setupHint: "準備 homeserver、access token 與 room allowlist。",
    requiredFields: ["homeserver", "accessToken", "allowedRooms"],
    allowlistLabel: "允許 room",
    streamMode: "partial",
    risk: "medium",
  },
];

const channelGuideSteps = {
  telegram: [
    {
      id: "telegram-botfather",
      title: "打開 BotFather",
      instruction: "在 Telegram 搜尋 @BotFather，輸入 /newbot 建立一個新的 bot。",
      helperText: "BotFather 是 Telegram 官方建立 bot 的入口。",
      userAction: "建立 bot 並複製 bot token。",
    },
    {
      id: "telegram-token",
      title: "貼上 bot token",
      instruction: "把 BotFather 給你的 token 放到正式版的 token 欄位；MVP 只保存設定狀態。",
      helperText: "token 等同鑰匙，不要貼到群組或公開文件。",
      userAction: "確認 token 已準備好。",
    },
    {
      id: "telegram-allowlist",
      title: "限制誰可以叫用",
      instruction: "輸入允許使用者或群組，例如 @me, @team。",
      helperText: "不在允許名單內的人，不能讓 AI 執行任務。",
      userAction: "填寫允許名單。",
    },
    {
      id: "telegram-test",
      title: "測試預覽",
      instruction: "先產生測試訊息預覽，確認不會送到外部服務後再啟用。",
      helperText: "正式發送前仍會要求人工授權。",
      userAction: "按下測試訊息預覽。",
    },
  ],
  discord: [
    {
      id: "discord-app",
      title: "建立 Discord App",
      instruction: "到 Discord Developer Portal 建立 Application，再建立 Bot。",
      helperText: "Bot token 只顯示一次，請放到安全位置。",
      userAction: "建立 Bot 並準備 token。",
    },
    {
      id: "discord-channel",
      title: "選擇允許頻道",
      instruction: "只填入要讓 ClawDesk 使用的 server/channel。",
      helperText: "避免整個伺服器都能叫用 AI。",
      userAction: "填寫允許 server/channel。",
    },
  ],
  whatsapp: [
    {
      id: "whatsapp-business",
      title: "準備 Business 設定",
      instruction: "到 Meta Developer/WhatsApp Business 準備 phone number id、access token、verify token。",
      helperText: "WhatsApp 是高風險通訊入口，任何發送都要人工確認。",
      userAction: "準備必要欄位。",
    },
    {
      id: "whatsapp-allowlist",
      title: "限制電話號碼",
      instruction: "輸入允許的電話號碼或群組識別。",
      helperText: "先從自己或測試號碼開始。",
      userAction: "填寫允許電話號碼。",
    },
  ],
  slack: [
    {
      id: "slack-app",
      title: "建立 Slack App",
      instruction: "在 Slack API 建立 App，取得 bot token、app token、signing secret。",
      helperText: "只授權必要 scopes，先不要給廣泛 workspace 權限。",
      userAction: "準備 Slack token。",
    },
    {
      id: "slack-channel",
      title: "指定工作頻道",
      instruction: "填入允許的 workspace 與 channel，例如 #ops。",
      helperText: "建議先建立測試頻道。",
      userAction: "填寫允許頻道。",
    },
  ],
  teams: [
    {
      id: "teams-app",
      title: "準備 Teams App",
      instruction: "由 Microsoft 365 管理員建立 Teams bot/app，指定 tenant、team、channel。",
      helperText: "企業 Teams 通常需要管理員同意。",
      userAction: "準備 app id 與 tenant id。",
    },
    {
      id: "teams-approval",
      title: "確認管理員授權",
      instruction: "啟用前先確認公司政策允許 AI 讀取或建立 Teams 草稿。",
      helperText: "MVP 不會直接發送 Teams 訊息。",
      userAction: "確認授權範圍。",
    },
  ],
  gmail: [
    {
      id: "gmail-mode",
      title: "選擇草稿模式",
      instruction: "先使用 draft-only，讓 AI 只建立草稿，不自動寄出。",
      helperText: "這是避免誤寄信的安全預設。",
      userAction: "確認使用草稿模式。",
    },
    {
      id: "gmail-domain",
      title: "限制寄件/收件範圍",
      instruction: "填入允許網域或信箱，例如 @company.com。",
      helperText: "寄送前一定會要求人工確認。",
      userAction: "填寫允許網域。",
    },
  ],
  line: [
    {
      id: "line-console",
      title: "準備 LINE Messaging API",
      instruction: "到 LINE Developers 建立 channel，取得 channel access token 與 secret。",
      helperText: "LINE 適合手機通知，但仍要限制群組。",
      userAction: "準備 token 與 secret。",
    },
    {
      id: "line-group",
      title: "限制群組與使用者",
      instruction: "填入允許的 user id 或 group id。",
      helperText: "先用測試群組驗證。",
      userAction: "填寫允許名單。",
    },
  ],
  matrix: [
    {
      id: "matrix-home",
      title: "準備 homeserver",
      instruction: "填入 Matrix homeserver 與 access token。",
      helperText: "自架環境建議先建立專用 bot 帳號。",
      userAction: "準備 homeserver/token。",
    },
    {
      id: "matrix-room",
      title: "限制 room",
      instruction: "只填入允許的 room id。",
      helperText: "避免 bot 進入不相關房間。",
      userAction: "填寫允許 room。",
    },
  ],
};

function communicationChannelsWithGuides() {
  return communicationChannels.map((channel) => ({
    ...channel,
    guideSteps: channelGuideSteps[channel.id] ?? [],
  }));
}

const mcpConnectors = [
  {
    id: "microsoft-office",
    name: "Microsoft 365 文書工具",
    vendor: "Microsoft",
    status: "available",
    transport: "mock",
    description: "Word、Excel、PowerPoint、Outlook 與 OneDrive 的本機 MCP adapter 預覽。",
    protocols: [
      {
        id: "microsoft-graph",
        name: "Microsoft Graph API",
        auth: "OAuth 2.0",
        transport: "https",
        description:
          "以 Microsoft Graph 讀取/編輯 Word、Excel、PowerPoint、Outlook、OneDrive；MVP 使用 mock adapter 模擬授權與權限流程。",
        scopes: [
          "Files.Read",
          "Files.ReadWrite",
          "Files.Read.All",
          "Mail.Read",
          "Mail.ReadWrite",
          "MailboxSettings.Read",
          "Calendars.Read",
          "User.Read",
        ],
        endpoints: [
          "https://graph.microsoft.com/v1.0/me/",
          "https://graph.microsoft.com/v1.0/me/drive/",
        ],
        localAdapter: true,
      },
      {
        id: "office-uri",
        name: "Office URI Protocol",
        auth: "本機 mock",
        transport: "mock",
        description: "模擬 Office URI 開啟與草稿工作流程，用於本機 UI 預覽。",
        localAdapter: true,
      },
    ],
    tools: [
      {
        id: "word.summarize",
        name: "Word 摘要",
        app: "Word",
        description: "讀取 Word 文件後產生摘要與待辦清單。",
        risk: "low",
        permission: "trusted-workspace",
      },
      {
        id: "word.redline",
        name: "Word 修訂建議",
        app: "Word",
        description: "建立修訂建議與批註，不直接覆寫原始文件。",
        risk: "medium",
        permission: "ask",
      },
      {
        id: "excel.inspect",
        name: "Excel 資料檢查",
        app: "Excel",
        description: "檢查工作表欄位、空值、公式錯誤與摘要統計。",
        risk: "low",
        permission: "trusted-workspace",
      },
      {
        id: "excel.build-chart",
        name: "Excel 圖表草稿",
        app: "Excel",
        description: "根據選定表格產生圖表規格草稿。",
        risk: "medium",
        permission: "ask",
      },
      {
        id: "powerpoint.outline",
        name: "PowerPoint 大綱",
        app: "PowerPoint",
        description: "把文件或分析結果轉成簡報大綱。",
        risk: "low",
        permission: "trusted-workspace",
      },
      {
        id: "outlook.draft-reply",
        name: "Outlook 回信草稿",
        app: "Outlook",
        description: "只產生草稿內容，不自動寄送。",
        risk: "medium",
        permission: "ask",
      },
      {
        id: "onedrive.search",
        name: "OneDrive 搜尋",
        app: "OneDrive",
        description: "搜尋受信任工作區與已授權雲端文件。",
        risk: "low",
        permission: "trusted-workspace",
      },
    ],
  },
  {
    id: "google-workspace",
    name: "Google Workspace",
    vendor: "Google",
    status: "available",
    transport: "mock",
    description: "Google Drive、Docs、Sheets、Slides、Gmail 與 Calendar 的 MCP adapter 預覽。",
    protocols: [
      {
        id: "google-workspace-apis",
        name: "Google Workspace APIs",
        auth: "OAuth 2.0",
        transport: "https",
        description:
          "以 Google Drive、Docs、Sheets、Slides、Gmail、Calendar API 提供文件、試算表與郵件草稿能力；MVP 僅 mock 回報。",
        scopes: [
          "https://www.googleapis.com/auth/drive.readonly",
          "https://www.googleapis.com/auth/documents.readonly",
          "https://www.googleapis.com/auth/spreadsheets",
          "https://www.googleapis.com/auth/presentations",
          "https://www.googleapis.com/auth/gmail.compose",
          "https://www.googleapis.com/auth/calendar.events",
        ],
        endpoints: ["https://www.googleapis.com/"],
        localAdapter: true,
      },
    ],
    tools: [
      {
        id: "drive.search",
        name: "Drive 搜尋",
        app: "Google Drive",
        description: "搜尋已授權的 Drive 檔案與專案資料夾副本。",
        risk: "low",
        permission: "trusted-workspace",
      },
      {
        id: "docs.summarize",
        name: "Docs 摘要",
        app: "Google Docs",
        description: "讀取 Google Docs 內容並產生摘要與待辦。",
        risk: "low",
        permission: "trusted-workspace",
      },
      {
        id: "sheets.inspect",
        name: "Sheets 資料檢查",
        app: "Google Sheets",
        description: "檢查表格、公式、欄位型態與資料品質。",
        risk: "low",
        permission: "trusted-workspace",
      },
      {
        id: "slides.outline",
        name: "Slides 大綱",
        app: "Google Slides",
        description: "建立簡報大綱與頁面結構草稿。",
        risk: "medium",
        permission: "ask",
      },
      {
        id: "gmail.draft",
        name: "Gmail 草稿",
        app: "Gmail",
        description: "建立郵件草稿，不自動寄送。",
        risk: "medium",
        permission: "ask",
      },
      {
        id: "calendar.plan",
        name: "Calendar 排程規劃",
        app: "Google Calendar",
        description: "產生會議時間建議，不直接建立活動。",
        risk: "medium",
        permission: "ask",
      },
    ],
  },
  {
    id: "browser-vision",
    name: "瀏覽器與螢幕 GUI",
    vendor: "Local",
    status: "available",
    transport: "mock",
    description: "內建網際網路連線、瀏覽器檢索與螢幕 GUI 視覺辨識 adapter。",
    tools: [
      {
        id: "browser.search",
        name: "網頁搜尋",
        app: "Browser",
        description: "透過授權網路連線查詢公開資訊。",
        risk: "low",
        permission: "trusted-workspace",
      },
      {
        id: "browser.open",
        name: "開啟網頁",
        app: "Chrome",
        description: "在受控瀏覽器工作階段開啟指定頁面。",
        risk: "medium",
        permission: "ask",
      },
      {
        id: "screen.vision",
        name: "螢幕 GUI 視覺辨識",
        app: "Browser",
        description: "擷取螢幕畫面摘要供模型理解 GUI 狀態。",
        risk: "high",
        permission: "ask",
      },
    ],
  },
  {
    id: "developer-tools",
    name: "程式開發工具",
    vendor: "Developer",
    status: "available",
    transport: "mock",
    description: "VS Code、Xcode、JetBrains、GitHub、GitLab、Docker 與 Terminal 的開發 MCP adapter 預覽。",
    tools: [
      {
        id: "vscode.workspace.inspect",
        name: "VS Code 專案檢視",
        app: "VS Code",
        description: "讀取專案結構、語言、測試指令與設定，不修改檔案。",
        risk: "low",
        permission: "trusted-workspace",
      },
      {
        id: "xcode.project.inspect",
        name: "Xcode 專案檢查",
        app: "Xcode",
        description: "檢查 schemes、target、build settings 與簽章狀態。",
        risk: "low",
        permission: "trusted-workspace",
      },
      {
        id: "jetbrains.project.inspect",
        name: "JetBrains 專案檢查",
        app: "JetBrains",
        description: "檢查 run configuration、索引狀態與專案 SDK。",
        risk: "low",
        permission: "trusted-workspace",
      },
      {
        id: "github.issue.triage",
        name: "GitHub Issue 整理",
        app: "GitHub",
        description: "讀取 issue/PR 並產生摘要與待辦，不自動留言或合併。",
        risk: "medium",
        permission: "ask",
      },
      {
        id: "gitlab.pipeline.inspect",
        name: "GitLab Pipeline 檢查",
        app: "GitLab",
        description: "檢查 pipeline 狀態與失敗 log 摘要。",
        risk: "medium",
        permission: "ask",
      },
      {
        id: "docker.compose.inspect",
        name: "Docker Compose 檢查",
        app: "Docker",
        description: "檢查 compose 服務、image、port 與 volume，不啟停容器。",
        risk: "medium",
        permission: "ask",
      },
      {
        id: "terminal.command.plan",
        name: "Terminal 指令計畫",
        app: "Terminal",
        description: "產生 shell 指令計畫；真正執行前必須授權。",
        risk: "high",
        permission: "ask",
      },
    ],
  },
  {
    id: "engineering-tools",
    name: "工程與設計軟體",
    vendor: "Engineering",
    status: "available",
    transport: "mock",
    description: "CAD、CAE、數值分析與工程 notebook 的 MCP adapter 預覽。",
    tools: [
      {
        id: "autocad.drawing.inspect",
        name: "AutoCAD 圖面檢查",
        app: "AutoCAD",
        description: "檢查圖層、標註、圖框與缺失清單，不改寫 DWG。",
        risk: "medium",
        permission: "ask",
      },
      {
        id: "fusion360.model.review",
        name: "Fusion 360 模型檢視",
        app: "Fusion 360",
        description: "檢視零件樹、材料與製造備註。",
        risk: "medium",
        permission: "ask",
      },
      {
        id: "solidworks.assembly.inspect",
        name: "SolidWorks 組立檢查",
        app: "SolidWorks",
        description: "檢查組立件、干涉風險與 BOM 草稿。",
        risk: "medium",
        permission: "ask",
      },
      {
        id: "matlab.script.review",
        name: "MATLAB 腳本檢閱",
        app: "MATLAB",
        description: "檢閱 m-file、模型參數與數值流程，不執行程式。",
        risk: "low",
        permission: "trusted-workspace",
      },
      {
        id: "jupyter.notebook.inspect",
        name: "Jupyter Notebook 檢查",
        app: "Jupyter",
        description: "整理 notebook cell、輸出與資料依賴。",
        risk: "low",
        permission: "trusted-workspace",
      },
    ],
  },
  {
    id: "cloud-services",
    name: "雲端服務",
    vendor: "Cloud",
    status: "available",
    transport: "mock",
    description: "AWS、Azure、Google Cloud、Cloudflare、Vercel 與 Supabase 的雲端 MCP adapter 預覽。",
    tools: [
      {
        id: "aws.cost.inspect",
        name: "AWS 成本檢查",
        app: "AWS",
        description: "讀取帳單與資源摘要，不建立或刪除資源。",
        risk: "medium",
        permission: "ask",
      },
      {
        id: "azure.resource.inspect",
        name: "Azure 資源檢查",
        app: "Azure",
        description: "讀取 resource group、成本與服務健康狀態。",
        risk: "medium",
        permission: "ask",
      },
      {
        id: "gcp.project.inspect",
        name: "Google Cloud 專案檢查",
        app: "Google Cloud",
        description: "讀取專案、IAM 摘要與服務啟用狀態。",
        risk: "medium",
        permission: "ask",
      },
      {
        id: "cloudflare.dns.preview",
        name: "Cloudflare DNS 預覽",
        app: "Cloudflare",
        description: "檢查 DNS 記錄與安全建議；修改前需授權。",
        risk: "high",
        permission: "ask",
      },
      {
        id: "vercel.deploy.inspect",
        name: "Vercel 部署檢查",
        app: "Vercel",
        description: "讀取部署狀態、環境變數缺漏與 build log。",
        risk: "medium",
        permission: "ask",
      },
      {
        id: "supabase.project.inspect",
        name: "Supabase 專案檢查",
        app: "Supabase",
        description: "讀取 database、auth、storage 與 edge function 狀態。",
        risk: "medium",
        permission: "ask",
      },
    ],
  },
];
const workflowTemplates = [
  {
    id: "daily-document-brief",
    name: "每日文件摘要",
    description: "搜尋 Google Drive 與專案資料夾，整理文件摘要並產生待辦。",
    scheduleKind: "daily",
    steps: [
      {
        id: "drive-search",
        title: "搜尋 Google Drive",
        connectorId: "google-workspace",
        toolId: "drive.search",
        requiresApproval: false,
      },
      {
        id: "docs-summary",
        title: "整理 Google Docs 摘要",
        connectorId: "google-workspace",
        toolId: "docs.summarize",
        requiresApproval: false,
      },
    ],
  },
  {
    id: "weekly-office-report",
    name: "每週文書報告",
    description: "檢查 Excel/Sheets 資料，生成 PowerPoint/Slides 大綱草稿。",
    scheduleKind: "weekly",
    steps: [
      {
        id: "excel-inspect",
        title: "檢查 Excel 資料",
        connectorId: "microsoft-office",
        toolId: "excel.inspect",
        requiresApproval: false,
      },
      {
        id: "slides-outline",
        title: "建立 Slides 大綱",
        connectorId: "google-workspace",
        toolId: "slides.outline",
        requiresApproval: true,
      },
    ],
  },
  {
    id: "mail-calendar-followup",
    name: "信件與行事曆追蹤",
    description: "依照 Gmail 草稿與 Calendar 建議建立待辦流程。",
    scheduleKind: "daily",
    steps: [
      {
        id: "gmail-draft",
        title: "建立 Gmail 草稿",
        connectorId: "google-workspace",
        toolId: "gmail.draft",
        requiresApproval: true,
      },
      {
        id: "calendar-plan",
        title: "規劃 Calendar 時段",
        connectorId: "google-workspace",
        toolId: "calendar.plan",
        requiresApproval: true,
      },
    ],
  },
];
const scheduledWorkflows = [];
const mediaCapabilities = [
  {
    id: "video-media-foundation",
    kind: "video",
    name: "影片編碼/解碼",
    formats: ["mp4", "mov", "m4v", "hevc", "h264"],
    engine: "Windows Media Foundation / DirectX Video Acceleration",
    localOnly: true,
    hardwareAcceleration: true,
    maxInputLabel: "單檔 3 小時內",
    notes: "優先使用 Windows 硬體加速；正式外掛 ffmpeg sidecar 時仍維持同一個合約。",
  },
  {
    id: "audio-wasapi",
    kind: "audio",
    name: "音訊讀取/轉碼",
    formats: ["mp3", "wav", "m4a", "aac", "flac"],
    engine: "Windows WASAPI / Media Foundation",
    localOnly: true,
    hardwareAcceleration: true,
    maxInputLabel: "單檔 4 小時內",
    notes: "可用於語音逐字稿、會議摘要與音訊切片；MVP 先建立本機能力邊界。",
  },
  {
    id: "image-wic",
    kind: "image",
    name: "圖片解析/縮圖",
    formats: ["png", "jpg", "jpeg", "webp", "heic", "tiff"],
    engine: "Windows Imaging Component / Direct2D",
    localOnly: true,
    hardwareAcceleration: true,
    maxInputLabel: "超高解析圖片自動產生預覽副本",
    notes: "所有圖片先複製到專案 uploads，再做縮圖、OCR 或視覺辨識。",
  },
  {
    id: "text-log-index",
    kind: "text-log",
    name: "文字記錄與索引",
    formats: ["txt", "md", "jsonl", "log", "csv"],
    engine: "Rust 本機索引器",
    localOnly: true,
    hardwareAcceleration: false,
    maxInputLabel: "單專案 2 GB 文字記錄",
    notes: "聊天紀錄、操作記錄與工具輸出只保存可序列化文字，不執行模型產生的程式碼。",
  },
];
const mediaPolicy = {
  keepLocalOnly: true,
  preferHardwareAcceleration: true,
  maxVideoMinutes: 180,
  maxAudioMinutes: 240,
  maxTextLogMb: 2048,
};
let learningSession = {
  status: "idle",
  consentRequired: true,
  capturePasswords: false,
  captureScreenImages: false,
  actions: [],
};
const openClawSettingsSchema = [
  "workspace",
  "models",
  "agents",
  "channels",
  "gateway",
  "security",
  "tools",
  "advanced",
];
let openClawSettingsProfile = {
  goal: "office",
  modelProvider: "chatgpt-pro",
  workspaceFolder: "~/ClawDesk Projects/桌面 GUI",
  internetEnabled: true,
  screenVisionEnabled: false,
  enableMessagingChannels: false,
  enableWorkflows: true,
};
let providerSession = {
  activeProvider: "mock",
  status: "connected",
  displayName: "Mock Gateway",
  detail: "目前使用本機 mock provider，可驗證桌面端流程。",
};
const identityUsers = [];
const identityVerifications = [];
const identityMailOutbox = [];
let identitySession = {
  authenticated: false,
  displayName: "未登入",
  mode: "personal",
  role: "viewer",
  ssoProvider: "none",
};
const identityPasswordSalt = "clawdesk-mock-identity-v1";
const seededIdentityAccounts = [
  {
    email: process.env.CLAWDESK_DEVELOPER_EMAIL ?? "huangkuoling@gmail.com",
    displayName: "huangkuoling",
    password: process.env.CLAWDESK_DEVELOPER_PASSWORD ?? "ChangeMe123!",
    mode: "personal",
    role: "owner",
    organization: "ClawDesk 測試組織",
  },
];
const developerIdentityEmails = new Set(seededIdentityAccounts.map((item) => item.email));

let machineFingerprint = {
  fingerprintHash: "mfp_salted_mock_win_x64_a9d2",
  hardwareSources: ["machine-guid", "baseboard-serial", "cpu-brand", "cpu-architecture"],
  platform: "Windows",
  confidence: 0.86,
  createdAt: "2026-05-12T00:00:00.000Z",
};

let licenseMachines = [];
let licenseStatus = {
  paymentProvider: "lemon-squeezy",
  licenseProvider: "lemon-license",
  plan: "trial",
  status: "trial",
  seats: 1,
  supportUpdatesUntil: "2026-06-12",
  eligibleLatestVersion: "1.0.0",
  offlineGraceUntil: "2026-05-28",
  features: ["safe-mode", "local-chat", "manual-permissions"],
  deviceLimit: 1,
  machines: licenseMachines,
  entitlement: {
    provider: "lemon-squeezy",
    status: "trial",
    plan: "trial",
    expiresAt: "2026-06-12",
    launchesRemaining: 30,
    conversationsRemaining: 30,
    features: ["local-chat", "manual-permissions", "diagnostics-basic"],
  },
  lastValidationCode: "BETA_TRIAL",
};

const pricingPlans = [
  { id: "trial", name: "Beta Trial", priceUsd: 0, cadence: "7 days or 30 launches" },
  { id: "pro-yearly", name: "Early Access Yearly", priceUsd: 79, cadence: "yearly" },
  { id: "lifetime-local", name: "Early Access Lifetime", priceUsd: 99, cadence: "one-time", supportRenewalUsd: 49 },
  { id: "early-bird", name: "First Batch Early Bird", priceUsd: 69, cadence: "yearly" },
  { id: "team", name: "Team", priceUsd: 40, cadence: "monthly-per-seat" },
  { id: "enterprise", name: "Enterprise", priceUsd: 50000, cadence: "contract" },
];
ensureSeedIdentityUsers();

const updateHistory = [
  {
    version: "1.4.0",
    releasedAt: "2027-01-15",
    notes: ["Paddle + Keygen production adapter", "MCP connector policy audit", "Windows installer hardening"],
  },
  {
    version: "1.0.0",
    releasedAt: "2026-05-12",
    notes: ["ClawDesk commercial desktop MVP", "Mock Gateway", "manual update check"],
  },
];

const legalDocuments = [
  {
    id: "installer-terms",
    title: "安裝與使用同意條款",
    summary: "安裝、啟動、註冊、登入或使用 ClawDesk 前，使用者需同意 EULA、隱私、訂閱、授權與第三方 NOTICE。",
    details: [
      "條款檔已打包於 app resources：legal/INSTALLER_TERMS.md。",
      "正式商業發行前需由律師審閱；此 MVP 僅提供產品內揭露與流程位置。",
      "購買前必須清楚顯示價格、週期、取消方式、退款條件與支援更新到期日。",
    ],
  },
  {
    id: "commercial-license",
    title: "ClawDesk 商業授權",
    summary: "ClawDesk GUI、記憶、Agent、授權、模仿學習與商業功能採閉源商業授權。",
    details: [
      "使用者取得有限、非專屬、不可轉讓、可撤銷的使用授權。",
      "使用者不取得 ClawDesk 原始碼、商標、授權後台或商業資料的所有權。",
    ],
  },
  {
    id: "subscription-compliance",
    title: "訂閱、自動續費與取消揭露",
    summary: "訂閱方案需在購買與安裝前揭露價格、續費週期、取消入口、退款規則與適用消費者權利。",
    details: [
      "Paddle 作為 Merchant of Record，正式版付款、稅務、收據與取消入口由 Paddle 流程承接。",
      "Keygen 管理授權、機器綁定、撤銷、離線票券與支援更新資格。",
      "美國、加州、歐盟、台灣與其他銷售地區可能有不同自動續費、遠距交易與數位內容規範。",
    ],
    sourceUrl: "https://www.ftc.gov/business-guidance/blog/2024/10/click-cancel-ftcs-amended-negative-option-rule-what-it-means-your-business",
  },
  {
    id: "openclaw-compatible",
    title: "OpenClaw-compatible 聲明",
    summary: "ClawDesk 以 OpenClaw-compatible 桌面 Agent 定位，不主張上游 OpenClaw 商標或所有權。",
    details: [
      "目前 MVP 不依賴上游 OpenClaw repo；日後若包含上游程式碼，需保留原始授權與 copyright notice。",
      "ClawDesk 自有 GUI、授權、記憶、Agent、工作流與商業功能仍採 ClawDesk 商業授權。",
    ],
  },
  {
    id: "openclaw-mit-notice",
    title: "OpenClaw MIT 開源說明與重製版權",
    summary: "若 ClawDesk 複製、改作或散布 OpenClaw MIT 程式碼，必須保留 MIT 授權文字與上游 copyright notice。",
    details: [
      "MIT 通常允許使用、複製、修改、合併、出版、散布、再授權與銷售。",
      "重製或散布時必須包含原始 copyright notice 與 permission notice。",
      "完整草案已打包於 app resources：legal/OPENCLAW_MIT_NOTICE.md。",
    ],
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
    details: [
      "診斷資料僅整理非個資摘要，例如版本、OS、CPU 架構、容量區間、Gateway 狀態與錯誤碼。",
      "診斷包送出或匯出前，必須由使用者在故障回報窗口確認。",
    ],
  },
];

const legalNotices = [
  {
    package: "OpenClaw",
    license: "MIT",
    purpose: "OpenClaw-compatible 參考；若重製上游程式碼，需保留 upstream copyright 與 MIT notice",
  },
  { package: "Tauri", license: "MIT / Apache-2.0", purpose: "桌面 shell" },
  { package: "React", license: "MIT", purpose: "使用者介面" },
  { package: "Vite", license: "MIT", purpose: "前端建置" },
  { package: "lucide-react", license: "ISC", purpose: "介面圖示" },
  { package: "Keygen", license: "Commercial SaaS", purpose: "正式版授權管控，MVP 使用 mock" },
  { package: "Paddle", license: "Commercial SaaS", purpose: "正式版金流與稅務，MVP 使用 mock" },
];

const enterpriseKnowledgeSources = [
  {
    id: "kb-drive-sales",
    type: "cloud-drive",
    name: "企業雲端硬碟（行銷與文件）",
    description: "模擬 Google Drive / OneDrive 共用資料夾。",
    provider: "Google Drive / OneDrive",
    tags: ["文件", "簡報", "合規範本"],
  },
  {
    id: "kb-db-salescrm",
    type: "database",
    name: "CRM 與訂單資料庫",
    description: "模擬交易紀錄、客戶資料摘要與專案需求欄位。",
    provider: "PostgreSQL / Supabase",
    tags: ["客戶", "案件", "帳務"],
  },
  {
    id: "kb-image-corpus",
    type: "image-corpus",
    name: "影像與視覺素材庫",
    description: "模擬設計稿、截圖、規格圖與參考影像。",
    provider: "內部圖庫伺服器 / NAS",
    tags: ["圖片", "草圖", "流程截圖"],
  },
];

let memoryItems = [
  {
    id: "mem-default-language",
    agentId: "personal-assistant",
    title: "使用者偏好",
    body: "介面與說明預設使用繁體中文。",
    pinned: true,
    shared: true,
    source: "markdown",
    createdAt: "2026-05-12T00:00:00.000Z",
  },
];

let contextStatus = {
  modelContextLimit: 128000,
  estimatedTokens: 18400,
  rollingSummary: "目前專案正在建立 ClawDesk 商業化桌面 MVP。",
  pinnedFacts: ["品牌名稱 ClawDesk", "Paddle 收款、Keygen 授權", "專案外改動需人工授權"],
  compressionRatio: 1,
  lastCompressedAt: null,
};

let agentProfiles = [
  {
    id: "personal-assistant",
    name: "個人助理",
    role: "整理日常任務、提醒與跨工具協作。",
    model: "ChatGPT Pro / local adapter",
    workspaceId: "desktop-mvp",
    toolPermissions: ["calendar.read", "mail.draft", "file.read"],
    knowledgeBaseIds: ["kb-drive-sales"],
    memoryScope: "private",
    learningMode: "rehearse-only",
  },
  {
    id: "document-assistant",
    name: "文書助理",
    role: "處理 Word、Excel、PowerPoint 與 PDF 文件。",
    model: "ChatGPT Pro / document adapter",
    workspaceId: "docs-brief",
    toolPermissions: ["office.read", "office.write-with-approval"],
    knowledgeBaseIds: ["kb-drive-sales"],
    memoryScope: "project",
    learningMode: "observe",
  },
  {
    id: "automation-assistant",
    name: "自動化助理",
    role: "建立排程、工作流與 MCP 工具串接。",
    model: "ChatGPT Pro / workflow adapter",
    workspaceId: "desktop-mvp",
    toolPermissions: ["workflow.run-with-approval", "mcp.connect"],
    knowledgeBaseIds: ["kb-db-salescrm"],
    memoryScope: "project",
    learningMode: "rehearse-only",
  },
  {
    id: "research-assistant",
    name: "研究助理",
    role: "整理網路資料、來源與長篇 Context。",
    model: "ChatGPT Pro / research adapter",
    workspaceId: "live-canvas",
    toolPermissions: ["browser.read", "knowledge.write"],
    knowledgeBaseIds: ["kb-image-corpus"],
    memoryScope: "shared",
    learningMode: "off",
  },
];

let ergonomicsChecks = [
  {
    id: "license-activation",
    taskName: "啟用 Keygen 授權",
    viewport: "desktop",
    steps: 4,
    keyboardReachable: true,
    noTextOverflow: true,
    tooltipCoverage: 0.96,
    riskPromptCoverage: true,
    score: 99,
  },
  {
    id: "diagnostics-submit",
    taskName: "故障回報確認後送出",
    viewport: "small-window",
    steps: 5,
    keyboardReachable: true,
    noTextOverflow: true,
    tooltipCoverage: 0.91,
    riskPromptCoverage: true,
    score: 96,
  },
];

const diagnosticReports = [];
let auditEvents = [];
let stateSaveTimer;
const DEFAULT_CHATGPT_MODEL = "gpt-5.4";

function audit(action, details = {}) {
  const event = {
    id: crypto.randomUUID(),
    action,
    createdAt: nowIso(),
    actor: identitySession?.email ? hashForAudit(identitySession.email) : "anonymous",
    details: redactAuditDetails(details),
  };
  auditEvents.unshift(event);
  auditEvents = auditEvents.slice(0, 500);
  scheduleStateSave();
  return event;
}

function hashForAudit(input) {
  return `sha256:${crypto.createHash("sha256").update(String(input)).digest("hex").slice(0, 16)}`;
}

function redactAuditDetails(details) {
  const serialized = redactDiagnosticText(JSON.stringify(details ?? {}));
  return JSON.parse(serialized);
}

function snapshotState() {
  return {
    schemaVersion: 1,
    savedAt: nowIso(),
    providerSession,
    connectedAccounts,
    communicationChannels,
    scheduledWorkflows,
    openClawSettingsProfile,
    identityUsers,
    identityVerifications,
    identityMailOutbox,
    identitySession,
    licenseMachines,
    licenseStatus,
    memoryItems,
    contextStatus,
    enterpriseKnowledgeSources,
    agentProfiles,
    ergonomicsChecks,
    diagnosticReports,
    auditEvents,
  };
}

function mergeArray(target, source) {
  if (!Array.isArray(source)) return;
  target.splice(0, target.length, ...source);
}

function applyPersistedState(state) {
  if (!state || state.schemaVersion !== 1) return;
  if (state.providerSession) providerSession = state.providerSession;
  mergeArray(connectedAccounts, state.connectedAccounts);
  mergeArray(communicationChannels, state.communicationChannels);
  mergeArray(scheduledWorkflows, state.scheduledWorkflows);
  if (state.openClawSettingsProfile) openClawSettingsProfile = state.openClawSettingsProfile;
  mergeArray(identityUsers, state.identityUsers);
  mergeArray(identityVerifications, state.identityVerifications);
  mergeArray(identityMailOutbox, state.identityMailOutbox);
  if (state.identitySession) identitySession = state.identitySession;
  if (Array.isArray(state.licenseMachines)) licenseMachines = state.licenseMachines;
  if (state.licenseStatus) licenseStatus = { ...state.licenseStatus, machines: licenseMachines };
  if (Array.isArray(state.memoryItems)) memoryItems = state.memoryItems;
  if (state.contextStatus) contextStatus = state.contextStatus;
  mergeArray(enterpriseKnowledgeSources, state.enterpriseKnowledgeSources);
  if (Array.isArray(state.agentProfiles)) agentProfiles = state.agentProfiles;
  if (Array.isArray(state.ergonomicsChecks)) ergonomicsChecks = state.ergonomicsChecks;
  mergeArray(diagnosticReports, state.diagnosticReports);
  if (Array.isArray(state.auditEvents)) auditEvents = state.auditEvents.slice(0, 500);
  ensureSeedIdentityUsers();
}

async function loadPersistedState() {
  if (!persistenceEnabled) return;
  try {
    const raw = await fs.readFile(stateFilePath, "utf8");
    applyPersistedState(JSON.parse(raw));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.error(`ClawDesk mock state load failed: ${error.message}`);
    }
  }
}

async function savePersistedState() {
  if (!persistenceEnabled) return;
  await fs.mkdir(path.dirname(stateFilePath), { recursive: true });
  await fs.writeFile(stateFilePath, `${JSON.stringify(snapshotState(), null, 2)}\n`, "utf8");
}

function scheduleStateSave() {
  if (!persistenceEnabled) return;
  clearTimeout(stateSaveTimer);
  stateSaveTimer = setTimeout(() => {
    void savePersistedState().catch((error) => {
      console.error(`ClawDesk mock state save failed: ${error.message}`);
    });
  }, 25);
}

function normalizeBackendPath(pathname = "") {
  return pathname.startsWith("/") ? pathname : `/${pathname}`;
}

function formatBackendPayload(payload) {
  if (payload === undefined) return {};
  if (payload === null) return null;
  return payload;
}

async function callBackendApi(pathname, options = {}) {
  if (!identityBackendEnabled || !normalizedBackendUrl) {
    return null;
  }

  const method = String(options.method ?? "GET").toUpperCase();
  const query = Object.entries(options.query ?? {});
  const queryParams = new URLSearchParams();
  for (const [key, value] of query) {
    if (value === undefined || value === null || value === "") continue;
    queryParams.set(key, String(value));
  }
  const targetUrl = new URL(`${normalizeBackendPath(pathname)}`, `${normalizedBackendUrl}/`);
  for (const [key, value] of queryParams) {
    targetUrl.searchParams.set(key, value);
  }

  const requestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "ClawDesk-Mock-Gateway/1.0",
      ...(options.headers ?? {}),
    },
  };

  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    requestInit.body = JSON.stringify(formatBackendPayload(options.body));
  }

  try {
    const response = await fetch(targetUrl, requestInit);
    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }
    return {
      ok: response.ok,
      status: response.status,
      payload,
    };
  } catch (error) {
    return { ok: false, status: 0, payload: { error: String(error?.message ?? "backend unreachable") }, networkError: true };
  }
}

function getBackendIdentityToken() {
  return backendLicenseState.sessionToken;
}

function setBackendIdentityToken(token) {
  backendLicenseState.sessionToken = typeof token === "string" ? token : "";
}

function normalizeIdentitySessionFromBackend(account) {
  if (!account || typeof account !== "object") return {};
  return {
    authenticated: Boolean(account.email),
    userId: account.id ?? account.accountId,
    displayName: account.displayName ?? account.name ?? (account.email ? account.email.split("@")[0] : "未登入"),
    email: account.email,
    mode: mapIdentityMode(account.mode),
    role:
      account.role === "admin" ? "admin" : account.role === "owner" ? "owner" : account.role === "member" ? "member" : "viewer",
    isDeveloper: false,
    organization: account.organization,
    emailVerified: account.emailVerified ?? true,
    emailVerificationPending: Boolean(account.emailVerificationPending),
    ssoProvider: account.ssoProvider ?? "none",
    lastLoginAt: account.lastLoginAt ?? nowIso(),
  };
}

function mapBackendIdentityAccountToMock(record, email, fallbackMode = "personal", fallbackRole = "viewer") {
  return {
    id: record?.id ?? crypto.randomUUID(),
    email,
    displayName: record?.displayName ?? (email ? email.split("@")[0] : "使用者"),
    passwordHash: typeof record?.passwordHash === "string" ? record.passwordHash : "",
    mode: mapIdentityMode(record?.mode ?? fallbackMode),
    role: record?.role ?? fallbackRole,
    organization: record?.organization,
    emailVerified: record?.emailVerified ?? false,
    emailVerificationPending: Boolean(record?.emailVerificationPending),
    ssoProvider: record?.ssoProvider ?? "none",
    createdAt: record?.createdAt ?? nowIso(),
  };
}

function setBackendVerificationCode(email, code) {
  if (!email || !code) return;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 20 * 60 * 1000).toISOString();
  identityVerifications.push({ token: code, email, userId: identityUsers.find((user) => user.email === email)?.id, code, createdAt: now.toISOString(), expiresAt, used: false });
  identityMailOutbox.unshift({
    to: email,
    subject: "ClawDesk 帳號啟用驗證信",
    body: `請在 20 分鐘內點擊驗證連結：https://localhost/identity/verify?token=${code}，或使用驗證碼 ${code}`,
    token: code,
    code,
    createdAt: now.toISOString(),
  });
  backendIdentityVerificationCodes.set(email, code);
}

function getBackendVerificationRecord(email) {
  const now = Date.now();
  const target = identityVerifications.find(
    (item) => item.email === email && !item.used && new Date(item.expiresAt).getTime() > now && item.code === backendIdentityVerificationCodes.get(email),
  );
  if (target) return target;
  const fallback = identityVerifications.find((item) => item.email === email && !item.used && new Date(item.expiresAt).getTime() > now);
  return fallback ?? null;
}

function consumeBackendVerification(email, code) {
  if (!email || !code) return null;
  const now = Date.now();
  const target = identityVerifications.find((item) => item.email === email && !item.used && item.code === code && new Date(item.expiresAt).getTime() > now);
  if (!target) return null;
  target.used = true;
  if (backendIdentityVerificationCodes.get(email) === code) {
    backendIdentityVerificationCodes.delete(email);
  }
  return target;
}

function toBackendPlatformName(value) {
  if (value === "darwin") {
    return "Windows";
  }
  if (value === "win32") {
    return "Windows";
  }
  return value ?? machineFingerprint.platform;
}

function sanitizeBackendFingerprint(raw = {}) {
  const source = raw ?? {};
  const normalizedHash = typeof source.fingerprintHash === "string" ? source.fingerprintHash : machineFingerprint.fingerprintHash;
  return {
    ...machineFingerprint,
    fingerprintHash: normalizedHash.startsWith("mfp_salted") ? normalizedHash : `mfp_salted_${normalizedHash}`,
    hardwareSources: Array.isArray(source.hardwareSources) && source.hardwareSources.length > 0 ? source.hardwareSources : machineFingerprint.hardwareSources,
    platform: toBackendPlatformName(source.platform) ?? machineFingerprint.platform,
    confidence: typeof source.confidence === "number" ? source.confidence : machineFingerprint.confidence,
    createdAt: source.createdAt || nowIso(),
  };
}

async function resolveBackendMachineFingerprint() {
  if (!identityBackendEnabled || !normalizedBackendUrl) {
    return machineFingerprint;
  }
  const response = await callBackendApi("/machine/fingerprint");
  if (!response || !response.ok) {
    return machineFingerprint;
  }
  const nextFingerprint = sanitizeBackendFingerprint(response.payload);
  machineFingerprint = nextFingerprint;
  backendLicenseState.machineFingerprintHash = nextFingerprint.fingerprintHash;
  return nextFingerprint;
}

function mapBackendLicenseEndpointResponse(payload, fallback) {
  const fallbackMachineHash = payload?.machineFingerprintHash || fallback?.machineFingerprintHash || backendLicenseState.machineFingerprintHash;
  const machinePayload = {
    fingerprintHash: fallbackMachineHash,
    platform: machineFingerprint.platform,
    deviceName: "Windows 11 x64 workstation",
    activatedAt: nowIso(),
    lastSeenAt: nowIso(),
  };
  return toLicenseStatusFromBackendLicense(payload, machinePayload, fallback);
}

function mapIdentityMode(mode) {
  if (mode === "enterprise") {
    return "enterprise";
  }
  if (mode === "consumer") {
    return "personal";
  }
  return "personal";
}

function toFrontendIdentitySession(authSession) {
  const session = authSession ?? {};
  return {
    authenticated: Boolean(session.authenticated ?? session.email),
    userId: session.userId,
    displayName: session.displayName ?? (session.email ? session.email.split("@")[0] : "未登入"),
    email: session.email,
    mode: mapIdentityMode(session.mode),
    role: session.role === "admin"
      ? "admin"
      : session.role === "owner"
        ? "owner"
        : session.role === "member"
          ? "member"
          : "viewer",
    isDeveloper: isDeveloperIdentitySession({
      authenticated: Boolean(session.email),
      email: session.email,
      mode: mapIdentityMode(session.mode),
      role: session.role ?? "viewer",
    }),
    organization: session.organization,
    emailVerified: session.emailVerified ?? true,
    emailVerificationPending: session.emailVerificationPending ?? false,
    ssoProvider: session.ssoProvider ?? "none",
    lastLoginAt: session.lastLoginAt ?? nowIso(),
  };
}

function toLicenseStatusFromBackendLicense(licensePayload, machinePayload, statusOverride = {}) {
  const payload = licensePayload ?? {};
  const machine = machinePayload ?? {};
  const statusValue = String(payload.status ?? statusOverride.status ?? "free");
  const isActive = ["active", "updated"].includes(statusValue.toLowerCase()) || statusValue === "past-due";
  const seats = Number(payload.deviceLimit ?? 1);
  const paymentProvider = payload.paymentProvider ?? statusOverride.paymentProvider ?? "paddle";
  const licenseProvider = payload.licenseProvider ?? statusOverride.licenseProvider ?? "keygen";
  return {
    paymentProvider,
    licenseProvider,
    plan: payload.plan ?? "hobby",
    status: statusValue,
    seats: Number.isFinite(seats) && seats > 0 ? seats : 1,
    supportUpdatesUntil: payload.supportUpdatesUntil ?? "2026-05-12",
    eligibleLatestVersion: payload.plan && payload.plan.includes("pro")
      ? "1.4.0"
      : payload.plan === "hobby"
        ? "0.1.0"
        : "1.4.0",
    offlineGraceUntil: payload.offlineGraceUntil ?? null,
    features: payload.features && Array.isArray(payload.features)
      ? payload.features
      : isActive
        ? ["pro-agent", "local-memory", "workflow-builder", "mcp-connectors", "diagnostics"]
        : ["safe-mode", "local-chat", "manual-permissions"],
    deviceLimit: Number.isFinite(seats) && seats > 0 ? seats : 1,
    machines: Array.isArray(payload.machines)
      ? payload.machines
      : machine.machineFingerprintHash
        ? [
            {
              machineId: machine.id || `backend-${Date.now()}`,
              fingerprintHash: machine.machineFingerprintHash,
              deviceName: "Windows 11 x64 workstation",
              platform: "Windows x64 MSVC",
              activatedAt: machine.activatedAt || nowIso(),
              lastSeenAt: machine.lastSeenAt || nowIso(),
            },
          ]
        : [],
    licenseFile: {
      keyId: payload.keyId,
      payloadHash: payload.payloadHash ?? payload.licenseKeyHash ?? `sha256:${(payload.encodedKey ?? "").slice(-5).toLowerCase()}`,
      signatureStatus: payload.signatureStatus ?? "valid",
      storedAs: licenseProvider === "lemon-license" ? "backend issued hashed Lemon beta entitlement" : "backend issued signed Keygen offline license file",
    },
    entitlement: payload.entitlement,
    lastValidationCode: statusOverride.lastValidationCode ?? (licenseProvider === "lemon-license" ? "LEMON_LICENSE_ACTIVE" : isActive ? "KEYGEN_VALID" : "KEYGEN_WAIT"),
  };
}

function toBackendUpdateInfo(backendPayload, fallbackStatus) {
  const payload = backendPayload ?? {};
  if (!payload || typeof payload !== "object") {
    return updateInfo();
  }
  return {
    currentVersion: "0.1.0",
    latestVersion: payload.latestVersion ?? payload.currentVersion ?? "1.4.0",
    eligibleLatestVersion: payload.eligibleLatestVersion ?? fallbackStatus?.eligibleLatestVersion ?? payload.latestVersion ?? "1.4.0",
    supportUpdatesUntil: payload.supportUpdatesUntil ?? fallbackStatus?.supportUpdatesUntil ?? "2026-05-12",
    canInstallLatest: Boolean(payload.canInstallLatest),
    releaseNotes: Array.isArray(payload.releaseNotes) ? payload.releaseNotes : [String(payload.releaseNotes ?? "")].filter(Boolean),
    downloadUrl: payload.downloadUrl,
    requiresRenewal: Boolean(payload.requiresRenewal),
  };
}

function shouldUseProUpdate(update, status) {
  if (!update || typeof update !== "object") return false;
  if (typeof update.canInstallLatest === "boolean") {
    return update.canInstallLatest;
  }
  const statusValue = String(status?.status ?? "").toLowerCase();
  if (!["active", "past-due", "trial"].includes(statusValue)) {
    return false;
  }
  const supportUntil = update.supportUpdatesUntil ?? status?.supportUpdatesUntil;
  if (!supportUntil) return false;
  const supportUntilTs = Date.parse(supportUntil);
  if (Number.isNaN(supportUntilTs)) return false;
  return supportUntilTs >= Date.now();
}

function backendReadiness() {
  return {
    status: "ready",
    service: "clawdesk-mock-gateway",
    productName: "ClawDesk",
    environment: process.env.NODE_ENV ?? "development",
    persistence: {
      enabled: persistenceEnabled,
      stateFilePath: persistenceEnabled ? stateFilePath : null,
    },
    providers: {
      payment: "lemon-squeezy-mock",
      licensing: "lemon-license-mock",
      identity: "email-password-sso-mock",
      mail: "mock-outbox",
      mcp: "catalog-mock",
    },
    counts: {
      users: identityUsers.length,
      accounts: connectedAccounts.length,
      workflows: scheduledWorkflows.length,
      memoryItems: memoryItems.length,
      agents: agentProfiles.length,
      auditEvents: auditEvents.length,
      diagnostics: diagnosticReports.length,
    },
  };
}

function backendDeploymentPlan() {
  return {
    mode: "simulated",
    minimumServices: ["mock-gateway"],
    recommendedServices: ["mock-gateway", "mock-mail", "reverse-proxy", "postgres-or-sqlite-state"],
    productionModules: [
      "Gateway API / WebSocket event service",
      "Identity service with email verification and SSO",
      "Lemon Squeezy webhook service for direct beta",
      "Paddle webhook service",
      "Keygen license adapter",
      "Notification service",
      "Audit and diagnostics store",
      "MCP connector proxy service",
    ],
    environmentVariables: [
      "OPENCLAW_MOCK_PORT",
      "CLAWDESK_MOCK_STATE_FILE",
      "NODE_ENV",
      "PADDLE_WEBHOOK_SECRET",
      "LEMON_SQUEEZY_WEBHOOK_SECRET",
      "LEMON_SQUEEZY_STORE_ID",
      "LEMON_SQUEEZY_PRODUCT_ID",
      "KEYGEN_ACCOUNT_ID",
      "KEYGEN_PRODUCT_ID",
      "KEYGEN_TOKEN",
      "SMTP_URL",
      "SSO_OIDC_ISSUER",
      "SSO_OIDC_CLIENT_ID",
    ],
  };
}

function normalizeKeygenKey(input) {
  return String(input ?? "").trim().toUpperCase().replace(/\s+/g, "-");
}

function normalizeLemonLicenseKey(input) {
  return String(input ?? "").trim().toUpperCase().replace(/\s+/g, "-");
}

function isMockKeygenKey(input) {
  return /^CLWD-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(normalizeKeygenKey(input));
}

function isMockLemonLicenseKey(input) {
  return /^CLWD-BETA-[A-Z0-9]{4}-[0-9]{4}$/.test(normalizeLemonLicenseKey(input));
}

function licenseKeyHash(input) {
  return `lk_${crypto.createHash("sha256").update(`clawdesk-beta-direct:${normalizeLemonLicenseKey(input)}`).digest("hex").slice(0, 24)}`;
}

function createLicensePayload(encodedKey) {
  const normalized = normalizeKeygenKey(encodedKey);
  const plan = normalized.includes("LIFE") ? "lifetime-local" : normalized.includes("TEAM") ? "team" : "pro-yearly";
  return {
    keyId: `kg_${normalized.slice(5, 10).toLowerCase()}`,
    encodedKey: normalized,
    signatureStatus: isMockKeygenKey(normalized) ? "valid" : "invalid",
    payloadHash: `sha256:${normalized.slice(-5).toLowerCase()}-${plan}`,
    plan,
    status: normalized.includes("REVOK") ? "revoked" : isMockKeygenKey(normalized) ? "active" : "tampered",
    supportUpdatesUntil: "2027-05-12",
    expiresAt: plan === "lifetime-local" ? null : "2027-05-12",
    deviceLimit: plan === "team" ? 10 : 3,
  };
}

function isDeveloperIdentitySession(session = identitySession) {
  return Boolean(session.authenticated && session.email && developerIdentityEmails.has(session.email));
}

function applyDeveloperLicenseBypass() {
  const devMachineId = `win_${machineFingerprint.fingerprintHash.slice(-8)}`;
  const existingMachine = licenseMachines.find((machine) => machine.fingerprintHash === machineFingerprint.fingerprintHash);
  if (existingMachine) {
    existingMachine.lastSeenAt = nowIso();
    existingMachine.machineId = existingMachine.machineId || devMachineId;
  } else {
    licenseMachines = [
      ...licenseMachines,
      {
        machineId: devMachineId,
        fingerprintHash: machineFingerprint.fingerprintHash,
        deviceName: "Windows 11 x64 workstation",
        platform: "Windows x64 MSVC",
        activatedAt: nowIso(),
        lastSeenAt: nowIso(),
      },
    ];
  }

  licenseMachines = licenseMachines.filter((machine) => !machine.revokedAt);
  licenseStatus = {
    paymentProvider: "paddle",
    licenseProvider: "keygen",
    plan: "lifetime-local",
    status: "active",
    seats: 10,
    supportUpdatesUntil: "2099-12-31",
    eligibleLatestVersion: "1.8.0",
    offlineGraceUntil: "2099-12-31",
    features: [
      "pro-agent",
      "local-memory",
      "workflow-builder",
      "mcp-connectors",
      "diagnostics",
      "enterprise-connectors",
      "learning",
      "model-routing",
    ],
    deviceLimit: 10,
    machines: licenseMachines,
    licenseFile: {
      keyId: "kg_dev_master",
      payloadHash: "sha256:developer-bypass",
      signatureStatus: "dev-bypass",
      storedAs: "mock developer bypass ticket",
    },
    lastValidationCode: "KEYGEN_DEV_BYPASS",
  };

  audit("license.developer-bypass", { plan: licenseStatus.plan, status: licenseStatus.status });
  scheduleStateSave();
  return licenseStatus;
}

function safeModeLicense(validationCode) {
  licenseMachines = [];
  licenseStatus = {
    paymentProvider: validationCode.includes("LEMON") ? "lemon-squeezy" : "paddle",
    licenseProvider: validationCode.includes("LEMON") ? "lemon-license" : "keygen",
    plan: "trial",
    status: validationCode.includes("LEMON") ? "safe-mode" : validationCode.includes("TAMPER") ? "tampered" : validationCode.includes("REVOK") ? "revoked" : "free",
    seats: 1,
    supportUpdatesUntil: "2026-05-12",
    eligibleLatestVersion: "1.0.0",
    offlineGraceUntil: null,
    features: ["safe-mode", "export-data", "diagnostics"],
    deviceLimit: 1,
    machines: licenseMachines,
    entitlement: {
      provider: validationCode.includes("LEMON") ? "lemon-squeezy" : "keygen",
      status: "safe-mode",
      plan: "trial",
      graceUntil: nowIso(),
      features: ["safe-mode", "export-data", "diagnostics"],
    },
    lastValidationCode: validationCode,
  };
  audit("license.safe-mode", { validationCode, status: licenseStatus.status });
  scheduleStateSave();
  return licenseStatus;
}

function activateLicense(encodedKey) {
  if (isMockLemonLicenseKey(encodedKey)) {
    return activateLemonLicense(encodedKey);
  }
  const payload = createLicensePayload(encodedKey);
  if (payload.signatureStatus !== "valid") {
    return safeModeLicense("KEYGEN_INVALID_SIGNATURE");
  }
  if (payload.status === "revoked") {
    return safeModeLicense("KEYGEN_REVOKED");
  }
  const activeMachines = licenseMachines.filter((machine) => !machine.revokedAt);
  const alreadyActive = activeMachines.some((machine) => machine.fingerprintHash === machineFingerprint.fingerprintHash);
  if (!alreadyActive && activeMachines.length >= payload.deviceLimit) {
    return safeModeLicense("KEYGEN_MACHINE_LIMIT_EXCEEDED");
  }
  if (!alreadyActive) {
    const timestamp = nowIso();
    licenseMachines = [
      ...licenseMachines,
      {
        machineId: `win_${machineFingerprint.fingerprintHash.slice(-8)}`,
        fingerprintHash: machineFingerprint.fingerprintHash,
        deviceName: "Windows 11 x64 workstation",
        platform: "Windows x64 MSVC",
        activatedAt: timestamp,
        lastSeenAt: timestamp,
      },
    ];
  }
  licenseStatus = {
    paymentProvider: "paddle",
    licenseProvider: "keygen",
    plan: payload.plan,
    status: "active",
    seats: payload.plan === "team" ? 10 : 1,
    supportUpdatesUntil: payload.supportUpdatesUntil,
    eligibleLatestVersion: "1.4.0",
    offlineGraceUntil: "2026-06-11",
    features: ["pro-agent", "local-memory", "workflow-builder", "mcp-connectors", "diagnostics"],
    deviceLimit: payload.deviceLimit,
    machines: licenseMachines,
    licenseFile: {
      keyId: payload.keyId,
      payloadHash: payload.payloadHash,
      signatureStatus: payload.signatureStatus,
      storedAs: "mock signed Keygen offline ticket",
    },
    lastValidationCode: "KEYGEN_VALID",
  };
  audit("license.activate", { keyId: payload.keyId, plan: payload.plan, status: licenseStatus.status });
  scheduleStateSave();
  return licenseStatus;
}

function activateLemonLicense(encodedKey) {
  const normalized = normalizeLemonLicenseKey(encodedKey);
  const timestamp = nowIso();
  licenseMachines = [
    {
      machineId: `win_${machineFingerprint.fingerprintHash.slice(-8)}`,
      fingerprintHash: machineFingerprint.fingerprintHash,
      deviceName: "Windows 11 x64 workstation",
      platform: "Windows x64 MSVC",
      activatedAt: timestamp,
      lastSeenAt: timestamp,
    },
  ];
  const plan = normalized.includes("LIFE") ? "lifetime-local" : "pro-yearly";
  const licenseHash = licenseKeyHash(normalized);
  licenseStatus = {
    paymentProvider: "lemon-squeezy",
    licenseProvider: "lemon-license",
    plan,
    status: "active",
    seats: 1,
    supportUpdatesUntil: plan === "lifetime-local" ? "2027-05-14" : "2027-05-14",
    eligibleLatestVersion: "1.4.0",
    offlineGraceUntil: "2026-05-28",
    features: ["pro-agent", "local-memory", "workflow-builder", "mcp-connectors", "diagnostics", "beta-direct"],
    deviceLimit: 1,
    machines: licenseMachines,
    licenseFile: {
      keyId: `lem_${licenseHash.slice(-10)}`,
      licenseKeyHash: licenseHash,
      signatureStatus: "valid",
      storedAs: "hashed Lemon Squeezy beta entitlement",
    },
    entitlement: {
      provider: "lemon-squeezy",
      status: "licensed",
      plan,
      expiresAt: plan === "lifetime-local" ? null : "2027-05-14",
      licenseKeyHash: licenseHash,
      machineHash: machineFingerprint.fingerprintHash,
      graceUntil: "2026-05-28",
      features: ["pro-agent", "local-memory", "workflow-builder", "mcp-connectors", "diagnostics", "beta-direct"],
      lastVerifiedAt: timestamp,
    },
    lastValidationCode: "LEMON_LICENSE_ACTIVE",
  };
  audit("license.lemon.activate", { licenseKeyHash: licenseHash, plan, status: licenseStatus.status });
  scheduleStateSave();
  return licenseStatus;
}

function updateInfo() {
  const latest = updateHistory[0];
  const canInstallLatest = licenseStatus.status === "active" && Date.parse(licenseStatus.supportUpdatesUntil) >= Date.parse(latest.releasedAt);
  return {
    currentVersion: "0.1.0",
    latestVersion: latest.version,
    eligibleLatestVersion: licenseStatus.eligibleLatestVersion,
    supportUpdatesUntil: licenseStatus.supportUpdatesUntil,
    canInstallLatest,
    downloadUrl: canInstallLatest ? "https://example.com/clawdesk/releases/1.4.0" : null,
    releaseNotes: latest.notes,
    requiresRenewal: !canInstallLatest,
  };
}

function redactDiagnosticText(input) {
  return String(input ?? "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]")
    .replace(/\bCLWD-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}\b/g, "[REDACTED]")
    .replace(/\bCLWD-BETA-[A-Z0-9]{4}-[0-9]{4}\b/g, "[REDACTED]")
    .replace(/\/Users\/[^/\s]+\/[^\s]+/g, "[REDACTED]")
    .replace(/[A-Z]:\\(?:[^\\\s]+\\)*[^\\\s]+/gi, "[REDACTED]")
    .replace(/\bpaddle_customer_[A-Za-z0-9_-]+\b/g, "[REDACTED]");
}

function legalConsentSummaryFromBody(body = {}) {
  const source = body.legalConsentSummary;
  if (!source || typeof source !== "object") return undefined;
  const documents = Array.isArray(source.documents)
    ? source.documents.map((item) => String(item)).filter((item) => item.length > 0).slice(0, 10)
    : [];
  const version = String(source.version ?? "").slice(0, 80);
  const acceptedAt = String(source.acceptedAt ?? "").slice(0, 40);
  const documentHash = String(source.documentHash ?? "").slice(0, 96);
  if (!version || !acceptedAt || !documentHash) return undefined;
  return { version, acceptedAt, documentHash, documents };
}

function createDiagnosticReport(body = {}) {
  const timestamp = nowIso();
  const recentErrors = [
    redactDiagnosticText(body.lastError ?? "CLWD-GW-2001 mock gateway recent warning"),
    `License validation=${licenseStatus.lastValidationCode ?? "none"} Lemon event=${body.lemonEventType ?? "none"} Paddle event=${body.paddleEventType ?? "none"}`,
  ];
  const report = {
    reportId: `diag-${Date.now()}`,
    faultCode: /^CLWD-[A-Z]{2,4}-\d{4}$/.test(body.faultCode ?? "") ? body.faultCode : "CLWD-UI-4001",
    createdAt: timestamp,
    appVersion: "0.1.0",
    systemSummary: {
      os: "Windows 11",
      cpuArch: "x64",
      webViewRuntime: "WebView2",
      memoryBucket: "16-32GB",
      diskFreeBucket: "100GB+",
      lowPowerMode: false,
    },
    licenseSummary: {
      provider: "keygen",
      status: licenseStatus.status,
      plan: licenseStatus.plan,
      lastValidationCode: licenseStatus.lastValidationCode,
    },
    gatewaySummary: {
      status: "healthy",
      sidecar: "mock-node",
      version: process.version,
    },
    recentErrors,
    redactionStatus: "redacted",
    legalConsentSummary: legalConsentSummaryFromBody(body),
    userDescription: redactDiagnosticText(body.userDescription ?? ""),
  };
  diagnosticReports.unshift(report);
  audit("diagnostics.create-report", { faultCode: report.faultCode, reportId: report.reportId });
  scheduleStateSave();
  return report;
}

function resolveGovernedPath(rawPath, mutating = false) {
  const raw = String(rawPath ?? ".").trim();
  const namespace = raw.match(/^([a-z]+):(.*)$/i);
  let kind = raw.startsWith(path.sep) ? "absolute" : "relative";
  let absolutePath = raw;
  const namespaces = { uploads: "uploads", backups: "backups", knowledge: "knowledge", memory: "memory" };
  if (raw === "." || raw === "project-root:") {
    kind = "project-root";
    absolutePath = projectRoot;
  } else if (namespace && namespaces[namespace[1]]) {
    kind = namespaces[namespace[1]];
    absolutePath = path.join(projectRoot, kind, namespace[2].replace(/^\/+/, ""));
  } else if (raw.startsWith("~/")) {
    absolutePath = path.join(homeDir, raw.slice(2));
  } else if (!raw.startsWith(path.sep)) {
    absolutePath = path.join(projectRoot, raw);
  }
  absolutePath = path.resolve(absolutePath);
  const insideProject = absolutePath === projectRoot || absolutePath.startsWith(`${projectRoot}${path.sep}`);
  return {
    input: rawPath,
    kind,
    absolutePath,
    insideProject,
    requiresApproval: !insideProject,
    requiresBackup: insideProject && mutating,
    canDeleteAutomatically: false,
  };
}

function filterKnowledgeSourcesByIds(ids = []) {
  const normalizedIds = Array.from(new Set(ids.filter((id) => typeof id === "string" && id.trim().length > 0)));
  return enterpriseKnowledgeSources.filter((source) => normalizedIds.includes(source.id));
}

function findAgent(agentId) {
  return agentProfiles.find((agent) => agent.id === agentId);
}

function scoreErgonomics(check) {
  const stepScore = Math.max(0, 100 - Math.max(0, check.steps - 4) * 8);
  const score = Math.round((stepScore + (check.keyboardReachable ? 100 : 45) + (check.noTextOverflow ? 100 : 30) + Math.round(check.tooltipCoverage * 100) + (check.riskPromptCoverage ? 100 : 50)) / 5);
  return { ...check, score };
}

function json(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(payload);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      if (process.env.CLAWDESK_DEBUG_READJSON === "1" && body.length < 200) {
        console.log(`readJson chunk: type=${typeof chunk}, hasBuffer=${chunk instanceof Buffer}, isUint8=${chunk instanceof Uint8Array}, length=${chunk.length}`);
      }
      if (typeof chunk === "string") {
        body += chunk;
      } else {
        body += Buffer.from(chunk).toString("utf8");
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        if (process.env.CLAWDESK_DEBUG_READJSON === "1") {
          console.error(`readJson parse failed. body=${body}`);
        }
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function websocketAccept(key) {
  return crypto
    .createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
}

function encodeFrame(payload) {
  const data = Buffer.from(payload);
  if (data.length < 126) {
    return Buffer.concat([Buffer.from([0x81, data.length]), data]);
  }
  if (data.length < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(data.length, 2);
    return Buffer.concat([header, data]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(data.length), 2);
  return Buffer.concat([header, data]);
}

function decodeFrame(buffer) {
  const length = buffer[1] & 0x7f;
  let offset = 2;
  let payloadLength = length;
  if (length === 126) {
    payloadLength = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    payloadLength = Number(buffer.readBigUInt64BE(offset));
    offset += 8;
  }
  const mask = buffer.subarray(offset, offset + 4);
  offset += 4;
  const payload = buffer.subarray(offset, offset + payloadLength);
  for (let index = 0; index < payload.length; index += 1) {
    payload[index] ^= mask[index % 4];
  }
  return payload.toString("utf8");
}

function send(socket, event) {
  if (socket.destroyed) return;
  socket.write(encodeFrame(JSON.stringify(event)));
}

function broadcast(event) {
  for (const socket of clients) {
    send(socket, event);
  }
}

function connectorById(connectorId) {
  return mcpConnectors.find((connector) => connector.id === connectorId);
}

function toolById(connector, toolId) {
  return connector?.tools.find((tool) => tool.id === toolId);
}

function mcpPreview(connector, tool, target) {
  const primaryProtocol = Array.isArray(connector.protocols) && connector.protocols.length > 0 ? connector.protocols[0] : undefined;
  return {
    connectorId: connector.id,
    toolId: tool.id,
    title: `${tool.app} · ${tool.name}`,
    target,
    risk: tool.risk,
    requiresApproval: tool.permission === "ask" || tool.risk !== "low",
    summary: `${tool.description} 目標：${target}`,
    protocol: primaryProtocol
      ? {
          id: primaryProtocol.id,
          name: primaryProtocol.name,
          auth: primaryProtocol.auth,
          transport: primaryProtocol.transport,
        }
      : undefined,
  };
}

function channelById(channelId) {
  return communicationChannels.find((channel) => channel.id === channelId);
}

function channelSetupPreview(channel, draft, verb = "啟用") {
  const allowlist = Array.isArray(draft.allowlist) ? draft.allowlist : [];
  return {
    channelId: channel.id,
    title: `${channel.name} 溝通頻道`,
    summary:
      verb === "停用"
        ? `將停用 ${channel.name}。`
        : `將${verb} ${channel.name}，限制在 ${allowlist.length} 個允許對象，串流模式：${draft.streamMode ?? channel.streamMode}。`,
    requiresApproval: channel.risk !== "low" || channel.status !== "connected",
  };
}

function scopesForProvider(providerId) {
  return accountProviders.find((provider) => provider.id === providerId)?.defaultScopes ?? [];
}

function llmProviderById(providerId) {
  return llmProviderCatalog.find((provider) => provider.id === providerId);
}

function isSupportedLlmProvider(providerId) {
  return Boolean(llmProviderById(providerId));
}

function hasValidApiKey(apiKey, allowedPrefixes = []) {
  if (typeof apiKey !== "string") return false;
  const trimmed = apiKey.trim();
  if (!trimmed) return false;
  if (allowedPrefixes.length === 0) return true;
  return allowedPrefixes.some((prefix) => trimmed.startsWith(prefix));
}

function normalizeEndpoint(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function maskSecret(secret, head = 6, tail = 4) {
  const normalized = String(secret ?? "").trim();
  if (normalized.length <= head + tail + 3) {
    return `${normalized.slice(0, 2)}...`;
  }
  return `${normalized.slice(0, head)}...${normalized.slice(-tail)}`;
}

function parseModelValue(value, fallback) {
  const model = typeof value === "string" ? value.trim() : "";
  return model || fallback;
}

function makeProviderSession(provider, data = {}) {
  const model = parseModelValue(data.model, provider.modelDefault);
  const common = {
    displayName: provider.displayName,
    model,
  };
  if (provider.authMode === "oauth") {
    const accountEmail = typeof data.accountEmail === "string" ? data.accountEmail.trim() : "";
    return {
      ...common,
      activeProvider: provider.id,
      status: accountEmail ? "connected" : "account-required",
      detail:
        `${provider.displayName} 已以帳號 ${accountEmail || "未指定帳號"} 啟用，模型為 ${model}。` +
        "桌面端不保存網站密碼、Cookie。",
      ...(accountEmail ? { accountEmail } : {}),
    };
  }
  if (provider.authMode === "api-key") {
    const apiKey = typeof data.apiKey === "string" ? data.apiKey : "";
    return {
      ...common,
      activeProvider: provider.id,
      status: "connected",
      detail: `${provider.displayName} API key 已暫存於本機 mock Gateway，模型：${model}。`,
      maskedKey: maskSecret(apiKey),
    };
  }
  if (provider.authMode === "local-endpoint") {
    const endpoint = typeof data.endpoint === "string" ? data.endpoint.trim() : "";
    return {
      ...common,
      activeProvider: provider.id,
      status: "connected",
      detail: `已設定 ${provider.displayName}，模型：${model}，endpoint：${endpoint}。`,
      endpoint,
    };
  }
  return {
    activeProvider: provider.id,
    status: "connected",
    displayName: provider.displayName,
    detail: `${provider.displayName} 已啟用（Mock）。`,
    model,
  };
}

function validateProviderInput(providerId, body) {
  const provider = llmProviderById(providerId);
  if (!provider) return { ok: false, error: "unknown provider" };

  if (provider.authMode === "oauth") {
    const accountEmail = typeof body?.accountEmail === "string" ? body.accountEmail.trim() : "";
    if (!accountEmail.includes("@")) return { ok: false, error: `${provider.displayName} 需要登入帳號 Email` };
  }
  if (provider.authMode === "api-key") {
    const apiKey = typeof body?.apiKey === "string" ? body.apiKey : "";
    if (!hasValidApiKey(apiKey, provider.keyPrefixes ?? ["sk-"])) return { ok: false, error: `${provider.displayName} 需要有效的 API Key` };
  }
  if (provider.authMode === "local-endpoint") {
    const endpoint = typeof body?.endpoint === "string" ? body.endpoint.trim() : "";
    if (!endpoint) return { ok: false, error: `${provider.displayName} 需要 endpoint` };
    if (!normalizeEndpoint(endpoint)) return { ok: false, error: `${provider.displayName} endpoint 格式無效` };
    if (providerId === "local-model" && !endpoint.startsWith("http://127.0.0.1") && !endpoint.startsWith("http://localhost")) {
      return { ok: false, error: "Only local endpoints are allowed in this MVP" };
    }
  }
  return { ok: true };
}

function setProviderBySpec(providerId, body = {}, options = {}) {
  const provider = llmProviderById(providerId);
  if (!provider) {
    throw new Error("Unknown provider");
  }
  const validation = options.skipValidation ? { ok: true } : validateProviderInput(providerId, body);
  if (!validation.ok) {
    return { ok: false, payload: validation.error };
  }
  const session = makeProviderSession(provider, body);
  providerSession = session;
  audit("provider.configure", { provider: providerId, status: session.status });
  scheduleStateSave();
  return { ok: true, session };
}

function runtimeReadinessSummary() {
  return openClawRuntimeSurfaces.reduce((summary, surface) => {
    summary[surface.status] = (summary[surface.status] ?? 0) + 1;
    return summary;
  }, {});
}

function runtimeAuthPlan(providerId) {
  const provider = llmProviderById(providerId);
  if (!provider) return null;
  if (provider.authMode === "oauth") {
    return {
      providerId,
      upstreamProviderId: provider.upstreamProviderId ?? provider.id,
      authMode: provider.authMode,
      endpoint: provider.id === "chatgpt-pro" ? "/auth/chatgpt-pro/oauth-login" : "/auth/openai-codex/oauth-login",
      credentialPolicy: "account-token-stub",
      upstreamSource: provider.upstreamSource ?? "src/agents/model-auth.ts",
      canUseNow: true,
    };
  }
  if (provider.authMode === "local-endpoint") {
    return {
      providerId,
      upstreamProviderId: provider.upstreamProviderId ?? provider.id,
      authMode: provider.authMode,
      endpoint: "/auth/local-model",
      credentialPolicy: "loopback-only",
      upstreamSource: provider.upstreamSource ?? "src/agents/models-config.providers.*",
      canUseNow: true,
    };
  }
  if (provider.authMode === "mock") {
    return {
      providerId,
      upstreamProviderId: provider.id,
      authMode: provider.authMode,
      endpoint: "/auth/mock",
      credentialPolicy: "no-secret",
      upstreamSource: "sidecars/mock-gateway/server.mjs",
      canUseNow: true,
    };
  }
  return {
    providerId,
    upstreamProviderId: provider.upstreamProviderId ?? provider.id,
    authMode: provider.authMode,
    endpoint: provider.id === "openai" || provider.id === "openai-api" ? "/auth/openai-api-key" : "/auth/provider",
    credentialPolicy: "masked-in-memory",
    upstreamSource: provider.upstreamSource ?? "src/agents/model-auth-env.ts",
    canUseNow: true,
  };
}

function providerDisplayLabel(providerId) {
  return llmProviderById(providerId)?.displayName ?? providerId;
}

function accountAuthPreview(draft) {
  const scopes = scopesForProvider(draft.provider).filter((scope) => Array.isArray(draft.scopes) && draft.scopes.includes(scope.id));
  return {
    provider: draft.provider,
    title: `${draft.email || "未命名帳號"} 授權`,
    summary: `將以 ${draft.role ?? "editor"} 角色加入 ${(draft.projectIds ?? []).length} 個專案，授權 ${scopes.length} 個範圍。`,
    requiresApproval: scopes.some((scope) => scope.risk === "high") || draft.role === "admin" || draft.role === "owner",
  };
}

function normalizeIdentityMode(value) {
  if (value === "enterprise") {
    return "enterprise";
  }
  return "personal";
}

function createIdentityVerificationCode() {
  return `${crypto.randomInt(100000, 999999)}`;
}

function findVerificationByEmail(email) {
  const now = Date.now();
  return identityVerifications.find((item) => item.email === email && !item.used && new Date(item.expiresAt).getTime() > now);
}

function issueIdentityVerification(user) {
  const token = crypto.randomUUID();
  const code = createIdentityVerificationCode();
  const now = Date.now();
  const expiresAt = new Date(now + 20 * 60 * 1000).toISOString();
  const record = {
    token,
    email: user.email,
    userId: user.id,
    code,
    createdAt: new Date(now).toISOString(),
    expiresAt,
    used: false,
  };
  identityVerifications.push(record);
  identityMailOutbox.unshift({
    to: user.email,
    subject: "ClawDesk 帳號啟用驗證信",
    body: `請在 20 分鐘內點擊驗證連結：https://localhost/identity/verify?token=${token}，或使用驗證碼 ${code}`,
    token,
    code,
    createdAt: record.createdAt,
  });
  return record;
}

function hashIdentityPassword(password) {
  return crypto.createHash("sha256").update(`${password}:${identityPasswordSalt}`).digest("hex");
}

function identitySessionPayload(user) {
  return {
    authenticated: true,
    userId: user.id,
    displayName: user.displayName,
    email: user.email,
    mode: normalizeIdentityMode(user.mode),
    role: user.role,
    isDeveloper: isDeveloperIdentitySession({ authenticated: true, email: user.email, mode: user.mode, role: "owner", displayName: user.displayName }),
    organization: user.organization,
    emailVerified: user.emailVerified ?? false,
    emailVerificationPending: user.emailVerified ? false : Boolean(user.emailVerificationPending),
    ssoProvider: user.ssoProvider,
    lastLoginAt: nowIso(),
  };
}

function consumeIdentityVerification({ token, code }) {
  const now = Date.now();
  const target = identityVerifications.find((item) => {
    if (item.used) return false;
    if (token && item.token === token) return true;
    if (code && item.code === code) return true;
    return false;
  });
  if (!target) return null;
  if (new Date(target.expiresAt).getTime() < now) {
    return null;
  }
  target.used = true;
  return target;
}

function ensureSeedIdentityUsers() {
  for (const seed of seededIdentityAccounts) {
    if (identityUsers.some((user) => user.email === seed.email)) continue;
    identityUsers.push({
      id: crypto.randomUUID(),
      email: seed.email,
      displayName: seed.displayName,
      passwordHash: hashIdentityPassword(seed.password),
      mode: seed.mode,
      role: seed.role,
      organization: seed.organization,
      emailVerified: true,
      emailVerificationPending: false,
      ssoProvider: "none",
      createdAt: nowIso(),
    });
  }
}

function identitySessionSignedOut() {
  return {
    authenticated: false,
    displayName: "未登入",
    mode: "personal",
    role: "viewer",
    isDeveloper: false,
    ssoProvider: "none",
  };
}

function learningActionToStep(action) {
  const connectorId = String(action.app ?? "").toLowerCase().includes("browser") ? "browser-screen" : "local-windows";
  const toolId = action.kind === "file-action" ? "file.prepare-change" : `learned.${action.kind ?? "action"}`;
  return {
    id: `step-${action.id}`,
    title: action.description || "觀察到的操作",
    connectorId,
    toolId,
    requiresApproval: action.risk !== "low",
  };
}

function learningWorkflowDraft(session) {
  return {
    id: crypto.randomUUID(),
    name: "學習模式產生的工作流草稿",
    status: "draft",
    scheduleKind: "manual",
    scheduleText: "手動執行",
    nextRun: "等待使用者審核",
    steps: session.actions.map(learningActionToStep),
  };
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function streamDemo(conversationId, prompt) {
  const messageId = `agent-${Date.now()}`;
  const providerLabel = providerDisplayLabel(providerSession.activeProvider ?? "mock");
  const modelLabel = providerSession.model ?? "未指定模型";
  const routeLabel =
    providerSession.activeProvider === "chatgpt-pro" && providerSession.accountEmail
      ? `Cloud-Main（${providerSession.accountEmail}）`
      : "自訂供應商路由";
  const providerPrefix =
    providerSession.activeProvider === "mock"
      ? "目前使用 Mock Gateway。"
      : `目前已啟用 ${providerLabel}，路由：${routeLabel}，模型 ${modelLabel}。`;
  const response =
    `${providerPrefix} 我會透過安全的桌面邊界處理「${prompt}」；` +
    "ClawDesk mock Gateway 正在串流回覆、更新 Live Canvas，並針對高風險動作要求使用者授權。";

  for (const token of response.match(/.{1,24}/g) ?? []) {
    broadcast({
      type: "agent.message.delta",
      conversationId,
      messageId,
      delta: token,
    });
    await delay(24);
  }

  broadcast({ type: "agent.message.done", conversationId, messageId });

  const surfaceId = "workspace-review";
  broadcast({ type: "canvas.begin", surfaceId, title: "工作區安全檢視" });
  await delay(80);
  broadcast({
    type: "canvas.patch",
    surfaceId,
    rootId: "root",
    components: [
      {
        id: "root",
        type: "Panel",
        props: { title: "ClawDesk Mock Gateway 報告" },
        children: ["summary", "confidence", "steps", "table", "progress", "approve"],
      },
      {
        id: "summary",
        type: "Text",
        props: {
          text: "這個生成式畫布是宣告式資料，由受信任的桌面元件型錄負責渲染。",
        },
      },
      { id: "confidence", type: "Metric", props: { label: "政策信心分數", value: "94%" } },
      {
        id: "steps",
        type: "List",
        props: {
          items: ["Gateway 健康檢查完成", "提示已接收", "Canvas patch 已串流", "權限閘門已啟用"],
        },
      },
      {
        id: "table",
        type: "Table",
        props: {
          columns: ["區域", "狀態", "下一步"],
          rows: [
            { 區域: "Sidecar", 狀態: "Mock", 下一步: "替換為 OpenClaw-compatible Gateway" },
            { 區域: "權限", 狀態: "需確認", 下一步: "持久化政策設定" },
            { 區域: "Canvas", 狀態: "宣告式", 下一步: "擴充元件型錄" },
            { 區域: "MCP", 狀態: "Microsoft mock", 下一步: "串接正式 MCP server" },
          ],
        },
      },
      { id: "progress", type: "Progress", props: { label: "MVP 完成度", value: 68 } },
      { id: "approve", type: "Button", props: { label: "檢視要求授權的動作" } },
    ],
  });

  await delay(300);
  const request = {
    type: "permission.request",
    requestId: crypto.randomUUID(),
    action: "delete_file",
    target: "/tmp/clawdesk-demo/destructive-action.txt",
    risk: "high",
    summary: "mock 代理想要模擬刪除檔案。未經明確授權前，這個動作不會執行。",
  };
  pendingPermissions.set(request.requestId, request);
  broadcast(request);
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url ?? "/", `http://${host}:${port}`);
  const pathname = parsedUrl.pathname;

  if (req.method === "OPTIONS") {
    json(res, 204, {});
    return;
  }

  if (req.method === "GET" && pathname === "/health") {
    json(res, 200, {
      ok: true,
      name: "clawdesk-mock-gateway",
      productName: "ClawDesk",
      compatibility: "OpenClaw-compatible desktop agent",
      baseUrl: `http://${host}:${port}`,
      wsUrl: `ws://${host}:${port}/events`,
      backend: backendReadiness(),
    });
    return;
  }

  if (req.method === "GET" && pathname === "/backend/status") {
    json(res, 200, backendReadiness());
    return;
  }

  if (req.method === "GET" && pathname === "/backend/deployment-plan") {
    json(res, 200, backendDeploymentPlan());
    return;
  }

  if (req.method === "GET" && pathname === "/backend/audit") {
    const limit = Math.max(1, Math.min(100, Number(parsedUrl.searchParams.get("limit") ?? 50)));
    json(res, 200, { events: auditEvents.slice(0, limit), total: auditEvents.length });
    return;
  }

  if (req.method === "POST" && pathname === "/backend/save-state") {
    await savePersistedState();
    json(res, 200, { saved: true, persistence: backendReadiness().persistence });
    return;
  }

  if (req.method === "GET" && pathname === "/machine/fingerprint") {
    if (identityBackendEnabled) {
      const nextFingerprint = await resolveBackendMachineFingerprint();
      json(res, 200, nextFingerprint);
      return;
    }
    json(res, 200, machineFingerprint);
    return;
  }

  if (req.method === "GET" && pathname === "/license/status") {
    if (identityBackendEnabled && backendLicenseState.licenseKey) {
      const response = await callBackendApi("/license/status", {
        query: {
          licenseKey: backendLicenseState.licenseKey,
          machineFingerprintHash: machineFingerprint.fingerprintHash,
        },
      });

      if (response?.ok) {
        const nextStatus = mapBackendLicenseEndpointResponse(response.payload, {
          status: "free",
          eligibleLatestVersion: "0.1.0",
          supportUpdatesUntil: "2026-05-12",
        });
        licenseStatus = { ...licenseStatus, ...nextStatus };
        json(res, 200, { status: licenseStatus, pricingPlans });
        return;
      }
      if (!response?.networkError) {
        json(res, response.status, response.payload);
        return;
      }
    }
    if (isDeveloperIdentitySession()) {
      applyDeveloperLicenseBypass();
    }
    json(res, 200, { status: licenseStatus, pricingPlans });
    return;
  }

  if (req.method === "GET" && pathname === "/license/machines") {
    json(res, 200, { machines: licenseMachines });
    return;
  }

  if (req.method === "POST" && pathname === "/license/activate-key") {
    try {
      const body = await readJson(req);
      if (identityBackendEnabled) {
        await resolveBackendMachineFingerprint();
        const response = await callBackendApi("/licenses/activate-key", {
          method: "POST",
          body: {
            licenseKey: body.licenseKey ?? body.encodedKey,
            machineFingerprintHash: machineFingerprint.fingerprintHash,
          },
        });
        if (response?.ok) {
          const next = response.payload ?? {};
          backendLicenseState.licenseKey = body.licenseKey ?? body.encodedKey ?? "";
          backendLicenseState.machineFingerprintHash = machineFingerprint.fingerprintHash;
          backendLicenseState.offlineTicket = next.offlineTicket?.token;
          const nextStatus = mapBackendLicenseEndpointResponse(next.license || next, {
            status: response.status >= 200 && response.status < 300 ? "active" : "free",
          });
          licenseStatus = nextStatus;
          json(res, 200, { status: licenseStatus, fingerprint: machineFingerprint });
          return;
        }
        if (!response?.networkError) {
          json(res, response.status, response.payload);
          return;
        }
      }
      if (isDeveloperIdentitySession()) {
        json(res, 200, { status: applyDeveloperLicenseBypass(), fingerprint: machineFingerprint });
        return;
      }
      const status = activateLicense(body.licenseKey ?? body.encodedKey);
      json(res, status.status === "active" ? 200 : 403, { status, fingerprint: machineFingerprint });
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/license/deactivate-machine") {
    try {
      const body = await readJson(req);
      if (isDeveloperIdentitySession()) {
        json(res, 200, { status: applyDeveloperLicenseBypass(), machines: licenseMachines });
        return;
      }
      const timestamp = nowIso();
      licenseMachines = licenseMachines.map((machine) =>
        machine.machineId === body.machineId ? { ...machine, revokedAt: timestamp } : machine,
      );
      licenseStatus = { ...licenseStatus, machines: licenseMachines, lastValidationCode: "KEYGEN_MACHINE_DEACTIVATED" };
      json(res, 200, { status: licenseStatus, machines: licenseMachines });
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/license/validate") {
    try {
      const body = await readJson(req);
      if (identityBackendEnabled) {
        const ticket = String(body.licenseFile ?? "");
        const response = await callBackendApi("/licenses/validate", {
          method: "POST",
          body: {
            offlineTicket: ticket,
            machineFingerprintHash: machineFingerprint.fingerprintHash,
          },
        });
        if (response?.ok) {
          const nextStatus = mapBackendLicenseEndpointResponse(response.payload, { status: "hobby", supportUpdatesUntil: "2026-05-12" });
          licenseStatus = { ...licenseStatus, ...nextStatus };
          json(res, 200, { status: licenseStatus });
          return;
        }
        if (!response?.networkError && response?.payload) {
          json(res, response.status, response.payload);
          return;
        }
      }
      if (isDeveloperIdentitySession()) {
        json(res, 200, { status: applyDeveloperLicenseBypass() });
        return;
      }
      if (String(body.licenseFile ?? body.licenseKey ?? "").includes("TAMPER")) {
        json(res, 200, { status: safeModeLicense("KEYGEN_TAMPERED_LICENSE_FILE") });
        return;
      }
      licenseStatus = { ...licenseStatus, lastValidationCode: licenseStatus.status === "active" ? "KEYGEN_VALID" : licenseStatus.lastValidationCode };
      json(res, 200, { status: licenseStatus });
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/license/refresh-offline-ticket") {
    if (identityBackendEnabled) {
      const response = await callBackendApi("/licenses/refresh-offline-ticket", {
        method: "POST",
        body: {
          licenseKey: backendLicenseState.licenseKey,
          machineFingerprintHash: machineFingerprint.fingerprintHash,
        },
      });
      if (response?.ok) {
        backendLicenseState.offlineTicket = response.payload.ticket?.token || backendLicenseState.offlineTicket;
        json(res, 200, {
          status: licenseStatus,
          ticket: response.payload.ticket || {
            token: backendLicenseState.offlineTicket,
            signature: response.payload.signature,
            issuedAt: nowIso(),
            expiresAt: "2026-06-11",
          },
        });
        return;
      }
      if (!response?.networkError) {
        json(res, response.status, response.payload);
        return;
      }
    }
    if (isDeveloperIdentitySession()) {
      json(res, 200, {
        status: applyDeveloperLicenseBypass(),
        ticket: {
          storedAs: "mock signed Keygen offline license file",
          expiresAt: "2099-12-31",
        },
      });
      return;
    }
    licenseStatus = { ...licenseStatus, offlineGraceUntil: "2026-06-11", lastValidationCode: "KEYGEN_OFFLINE_TICKET_REFRESHED" };
    json(res, 200, {
      status: licenseStatus,
      ticket: {
        storedAs: "mock signed Keygen offline license file",
        expiresAt: licenseStatus.offlineGraceUntil,
      },
    });
    return;
  }

  if (req.method === "POST" && pathname === "/license/report-tamper") {
    if (identityBackendEnabled) {
      const body = await readJson(req).catch(() => ({}));
      const response = await callBackendApi("/licenses/report-tamper", {
        method: "POST",
        body: {
          reason: body?.reason ?? "local-ui-detected",
          faultCode: body?.faultCode ?? "CLWD-LIC-1001",
        },
      });
      if (!response || response.networkError) {
        // keep local fallback
      } else if (!response.ok) {
        json(res, response.status, response.payload);
        return;
      }
      const fallbackEvent = {
        eventId: crypto.randomUUID(),
        reason: "授權金鑰、方案、裝置數、到期日、更新日或 license file 被修改。",
        detectedAt: nowIso(),
        localAction: "downgrade-to-hobby",
        serverAction: "report-to-keygen",
        faultCode: "CLWD-LIC-1001",
      };
      json(res, 200, { event: response?.payload?.id ? response.payload : fallbackEvent, status: safeModeLicense("KEYGEN_TAMPER_REPORTED") });
      return;
    }
    if (isDeveloperIdentitySession()) {
      const event = {
        eventId: crypto.randomUUID(),
        reason: "開發者帳號使用繞過授權。",
        detectedAt: nowIso(),
        localAction: "keep-dev-license",
        serverAction: "keep-dev-license",
        faultCode: "CLWD-LIC-1001",
      };
      json(res, 200, { event, status: applyDeveloperLicenseBypass() });
      return;
    }
    const event = {
      eventId: crypto.randomUUID(),
      reason: "授權金鑰、方案、裝置數、到期日、更新日或 license file 被修改。",
      detectedAt: nowIso(),
      localAction: "downgrade-to-hobby",
      serverAction: "report-to-keygen",
      faultCode: "CLWD-LIC-1001",
    };
    json(res, 200, { event, status: safeModeLicense("KEYGEN_TAMPER_REPORTED") });
    return;
  }

  if (req.method === "POST" && pathname === "/webhooks/paddle/mock") {
    try {
      const body = await readJson(req);
      const eventType = body.eventType ?? "transaction.completed";
      const backendEventType = {
        "lifetime.purchased": "subscription.created",
        "transaction.completed": "payment_succeeded",
        "subscription.created": "subscription.created",
        "subscription.renewed": "renewed",
        "subscription.updated-failed": "subscription.updated-failed",
        "subscription.payment_failed": "payment_failed",
        "payment_failed": "payment_failed",
        "transaction.failed": "payment_failed",
        "transaction.refunded": "subscription.canceled",
        "subscription.canceled": "subscription.canceled",
        "support.renewed": "renewed",
      }[eventType] ?? eventType;
      const licenseKey = typeof body.licenseKey === "string" && body.licenseKey.trim() ? body.licenseKey : backendLicenseState.licenseKey || "CLWD-LIFETIME-LOCAL-2026";
      if (identityBackendEnabled) {
        const response = await callBackendApi("/webhooks/paddle", {
          method: "POST",
          body: {
            eventType: backendEventType,
            licenseKey,
            note: body.note ?? `frontend-webhook-${eventType}`,
          },
        });
        if (response?.ok) {
          const newStatus = mapBackendLicenseEndpointResponse(response.payload, {
            status: licenseStatus.status,
            supportUpdatesUntil: licenseStatus.supportUpdatesUntil,
          });
          licenseStatus = {
            ...licenseStatus,
            ...newStatus,
            paymentProvider: "paddle",
            licenseProvider: "keygen",
            lastValidationCode: `PADDLE_${eventType}`,
          };
          audit("webhook.paddle", { eventType, licenseStatus: licenseStatus.status, plan: licenseStatus.plan });
          scheduleStateSave();
          json(res, 200, { accepted: true, provider: "paddle", eventType, status: licenseStatus, backend: true });
          return;
        }
        if (!response?.networkError) {
          json(res, response.status, { accepted: false, provider: "paddle", eventType, ...response.payload });
          return;
        }
      }
      if (["transaction.completed", "subscription.created", "subscription.renewed", "lifetime.purchased", "payment_succeeded", "renewed", "support.renewed"].includes(eventType)) {
        licenseStatus = {
          ...licenseStatus,
          status: eventType === "transaction.refunded" ? "canceled" : "active",
          plan: eventType === "lifetime.purchased" ? "lifetime-local" : "pro-yearly",
          lastValidationCode: `PADDLE_${eventType}`,
        };
      } else if (["subscription.payment_failed", "payment_failed", "subscription.updated-failed"].includes(eventType)) {
        licenseStatus = { ...licenseStatus, status: "past-due", lastValidationCode: `PADDLE_${eventType}` };
      } else if (["subscription.canceled", "transaction.refunded"].includes(eventType)) {
        licenseStatus = { ...licenseStatus, status: "canceled", lastValidationCode: `PADDLE_${eventType}` };
      }
      if (eventType === "support.renewed") {
        licenseStatus = { ...licenseStatus, supportUpdatesUntil: "2028-05-12", eligibleLatestVersion: "1.8.0", lastValidationCode: "PADDLE_SUPPORT_RENEWED" };
      }
      if (!["subscription.payment_failed", "payment_failed", "transaction.failed", "subscription.updated-failed"].includes(eventType) && !licenseStatus.plan) {
        licenseStatus = { ...licenseStatus, plan: "lifetime-local" };
      }
      audit("webhook.paddle", { eventType, licenseStatus: licenseStatus.status, plan: licenseStatus.plan });
      scheduleStateSave();
      json(res, 200, { accepted: true, provider: "paddle", eventType, status: licenseStatus });
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/webhooks/lemon/mock") {
    try {
      const body = await readJson(req);
      const eventType = body.eventType ?? "license_key_created";
      const licenseKey = normalizeLemonLicenseKey(body.licenseKey ?? "CLWD-BETA-PRO1-2026");
      if (identityBackendEnabled) {
        const response = await callBackendApi("/webhooks/lemon", {
          method: "POST",
          body: {
            eventType,
            licenseKey,
            machineFingerprintHash: machineFingerprint.fingerprintHash,
          },
        });
        if (response?.ok) {
          const nextStatus = mapBackendLicenseEndpointResponse(response.payload?.license || response.payload, {
            status: response.payload?.license?.status ?? (eventType.includes("refund") || eventType.includes("cancel") ? "safe-mode" : "active"),
            paymentProvider: "lemon-squeezy",
            licenseProvider: "lemon-license",
          });
          licenseStatus = {
            ...licenseStatus,
            ...nextStatus,
            entitlement: response.payload?.entitlement ?? nextStatus.entitlement,
            lastValidationCode: `LEMON_${eventType}`,
          };
          audit("webhook.lemon", { eventType, status: licenseStatus.status, licenseKeyHash: licenseKeyHash(licenseKey) });
          scheduleStateSave();
          json(res, 200, { accepted: true, provider: "lemon-squeezy", eventType, status: licenseStatus, backend: true });
          return;
        }
        if (!response?.networkError) {
          json(res, response.status, { accepted: false, provider: "lemon-squeezy", eventType, ...response.payload });
          return;
        }
      }

      if (["refund_created", "subscription_cancelled"].includes(eventType)) {
        licenseStatus = safeModeLicense(`LEMON_${eventType}`);
      } else {
        licenseStatus = activateLemonLicense(licenseKey);
        licenseStatus.lastValidationCode = `LEMON_${eventType}`;
      }
      audit("webhook.lemon", { eventType, status: licenseStatus.status, licenseKeyHash: licenseKeyHash(licenseKey) });
      scheduleStateSave();
      json(res, 200, { accepted: true, provider: "lemon-squeezy", eventType, status: licenseStatus });
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/webhooks/keygen/mock") {
    try {
      const body = await readJson(req);
      const eventType = body.eventType ?? "license.validated";
      const licenseKey = typeof body.licenseKey === "string" && body.licenseKey.trim() ? body.licenseKey : backendLicenseState.licenseKey;
      if (identityBackendEnabled && licenseKey) {
        const response = await callBackendApi("/webhooks/keygen", {
          method: "POST",
          body: { eventType, licenseKey },
        });
        if (response?.ok) {
          if (eventType === "license.revoked" || eventType === "license.suspended") {
            licenseStatus = safeModeLicense("KEYGEN_REVOKED");
          } else if (eventType === "license.validated") {
            licenseStatus = { ...licenseStatus, lastValidationCode: "KEYGEN_WEBHOOK_VALIDATED" };
          }
          audit("webhook.keygen", { eventType, licenseStatus: licenseStatus.status });
          scheduleStateSave();
          json(res, 200, { accepted: true, provider: "keygen", eventType, status: licenseStatus, backend: true });
          return;
        }
        if (!response?.networkError) {
          json(res, response.status, { accepted: false, provider: "keygen", eventType, ...response.payload });
          return;
        }
      }
      if (eventType === "license.revoked") {
        safeModeLicense("KEYGEN_REVOKED_BY_WEBHOOK");
      } else if (eventType === "license.validated") {
        licenseStatus = { ...licenseStatus, lastValidationCode: "KEYGEN_WEBHOOK_VALIDATED" };
      }
      audit("webhook.keygen", { eventType, licenseStatus: licenseStatus.status });
      scheduleStateSave();
      json(res, 200, { accepted: true, provider: "keygen", eventType, status: licenseStatus });
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "GET" && pathname === "/updates/check") {
    if (identityBackendEnabled) {
      const response = await callBackendApi("/updates/check");
      if (response?.ok) {
        const update = toBackendUpdateInfo(response.payload, licenseStatus);
        json(res, 200, { ...update, canInstallLatest: shouldUseProUpdate(update, licenseStatus) });
        return;
      }
      if (!response?.networkError) {
        json(res, response.status, response.payload);
        return;
      }
    }
    if (isDeveloperIdentitySession()) {
      applyDeveloperLicenseBypass();
    }
    json(res, 200, updateInfo());
    return;
  }

  if (req.method === "GET" && pathname === "/updates/history") {
    if (identityBackendEnabled) {
      const response = await callBackendApi("/updates/history");
      if (response?.ok) {
        const history = Array.isArray(response.payload?.history) ? response.payload.history : response.payload?.updates ?? [];
        json(res, 200, { updates: history });
        return;
      }
      if (!response?.networkError) {
        json(res, response.status, response.payload);
        return;
      }
    }
    json(res, 200, { updates: updateHistory });
    return;
  }

  if (req.method === "POST" && pathname === "/updates/mock-renew-support") {
    const supportLicenseKey = backendLicenseState.licenseKey || "CLWD-LIFETIME-LOCAL-2026";
    if (identityBackendEnabled) {
      const latestCheck = await callBackendApi("/updates/check");
      const response = await callBackendApi("/webhooks/paddle", {
        method: "POST",
        body: {
          eventType: "subscription.created",
          licenseKey: supportLicenseKey,
          note: "frontend-support-renewal",
        },
      });
      if (response?.ok) {
        audit("updates.renew-support", {
          supportUpdatesUntil: response.payload?.license?.supportUpdatesUntil ?? "2028-05-12",
          licenseKey: supportLicenseKey,
        });
        licenseStatus = {
          ...licenseStatus,
          supportUpdatesUntil: response.payload?.license?.supportUpdatesUntil ?? "2028-05-12",
          eligibleLatestVersion: "1.8.0",
          lastValidationCode: "PADDLE_SUPPORT_RENEWED",
        };
        scheduleStateSave();
        json(res, 200, {
          status: licenseStatus,
          update: toBackendUpdateInfo(latestCheck?.ok ? latestCheck.payload : updateInfo(), licenseStatus),
        });
        return;
      }
      if (!response?.networkError) {
        json(res, response.status, response.payload);
        return;
      }
    }
    if (isDeveloperIdentitySession()) {
      json(res, 200, { status: applyDeveloperLicenseBypass(), update: updateInfo() });
      return;
    }
    licenseStatus = { ...licenseStatus, supportUpdatesUntil: "2028-05-12", eligibleLatestVersion: "1.8.0", lastValidationCode: "PADDLE_SUPPORT_RENEWED" };
    audit("updates.renew-support", { supportUpdatesUntil: licenseStatus.supportUpdatesUntil });
    scheduleStateSave();
    json(res, 200, { status: licenseStatus, update: updateInfo() });
    return;
  }

  if (req.method === "GET" && pathname === "/diagnostics/summary") {
    if (identityBackendEnabled) {
      const response = await callBackendApi("/diagnostics/create-report", {
        method: "POST",
        body: { faultCode: "CLWD-GW-2001" },
      });
      if (response?.ok) {
        json(res, 200, {
          autoCollected: true,
          autoUploaded: false,
          privacyChecklist: ["不含 Email", "不含完整路徑", "不含完整 license key", "不含 API key", "不含聊天內容", "不含螢幕截圖", "不含 Lemon/Paddle customer id 明文", "法務同意僅含版本、hash、同意時間"],
          preview: response.payload,
        });
        return;
      }
      if (!response?.networkError) {
        json(res, response.status, response.payload);
        return;
      }
    }
    json(res, 200, {
      autoCollected: true,
      autoUploaded: false,
      privacyChecklist: ["不含 Email", "不含完整路徑", "不含完整 license key", "不含 API key", "不含聊天內容", "不含螢幕截圖", "不含 Lemon/Paddle customer id 明文", "法務同意僅含版本、hash、同意時間"],
      preview: createDiagnosticReport({ faultCode: "CLWD-GW-2001" }),
    });
    return;
  }

  if (req.method === "POST" && pathname === "/diagnostics/create-report") {
    try {
      const body = await readJson(req);
      if (identityBackendEnabled) {
        const response = await callBackendApi("/diagnostics/create-report", {
          method: "POST",
          body: {
            ...body,
            appVersion: body.appVersion ?? "0.5.1",
            faultCode: body.faultCode ?? "CLWD-GW-2001",
          },
        });
        if (response?.ok) {
          json(res, 200, { report: response.payload });
          return;
        }
        if (!response?.networkError) {
          json(res, response.status, response.payload);
          return;
        }
      }
      json(res, 200, { report: createDiagnosticReport(body) });
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/diagnostics/submit-report") {
    try {
      const body = await readJson(req);
      const report = body.report ?? createDiagnosticReport(body);
      json(res, 200, {
        submitted: true,
        reportId: report.reportId,
        message: "MVP mock 已接收回報；正式版會在使用者確認後送出。",
      });
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "GET" && pathname === "/legal/documents") {
    if (identityBackendEnabled) {
      const response = await callBackendApi("/legal/documents");
      if (response?.ok) {
        json(res, 200, { documents: response.payload?.documents ?? legalDocuments });
        return;
      }
      if (!response?.networkError) {
        json(res, response.status, response.payload);
        return;
      }
    }
    json(res, 200, { documents: legalDocuments });
    return;
  }

  if (req.method === "GET" && pathname === "/legal/notices") {
    if (identityBackendEnabled) {
      const response = await callBackendApi("/legal/notices");
      if (response?.ok) {
        json(res, 200, { notices: response.payload?.notices ?? legalNotices });
        return;
      }
      if (!response?.networkError) {
        json(res, response.status, response.payload);
        return;
      }
    }
    json(res, 200, { notices: legalNotices });
    return;
  }

  if (req.method === "GET" && pathname === "/ergonomics/checks") {
    json(res, 200, {
      checks: ergonomicsChecks,
      score: Math.round(ergonomicsChecks.reduce((sum, check) => sum + check.score, 0) / ergonomicsChecks.length),
    });
    return;
  }

  if (req.method === "POST" && pathname === "/ergonomics/run-smoke") {
    ergonomicsChecks = ergonomicsChecks.map((check) => scoreErgonomics(check));
    json(res, 200, {
      checks: ergonomicsChecks,
      score: Math.round(ergonomicsChecks.reduce((sum, check) => sum + check.score, 0) / ergonomicsChecks.length),
    });
    return;
  }

  if (req.method === "GET" && pathname === "/paths/resolve") {
    json(res, 200, resolveGovernedPath(parsedUrl.searchParams.get("path") ?? ".", parsedUrl.searchParams.get("mutating") === "true"));
    return;
  }

  if (req.method === "GET" && pathname === "/memory/profile") {
    json(res, 200, {
      storage: { index: "SQLite mock", readableFiles: ["memory/*.md", "knowledge/*.yaml"] },
      items: memoryItems,
    });
    return;
  }

  if (req.method === "GET" && pathname === "/knowledge/sources") {
    json(res, 200, { sources: enterpriseKnowledgeSources });
    return;
  }

  if (req.method === "POST" && pathname === "/knowledge/sources") {
    try {
      const body = await readJson(req);
      const type = typeof body.type === "string" ? body.type : "cloud-drive";
      const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "";
      if (!name || !["cloud-drive", "database", "image-corpus"].includes(type)) {
        json(res, 400, { error: "Knowledge source name and valid type are required." });
        return;
      }
      const source = {
        id: `kb-${crypto.randomUUID().slice(0, 8)}`,
        type,
        name,
        description:
          typeof body.description === "string" && body.description.trim() ? body.description.trim() : `模擬 ${type} 知識源。`,
        provider: typeof body.provider === "string" && body.provider.trim() ? body.provider.trim() : "Enterprise mock provider",
        tags: Array.isArray(body.tags) ? body.tags.slice(0, 8) : [],
      };
      enterpriseKnowledgeSources.unshift(source);
      audit("knowledge.create-source", { id: source.id, type: source.type, name: source.name });
      scheduleStateSave();
      json(res, 200, { source, sources: enterpriseKnowledgeSources });
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/memory/items") {
    try {
      const body = await readJson(req);
      const item = {
        id: crypto.randomUUID(),
        agentId: body.agentId ?? "personal-assistant",
        title: body.title ?? "未命名記憶",
        body: body.body ?? "",
        pinned: Boolean(body.pinned),
        shared: Boolean(body.shared),
        source: "markdown",
        createdAt: nowIso(),
      };
      memoryItems.unshift(item);
      audit("memory.create-item", { id: item.id, agentId: item.agentId, pinned: item.pinned, shared: item.shared });
      scheduleStateSave();
      json(res, 200, { item, items: memoryItems });
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  const knowledgeSourcesByAgentMatch = pathname.match(/^\/agents\/([^/]+)\/knowledge-sources$/);
  if (req.method === "GET" && knowledgeSourcesByAgentMatch) {
    const agent = findAgent(knowledgeSourcesByAgentMatch[1]);
    if (!agent) {
      json(res, 404, { error: "Unknown agent" });
      return;
    }
    const sources = filterKnowledgeSourcesByIds(agent.knowledgeBaseIds);
    json(res, 200, { agentId: agent.id, knowledgeBaseIds: sources.map((source) => source.id), knowledgeSources: sources });
    return;
  }

  if (req.method === "GET" && pathname === "/context/status") {
    json(res, 200, contextStatus);
    return;
  }

  if (req.method === "POST" && pathname === "/context/compress") {
    const estimatedTokens = Math.max(800, Math.round(contextStatus.estimatedTokens * 0.42));
    contextStatus = {
      ...contextStatus,
      estimatedTokens,
      rollingSummary: `${contextStatus.rollingSummary}\n已壓縮舊對話並保留釘選事實。`.trim(),
      compressionRatio: Number((estimatedTokens / contextStatus.estimatedTokens).toFixed(2)),
      lastCompressedAt: nowIso(),
    };
    audit("context.compress", { estimatedTokens: contextStatus.estimatedTokens, compressionRatio: contextStatus.compressionRatio });
    scheduleStateSave();
    json(res, 200, contextStatus);
    return;
  }

  if (req.method === "GET" && pathname === "/agents") {
    json(res, 200, { agents: agentProfiles });
    return;
  }

  if (req.method === "POST" && pathname === "/agents") {
    try {
      const body = await readJson(req);
      const agent = {
        id: crypto.randomUUID(),
        name: body.name ?? "自訂 Agent",
        role: body.role ?? "使用者自訂工作角色。",
        model: body.model ?? "ChatGPT Pro / custom adapter",
        workspaceId: body.workspaceId ?? "desktop-mvp",
        toolPermissions: Array.isArray(body.toolPermissions) ? body.toolPermissions : [],
        knowledgeBaseIds: [],
        memoryScope: body.memoryScope ?? "private",
        learningMode: body.learningMode ?? "rehearse-only",
      };
      agentProfiles.unshift(agent);
      audit("agent.create", { id: agent.id, workspaceId: agent.workspaceId, memoryScope: agent.memoryScope });
      scheduleStateSave();
      json(res, 200, { agent, agents: agentProfiles });
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  const knowledgeMatch = pathname.match(/^\/agents\/([^/]+)\/knowledge$/);
  if (req.method === "POST" && knowledgeMatch) {
    try {
      const body = await readJson(req);
      const agentId = knowledgeMatch[1];
      const item = {
        id: crypto.randomUUID(),
        agentId,
        title: body.title ?? "Agent 知識",
        body: body.body ?? "",
        pinned: false,
        shared: Boolean(body.shared),
        source: "yaml",
        createdAt: nowIso(),
      };
      memoryItems.unshift(item);
      audit("agent.add-knowledge", { agentId, itemId: item.id, shared: item.shared });
      scheduleStateSave();
      json(res, 200, { item });
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && knowledgeSourcesByAgentMatch) {
    const agent = findAgent(knowledgeSourcesByAgentMatch[1]);
    if (!agent) {
      json(res, 404, { error: "Unknown agent" });
      return;
    }
    try {
      const body = await readJson(req);
      if (!Array.isArray(body.knowledgeBaseIds)) {
        json(res, 400, { error: "knowledgeBaseIds required." });
        return;
      }
      const requestedIds = Array.from(new Set(body.knowledgeBaseIds.filter((id) => typeof id === "string")));
      const unknownIds = requestedIds.filter((id) => !enterpriseKnowledgeSources.some((source) => source.id === id));
      if (unknownIds.length > 0) {
        json(res, 404, { error: `Unknown knowledge source IDs: ${unknownIds.join(",")}` });
        return;
      }
      agent.knowledgeBaseIds = requestedIds;
      const sources = filterKnowledgeSourcesByIds(agent.knowledgeBaseIds);
      audit("agent.bind-knowledge-sources", { agentId: agent.id, knowledgeBaseIds: sources.map((source) => source.id) });
      scheduleStateSave();
      json(res, 200, { agentId: agent.id, knowledgeBaseIds: sources.map((source) => source.id), knowledgeSources: sources });
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "GET" && pathname === "/identity/session") {
    if (identityBackendEnabled && getBackendIdentityToken()) {
      const response = await callBackendApi("/auth/session", {
        method: "GET",
        headers: { Authorization: `Bearer ${getBackendIdentityToken()}` },
      });
      if (response?.ok && response.payload?.session) {
        const mapped = normalizeIdentitySessionFromBackend(response.payload.session);
        identitySession = ensureBackendIdentityDeveloper(mapped);
        json(res, 200, identitySession);
        return;
      }
      if (!response?.networkError && response.payload?.error) {
        setBackendIdentityToken("");
      }
    }
    json(res, 200, identitySession.authenticated ? identitySession : identitySessionSignedOut());
    return;
  }

  if (req.method === "GET" && pathname === "/identity/verification-code") {
    try {
      const email = typeof parsedUrl.searchParams.get("email") === "string"
        ? parsedUrl.searchParams.get("email").trim().toLowerCase()
        : "";
      if (!email.includes("@")) {
        json(res, 400, { error: "valid email required" });
        return;
      }
      const latest = findVerificationByEmail(email);
      const latestBackendCode = backendIdentityVerificationCodes.get(email);
      if (latestBackendCode && latest && latest.code === latestBackendCode) {
        json(res, 200, {
          email,
          code: latest.code,
          token: latest.token,
          expiresAt: latest.expiresAt,
          subject: "ClawDesk 帳號啟用驗證信",
        });
        return;
      }
      if (!latest) {
        json(res, 404, { error: "verification record not found" });
        return;
      }
      const latestMail = identityMailOutbox.find((item) => item.to === email && item.token === latest.token);
      if (!latestMail) {
        json(res, 404, { error: "verification mail not found" });
        return;
      }
      json(res, 200, {
        email,
        code: latest.code,
        token: latest.token,
        expiresAt: latest.expiresAt,
        subject: latestMail.subject,
      });
    } catch {
      json(res, 400, { error: "Invalid request" });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/identity/resend-verification") {
    try {
      const body = await readJson(req);
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const user = identityUsers.find((item) => item.email === email);
      if (!user) {
        json(res, 404, { error: "account not found" });
        return;
      }
      if (user.emailVerified) {
        json(res, 400, { error: "account already verified" });
        return;
      }
      let verification = null;
      if (identityBackendEnabled) {
        const response = await callBackendApi("/auth/register", {
          method: "POST",
          body: {
            email,
            displayName: user.displayName,
            password: `__internal__${Date.now()}`,
            organization: user.organization ?? "",
          },
        });
        if (response?.ok && response.payload?.debugVerificationToken) {
          setBackendVerificationCode(email, response.payload.debugVerificationToken);
          verification = getBackendVerificationRecord(email);
        } else if (!response?.networkError) {
          json(res, response?.status ?? 400, { error: response?.payload?.error || "resend failed" });
          return;
        }
      }
      if (!verification) {
        verification = issueIdentityVerification(user);
      }
      audit("identity.resend-verification", { emailHash: hashForAudit(user.email) });
      scheduleStateSave();
      json(res, 200, {
        email: user.email,
        message: "verification mail resent",
        verification: { token: verification.token, expiresAt: verification.expiresAt },
      });
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/identity/confirm") {
    try {
      const body = await readJson(req);
      const token = typeof body.token === "string" ? body.token.trim() : "";
      const code = typeof body.code === "string" ? body.code.trim() : "";
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      let verification = null;
      if (identityBackendEnabled) {
        const confirmPayload = { email };
        if (code) confirmPayload.code = code;
        const response = await callBackendApi("/auth/confirm", {
          method: "POST",
          body: confirmPayload,
        });
        if (!response?.ok) {
          if (!response?.networkError) {
            json(res, response?.status ?? 400, { error: response?.payload?.error || "invalid or expired verification" });
            return;
          }
        } else {
          verification = consumeBackendVerification(email, code);
        }
      }
      if (!verification) {
        verification = consumeIdentityVerification({ token, code });
      }
      if (!verification) {
        json(res, 400, { error: "invalid or expired verification" });
        return;
      }
      const user = identityUsers.find((item) => item.id === verification.userId || item.email === email || item.email === verification.email);
      if (!user) {
        json(res, 404, { error: "account not found" });
        return;
      }
      user.emailVerified = true;
      user.emailVerificationPending = false;
      user.lastLoginAt = nowIso();
      const pendingMailIndex = identityMailOutbox.findIndex((mail) => mail.token === verification.token);
      if (pendingMailIndex >= 0) {
        identityMailOutbox.splice(pendingMailIndex, 1);
      }
      identitySession = identitySessionPayload(user);
      if (isDeveloperIdentitySession(identitySession)) {
        applyDeveloperLicenseBypass();
      }
      audit("identity.confirm", { emailHash: hashForAudit(user.email), mode: user.mode });
      scheduleStateSave();
      json(res, 200, { ...identitySession, verification: { verified: true, at: nowIso() }, emailVerified: true });
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/identity/register") {
    try {
      const body = await readJson(req);
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const displayName = typeof body.displayName === "string" ? body.displayName.trim() : email.split("@")[0] || "使用者";
      const password = typeof body.password === "string" ? body.password : "";
      const mode = normalizeIdentityMode(body.mode);
      const organization = typeof body.organization === "string" ? body.organization.trim() : "";
      if (!email.includes("@") || password.length < 8) {
        json(res, 400, { error: "註冊失敗：Email 不合法或密碼不足。" });
        return;
      }
      const existing = identityUsers.find((user) => user.email === email);
      if (identityBackendEnabled) {
        const response = await callBackendApi("/auth/register", {
          method: "POST",
          body: {
            email,
            displayName,
            password,
            organization,
          },
        });
        if (response?.ok && response.payload?.debugVerificationToken) {
          const record = mapBackendIdentityAccountToMock(null, email);
          record.passwordHash = hashIdentityPassword(password);
          record.mode = mode;
          record.role = existing ? existing.role : "owner";
          record.organization = organization || existing?.organization;
          if (existing) {
            Object.assign(existing, record);
          } else {
            identityUsers.push(record);
          }
          setBackendVerificationCode(email, response.payload.debugVerificationToken);
          setBackendIdentityToken("");
          const verification = getBackendVerificationRecord(email);
          audit("identity.register", { emailHash: hashForAudit(record.email), mode: record.mode, backend: true });
          scheduleStateSave();
          json(res, 201, {
            authenticated: false,
            userId: record.id,
            displayName: record.displayName,
            email: record.email,
            mode: normalizeIdentityMode(record.mode),
            role: record.role,
            isDeveloper: isDeveloperIdentitySession({ email: record.email, authenticated: true }),
            organization: record.organization,
            ssoProvider: "none",
            emailVerified: false,
            emailVerificationPending: true,
            lastLoginAt: nowIso(),
            pendingVerification: {
              token: verification.token,
              code: verification.code,
              expiresAt: verification.expiresAt,
            },
          });
          return;
        }
        if (!response?.networkError) {
          if (response?.status === 409) {
            if (existing?.emailVerified) {
              json(res, 409, { error: "此 Email 已註冊。" });
              return;
            }
            const verification = issueIdentityVerification(existing);
            json(res, 200, {
              authenticated: false,
              userId: existing.id,
              displayName: existing.displayName,
              email: existing.email,
              mode: normalizeIdentityMode(existing.mode),
              role: existing.role,
              isDeveloper: isDeveloperIdentitySession(existing),
              organization: existing.organization,
              ssoProvider: "none",
              emailVerified: false,
              emailVerificationPending: true,
              lastLoginAt: nowIso(),
              pendingVerification: {
                token: verification.token,
                code: verification.code,
                expiresAt: verification.expiresAt,
              },
            });
            return;
          }
          json(res, response?.status ?? 400, { error: response?.payload?.error || "register failed" });
          return;
        }
      }

      if (existing) {
        if (existing.emailVerified) {
          json(res, 409, { error: "此 Email 已註冊。" });
          return;
        }
        const verification = issueIdentityVerification(existing);
        audit("identity.resend-verification", { emailHash: hashForAudit(existing.email) });
        scheduleStateSave();
        json(res, 200, {
          authenticated: false,
          userId: existing.id,
          displayName: existing.displayName,
          email: existing.email,
          mode: normalizeIdentityMode(existing.mode),
          role: existing.role,
          isDeveloper: false,
          organization: existing.organization,
          ssoProvider: "none",
          emailVerified: false,
          emailVerificationPending: true,
          lastLoginAt: nowIso(),
          pendingVerification: {
            token: verification.token,
            code: verification.code,
            expiresAt: verification.expiresAt,
          },
        });
        return;
      }
      const user = {
        id: crypto.randomUUID(),
        email,
        displayName,
        passwordHash: hashIdentityPassword(password),
        mode,
        role: "owner",
        organization: organization || undefined,
        emailVerified: false,
        emailVerificationPending: true,
        ssoProvider: "none",
        createdAt: nowIso(),
      };
      identityUsers.push(user);
      const verification = issueIdentityVerification(user);
      audit("identity.register", { emailHash: hashForAudit(user.email), mode: user.mode });
      scheduleStateSave();
      const sessionPayload = {
        authenticated: false,
        userId: user.id,
        displayName: user.displayName,
        email: user.email,
        mode: normalizeIdentityMode(user.mode),
        role: user.role,
        isDeveloper: false,
        organization: user.organization,
        ssoProvider: user.ssoProvider,
        emailVerified: false,
        emailVerificationPending: true,
        lastLoginAt: nowIso(),
        pendingVerification: {
          token: verification.token,
          code: verification.code,
          expiresAt: verification.expiresAt,
        },
      };
      json(res, 201, sessionPayload);
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/identity/login") {
    try {
      const body = await readJson(req);
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const password = typeof body.password === "string" ? body.password : "";
      if (identityBackendEnabled) {
        const response = await callBackendApi("/auth/login", {
          method: "POST",
          body: { email, password },
        });
        if (response?.ok && response.payload?.session?.account) {
          const mapped = normalizeIdentitySessionFromBackend(response.payload.session.account);
          setBackendIdentityToken(response.payload.session.token);
          const user = {
            id: response.payload.session.account.id,
            email: response.payload.session.account.email,
            displayName: response.payload.session.account.displayName,
            passwordHash: hashIdentityPassword(password),
            mode: mapIdentityMode(response.payload.session.account.mode),
            role: response.payload.session.account.role,
            organization: response.payload.session.account.organization,
            emailVerified: true,
            emailVerificationPending: false,
            ssoProvider: response.payload.session.account.ssoProvider ?? "none",
            createdAt: response.payload.session.account.createdAt ?? nowIso(),
          };
          const existing = identityUsers.find((item) => item.email === email);
          if (existing) {
            Object.assign(existing, user);
          } else {
            identityUsers.push(user);
          }
          identitySession = ensureBackendIdentityDeveloper(mapped);
          audit("identity.login", { emailHash: hashForAudit(user.email), isDeveloper: Boolean(identitySession.isDeveloper) });
          scheduleStateSave();
          json(res, 200, identitySession);
          return;
        }
        if (!response?.networkError) {
          if (response?.status === 403 && !identitySession.authenticated) {
            json(res, 403, { error: "帳號尚未完成 Email 驗證，請先點擊驗證信。" });
            return;
          }
          json(res, response?.status ?? 401, { error: response?.payload?.error || "帳號或密碼錯誤。" });
          return;
        }
      }
      const user = identityUsers.find(
        (item) => item.email === email && item.passwordHash === hashIdentityPassword(password),
      );
      if (!user) {
        json(res, 401, { error: "帳號或密碼錯誤。" });
        return;
      }
      if (!user.emailVerified) {
        json(res, 403, { error: "帳號尚未完成 Email 驗證，請先點擊驗證信。" });
        return;
      }
      user.lastLoginAt = nowIso();
      identitySession = identitySessionPayload(user);
      if (isDeveloperIdentitySession(identitySession)) {
        applyDeveloperLicenseBypass();
      }
      audit("identity.login", { emailHash: hashForAudit(user.email), isDeveloper: Boolean(identitySession.isDeveloper) });
      scheduleStateSave();
      json(res, 200, identitySession);
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/identity/sso") {
    try {
      const body = await readJson(req);
      const provider = typeof body.provider === "string" ? body.provider : "";
      const email = typeof body.email === "string" && body.email.includes("@") ? body.email.trim().toLowerCase() : "";
      const displayName = typeof body.displayName === "string" && body.displayName.trim() ? body.displayName.trim() : "";
      const organization = typeof body.organization === "string" ? body.organization.trim() : "";
      const supportedProviders = ["apple", "google", "google-workspace", "microsoft", "azure", "okta", "saml", "github"];
      if (!supportedProviders.includes(provider)) {
        json(res, 400, { error: "未支援的 SSO 提供者。" });
        return;
      }
      const identityEmail = email || `${crypto.randomBytes(5).toString("hex")}@sso.local`;
      if (identityBackendEnabled) {
        const response = await callBackendApi("/auth/sso/finish", {
          method: "POST",
          body: {
            provider: provider === "microsoft" ? "microsoft" : provider === "azure" ? "microsoft" : provider,
            email: identityEmail,
            displayName,
            organization,
          },
        });
        if (response?.ok && response.payload?.session?.account) {
          const mapped = normalizeIdentitySessionFromBackend(response.payload.session.account);
          setBackendIdentityToken(response.payload.session.token);
          identitySession = ensureBackendIdentityDeveloper(mapped);
          const account = response.payload.session.account;
          const record = mapBackendIdentityAccountToMock(account, account.email, account.mode, account.role);
          const existed = identityUsers.find((item) => item.email === account.email);
          if (existed) {
            Object.assign(existed, record);
          } else {
            identityUsers.push(record);
          }
          audit("identity.sso", { provider, emailHash: hashForAudit(identityEmail), mode: identitySession.mode });
          scheduleStateSave();
          json(res, 200, { ...identitySession, ssoMock: { provider, status: "single-entry-ready" } });
          return;
        }
        if (!response?.networkError) {
          json(res, response?.status ?? 400, { error: response?.payload?.error || "SSO failed" });
          return;
        }
      }

      const existed = identityUsers.find((user) => user.email === identityEmail);
      const user = existed
        ? { ...existed, mode: "enterprise", role: existed.role, organization: existed.organization || organization, ssoProvider: provider }
        : {
            id: crypto.randomUUID(),
            email: identityEmail,
            displayName: displayName || identityEmail.split("@")[0],
            passwordHash: hashIdentityPassword(`__sso_${identityEmail}`),
            mode: "enterprise",
            role: "admin",
            emailVerified: true,
            emailVerificationPending: false,
            organization: organization || undefined,
            ssoProvider: provider,
            createdAt: nowIso(),
          };
      if (!existed) {
        identityUsers.push(user);
      } else {
        existed.mode = "enterprise";
        existed.role = existed.role || "admin";
        existed.ssoProvider = provider;
        if (organization) existed.organization = organization;
      }
      identitySession = identitySessionPayload(user);
      if (isDeveloperIdentitySession(identitySession)) {
        applyDeveloperLicenseBypass();
      }
      audit("identity.sso", { provider, emailHash: hashForAudit(identityEmail), mode: identitySession.mode });
      scheduleStateSave();
      json(res, 200, { ...identitySession, ssoMock: { provider, status: "single-entry-ready" } });
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/identity/logout") {
    identitySession = identitySessionSignedOut();
    setBackendIdentityToken("");
    safeModeLicense("HOBBY_MODE");
    audit("identity.logout", {});
    scheduleStateSave();
    json(res, 200, identitySession);
    return;
  }

  if (req.method === "GET" && pathname === "/auth/session") {
    if (identityBackendEnabled && getBackendIdentityToken()) {
      const response = await callBackendApi("/auth/session", {
        method: "GET",
        headers: { Authorization: `Bearer ${getBackendIdentityToken()}` },
      });
      if (response?.ok) {
        json(res, 200, response.payload);
        return;
      }
      if (response?.status === 401) {
        json(res, 401, { error: "Invalid session" });
        return;
      }
      if (!response?.networkError) {
        json(res, response.status, response.payload);
        return;
      }
    }
    json(res, 200, providerSession);
    return;
  }

  if (req.method === "GET" && pathname === "/channels") {
    json(res, 200, { channels: communicationChannelsWithGuides() });
    return;
  }

  if (req.method === "GET" && req.url === "/accounts") {
    json(res, 200, { providers: accountProviders, accounts: connectedAccounts });
    return;
  }

  if (req.method === "POST" && req.url === "/accounts/connect") {
    try {
      const body = await readJson(req);
      const email = typeof body.email === "string" ? body.email.trim() : "";
      if (!email.includes("@")) {
        json(res, 400, { error: "Valid account email is required" });
        return;
      }
      const provider = accountProviders.find((item) => item.id === body.provider);
      if (!provider) {
        json(res, 404, { error: "Unknown account provider" });
        return;
      }
      const selectedScopes = scopesForProvider(provider.id).filter((scope) => Array.isArray(body.scopes) && body.scopes.includes(scope.id));
      const account = {
        id: crypto.randomUUID(),
        provider: provider.id,
        displayName: provider.name,
        email,
        status: "connected",
        role: body.role ?? "editor",
        projectIds: Array.isArray(body.projectIds) ? body.projectIds : [],
        softwareTargets: Array.isArray(body.softwareTargets) ? body.softwareTargets : [],
        scopes: selectedScopes,
      };
      connectedAccounts.unshift(account);
      audit("account.connect", { provider: provider.id, emailHash: hashForAudit(email), role: account.role });
      scheduleStateSave();
      const preview = accountAuthPreview(body);
      if (preview.requiresApproval) {
        const request = {
          type: "permission.request",
          requestId: crypto.randomUUID(),
          action: `account.${provider.id}.connect`,
          target: email,
          risk: "high",
          summary: `${provider.name} 帳號授權需要確認。${preview.summary}`,
        };
        pendingPermissions.set(request.requestId, request);
        broadcast(request);
      }
      json(res, 200, { account, preview });
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/channels/configure") {
    try {
      const body = await readJson(req);
      const channel = channelById(body.channelId);
      if (!channel) {
        json(res, 404, { error: "Unknown channel" });
        return;
      }
      channel.status = body.enabled === false ? "disabled" : "configured";
      audit("channel.configure", { channelId: channel.id, status: channel.status });
      scheduleStateSave();
      const preview = channelSetupPreview(channel, body, body.enabled === false ? "停用" : "啟用");
      if (preview.requiresApproval && body.enabled !== false) {
        const request = {
          type: "permission.request",
          requestId: crypto.randomUUID(),
          action: `channel.${channel.id}.configure`,
          target: channel.name,
          risk: channel.risk,
          summary: `${channel.name} 通訊頻道啟用需要授權。${preview.summary}`,
        };
        pendingPermissions.set(request.requestId, request);
        broadcast(request);
      }
      json(res, 200, preview);
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/channels/test-message") {
    try {
      const body = await readJson(req);
      const channel = channelById(body.channelId);
      if (!channel) {
        json(res, 404, { error: "Unknown channel" });
        return;
      }
      json(res, 200, {
        ...channelSetupPreview(channel, body, "測試"),
        summary: `將產生 ${channel.name} 測試訊息預覽，不會送出到外部服務。`,
      });
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "GET" && req.url === "/mcp/connectors") {
    json(res, 200, { connectors: mcpConnectors });
    return;
  }

  if (req.method === "GET" && req.url === "/workflows") {
    json(res, 200, { templates: workflowTemplates, workflows: scheduledWorkflows });
    return;
  }

  if (req.method === "GET" && req.url === "/media/capabilities") {
    json(res, 200, { capabilities: mediaCapabilities, policy: mediaPolicy });
    return;
  }

  if (req.method === "GET" && req.url === "/learning/session") {
    json(res, 200, learningSession);
    return;
  }

  if (req.method === "POST" && req.url === "/learning/start") {
    learningSession = {
      status: "recording",
      startedAt: new Date().toISOString(),
      consentRequired: true,
      capturePasswords: false,
      captureScreenImages: false,
      actions: [],
    };
    audit("learning.start", { status: learningSession.status });
    scheduleStateSave();
    json(res, 200, learningSession);
    return;
  }

  if (req.method === "POST" && req.url === "/learning/observe") {
    try {
      if (learningSession.status !== "recording") {
        json(res, 409, { error: "Learning mode is not recording" });
        return;
      }
      const body = await readJson(req);
      const action = {
        id: `observed-${learningSession.actions.length + 1}`,
        app: typeof body.app === "string" ? body.app : "Unknown app",
        kind: typeof body.kind === "string" ? body.kind : "click",
        description: typeof body.description === "string" ? body.description : "觀察到的操作",
        target: typeof body.target === "string" ? body.target : "未指定目標",
        risk: ["low", "medium", "high"].includes(body.risk) ? body.risk : "medium",
      };
      learningSession = {
        ...learningSession,
        actions: [...learningSession.actions, action],
      };
      audit("learning.observe", { actionId: action.id, kind: action.kind, risk: action.risk });
      scheduleStateSave();
      json(res, 200, learningSession);
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/learning/stop") {
    learningSession = {
      ...learningSession,
      status: "draft-ready",
    };
    const workflow = learningWorkflowDraft(learningSession);
    if (workflow.steps.length > 0) {
      scheduledWorkflows.unshift(workflow);
    }
    audit("learning.stop", { status: learningSession.status, workflowId: workflow.id, steps: workflow.steps.length });
    scheduleStateSave();
    json(res, 200, { session: learningSession, workflow });
    return;
  }

  if (req.method === "POST" && pathname === "/learning/rehearse") {
    const workflow = learningWorkflowDraft(learningSession);
    json(res, 200, {
      phase: "預演",
      workflow,
      safety: {
        capturePasswords: false,
        captureTokens: false,
        capturePaymentData: false,
        captureRawScreenshots: false,
        highRiskRequiresApproval: true,
      },
      replaySummary: workflow.steps.map((step) => `${step.title}：${step.requiresApproval ? "需授權" : "可預演"}`),
    });
    return;
  }

  if (req.method === "POST" && pathname === "/learning/promote-to-skill") {
    try {
      const body = await readJson(req);
      json(res, 200, {
        skillDraft: {
          id: crypto.randomUUID(),
          name: body.name ?? "學習模式技能草稿",
          status: "draft",
          executionMode: "rehearse-only",
          approvalRequired: true,
          summary: "由觀察流程拆解而來；正式執行前必須人工授權。",
        },
      });
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/learning/replay-preview") {
    json(res, 200, {
      replayMode: "preview-only",
      steps: learningSession.actions.map((action) => ({
        actionId: action.id,
        description: action.description,
        allowedToExecute: false,
        reason: action.risk === "high" ? "高風險動作只允許預演" : "MVP 預設不直接執行學習回放",
      })),
    });
    return;
  }

  if (req.method === "GET" && req.url === "/openclaw/settings") {
    json(res, 200, { sections: openClawSettingsSchema, profile: openClawSettingsProfile });
    return;
  }

  if (req.method === "POST" && req.url === "/openclaw/settings") {
    try {
      const body = await readJson(req);
      openClawSettingsProfile = {
        ...openClawSettingsProfile,
        ...body,
      };
      audit("openclaw.settings.update", { sections: Object.keys(body).slice(0, 20) });
      scheduleStateSave();
      json(res, 200, { sections: openClawSettingsSchema, profile: openClawSettingsProfile });
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/workflows") {
    try {
      const body = await readJson(req);
      const workflow = {
        id: crypto.randomUUID(),
        name: typeof body.name === "string" ? body.name : "未命名工作流",
        status: body.status === "active" ? "active" : "draft",
        scheduleKind: body.scheduleKind ?? "manual",
        scheduleText: typeof body.scheduleText === "string" ? body.scheduleText : "手動執行",
        nextRun: "等待啟用",
        steps: Array.isArray(body.steps) ? body.steps : [],
      };
      scheduledWorkflows.unshift(workflow);
      audit("workflow.create", { id: workflow.id, scheduleKind: workflow.scheduleKind, steps: workflow.steps.length });
      scheduleStateSave();
      json(res, 200, workflow);
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/mcp/connect") {
    try {
      const body = await readJson(req);
      const connector = connectorById(body.connectorId);
      if (!connector) {
        json(res, 404, { error: "Unknown MCP connector" });
        return;
      }
      connector.status = "connected";
      audit("mcp.connect", { connectorId: connector.id });
      scheduleStateSave();
      broadcast({
        type: "gateway.status",
        status: "ready",
        detail: `${connector.name} 已啟用。`,
      });
      json(res, 200, connector);
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/mcp/preview") {
    try {
      const body = await readJson(req);
      const connector = connectorById(body.connectorId);
      const tool = toolById(connector, body.toolId);
      const target = typeof body.target === "string" && body.target.trim() ? body.target.trim() : "~/Documents";
      if (!connector || !tool) {
        json(res, 404, { error: "Unknown MCP tool" });
        return;
      }
      const preview = mcpPreview(connector, tool, target);
      if (preview.requiresApproval) {
        const request = {
          type: "permission.request",
          requestId: crypto.randomUUID(),
          action: `mcp.${tool.id}`,
          target,
          risk: preview.risk,
          summary: `${preview.title} 需要授權。${preview.summary}`,
        };
        pendingPermissions.set(request.requestId, request);
        broadcast(request);
      }
      json(res, 200, preview);
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "GET" && pathname === "/llm-providers") {
    json(res, 200, {
      providers: llmProviderCatalog.map((provider) => ({
        id: provider.id,
        shortName: provider.shortName,
        displayName: provider.displayName,
        authMode: provider.authMode,
        modelPlaceholder: provider.modelPlaceholder,
        modelDefault: provider.modelDefault,
        keyPlaceholder: provider.keyPlaceholder,
        endpointPlaceholder: provider.endpointPlaceholder,
        accountPlaceholder: provider.accountPlaceholder,
        upstreamAuthKind: provider.upstreamAuthKind,
        upstreamProviderId: provider.upstreamProviderId,
        upstreamSource: provider.upstreamSource,
        description: provider.description,
      })),
      upstream: openClawUpstreamSnapshot,
    });
    return;
  }

  if (req.method === "GET" && pathname === "/openclaw/upstream/import-status") {
    json(res, 200, {
      ...openClawUpstreamSnapshot,
      imported: true,
      importedAuthModes: [
        { id: "openai-api-key", providerId: "openai-api", upstreamProviderId: "openai", authKind: "api_key" },
        { id: "openai-account-oauth", providerId: "openai-codex", upstreamProviderId: "openai-codex", authKind: "oauth" },
      ],
      windowsReleaseGate: {
        target: "Windows 11 x64 MSVC",
        installer: "NSIS signed installer",
        certificationFocus: ["Authenticode or Trusted Signing", "SBOM", "NOTICE", "legal resources"],
      },
    });
    return;
  }

  if (req.method === "GET" && pathname === "/openclaw/feature-parity") {
    const summary = openClawFeatureParity.reduce((acc, item) => {
      acc[item.status] = (acc[item.status] ?? 0) + 1;
      return acc;
    }, {});
    json(res, 200, {
      upstream: openClawUpstreamSnapshot,
      summary,
      items: openClawFeatureParity,
    });
    return;
  }

  if (req.method === "GET" && pathname === "/openclaw/runtime-contract") {
    json(res, 200, {
      upstream: openClawUpstreamSnapshot,
      adapterMode: "windows-sidecar-contract",
      target: "Windows 11 x64 MSVC",
      eventTypes: [
        "agent.message.delta",
        "agent.message.done",
        "canvas.begin",
        "canvas.patch",
        "canvas.data",
        "permission.request",
        "permission.result",
        "gateway.status",
      ],
      summary: runtimeReadinessSummary(),
      surfaces: openClawRuntimeSurfaces,
    });
    return;
  }

  if (req.method === "POST" && pathname === "/openclaw/runtime/auth-plan") {
    try {
      const body = await readJson(req);
      const providerId = typeof body.providerId === "string" ? body.providerId.trim() : "";
      const plan = runtimeAuthPlan(providerId);
      if (!plan) {
        json(res, 404, { error: "Unknown provider" });
        return;
      }
      json(res, 200, plan);
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/auth/provider") {
    try {
      const body = await readJson(req);
      const providerId = typeof body.provider === "string" ? body.provider.trim() : "";
      if (!providerId) {
        json(res, 400, { error: "provider is required" });
        return;
      }
      if (!isSupportedLlmProvider(providerId)) {
        json(res, 400, { error: "Unknown provider" });
        return;
      }
      const result = setProviderBySpec(providerId, body);
      if (!result.ok) {
        json(res, 400, { error: result.payload });
        return;
      }
      json(res, 200, providerSession);
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/auth/chatgpt-pro/configure") {
    try {
      const result = setProviderBySpec(
        "chatgpt-pro",
        { model: DEFAULT_CHATGPT_MODEL, accountEmail: "desktop-only@local" },
        { skipValidation: true },
      );
      if (!result.ok) {
        json(res, 400, { error: result.payload });
        return;
      }
      providerSession = {
        ...providerSession,
        status: "configured",
        detail:
          "已在桌面端標記 ChatGPT Pro 方案。此模式採無金鑰協議，需登入 ChatGPT 後由帳號授權走 Cloud-Main 路由。",
      };
      scheduleStateSave();
      audit("provider.configure-chatgpt-pro", { status: "configured" });
      json(res, 200, providerSession);
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/auth/chatgpt-pro/oauth-login") {
    try {
      const body = await readJson(req);
      const response = setProviderBySpec("chatgpt-pro", body);
      if (!response.ok) {
        json(res, 400, { error: response.payload });
        return;
      }
      providerSession = {
        ...providerSession,
        displayName: "ChatGPT Pro（Cloud-Main）",
        detail:
          `無金鑰協議登入成功：${(body.accountEmail || "").trim()} 已被標記為 Cloud-Main 供應商，模型為 ${providerSession.model ?? DEFAULT_CHATGPT_MODEL}。` +
          "桌面端不保存密碼或 cookie。",
      };
      scheduleStateSave();
      audit("provider.oauth-chatgpt-pro", { model: providerSession.model });
      json(res, 200, providerSession);
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && (req.url === "/auth/openai-codex/oauth-login" || req.url === "/auth/openai-account/oauth-login")) {
    try {
      const body = await readJson(req);
      const response = setProviderBySpec("openai-codex", body);
      if (!response.ok) {
        json(res, 400, { error: response.payload });
        return;
      }
      providerSession = {
        ...providerSession,
        displayName: "OpenAI Codex OAuth",
        detail:
          `OpenClaw upstream account auth 已登錄：${(body.accountEmail || "").trim()}，模型為 ${providerSession.model ?? "gpt-5.3-codex"}。` +
          "桌面端不保存網站密碼或 cookie。",
      };
      scheduleStateSave();
      audit("provider.oauth-openai-codex", { model: providerSession.model });
      json(res, 200, providerSession);
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/auth/chatgpt-pro/account") {
    try {
      const body = await readJson(req);
      const response = setProviderBySpec("chatgpt-pro", body);
      if (!response.ok) {
        json(res, 400, { error: response.payload });
        return;
      }
      providerSession = {
        ...providerSession,
        displayName: "ChatGPT Pro（Cloud-Main）",
        detail: `已登錄 ChatGPT Pro 網站帳號狀態：${(body.accountEmail || "").trim()}。無金鑰協議已啟用，走 Cloud-Main 主供應商路由。`,
      };
      scheduleStateSave();
      audit("provider.configure-chatgpt-pro", { status: "connected" });
      json(res, 200, providerSession);
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/auth/openai-api-key") {
    try {
      const body = await readJson(req);
      const response = setProviderBySpec("openai-api", body);
      if (!response.ok) {
        json(res, 400, { error: response.payload });
        return;
      }
      json(res, 200, providerSession);
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/auth/gemini-api-key") {
    try {
      const body = await readJson(req);
      const response = setProviderBySpec("google-gemini", body);
      if (!response.ok) {
        json(res, 400, { error: response.payload });
        return;
      }
      json(res, 200, providerSession);
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/auth/local-model") {
    try {
      const body = await readJson(req);
      const response = setProviderBySpec("local-model", body);
      if (!response.ok) {
        json(res, 400, { error: response.payload });
        return;
      }
      json(res, 200, providerSession);
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/auth/mock") {
    const response = setProviderBySpec("mock", {});
    if (!response.ok) {
      json(res, 400, { error: response.payload });
      return;
    }
    json(res, 200, providerSession);
    return;
  }

  if (req.method === "POST" && req.url === "/chat") {
    try {
      const body = await readJson(req);
      const conversationId = typeof body.conversationId === "string" ? body.conversationId : "default";
      const prompt = typeof body.prompt === "string" ? body.prompt : "empty prompt";
      json(res, 202, { accepted: true, conversationId });
      void streamDemo(conversationId, prompt);
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/permission-result") {
    try {
      const body = await readJson(req);
      if (typeof body.requestId === "string") {
        pendingPermissions.delete(body.requestId);
      }
      broadcast(body);
      json(res, 200, { accepted: true });
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  json(res, 404, { error: "Not found" });
});

server.keepAliveTimeout = 2500;
server.requestTimeout = 8000;

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

  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${websocketAccept(key)}`,
      "",
      "",
    ].join("\r\n"),
  );

  clients.add(socket);
  send(socket, {
    type: "gateway.status",
    status: "ready",
    baseUrl: `http://${host}:${port}`,
    wsUrl: `ws://${host}:${port}/events`,
  });

  socket.on("data", (buffer) => {
    try {
      const message = JSON.parse(decodeFrame(buffer));
      if (message.type === "permission.result" && typeof message.requestId === "string") {
        pendingPermissions.delete(message.requestId);
        broadcast(message);
      }
    } catch {
      // Ignore malformed client frames in the mock server.
    }
  });

  socket.on("close", () => clients.delete(socket));
  socket.on("error", () => clients.delete(socket));
});

await loadPersistedState();

server.listen(port, host, () => {
  console.log(`ClawDesk mock gateway 已啟動：http://${host}:${port}`);
});

function shutdown() {
  for (const socket of clients) {
    socket.destroy();
  }
  void savePersistedState().finally(() => {
    server.close(() => process.exit(0));
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
