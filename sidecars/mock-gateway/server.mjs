import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";

const port = Number(process.env.CLAWDESK_MOCK_PORT ?? process.env.OPENCLAW_MOCK_PORT ?? 18890);
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
const openAiApiBaseUrl = (process.env.CLAWDESK_OPENAI_API_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const backendLicenseState = {
  licenseKey: "",
  machineFingerprintHash: "",
  offlineTicket: "",
  status: null,
  sessionToken: "",
};
const backendIdentityVerificationCodes = new Map();
const backendIdentityPasswordResetCodes = new Map();
const targetCredentialVaultDurable = true;
const targetCredentialVaultFilePath = path.join(homeDir, ".clawdesk", "ssh-credential-vault.json");
const targetCredentialVaultKeyPath = path.join(homeDir, ".clawdesk", "ssh-credential-vault.key");
const targetCredentialBundleIterations = 120_000;
const pairingTicketDefaultTtlMs = 15 * 60 * 1000;
const hostBridgeHeartbeatStaleAfterMs = 10 * 60 * 1000;
const openClawUpstreamSnapshot = {
  repository: "https://github.com/openclaw/openclaw",
  commit: "278e3eabf29dd8ff31d633907525bda35ec6474a",
  license: "MIT",
  scannedAt: "2026-05-14",
  sourceFileCount: 14940,
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
  ["model-auth-openai", "模型連線與 OpenAI 登入", "partial", "已納入 OpenAI API key、OpenAI/Codex OAuth 契約、Tauri DPAPI credential vault 與 Responses API runtime probe；OAuth token refresh 仍是合約層。", "high", "/provider/openai/runtime-contract", "signed-beta"],
  ["provider-catalog", "Provider catalog / model catalog", "partial", "已有主要 provider 清單；尚未完整支援 live catalog/cache/cost/context window。", "medium", "/llm-providers", "windows-beta"],
  ["gateway-protocol", "Gateway protocol / WebSocket / RPC", "mock", "目前是相容 mock Gateway；尚未載入 production gateway runtime。", "high", "/gateway-adapter/contract", "production-gateway"],
  ["agents-runtime", "Agents runtime / subagents / harness", "mock", "已有 agent GUI 與 mock 任務；尚未執行 embedded runner/harness。", "high", "/coding-workspace", "production-gateway"],
  ["plugins-sdk", "Plugin SDK / tools", "partial", "已有 MCP/tool preview；尚未載入完整 plugin runtime。", "high", "/safety-policy", "signed-beta"],
  ["extensions", "Extensions / external connectors", "mock", "已有 connector catalog/permission preview；upstream extensions 尚未打包。", "high", "/mcp/connectors", "signed-beta"],
  ["channels", "Messaging channels", "partial", "已有 Teams/Gmail/LINE/Telegram/Slack 入口；尚未接 webhook delivery runtime。", "high", "/channels", "signed-beta"],
  ["cron-workflows", "Cron / workflow automation", "mock", "已有 workflow CRUD mock；尚未接 isolated-agent cron runner。", "medium", "/workflows", "post-beta"],
  ["memory", "Memory / embeddings / vector store", "mock", "已有 memory UI/mock；尚未接 embeddings/batch/vector store。", "medium", "/memory/items", "post-beta"],
  ["security-auth", "Security / auth profiles / secret refs", "partial", "已有 redaction、masked key、DPAPI credential vault 與清除流程；尚未實作 production SecretRef/token refresh lock。", "blocked", "/safety-policy", "signed-beta"],
  ["config-schema", "Config schema / guided setup", "partial", "已有設定導引；尚未完整匯入/匯出相容 config schema。", "medium", "/compat/feature-parity", "post-beta"],
  ["ui-control", "Control UI / TUI / model picker", "partial", "本機使用 React/Tauri GUI；未直接使用 upstream Lit UI/TUI。", "medium", "/product-comparison", "windows-beta"],
  ["media-understanding", "Media understanding / generation", "mock", "已有能力宣告；未接 upstream provider runtime。", "medium", "/media/capabilities", "post-beta"],
  ["tts-talk", "TTS / talk / realtime transcription", "deferred", "首發 Beta 不阻塞，後續接 Windows audio pipeline。", "medium", "", "post-beta"],
  ["pairing-device", "Pairing / device auth / node mode", "deferred", "Windows 首發先支援 loopback，不做 mobile node pairing。", "medium", "", "post-beta"],
  ["macos-ios-android", "Native Apple/Android apps", "not-applicable", "平台不同，不納入 Windows installer。", "low", "", "post-beta"],
  ["sdk", "SDK / client API", "deferred", "Beta 穩定後再提供 local API SDK 或 upstream SDK 相容。", "medium", "", "post-beta"],
  ["windows-release", "Windows packaging / certification", "partial", "Tauri NSIS/release guard 已有；簽章/認證保留。", "blocked", "npm run release:guard -- --beta-direct", "signed-beta"],
].map(([id, domain, status, difference, riskLevel, testEndpoint, targetMilestone]) => ({
  id,
  domain,
  status,
  difference,
  riskLevel,
  testEndpoint,
  targetMilestone,
}));
const productComparisonItems = [
  {
    domain: "主要入口",
    openClaw: "多通訊 app、Gateway、CLI 與插件入口。",
    claudeCowork: "Claude Desktop 內的本機/VM 任務工作流。",
    claudeCode: "Terminal、IDE、desktop 與 CI coding workflow。",
    clawDesk: "Windows-first Tauri GUI 與 mock Gateway。",
    gap: "ClawDesk 應做可視化任務工作台，不追 terminal-only 體驗。",
    priority: "p1",
  },
  {
    domain: "Agent runtime",
    openClaw: "Gateway、channels、plugins、cron、memory 與 runtime harness。",
    claudeCowork: "本機 agent loop、檔案/瀏覽器/app 操作與 VM 隔離。",
    claudeCode: "coding agent loop、工具、subagents、hooks、settings。",
    clawDesk: "agent/session UI 已有，runtime 多為 mock/partial。",
    gap: "先落地 Gateway adapter contract、tool approval 與可測 endpoint。",
    priority: "p0",
  },
  {
    domain: "模型支援",
    openClaw: "BYOM：OpenAI、Anthropic、local 與 provider catalog。",
    claudeCowork: "Claude 生態為主，透過 connector/MCP 擴充。",
    claudeCode: "Claude 模型為主，可搭配 API、seat 與 IDE integration。",
    clawDesk: "OpenAI API/OAuth、Anthropic、Gemini、OpenRouter、本機 endpoint contract partial。",
    gap: "補 provider 狀態、成本、context window、fallback 與 Credential Manager。",
    priority: "p0",
  },
  {
    domain: "MCP / plugin",
    openClaw: "Native MCP、Plugin SDK、hot reload config。",
    claudeCowork: "MCP/plugins/skills，但受桌面安全政策限制。",
    claudeCode: "MCP、plugins、skills、hooks、subagents。",
    clawDesk: "MCP UI、connector catalog 與 permission preview mock。",
    gap: "建立 Windows plugin sandbox、allowlist、manifest 驗證與審計。",
    priority: "p0",
  },
  {
    domain: "安全與權限",
    openClaw: "自架彈性高，但 gateway/plugin 權限風險大。",
    claudeCowork: "permission、VM、admin policy 與使用者責任界線。",
    claudeCode: "settings、deny list、tool approval、session 控制。",
    clawDesk: "診斷 redaction、permission mock、sandbox policy partial。",
    gap: "加 Desktop Action Safety、Credential Manager、risk profile、audit trail。",
    priority: "p0",
  },
  {
    domain: "商業化",
    openClaw: "MIT open-source，商業發佈需自建。",
    claudeCowork: "Anthropic SaaS 與企業政策。",
    claudeCode: "Anthropic SaaS/CLI/IDE billing path。",
    clawDesk: "Lemon-only、NSIS、release guard、legal/diagnostics 已有骨架。",
    gap: "正式 Lemon webhook、signed installer、Gateway URL、support/legal review 仍是 release gate。",
    priority: "p1",
  },
  {
    domain: "UI / UX",
    openClaw: "通訊與配置偏工程向。",
    claudeCowork: "Claude Desktop 體驗，面向一般工作者。",
    claudeCode: "Terminal/IDE 強，非工程使用者門檻高。",
    clawDesk: "Windows GUI 工作台、繁中與本機任務面板。",
    gap: "把任務儀表板、對話、Canvas、執行狀態與風險提示整合成主體驗。",
    priority: "p1",
  },
];
const defaultSafetyPolicyRules = [
  {
    id: "secret-paths",
    label: "Secret 與 credential 路徑保護",
    denyPaths: [".env*", "secrets/**", "**/*credential*", "**/*token*", "**/*.pfx", "**/*.p12"],
    allowCommands: [],
    requiresApproval: true,
    riskLevel: "blocked",
    auditCategory: "credential",
    dryRunRequired: true,
    description: "禁止讀取或寫入常見 secret、憑證與 token 檔案；診斷與 Canvas 也不得包含明文。",
  },
  {
    id: "workspace-boundary",
    label: "工作區外修改保護",
    denyPaths: ["C:/Windows/**", "C:/Program Files/**", "C:/Users/*/AppData/**", "../**"],
    allowCommands: [],
    requiresApproval: true,
    riskLevel: "high",
    auditCategory: "workspace",
    dryRunRequired: true,
    description: "任何專案資料夾外的變更必須先產生 dry-run preview，Beta 預設不自動套用。",
  },
  {
    id: "shell-allowlist",
    label: "Shell 指令 allowlist",
    denyPaths: [],
    allowCommands: ["npm", "cargo", "git status", "git diff", "rg", "node"],
    requiresApproval: true,
    riskLevel: "high",
    auditCategory: "shell",
    dryRunRequired: true,
    description: "允許常見開發驗證指令；刪除、移動、憑證、付款與系統設定類命令需要人工核准。",
  },
  {
    id: "external-send",
    label: "外部訊息 draft-only",
    denyPaths: [],
    allowCommands: [],
    requiresApproval: true,
    riskLevel: "high",
    auditCategory: "external-send",
    dryRunRequired: true,
    description: "Gmail、Teams、Slack、LINE、Telegram 等外部傳送首版只建立草稿或預覽，不自動送出。",
  },
  {
    id: "browser-actions",
    label: "瀏覽器與帳號操作審批",
    denyPaths: [],
    allowCommands: [],
    requiresApproval: true,
    riskLevel: "medium",
    auditCategory: "browser",
    dryRunRequired: true,
    description: "登入、購買、提交表單、刪除帳號與高權限瀏覽器操作都需要 permission queue。",
  },
  {
    id: "payment-account",
    label: "付款與訂閱安全閘",
    denyPaths: [],
    allowCommands: [],
    requiresApproval: true,
    riskLevel: "blocked",
    auditCategory: "payment-account",
    dryRunRequired: true,
    description: "付款、退款、訂閱取消、license downgrade 僅接受已驗簽 webhook 或人工確認流程。",
  },
];
const defaultSubagentTemplates = [
  { id: "planner", label: "Planner", responsibility: "拆解需求、列風險、決定驗證路徑。", defaultTools: ["repo-read", "rg", "plan"], status: "mock" },
  { id: "implementer", label: "Implementer", responsibility: "依既有架構做最小安全修改。", defaultTools: ["apply_patch", "npm", "cargo"], status: "mock" },
  { id: "reviewer", label: "Reviewer", responsibility: "檢查 regression、安全與可維護性。", defaultTools: ["git diff", "tests", "static-analysis"], status: "mock" },
  { id: "tester", label: "Tester", responsibility: "執行 smoke、build、release guard 並整理結果。", defaultTools: ["npm test", "playwright", "tauri smoke"], status: "mock" },
];
const gatewayAdapterMethods = [
  { name: "health", method: "GET", path: "/health", status: "ready", purpose: "確認 Gateway、版本、相容性與 Windows sidecar 狀態。" },
  { name: "chat", method: "POST", path: "/chat", status: "partial", purpose: "串流 agent 訊息、Canvas patch 與 permission request。" },
  { name: "permissionResult", method: "POST", path: "/permission-result", status: "ready", purpose: "把 GUI 審批結果送回 runtime。" },
  { name: "providerStatus", method: "GET", path: "/provider/status", status: "partial", purpose: "回報 active provider、auth mode、masked credential 與 fallback。" },
  { name: "providerSecretRef", method: "POST", path: "/provider/secret-ref/issue", status: "partial", purpose: "把 provider secret 轉成不可逆 SecretRef，refresh 只回傳 token reference。" },
  { name: "providerOpenAiRuntime", method: "POST", path: "/provider/openai/chat-test", status: "partial", purpose: "以 OpenAI Responses API 合約驗證 API key provider，預設 dry-run。" },
  { name: "memory", method: "POST", path: "/memory/items", status: "mock", purpose: "建立與查詢本機記憶；後續接 durable store/vector store。" },
  { name: "workflow", method: "GET", path: "/workflows", status: "mock", purpose: "讀取 workflow templates 與 schedule 狀態。" },
  { name: "diagnostics", method: "POST", path: "/diagnostics/create-report", status: "ready", purpose: "產生 redacted support bundle 與 release/build/signature 狀態。" },
  { name: "targetsRegistry", method: "GET", path: "/targets", status: "mock", purpose: "讀取多電腦 target registry 與 dispatch log。" },
  { name: "targetsSave", method: "POST", path: "/targets", status: "mock", purpose: "儲存 target registry 與 default target 選擇。" },
  { name: "targetsCredentialRefIssue", method: "POST", path: "/targets/credential-ref/issue", status: "partial", purpose: "將 SSH private key 或遠端桌面登入 secret 發行成 gateway-managed credential ref，供安全 SSH / RDP dispatch 使用。" },
  { name: "targetsCredentialBundleExport", method: "POST", path: "/targets/credential-bundle/export", status: "partial", purpose: "將 target registry 與已發行的 credential refs 匯出成 passphrase-protected encrypted bundle，用於換機或跨機器遷移。" },
  { name: "targetsCredentialBundlePreview", method: "POST", path: "/targets/credential-bundle/preview", status: "partial", purpose: "在匯入前預覽 passphrase-protected encrypted bundle 的 target / secret 摘要與來源資訊。" },
  { name: "targetsCredentialBundleImport", method: "POST", path: "/targets/credential-bundle/import", status: "partial", purpose: "匯入 passphrase-protected encrypted bundle，還原 target registry 與 gateway-managed credential refs。" },
  { name: "targetsDispatchPreview", method: "POST", path: "/targets/dispatch-preview", status: "mock", purpose: "建立 target dispatch 預覽與 audit record。" },
  { name: "targetsDispatch", method: "POST", path: "/targets/dispatch", status: "mock", purpose: "儲存 target dispatch record 與 audit trail。" },
  { name: "targetsSshTerminalSessionRead", method: "GET", path: "/targets/ssh-terminal/session", status: "partial", purpose: "讀取 SSH terminal session 與 transcript snapshot。" },
  { name: "targetsSshTerminalSession", method: "POST", path: "/targets/ssh-terminal/session", status: "partial", purpose: "建立 SSH terminal open / command / close contract，命令執行維持 allowlisted 與審批安全邊界。" },
  { name: "targetsRemoteDesktopSessionRead", method: "GET", path: "/targets/remote-desktop/session", status: "partial", purpose: "讀取遠端桌面 session 與最近觀察摘要。" },
  { name: "targetsRemoteDesktopSession", method: "POST", path: "/targets/remote-desktop/session", status: "partial", purpose: "建立遠端桌面 observe / control session contract，控制請求會進入 permission queue。" },
];
const defaultContextBudget = {
  messageCount: 42,
  estimatedTokens: 48000,
  tokenLimit: 120000,
  budgetPercent: 40,
  loadedTools: ["file-search", "patch-preview", "test-runner", "permission-queue"],
  mcpConnectors: ["microsoft-office", "google-workspace", "developer-tools"],
  recommendedAction: "none",
  note: "目前仍在可操作區間；超過 70% 建議 compact，超過 88% 建議 clear 或新 session。",
};
const codingWorkspaceSnapshot = {
  mode: "windows-coding-workspace",
  capabilities: [
    { id: "file-search", label: "檔案搜尋", status: "ready", description: "用 rg / workspace index 找出相關檔案，不讀 secret pattern。" },
    { id: "change-plan", label: "變更計畫", status: "partial", description: "把需求拆成可審批步驟，保留人工確認點。" },
    { id: "patch-preview", label: "Patch preview", status: "partial", description: "先展示變更摘要與風險，再套用 apply_patch。" },
    { id: "test-command", label: "測試命令", status: "ready", description: "集中顯示 npm/cargo/smoke/release guard 結果。" },
    { id: "result-summary", label: "結果摘要", status: "ready", description: "輸出檔案、驗證、風險與下一步。" },
  ],
  subagents: defaultSubagentTemplates,
  contextBudget: defaultContextBudget,
  gatewayAdapter: gatewayAdapterMethods,
};
const workspaceSearchIndex = [
  { path: "src/App.tsx", area: "ui-shell", riskLevel: "low" },
  { path: "src/lib/codingWorkspace.ts", area: "coding-workspace", riskLevel: "low" },
  { path: "src/lib/safetyPolicy.ts", area: "safety-policy", riskLevel: "high" },
  { path: "src/components/CodingWorkspacePanel.tsx", area: "coding-panel", riskLevel: "low" },
  { path: "src/components/SafetyQueuePanel.tsx", area: "safety-panel", riskLevel: "low" },
  { path: "scripts/release-guard.mjs", area: "release-gate", riskLevel: "high" },
  { path: "src-tauri/tauri.prod.conf.json", area: "production-bundle", riskLevel: "high" },
  { path: "backend/server.mjs", area: "backend-adapter", riskLevel: "high" },
];
let safetyQueue = [
  { id: "queue-shell-preview", action: "shell.command.plan", riskLevel: "high", status: "waiting-for-user", note: "變更前需要人工審批" },
  { id: "queue-external-draft", action: "gmail.draft.create", riskLevel: "high", status: "draft-only", note: "外部訊息預設只可草稿" },
];
const defaultTargetRegistry = {
  defaultTargetId: "local-builder",
  targetGroups: [
    {
      id: "default-local-ssh",
      name: "Local + SSH",
      description: "本機與 SSH 終端機的日常發配群組。",
      targetIds: ["local-builder", "builder-ssh"],
    },
    {
      id: "remote-ops",
      name: "Remote Ops",
      description: "遠端桌面與 lab target 的觀察 / 控制群組。",
      targetIds: ["ops-rdp", "lab-mock"],
    },
    {
      id: "all-targets",
      name: "All Targets",
      description: "全部已註冊 target。",
      targetIds: ["local-builder", "builder-ssh", "ops-rdp", "lab-mock"],
    },
  ],
  targets: [
    {
      id: "local-builder",
      displayName: "Local Builder",
      kind: "local-shell",
      state: "ready",
      paired: true,
      trustedWorkspaces: ["~/ClawDesk Projects/桌面 GUI"],
      connection: {
        ...defaultTargetConnectionState("local-shell"),
      },
      adapters: [
        {
          kind: "local-shell",
          endpoint: "local://workspace",
          authenticated: true,
          hostKeyVerified: true,
          supportsTerminal: true,
          supportsScreen: false,
          supportsClipboard: true,
          supportsFileTransfer: true,
        },
      ],
    },
    {
      id: "builder-ssh",
      displayName: "Builder SSH",
      kind: "ssh-terminal",
      state: "offline",
      paired: false,
      trustedWorkspaces: ["~/ClawDesk Projects/桌面 GUI"],
      connection: {
        ...defaultTargetConnectionState("ssh-terminal"),
      },
      adapters: [
        {
          kind: "ssh-terminal",
          endpoint: "ssh://builder.example.internal",
          authenticated: false,
          hostKeyVerified: false,
          supportsTerminal: true,
          supportsScreen: false,
          supportsClipboard: false,
          supportsFileTransfer: true,
        },
      ],
    },
    {
      id: "ops-rdp",
      displayName: "Ops Remote Desktop",
      kind: "remote-desktop",
      state: "offline",
      paired: false,
      trustedWorkspaces: ["~/ClawDesk Projects/桌面 GUI"],
      connection: {
        ...defaultTargetConnectionState("remote-desktop"),
      },
      adapters: [
        {
          kind: "remote-desktop",
          endpoint: "rdp://ops.example.internal",
          authenticated: false,
          hostKeyVerified: false,
          supportsTerminal: false,
          supportsScreen: true,
          supportsClipboard: false,
          supportsFileTransfer: false,
        },
      ],
    },
    {
      id: "lab-mock",
      displayName: "Lab Mock Target",
      kind: "mock",
      state: "degraded",
      paired: true,
      trustedWorkspaces: ["~/ClawDesk Projects/桌面 GUI"],
      connection: {
        ...defaultTargetConnectionState("mock"),
      },
      adapters: [
        {
          kind: "mock",
          endpoint: "mock://lab",
          authenticated: true,
          hostKeyVerified: true,
          supportsTerminal: true,
          supportsScreen: true,
          supportsClipboard: true,
          supportsFileTransfer: true,
        },
      ],
    },
  ],
};
const SAFE_COMMAND_PATTERNS = [
  /^ls(\s|$)/i,
  /^dir(\s|$)/i,
  /^pwd(\s|$)/i,
  /^Get-Location(\s|$)/i,
  /^whoami(\s|$)/i,
  /^hostname(\s|$)/i,
  /^git status(\s|$)/i,
  /^git diff(\s|$)/i,
  /^git log(\s|$)/i,
  /^Get-ChildItem(\s|$)/i,
  /^Get-Content(\s|$)/i,
  /^cat(\s|$)/i,
  /^type(\s|$)/i,
];
const BLOCKED_COMMAND_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\bdel\b/i,
  /\brmdir\b/i,
  /\bremove-item\b/i,
  /\bformat\b/i,
  /\bshutdown\b/i,
  /\brestart-computer\b/i,
  /\bstop-process\b/i,
  /\bsudo\b/i,
  /\bchmod\s+777\b/i,
  /\bcurl\b.*\|\s*sh/i,
  /\bwget\b.*\|\s*sh/i,
];
let targetRegistry = cloneTargetRegistryState(defaultTargetRegistry);
let targetDispatches = [];
const remoteDesktopSessions = new Map();
const remoteDesktopLaunchRuntimes = new Map();
const sshTerminalSessions = new Map();
const sshTerminalInteractiveRuntimes = new Map();
const pairingTickets = new Map();
const hostEnrollmentTickets = new Map();
const sshExecutable = (process.env.CLAWDESK_SSH_EXECUTABLE || (process.platform === "win32" ? "ssh.exe" : "ssh")).trim();
const sshExecutableArgs = (() => {
  const raw = process.env.CLAWDESK_SSH_EXECUTABLE_ARGS_JSON;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
})();
const sshRemoteShellCommand = (process.env.CLAWDESK_SSH_REMOTE_SHELL_COMMAND || "sh -s").trim();
const sshSessionCommandTimeoutMs = Number(process.env.CLAWDESK_SSH_SESSION_COMMAND_TIMEOUT_MS ?? 60_000);
const remoteDesktopClientExecutableOverride = process.env.CLAWDESK_REMOTE_DESKTOP_CLIENT_EXECUTABLE?.trim() || "";
const remoteDesktopClientArgsOverrideJson = process.env.CLAWDESK_REMOTE_DESKTOP_CLIENT_ARGS_JSON?.trim() || "";
// SSH credential vault uses an in-memory index plus a local encrypted file for durable storage.
const targetCredentialVault = new Map();
let targetCredentialVaultSaveTimer;
let targetCredentialVaultKey;
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
    remainingWork: "Add import/export compatibility with upstream config files.",
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
    description: "兼容既有欄位命名。",
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
    modelPlaceholder: "llama3.3",
    modelDefault: "llama3.3",
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
  activeProvider: "local-model",
  status: "connected",
  displayName: "Ollama",
  detail: "目前預設使用本機 Ollama endpoint（http://127.0.0.1:11434）。",
  endpoint: "http://127.0.0.1:11434",
  model: "llama3.3",
};
let visionProbeResults = {};
const identityUsers = [];
const identityVerifications = [];
const identityPasswordResets = [];
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
    email: process.env.CLAWDESK_DEVELOPER_EMAIL ?? "support@clawdesk.example",
    displayName: "huangkuoling",
    password: process.env.CLAWDESK_DEVELOPER_PASSWORD ?? "ChangeMe123!",
    mode: process.env.CLAWDESK_DEVELOPER_MODE === "personal" ? "personal" : "enterprise",
    role: "owner",
    organization: process.env.CLAWDESK_DEVELOPER_ORGANIZATION ?? "ClawDesk 測試組織",
  },
];
const developerIdentityEmails = new Set([
  ...seededIdentityAccounts.map((item) => item.email),
  "silentposture@hotmail.com",
]);

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
  { id: "trial", name: "Free Trial", priceUsd: 0, cadence: "free", description: "本機安全沙盒、手動授權與基本桌面工作流試用。" },
  { id: "pro-yearly", name: "Pro Yearly", priceUsd: 79, cadence: "yearly", description: "桌面 AI 工作平台年繳方案，含支援更新資格。" },
  { id: "lifetime-local", name: "Lifetime", priceUsd: 99, cadence: "one-time", description: "永久本機功能，含 12 個月支援更新。" },
];
ensureSeedIdentityUsers();

const updateHistory = [
  {
    version: "1.4.0",
    releasedAt: "2027-01-15",
    notes: ["Lemon Squeezy production adapter", "MCP connector policy audit", "Windows installer hardening"],
  },
  {
    version: "1.0.0",
    releasedAt: "2026-05-12",
    notes: ["ClawDesk commercial desktop MVP", "Mock Gateway", "manual update check"],
  },
];

const legalDocuments = [
  {
    id: "developer-disclosure",
    title: "開發者與發行者聲明",
    summary: "ClawDesk 由 ClawDesk Contributors 以 OSS 社群專案名義開發與發行。",
    details: [
      "ClawDesk Contributors 不以公司、代理商、系統整合商、財務顧問、法律顧問、稅務顧問或代管服務提供者身分對外表示。",
      "除非另有書面揭露，ClawDesk 與 OpenClaw、OpenAI、Microsoft、Google、Lemon Squeezy 或其他第三方服務沒有隸屬、背書或贊助關係。",
      "完整聲明已打包於 app resources：legal/DEVELOPER_DISCLOSURE.md。",
    ],
  },
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
      "Lemon Squeezy 是唯一付款與授權供應商，正式版付款、稅務、收據、取消入口、license key 與 webhook 由 Lemon Squeezy 流程承接。",
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
  {
    id: "support-contact",
    title: "客服與聯絡入口",
    summary: "客服聯絡信箱為 support@clawdesk.example；目前 OSS launch 不承諾 24/7、企業 SLA 或代管部署。",
    details: [
      "release guard 會在 beta-direct 模式要求 CLAWDESK_SUPPORT_EMAIL 或 CLAWDESK_SUPPORT_URL。",
      "支援範圍草案已打包於 app resources：support/CONTACT.md。",
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
  { package: "Lemon Squeezy", license: "Commercial SaaS", purpose: "唯一付款、license key、退款/取消 webhook 與授權管控供應商" },
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
  pinnedFacts: ["品牌名稱 ClawDesk", "Lemon Squeezy 是唯一付款與授權供應商", "專案外改動需人工授權"],
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
    taskName: "啟用 Lemon Squeezy 授權",
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

function cloneTargetRegistryState(registry = defaultTargetRegistry) {
  return JSON.parse(JSON.stringify(registry));
}

function defaultTargetConnectionState(kind) {
  if (kind === "local-shell" || kind === "mock") {
    return {
      credentialMode: "platform-managed",
      sessionMode: "control",
      hostBridge: {
        state: "registered",
        bridgeId: `${kind}-bridge`,
        hostName: kind === "local-shell" ? "Local Host" : "Mock Host",
        bridgeVersion: "local",
      },
    };
  }

  if (kind === "ssh-terminal") {
    return {
      credentialMode: "none",
      sessionMode: "control",
      port: 22,
      hostBridge: {
        state: "unregistered",
      },
    };
  }

  return {
    credentialMode: "none",
    sessionMode: "observe",
    port: 3389,
    hostBridge: {
      state: "unregistered",
    },
  };
}

function normalizeTargetConnectionState(kind, connection = {}) {
  const source = connection && typeof connection === "object" ? connection : {};
  const defaults = defaultTargetConnectionState(kind);
  const portValue = typeof source.port === "number" ? source.port : Number.parseInt(source.port, 10);
  const hostBridgeSource = source.hostBridge && typeof source.hostBridge === "object" ? source.hostBridge : {};
  return {
    ...defaults,
    ...source,
    port: Number.isFinite(portValue) ? portValue : defaults.port,
    credentialMode:
      typeof source.credentialMode === "string" && source.credentialMode ? source.credentialMode : defaults.credentialMode,
    sessionMode:
      typeof source.sessionMode === "string" && source.sessionMode ? source.sessionMode : defaults.sessionMode,
    username: typeof source.username === "string" && source.username.trim() ? source.username.trim() : undefined,
    credentialRef: typeof source.credentialRef === "string" && source.credentialRef.trim() ? source.credentialRef.trim() : undefined,
    knownHostFingerprint:
      typeof source.knownHostFingerprint === "string" && source.knownHostFingerprint.trim()
        ? source.knownHostFingerprint.trim()
        : undefined,
    note: typeof source.note === "string" && source.note.trim() ? source.note.trim() : undefined,
    hostBridge: {
      state:
        typeof hostBridgeSource.state === "string" && hostBridgeSource.state
          ? hostBridgeSource.state
          : defaults.hostBridge?.state ?? "unregistered",
      bridgeId: typeof hostBridgeSource.bridgeId === "string" && hostBridgeSource.bridgeId.trim() ? hostBridgeSource.bridgeId.trim() : defaults.hostBridge?.bridgeId,
      hostName: typeof hostBridgeSource.hostName === "string" && hostBridgeSource.hostName.trim() ? hostBridgeSource.hostName.trim() : defaults.hostBridge?.hostName,
      bridgeVersion:
        typeof hostBridgeSource.bridgeVersion === "string" && hostBridgeSource.bridgeVersion.trim()
          ? hostBridgeSource.bridgeVersion.trim()
          : defaults.hostBridge?.bridgeVersion,
      deviceId: typeof hostBridgeSource.deviceId === "string" && hostBridgeSource.deviceId.trim() ? hostBridgeSource.deviceId.trim() : defaults.hostBridge?.deviceId,
      installId: typeof hostBridgeSource.installId === "string" && hostBridgeSource.installId.trim() ? hostBridgeSource.installId.trim() : defaults.hostBridge?.installId,
      platform: typeof hostBridgeSource.platform === "string" && hostBridgeSource.platform.trim() ? hostBridgeSource.platform.trim() : defaults.hostBridge?.platform,
      registeredAt:
        typeof hostBridgeSource.registeredAt === "string" && hostBridgeSource.registeredAt.trim()
          ? hostBridgeSource.registeredAt.trim()
          : defaults.hostBridge?.registeredAt,
      attestedAt:
        typeof hostBridgeSource.attestedAt === "string" && hostBridgeSource.attestedAt.trim()
          ? hostBridgeSource.attestedAt.trim()
          : defaults.hostBridge?.attestedAt,
      lastSeenAt:
        typeof hostBridgeSource.lastSeenAt === "string" && hostBridgeSource.lastSeenAt.trim()
          ? hostBridgeSource.lastSeenAt.trim()
          : defaults.hostBridge?.lastSeenAt,
      lastError: typeof hostBridgeSource.lastError === "string" && hostBridgeSource.lastError.trim() ? hostBridgeSource.lastError.trim() : defaults.hostBridge?.lastError,
      lastAttestationError:
        typeof hostBridgeSource.lastAttestationError === "string" && hostBridgeSource.lastAttestationError.trim()
          ? hostBridgeSource.lastAttestationError.trim()
          : defaults.hostBridge?.lastAttestationError,
    },
  };
}

function hostBridgeStalenessState(hostBridge) {
  if (!hostBridge || hostBridge.state !== "registered") {
    return "missing";
  }

  if (!hostBridge.lastSeenAt) {
    return "fresh";
  }

  const seenAt = new Date(hostBridge.lastSeenAt).getTime();
  if (!Number.isFinite(seenAt)) {
    return "stale";
  }

  return Date.now() - seenAt > hostBridgeHeartbeatStaleAfterMs ? "stale" : "fresh";
}

function hostBridgeAttestationState(hostBridge) {
  if (!hostBridge || hostBridge.state !== "registered") {
    return "missing";
  }

  if (!hostBridge.attestedAt || !hostBridge.deviceId || !hostBridge.installId) {
    return "missing";
  }

  return "fresh";
}

function normalizeTargetProfileState(target) {
  const cloned = cloneTargetProfileState(target);
  const kind = typeof cloned.kind === "string" ? cloned.kind : "local-shell";
  return {
    ...cloned,
    kind,
    trustedWorkspaces: Array.isArray(cloned.trustedWorkspaces) ? [...cloned.trustedWorkspaces] : [],
    adapters: Array.isArray(cloned.adapters) ? cloned.adapters.map((adapter) => ({ ...adapter })) : [],
    connection: normalizeTargetConnectionState(kind, cloned.connection),
  };
}

function normalizeTargetRegistryState(registry) {
  if (!registry || !Array.isArray(registry.targets) || registry.targets.length === 0) {
    return cloneTargetRegistryState(defaultTargetRegistry);
  }

  const cloned = cloneTargetRegistryState(registry);
  cloned.targets = cloned.targets.map((target) => normalizeTargetProfileState(target));
  const validTargetIds = cloned.targets.map((target) => target.id);
  cloned.targetGroups = Array.isArray(cloned.targetGroups)
    ? cloned.targetGroups
        .map((group) => {
          if (!group || typeof group !== "object") return undefined;
          const name = typeof group.name === "string" && group.name.trim() ? group.name.trim() : "未命名群組";
          const id = typeof group.id === "string" && group.id.trim() ? group.id.trim() : name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
          const targetIds = Array.isArray(group.targetIds)
            ? [...new Set(group.targetIds.map((targetId) => (typeof targetId === "string" ? targetId.trim() : "")).filter((targetId) => targetId && validTargetIds.includes(targetId)))]
            : [];
          if (!targetIds.length) return undefined;
          return {
            id,
            name,
            description: typeof group.description === "string" && group.description.trim() ? group.description.trim() : undefined,
            targetIds,
          };
        })
        .filter(Boolean)
    : [];
  if (!cloned.targetGroups.length) {
    cloned.targetGroups = (defaultTargetRegistry.targetGroups ?? []).map((group) => ({
      ...group,
      targetIds: group.targetIds.filter((targetId) => validTargetIds.includes(targetId)),
    })).filter((group) => group.targetIds.length > 0);
  }
  if (!cloned.defaultTargetId) {
    cloned.defaultTargetId = cloned.targets[0]?.id;
  }
  return cloned;
}

function cloneTargetProfileState(target) {
  return JSON.parse(JSON.stringify(target));
}

function buildTargetTimelineEntryFromDispatch(record) {
  return {
    id: record.id,
    kind: "dispatch",
    eventType: "dispatch.record",
    targetId: record.targetId,
    targetName: record.targetName,
    createdAt: record.createdAt,
    summary: record.summary,
    category: record.category,
    command: record.command,
    allowed: Boolean(record.decision?.allowed),
    decision: record.decision?.reason ?? "",
    source: "dispatch-log",
  };
}

function buildTargetTimelineEntryFromSshSession(session) {
  return {
    id: `${session.sessionId}:ssh`,
    kind: "session",
    eventType: "ssh.session.snapshot",
    targetId: session.targetId,
    targetName: session.targetName,
    createdAt: session.lastUpdatedAt,
    summary: session.sessionSummary ?? `SSH terminal ${session.targetName} session snapshot.`,
    state: session.state,
    transport: session.transport,
    source: "ssh-session",
    lastCommand: session.lastCommand,
    lastExitCode: session.lastExitCode,
  };
}

function buildTargetTimelineEntryFromRemoteDesktopSession(session) {
  return {
    id: `${session.sessionId}:rdp`,
    kind: "session",
    eventType: "remote-desktop.session.snapshot",
    targetId: session.targetId,
    targetName: session.targetName,
    createdAt: session.lastUpdatedAt,
    summary: session.sessionSummary ?? `Remote desktop ${session.targetName} session snapshot.`,
    state: session.state,
    transport: session.transport,
    source: "remote-desktop-session",
    credentialSource: session.credentialSource,
    credentialSeedState: session.credentialSeedState,
    clientLaunchState: session.clientLaunchState,
    clientLaunchCommand: session.clientLaunchCommand,
    activeWindow: session.activeWindow,
  };
}

function extractTimelineTargetIdFromAuditDetails(details) {
  if (!details || typeof details !== "object") return "";
  const candidateFields = [
    details.targetId,
    details.record?.targetId,
    details.session?.targetId,
    details.request?.targetId,
    details.permissionRequest?.targetId,
  ];
  for (const value of candidateFields) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function buildTargetTimelineEntryFromAudit(event) {
  const details = event.details && typeof event.details === "object" ? event.details : {};
  const targetId = extractTimelineTargetIdFromAuditDetails(details);
  if (!targetId) return null;
  const target = targetRegistry.targets.find((entry) => entry.id === targetId);
  return {
    id: `${event.id}:audit`,
    kind: "audit",
    eventType: event.action,
    targetId,
    targetName: target?.displayName ?? targetId,
    createdAt: event.createdAt,
    summary: `${event.action}${details.reason ? ` · ${redactDiagnosticText(String(details.reason))}` : ""}`,
    source: "audit-log",
    action: event.action,
    allowed: typeof details.allowed === "boolean" ? details.allowed : undefined,
    decision:
      typeof details.decision === "string"
        ? details.decision
        : typeof details.state === "string"
          ? details.state
          : "",
    state: typeof details.state === "string" ? details.state : undefined,
    transport: typeof details.transport === "string" ? details.transport : undefined,
    credentialSource: typeof details.credentialSource === "string" ? details.credentialSource : undefined,
    credentialSeedState: typeof details.credentialSeedState === "string" ? details.credentialSeedState : undefined,
    credentialTarget: typeof details.credentialTarget === "string" ? details.credentialTarget : undefined,
    clientLaunchState: typeof details.clientLaunchState === "string" ? details.clientLaunchState : undefined,
    clientLaunchCommand: typeof details.clientLaunchCommand === "string" ? details.clientLaunchCommand : undefined,
    lastCommand: typeof details.command === "string" ? details.command : undefined,
    lastExitCode: typeof details.exitCode === "number" ? details.exitCode : undefined,
    activeWindow: typeof details.activeWindow === "string" ? details.activeWindow : undefined,
    lastProbeAt: typeof details.lastProbeAt === "string" ? details.lastProbeAt : undefined,
    lastProbeResult: typeof details.lastProbeResult === "string" ? details.lastProbeResult : undefined,
    lastProbeHost: typeof details.lastProbeHost === "string" ? details.lastProbeHost : undefined,
    lastProbePort: typeof details.lastProbePort === "number" ? details.lastProbePort : undefined,
    lastProbeLatencyMs: typeof details.lastProbeLatencyMs === "number" ? details.lastProbeLatencyMs : undefined,
    lastProbeError: typeof details.lastProbeError === "string" ? details.lastProbeError : undefined,
  };
}

function buildTargetTimelineState(targetId, limit = 6) {
  const normalizedTargetId = typeof targetId === "string" ? targetId.trim() : "";
  if (!normalizedTargetId) {
    return { targetId: "", entries: [] };
  }

  const target = targetRegistry.targets.find((entry) => entry.id === normalizedTargetId);
  if (!target) {
    return { targetId: normalizedTargetId, entries: [] };
  }

  const entries = [
    ...targetDispatches
      .filter((record) => record.targetId === normalizedTargetId)
      .map((record) => buildTargetTimelineEntryFromDispatch(record)),
    ...auditEvents
      .map((event) => buildTargetTimelineEntryFromAudit(event))
      .filter((entry) => entry && entry.targetId === normalizedTargetId),
  ];

  const sshSession = sshTerminalSessions.get(sshTerminalSessionStorageKey(normalizedTargetId));
  if (sshSession) {
    entries.unshift(buildTargetTimelineEntryFromSshSession(sshSession));
  }

  const remoteDesktopSession = remoteDesktopSessions.get(remoteDesktopSessionStorageKey(normalizedTargetId));
  if (remoteDesktopSession) {
    entries.unshift(buildTargetTimelineEntryFromRemoteDesktopSession(remoteDesktopSession));
  }

  return {
    targetId: normalizedTargetId,
    targetName: target.displayName,
    entries: entries
      .filter((entry) => entry && typeof entry === "object")
      .sort((left, right) => String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")))
    .slice(0, Math.max(1, Math.min(Number(limit) || 6, 20))),
  };
}

function formatTargetAuditReportText(report) {
  const lines = [];
  lines.push(`# Target Audit Report`);
  lines.push(`generatedAt: ${report.generatedAt}`);
  lines.push(`targetId: ${report.targetId}`);
  lines.push(`kind: ${report.kind}`);
  lines.push(`state: ${report.state}`);
  lines.push(`paired: ${report.paired ? "yes" : "no"}`);
  lines.push(`readyToConnect: ${report.readiness.readyToConnect ? "yes" : "no"}`);
  lines.push(`nextAction: ${report.readiness.nextAction}`);
  lines.push(`summary: ${report.summary}`);
  lines.push(``);
  if (report.session) {
    lines.push(`## Session Snapshot`);
    lines.push(`state: ${report.session.state ?? "unknown"}`);
    lines.push(`transport: ${report.session.transport ?? "unknown"}`);
    lines.push(`sessionSummary: ${redactDiagnosticText(String(report.session.sessionSummary ?? ""))}`);
    if (report.kind === "ssh-terminal") {
      lines.push(`prompt: ${redactDiagnosticText(String(report.session.prompt ?? ""))}`);
      lines.push(`currentDirectory: ${redactDiagnosticText(String(report.session.currentDirectory ?? ""))}`);
      lines.push(`lastCommand: ${redactDiagnosticText(String(report.session.lastCommand ?? ""))}`);
      lines.push(`lastExitCode: ${typeof report.session.lastExitCode === "number" ? report.session.lastExitCode : "n/a"}`);
      lines.push(`transcript:`);
      const transcript = Array.isArray(report.session.transcript) ? report.session.transcript.slice(-6) : [];
      if (!transcript.length) {
        lines.push(`- no transcript entries`);
      } else {
        for (const entry of transcript) {
          lines.push(`- ${entry.createdAt} | ${entry.role} | ${redactDiagnosticText(String(entry.text ?? ""))}`);
        }
      }
    } else if (report.kind === "remote-desktop") {
      lines.push(`mode: ${report.session.mode ?? "unknown"}`);
      lines.push(`credentialSource: ${report.session.credentialSource ?? "none"}`);
      lines.push(`credentialSeedState: ${report.session.credentialSeedState ?? "idle"}`);
      lines.push(`activeWindow: ${redactDiagnosticText(String(report.session.activeWindow ?? ""))}`);
      lines.push(`clientLaunchState: ${report.session.clientLaunchState ?? "idle"}`);
      lines.push(`clientLaunchCommand: ${redactDiagnosticText(String(report.session.clientLaunchCommand ?? ""))}`);
      lines.push(`clientLaunchPid: ${typeof report.session.clientLaunchPid === "number" ? report.session.clientLaunchPid : "n/a"}`);
      lines.push(`launchHistory:`);
      const launchHistory = Array.isArray(report.session.launchHistory) ? report.session.launchHistory.slice(-4) : [];
      if (!launchHistory.length) {
        lines.push(`- no launch history`);
      } else {
        for (const entry of launchHistory) {
          const fields = [
            entry.launchedAt ?? entry.createdAt ?? report.generatedAt,
            entry.transport ?? "unknown",
            redactDiagnosticText(String(entry.command ?? "")),
          ];
          if (typeof entry.dryRun === "boolean") fields.push(`dryRun=${entry.dryRun ? "yes" : "no"}`);
          if (entry.mode) fields.push(`mode=${entry.mode}`);
          if (entry.result) fields.push(`result=${redactDiagnosticText(String(entry.result))}`);
          lines.push(`- ${fields.filter(Boolean).join(" | ")}`);
        }
      }
    }
    lines.push(``);
  }
  lines.push(`## Readiness Checks`);
  for (const check of report.readiness.checks) {
    const safeDetail = redactDiagnosticText(String(check.detail ?? ""));
    lines.push(`- ${check.key} | ${check.label} | ${check.status} | ${safeDetail}`);
  }
  lines.push(``);
  lines.push(`## Timeline`);
  if (!report.timeline.length) {
    lines.push(`- no timeline entries`);
  } else {
    for (const entry of report.timeline) {
      const fields = [
        entry.createdAt,
        entry.eventType,
        entry.kind,
        entry.source,
        redactDiagnosticText(entry.summary),
      ];
      if (entry.category) fields.push(`category=${entry.category}`);
      if (typeof entry.allowed === "boolean") fields.push(`allowed=${entry.allowed ? "yes" : "no"}`);
      if (entry.decision) fields.push(`decision=${redactDiagnosticText(String(entry.decision))}`);
      if (entry.state) fields.push(`state=${entry.state}`);
      if (entry.transport) fields.push(`transport=${entry.transport}`);
      if (entry.lastProbeResult) fields.push(`probe=${entry.lastProbeResult}`);
      if (typeof entry.lastExitCode === "number") fields.push(`exit=${entry.lastExitCode}`);
      if (entry.clientLaunchState) fields.push(`launch=${entry.clientLaunchState}`);
      if (entry.credentialSource) fields.push(`credentialSource=${entry.credentialSource}`);
      if (entry.credentialSeedState) fields.push(`credentialSeed=${entry.credentialSeedState}`);
      lines.push(`- ${fields.filter(Boolean).join(" | ")}`);
    }
  }
  return lines.join("\n");
}

function formatTargetSessionExportText(target, session) {
  const lines = [];
  lines.push(`# Target Session Export`);
  lines.push(`generatedAt: ${nowIso()}`);
  lines.push(`targetId: ${target.id}`);
  lines.push(`displayName: ${target.displayName}`);
  lines.push(`kind: ${target.kind}`);
  lines.push(`endpoint: ${target.adapters[0]?.endpoint ?? target.endpoint ?? target.displayName}`);
  lines.push(`state: ${target.state}`);
  lines.push(`paired: ${target.paired ? "yes" : "no"}`);
  lines.push(`summary: ${target.displayName} ${target.kind} target (${target.state})`);
  lines.push(``);

  if (target.kind === "ssh-terminal") {
    lines.push(`## SSH Session`);
    lines.push(`sessionId: ${session.sessionId}`);
    lines.push(`state: ${session.state}`);
    lines.push(`mode: ${session.mode}`);
    lines.push(`transport: ${session.transport}`);
    lines.push(`sessionSummary: ${redactDiagnosticText(String(session.sessionSummary ?? ""))}`);
    lines.push(`prompt: ${redactDiagnosticText(String(session.prompt ?? ""))}`);
    lines.push(`currentDirectory: ${redactDiagnosticText(String(session.currentDirectory ?? ""))}`);
    lines.push(`lastCommand: ${redactDiagnosticText(String(session.lastCommand ?? ""))}`);
    lines.push(`lastExitCode: ${typeof session.lastExitCode === "number" ? session.lastExitCode : "n/a"}`);
    lines.push(``);
    lines.push(`### Transcript`);
    const transcript = Array.isArray(session.transcript) ? session.transcript.slice(-20) : [];
    if (!transcript.length) {
      lines.push(`- no transcript entries`);
    } else {
      for (const entry of transcript) {
        lines.push(`- ${entry.createdAt} | ${entry.role} | ${redactDiagnosticText(String(entry.text ?? ""))}`);
      }
    }
  }

  if (target.kind === "remote-desktop") {
    lines.push(`## Remote Desktop Session`);
    lines.push(`sessionId: ${session.sessionId}`);
    lines.push(`state: ${session.state}`);
    lines.push(`mode: ${session.mode}`);
    lines.push(`transport: ${session.transport}`);
    lines.push(`sessionSummary: ${redactDiagnosticText(String(session.sessionSummary ?? ""))}`);
    lines.push(`credentialSource: ${session.credentialSource ?? "none"}`);
    lines.push(`credentialSeedState: ${session.credentialSeedState ?? "idle"}`);
    lines.push(`activeWindow: ${redactDiagnosticText(String(session.activeWindow ?? ""))}`);
    lines.push(`clientLaunchState: ${session.clientLaunchState ?? "idle"}`);
    lines.push(`clientLaunchCommand: ${redactDiagnosticText(String(session.clientLaunchCommand ?? ""))}`);
    lines.push(`clientLaunchPid: ${typeof session.clientLaunchPid === "number" ? session.clientLaunchPid : "n/a"}`);
    lines.push(``);
    lines.push(`### Launch History`);
    const launchHistory = Array.isArray(session.launchHistory) ? session.launchHistory.slice(-10) : [];
    if (!launchHistory.length) {
      lines.push(`- no launch history`);
    } else {
      for (const entry of launchHistory) {
        const fields = [
          entry.launchedAt ?? "",
          entry.transport ?? "unknown",
          redactDiagnosticText(String(entry.command ?? "")),
        ];
        if (typeof entry.dryRun === "boolean") fields.push(`dryRun=${entry.dryRun ? "yes" : "no"}`);
        if (entry.mode) fields.push(`mode=${entry.mode}`);
        if (typeof entry.pid === "number") fields.push(`pid=${entry.pid}`);
        if (entry.error) fields.push(`error=${redactDiagnosticText(String(entry.error))}`);
        lines.push(`- ${fields.filter(Boolean).join(" | ")}`);
      }
    }
  }

  return lines.join("\n");
}

function buildTargetAuditReportState(targetId, limit = 12) {
  const normalizedTargetId = typeof targetId === "string" ? targetId.trim() : "";
  if (!normalizedTargetId) {
    return { targetId: "", entries: [], text: "" };
  }

  const target = targetRegistry.targets.find((entry) => entry.id === normalizedTargetId);
  if (!target) {
    return { targetId: normalizedTargetId, entries: [], text: "" };
  }

  const readiness = buildTargetConnectionReadinessReportState(target);
  const timeline = buildTargetTimelineState(normalizedTargetId, limit);
  const session =
    target.kind === "ssh-terminal"
      ? getSshTerminalSessionState(target)
      : target.kind === "remote-desktop"
        ? getRemoteDesktopSessionState(target)
        : undefined;
  const report = {
    version: 1,
    generatedAt: nowIso(),
    targetId: target.id,
    kind: target.kind,
    state: target.state,
    paired: Boolean(target.paired),
    readiness,
    summary: `${target.displayName} ${target.kind} target (${target.state})`,
    session,
    timeline: timeline.entries.map((entry) => ({
      ...entry,
      summary: redactDiagnosticText(String(entry.summary ?? "")),
    })),
  };

  return {
    ...report,
    text: formatTargetAuditReportText(report),
  };
}

function buildTargetSessionExportState(targetId, limit = 20) {
  const normalizedTargetId = typeof targetId === "string" ? targetId.trim() : "";
  if (!normalizedTargetId) {
    return { targetId: "", text: "", session: undefined };
  }

  const target = targetRegistry.targets.find((entry) => entry.id === normalizedTargetId);
  if (!target || (target.kind !== "ssh-terminal" && target.kind !== "remote-desktop")) {
    return { targetId: normalizedTargetId, text: "", session: undefined };
  }

  const session = target.kind === "ssh-terminal" ? getSshTerminalSessionState(target) : getRemoteDesktopSessionState(target);
  const text = formatTargetSessionExportText(target, session);
  return { targetId: target.id, session, text };
}

function targetConnectionReadinessIssuesState(target) {
  const issues = [];
  const connection = target.connection ?? defaultTargetConnectionState(target.kind);
  const hostBridgeStaleness = hostBridgeStalenessState(connection.hostBridge);
  const hostBridgeAttestation = hostBridgeAttestationState(connection.hostBridge);

  if (target.kind === "local-shell" || target.kind === "mock") {
    return issues;
  }

  if (!target.paired) {
    issues.push("Target must be paired before it can connect.");
  }

  if (!connection.username) {
    issues.push("Connection username is required.");
  }

  if (connection.credentialMode === "none") {
    issues.push("Select a credential mode before connecting.");
  }

  if (connection.credentialMode === "secret-ref" && !connection.credentialRef) {
    issues.push("Secret-ref mode requires a credential reference.");
  }

  if (connection.credentialMode === "secret-ref" && connection.credentialRef && !resolveTargetCredentialRefState(connection.credentialRef)) {
    issues.push("Secret-ref credential is not registered in the gateway vault.");
  }

  if (target.kind === "ssh-terminal" && !connection.knownHostFingerprint) {
    issues.push("SSH host key is required for host-key verification.");
  }

  if (target.kind === "ssh-terminal" || target.kind === "remote-desktop") {
    if (connection.hostBridge?.state !== "registered") {
      issues.push("Install and enroll the ClawDesk host bridge before pairing this target.");
    } else if (hostBridgeAttestation === "missing") {
      issues.push("Attest the host bridge identity before connecting this target.");
    } else if (hostBridgeStaleness === "stale") {
      issues.push("Host bridge heartbeat is stale; request a fresh heartbeat from the host bridge.");
    }
  }

  return issues;
}

function buildTargetConnectionReadinessReportState(target) {
  const baseTarget = normalizeTargetProfileState(target);
  const connection = baseTarget.connection ?? defaultTargetConnectionState(baseTarget.kind);
  const checks = [];
  const addCheck = (key, label, status, detail, required) => {
    checks.push({ key, label, status, detail, required });
  };

  const isLocalLike = baseTarget.kind === "local-shell" || baseTarget.kind === "mock";
  const hostBridgeStaleness = hostBridgeStalenessState(connection.hostBridge);
  const hostBridgeAttestation = hostBridgeAttestationState(connection.hostBridge);
  if (isLocalLike) {
    addCheck(
      "host-bridge",
      "Host bridge",
      connection.hostBridge?.state === "registered" ? (hostBridgeStaleness === "fresh" ? "pass" : "warn") : "warn",
      connection.hostBridge?.state === "registered"
        ? hostBridgeStaleness === "fresh"
          ? `Host bridge registered${connection.hostBridge.hostName ? ` for ${connection.hostBridge.hostName}` : ""}.`
          : "Host bridge heartbeat is stale; request a fresh heartbeat from the host bridge."
        : "Local targets ship with the host bridge already present.",
      false,
    );
    addCheck(
      "pair",
      "Pairing",
      baseTarget.paired ? "pass" : "warn",
      baseTarget.paired ? "Local targets remain paired and ready." : "Local targets can be paired before dispatch.",
      false,
    );
    addCheck(
      "attestation",
      "Host attestation",
      connection.hostBridge?.state === "registered" ? "pass" : "warn",
      connection.hostBridge?.state === "registered"
        ? "Local host bridge attestation is already present."
        : "Local targets ship with the host bridge already present.",
      false,
    );
    addCheck("probe", "Probe", "pass", "Local targets do not require a network probe.", false);
    return {
      targetId: baseTarget.id,
      targetName: baseTarget.displayName,
      kind: baseTarget.kind,
      state: baseTarget.state,
      readyToConnect: true,
      lastProbeResult: connection.lastProbeResult,
      lastProbeAt: connection.lastProbeAt,
      nextAction: baseTarget.paired ? "connect" : "pair",
      checks,
    };
  }

  addCheck(
    "host-bridge",
    "Host bridge",
    connection.hostBridge?.state === "registered" ? (hostBridgeStaleness === "fresh" ? "pass" : "fail") : "fail",
    connection.hostBridge?.state === "registered"
      ? hostBridgeStaleness === "fresh"
        ? `Host bridge registered${connection.hostBridge.hostName ? ` for ${connection.hostBridge.hostName}` : ""}${connection.hostBridge.bridgeVersion ? ` (${connection.hostBridge.bridgeVersion})` : ""}.`
        : "Host bridge heartbeat is stale; request a fresh heartbeat from the host bridge."
      : "Install and enroll the ClawDesk host bridge before pairing this target.",
    true,
  );
  addCheck(
    "pair",
    "Pairing",
    baseTarget.paired ? "pass" : connection.hostBridge?.state === "registered" ? "warn" : "fail",
    baseTarget.paired
      ? "Target is paired."
      : connection.hostBridge?.state === "registered"
        ? "Enroll the host, then complete pairing before connect."
        : "Target must be paired after host enrollment before it can connect.",
    true,
  );
  addCheck(
    "attestation",
    "Host attestation",
    hostBridgeAttestation === "fresh" ? "pass" : "fail",
    hostBridgeAttestation === "fresh"
      ? `Host bridge attested${connection.hostBridge.deviceId ? ` from device ${connection.hostBridge.deviceId}` : ""}${connection.hostBridge.installId ? ` / install ${connection.hostBridge.installId}` : ""}.`
      : "Host bridge attestation is required before connect.",
    true,
  );
  addCheck(
    "username",
    "Username",
    connection.username ? "pass" : "fail",
    connection.username ? `Username: ${connection.username}` : "Connection username is required.",
    true,
  );
  addCheck(
    "credential-mode",
    "Credential mode",
    connection.credentialMode === "none" ? "fail" : "pass",
    connection.credentialMode === "none" ? "Select a credential mode before connecting." : `Credential mode: ${connection.credentialMode}`,
    true,
  );
  addCheck(
    "credential-ref",
    "Credential ref",
    connection.credentialMode === "secret-ref" && !connection.credentialRef
      ? "fail"
      : connection.credentialMode === "secret-ref"
        ? "pass"
        : "warn",
    connection.credentialMode === "secret-ref" && !connection.credentialRef
      ? "Secret-ref mode requires a credential reference."
      : connection.credentialMode === "secret-ref" && connection.credentialRef
        ? `Credential ref: ${maskTargetCredentialRef(connection.credentialRef)}`
        : "Credential ref not required for this credential mode.",
    connection.credentialMode === "secret-ref",
  );
  if (baseTarget.kind === "ssh-terminal") {
    addCheck(
      "host-key",
      "SSH host key",
      connection.knownHostFingerprint ? "pass" : "fail",
      connection.knownHostFingerprint ? "SSH host key recorded." : "SSH host key is required for host-key verification.",
      true,
    );
  } else {
    addCheck("host-key", "Host key", "warn", "Host-key verification is not required for this target kind.", false);
  }

  const probeStatus =
    connection.lastProbeResult === "reachable"
      ? "pass"
      : connection.lastProbeResult === "unreachable" || connection.lastProbeResult === "error"
        ? "fail"
        : "warn";
  addCheck(
    "probe",
    "Connectivity probe",
    probeStatus,
    connection.lastProbeResult === "reachable"
      ? `Last probe succeeded${connection.lastProbeHost ? ` at ${connection.lastProbeHost}${connection.lastProbePort ? `:${connection.lastProbePort}` : ""}` : ""}.`
      : connection.lastProbeResult
        ? `Last probe reported ${connection.lastProbeResult}${connection.lastProbeError ? `: ${connection.lastProbeError}` : ""}.`
        : "Run a probe before connect to confirm reachability.",
    true,
  );

  const readyToConnect = checks.every((check) => check.status !== "fail");
  let nextAction = "connect";
  if (connection.hostBridge?.state !== "registered") {
    nextAction = "enroll_host";
  } else if (hostBridgeAttestation === "missing") {
    nextAction = "attest";
  } else if (hostBridgeStaleness === "stale") {
    nextAction = "heartbeat";
  } else if (!baseTarget.paired) {
    nextAction = "pair";
  } else if (connection.lastProbeResult !== "reachable") {
    nextAction = "probe";
  } else if (baseTarget.kind === "ssh-terminal" && !connection.knownHostFingerprint) {
    nextAction = "verify_host_key";
  }

  return {
    targetId: baseTarget.id,
    targetName: baseTarget.displayName,
    kind: baseTarget.kind,
    state: baseTarget.state,
    readyToConnect,
    lastProbeResult: connection.lastProbeResult,
    lastProbeAt: connection.lastProbeAt,
    nextAction,
    checks,
  };
}

function classifyShellCommandState(command) {
  const normalized = command.trim();
  if (!normalized) return "blocked";

  if (BLOCKED_COMMAND_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return "blocked";
  }

  if (SAFE_COMMAND_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return "allowlisted";
  }

  return "needs-review";
}

function sanitizeTargetStorageKey(value) {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  return normalized.replace(/^-+|-+$/g, "") || "target";
}

function targetConnectionStorageDir(targetId) {
  return path.join(homeDir, ".clawdesk", "targets", sanitizeTargetStorageKey(targetId));
}

function targetKnownHostsPath(targetId) {
  return path.join(targetConnectionStorageDir(targetId), "known_hosts");
}

function targetCredentialRefStorageKey(credentialRef) {
  return sanitizeTargetStorageKey(credentialRef);
}

function normalizeTargetCredentialVaultEntry(raw) {
  if (!raw || typeof raw !== "object") return undefined;
  const credentialRef = typeof raw.credentialRef === "string" ? raw.credentialRef.trim() : "";
  if (!credentialRef) return undefined;

  return {
    credentialRef,
    targetId: typeof raw.targetId === "string" ? raw.targetId.trim() : "",
    label: typeof raw.label === "string" && raw.label.trim() ? raw.label.trim() : undefined,
    kind: typeof raw.kind === "string" && raw.kind.trim() ? raw.kind.trim() : "ssh-private-key",
    cipherText: typeof raw.cipherText === "string" && raw.cipherText.trim() ? raw.cipherText.trim() : undefined,
    privateKey: !targetCredentialVaultDurable && typeof raw.privateKey === "string" && raw.privateKey.trim() ? raw.privateKey : undefined,
    createdAt: typeof raw.createdAt === "string" && raw.createdAt.trim() ? raw.createdAt.trim() : nowIso(),
    status: typeof raw.status === "string" && raw.status.trim() ? raw.status.trim() : "active",
  };
}

function snapshotTargetCredentialVaultState() {
  return {
    version: 1,
    savedAt: nowIso(),
    entries: [...targetCredentialVault.values()].map((entry) => ({
      credentialRef: entry.credentialRef,
      targetId: entry.targetId,
      label: entry.label,
      kind: entry.kind,
      cipherText: entry.cipherText,
      createdAt: entry.createdAt,
      status: entry.status,
    })),
  };
}

function targetCredentialVaultPath() {
  return targetCredentialVaultFilePath;
}

async function encryptTargetCredentialSecret(plaintext) {
  const normalizedPlaintext = typeof plaintext === "string" ? plaintext : "";
  if (!normalizedPlaintext) {
    throw new Error("SSH credential material is required.");
  }

  const key = await ensureTargetCredentialVaultKeyState();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(normalizedPlaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

async function decryptTargetCredentialSecret(cipherText) {
  const normalizedCipherText = typeof cipherText === "string" ? cipherText.trim() : "";
  if (!normalizedCipherText) {
    throw new Error("SSH credential ref does not contain encrypted key material.");
  }

  const key = await ensureTargetCredentialVaultKeyState();
  const payload = Buffer.from(normalizedCipherText, "base64");
  if (payload.length < 28) {
    throw new Error("SSH credential ref payload is too short.");
  }
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const encrypted = payload.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const privateKey = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  if (!privateKey.trim()) {
    throw new Error("SSH credential decryption produced no output.");
  }
  return privateKey;
}

async function ensureTargetCredentialVaultKeyState() {
  if (targetCredentialVaultKey instanceof Buffer && targetCredentialVaultKey.length === 32) {
    return targetCredentialVaultKey;
  }

  try {
    const raw = await fs.readFile(targetCredentialVaultKeyPath);
    if (Buffer.isBuffer(raw) && raw.length === 32) {
      targetCredentialVaultKey = Buffer.from(raw);
      return targetCredentialVaultKey;
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  targetCredentialVaultKey = crypto.randomBytes(32);
  await fs.mkdir(path.dirname(targetCredentialVaultKeyPath), { recursive: true });
  await fs.writeFile(targetCredentialVaultKeyPath, targetCredentialVaultKey);
  try {
    await fs.chmod(targetCredentialVaultKeyPath, 0o600);
  } catch {
    // Best effort on Windows.
  }
  return targetCredentialVaultKey;
}

async function persistTargetCredentialVaultState() {
  if (!targetCredentialVaultDurable) return;
  await fs.mkdir(path.dirname(targetCredentialVaultPath()), { recursive: true });
  await fs.writeFile(targetCredentialVaultPath(), `${JSON.stringify(snapshotTargetCredentialVaultState(), null, 2)}\n`, "utf8");
}

function scheduleTargetCredentialVaultSave() {
  if (!targetCredentialVaultDurable) return;
  clearTimeout(targetCredentialVaultSaveTimer);
  targetCredentialVaultSaveTimer = setTimeout(() => {
    void persistTargetCredentialVaultState().catch((error) => {
      console.error(`ClawDesk mock SSH credential vault save failed: ${error.message}`);
    });
  }, 25);
}

async function loadTargetCredentialVaultState() {
  if (!targetCredentialVaultDurable) return;
  await ensureTargetCredentialVaultKeyState();
  try {
    const raw = await fs.readFile(targetCredentialVaultPath(), "utf8");
    const state = JSON.parse(raw);
    if (!state || !Array.isArray(state.entries)) return;
    targetCredentialVault.clear();
    for (const entry of state.entries) {
      const normalized = normalizeTargetCredentialVaultEntry(entry);
      if (normalized) {
        targetCredentialVault.set(targetCredentialRefStorageKey(normalized.credentialRef), normalized);
      }
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.error(`ClawDesk mock SSH credential vault load failed: ${error.message}`);
    }
  }
}

async function issueTargetCredentialRefState({ targetId, label, kind, privateKey }) {
  const normalizedPrivateKey = typeof privateKey === "string" ? privateKey.trim() : "";
  if (!targetId || !normalizedPrivateKey) {
    throw new Error("targetId and privateKey are required to issue a credential ref.");
  }

  const credentialRef = `tcr_${crypto
    .createHash("sha256")
    .update(`clawdesk-target-credential:${targetId}:${kind ?? "ssh-private-key"}:${normalizedPrivateKey}`)
    .digest("hex")
    .slice(0, 24)}`;

  const entry = {
    credentialRef,
    targetId,
    label: typeof label === "string" && label.trim() ? label.trim() : undefined,
    kind: kind ?? "ssh-private-key",
    createdAt: nowIso(),
    status: "active",
  };

  if (targetCredentialVaultDurable) {
    entry.cipherText = await encryptTargetCredentialSecret(normalizedPrivateKey);
  } else {
    entry.privateKey = normalizedPrivateKey;
  }

  targetCredentialVault.set(targetCredentialRefStorageKey(credentialRef), entry);
  await persistTargetCredentialVaultState();

  return {
    credentialRef,
    targetId,
    label: entry.label,
    kind: entry.kind,
    createdAt: entry.createdAt,
    status: entry.status,
    maskedSecret: maskSecret(normalizedPrivateKey),
  };
}

function resolveTargetCredentialRefState(credentialRef) {
  const normalizedRef = typeof credentialRef === "string" ? credentialRef.trim() : "";
  if (!normalizedRef) return undefined;
  return targetCredentialVault.get(targetCredentialRefStorageKey(normalizedRef));
}

function deriveTargetCredentialBundleKey(passphrase, salt) {
  const normalizedPassphrase = typeof passphrase === "string" ? passphrase.trim() : "";
  if (!normalizedPassphrase) {
    throw new Error("Bundle passphrase is required.");
  }
  if (!Buffer.isBuffer(salt) || salt.length < 16) {
    throw new Error("Bundle salt is required.");
  }
  return crypto.pbkdf2Sync(normalizedPassphrase, salt, targetCredentialBundleIterations, 32, "sha256");
}

function encryptTargetCredentialBundlePayload(payload, passphrase) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveTargetCredentialBundleKey(passphrase, salt);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = JSON.stringify(payload);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    version: 1,
    scope: "target-credential-bundle",
    algorithm: "aes-256-gcm",
    kdf: "pbkdf2-sha256",
    iterations: targetCredentialBundleIterations,
    createdAt: nowIso(),
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    payload: Buffer.concat([tag, ciphertext]).toString("base64"),
  };
}

function decryptTargetCredentialBundlePayload(bundle, passphrase) {
  if (!bundle || typeof bundle !== "object") {
    throw new Error("Credential bundle is required.");
  }
  if (bundle.version !== 1 || bundle.scope !== "target-credential-bundle") {
    throw new Error("Unsupported credential bundle format.");
  }
  const salt = typeof bundle.salt === "string" && bundle.salt.trim() ? Buffer.from(bundle.salt, "base64") : Buffer.alloc(0);
  const iv = typeof bundle.iv === "string" && bundle.iv.trim() ? Buffer.from(bundle.iv, "base64") : Buffer.alloc(0);
  const payload = typeof bundle.payload === "string" && bundle.payload.trim() ? Buffer.from(bundle.payload, "base64") : Buffer.alloc(0);
  if (salt.length < 16 || iv.length < 12 || payload.length < 16) {
    throw new Error("Credential bundle payload is invalid.");
  }
  const key = deriveTargetCredentialBundleKey(passphrase, salt);
  const tag = payload.subarray(0, 16);
  const ciphertext = payload.subarray(16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  const parsed = JSON.parse(plaintext);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Credential bundle payload is invalid.");
  }
  return parsed;
}

function normalizeCredentialBundleSecrets(secrets = []) {
  if (!Array.isArray(secrets)) return [];
  return secrets
    .map((entry) => {
      if (!entry || typeof entry !== "object") return undefined;
      const targetId = typeof entry.targetId === "string" ? entry.targetId.trim() : "";
      const secret = typeof entry.secret === "string" ? entry.secret.trim() : "";
      if (!targetId || !secret) return undefined;
      return {
        targetId,
        targetName: typeof entry.targetName === "string" ? entry.targetName.trim() : "",
        label: typeof entry.label === "string" ? entry.label.trim() : "",
        kind: typeof entry.kind === "string" && entry.kind.trim() ? entry.kind.trim() : "ssh-private-key",
        credentialRef: typeof entry.credentialRef === "string" ? entry.credentialRef.trim() : "",
        secret,
      };
    })
    .filter(Boolean);
}

async function createTargetCredentialBundleState({ targetIds, passphrase } = {}) {
  const requestedTargetIds = Array.isArray(targetIds)
    ? targetIds.map((targetId) => (typeof targetId === "string" ? targetId.trim() : "")).filter(Boolean)
    : [];
  const targets = requestedTargetIds.length > 0
    ? targetRegistry.targets.filter((target) => requestedTargetIds.includes(target.id))
    : targetRegistry.targets;
  const normalizedTargets = targets.map((target) => cloneTargetProfileState(target));
  const credentialSecrets = [];

  for (const target of normalizedTargets) {
    const credentialRef = target.connection?.credentialRef?.trim() ?? "";
    if (target.connection?.credentialMode !== "secret-ref" || !credentialRef) {
      continue;
    }
    const entry = resolveTargetCredentialRefState(credentialRef);
    if (!entry) {
      throw new Error(`Credential ref ${credentialRef} is not registered in the gateway vault.`);
    }
    const secret = entry.privateKey ?? (entry.cipherText ? await decryptTargetCredentialSecret(entry.cipherText) : "");
    if (!secret.trim()) {
      throw new Error(`Credential ref ${credentialRef} does not contain decryptable secret material.`);
    }
    credentialSecrets.push({
      targetId: target.id,
      targetName: target.displayName,
      label: entry.label ?? target.displayName,
      kind: entry.kind,
      credentialRef,
      secret: secret.trim(),
    });
  }

  const payload = {
    version: 1,
    createdAt: nowIso(),
    registry: {
      targets: normalizedTargets,
      defaultTargetId: requestedTargetIds.length > 0 && requestedTargetIds.includes(targetRegistry.defaultTargetId ?? "")
        ? targetRegistry.defaultTargetId
        : targetRegistry.defaultTargetId,
      targetGroups: Array.isArray(targetRegistry.targetGroups) ? targetRegistry.targetGroups.map((group) => ({
        ...group,
        targetIds: group.targetIds.filter((targetId) => requestedTargetIds.length > 0 ? requestedTargetIds.includes(targetId) : true),
      })).filter((group) => group.targetIds.length > 0) : [],
    },
    credentialSecrets,
  };

  return {
    bundle: encryptTargetCredentialBundlePayload(payload, passphrase),
    targetCount: normalizedTargets.length,
    secretCount: credentialSecrets.length,
  };
}

async function applyTargetCredentialBundleState(bundle, passphrase) {
  const payload = decryptTargetCredentialBundlePayload(bundle, passphrase);
  if (!payload || typeof payload !== "object" || payload.version !== 1) {
    throw new Error("Unsupported credential bundle payload.");
  }

  const importedRegistry = normalizeTargetRegistryState(payload.registry);
  const importedSecrets = normalizeCredentialBundleSecrets(payload.credentialSecrets);

  for (const secretEntry of importedSecrets) {
    await issueTargetCredentialRefState({
      targetId: secretEntry.targetId,
      label: secretEntry.label,
      kind: secretEntry.kind,
      privateKey: secretEntry.secret,
    });
  }

  const mergedTargets = targetRegistry.targets.slice();
  for (const importedTarget of importedRegistry.targets) {
    const existingIndex = mergedTargets.findIndex((target) => target.id === importedTarget.id);
    if (existingIndex >= 0) {
      mergedTargets[existingIndex] = importedTarget;
    } else {
      mergedTargets.push(importedTarget);
    }
  }

  targetRegistry = normalizeTargetRegistryState({
    targets: mergedTargets,
    defaultTargetId: importedRegistry.defaultTargetId ?? targetRegistry.defaultTargetId,
    targetGroups: importedRegistry.targetGroups ?? targetRegistry.targetGroups,
  });
  scheduleStateSave();
  audit("targets.credential-bundle.import", {
    targetCount: importedRegistry.targets.length,
    secretCount: importedSecrets.length,
  });

  return {
    allowed: true,
    reason: "Credential bundle imported.",
    registry: cloneTargetRegistryState(targetRegistry),
    targetCount: importedRegistry.targets.length,
    secretCount: importedSecrets.length,
  };
}

async function resolveTargetCredentialSecretText(target) {
  const credentialRef = target.connection?.credentialRef?.trim() ?? "";
  if (target.connection?.credentialMode !== "secret-ref" || !credentialRef) {
    return "";
  }

  const entry = resolveTargetCredentialRefState(credentialRef);
  if (!entry) {
    throw new Error("Credential ref is not registered in the gateway vault.");
  }

  const secretText = entry.privateKey ?? (entry.cipherText ? await decryptTargetCredentialSecret(entry.cipherText) : "");
  if (!secretText.trim()) {
    throw new Error("Credential ref does not contain decryptable secret material.");
  }

  return secretText.trim();
}

function extractTargetHost(target) {
  const endpoint = target.adapters?.[0]?.endpoint ?? "";
  if (!endpoint) return "";

  try {
    const parsed = new URL(endpoint);
    return parsed.hostname.trim();
  } catch {
    return endpoint.replace(/^ssh:\/\//i, "").split(/[/:]/)[0].trim();
  }
}

function buildKnownHostEntry(target) {
  const host = extractTargetHost(target);
  const keyMaterial = target.connection?.knownHostFingerprint?.trim() ?? "";
  if (!host) {
    throw new Error("SSH host name is required to build a known_hosts entry.");
  }
  if (!keyMaterial) {
    throw new Error("SSH host key is required before command execution.");
  }

  if (keyMaterial.startsWith(`${host} `)) {
    return keyMaterial;
  }

  return `${host} ${keyMaterial}`;
}

function pairingTicketStorageKey(code) {
  return String(code ?? "").trim().toLowerCase();
}

function clonePairingTicketState(ticket) {
  return ticket ? { ...ticket } : ticket;
}

function issueTargetPairingTicketState(target, options = {}) {
  const baseTarget = normalizeTargetProfileState(target);
  const now = nowIso();
  const ticket = {
    code: `pair-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
    targetId: baseTarget.id,
    targetName: baseTarget.displayName,
    kind: baseTarget.kind,
    createdAt: now,
    expiresAt: new Date(Date.now() + (Number(options.expiresInMinutes) > 0 ? Number(options.expiresInMinutes) * 60_000 : pairingTicketDefaultTtlMs)).toISOString(),
    redeemedAt: null,
  };
  pairingTickets.set(pairingTicketStorageKey(ticket.code), ticket);
  audit("targets.pairing-ticket.issued", {
    targetId: baseTarget.id,
    targetName: baseTarget.displayName,
    kind: baseTarget.kind,
    expiresAt: ticket.expiresAt,
  });
  return ticket;
}

function resolveTargetPairingTicketState(code) {
  const ticket = pairingTickets.get(pairingTicketStorageKey(code));
  if (!ticket) return null;
  return clonePairingTicketState(ticket);
}

function redeemTargetPairingTicketState(target, code) {
  const baseTarget = normalizeTargetProfileState(target);
  const ticket = resolveTargetPairingTicketState(code);
  const now = nowIso();

  if (!ticket) {
    return {
      allowed: false,
      reason: "Pairing code is invalid or expired.",
      target: baseTarget,
    };
  }

  if (ticket.redeemedAt) {
    return {
      allowed: false,
      reason: "Pairing code has already been redeemed.",
      target: baseTarget,
    };
  }

  if (new Date(ticket.expiresAt).getTime() <= Date.now()) {
    pairingTickets.delete(pairingTicketStorageKey(ticket.code));
    return {
      allowed: false,
      reason: "Pairing code is invalid or expired.",
      target: baseTarget,
    };
  }

  if (ticket.targetId && ticket.targetId !== baseTarget.id) {
    return {
      allowed: false,
      reason: "Pairing code does not match this target.",
      target: baseTarget,
    };
  }

  if (ticket.kind && ticket.kind !== baseTarget.kind) {
    return {
      allowed: false,
      reason: "Pairing code is not valid for this target kind.",
      target: baseTarget,
    };
  }

  const redeemedTicket = {
    ...ticket,
    redeemedAt: now,
  };
  pairingTickets.set(pairingTicketStorageKey(ticket.code), redeemedTicket);
  audit("targets.pairing-ticket.redeemed", {
    targetId: baseTarget.id,
    targetName: baseTarget.displayName,
    kind: baseTarget.kind,
    code: `pairing:${hashForAudit(ticket.code)}`,
  });

  return {
    allowed: true,
    reason: "Pairing code redeemed.",
    target: {
      ...baseTarget,
      paired: true,
      state: "connecting",
      lastSeenAt: now,
    },
    ticket: redeemedTicket,
  };
}

function hostEnrollmentTicketStorageKey(code) {
  return String(code ?? "").trim().toLowerCase();
}

function cloneHostEnrollmentTicketState(ticket) {
  return ticket ? { ...ticket } : ticket;
}

function issueTargetHostEnrollmentTicketState(target, options = {}) {
  const baseTarget = normalizeTargetProfileState(target);
  const now = nowIso();
  const ticket = {
    code: `host-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
    targetId: baseTarget.id,
    targetName: baseTarget.displayName,
    kind: baseTarget.kind,
    hostName: typeof options.hostName === "string" && options.hostName.trim() ? options.hostName.trim() : baseTarget.displayName,
    bridgeVersion: typeof options.bridgeVersion === "string" && options.bridgeVersion.trim() ? options.bridgeVersion.trim() : "1.0.0",
    createdAt: now,
    expiresAt: new Date(Date.now() + (Number(options.expiresInMinutes) > 0 ? Number(options.expiresInMinutes) * 60_000 : pairingTicketDefaultTtlMs)).toISOString(),
    redeemedAt: null,
    bridgeId: `bridge-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
  };
  hostEnrollmentTickets.set(hostEnrollmentTicketStorageKey(ticket.code), ticket);
  audit("targets.host-enrollment-ticket.issued", {
    targetId: baseTarget.id,
    targetName: baseTarget.displayName,
    kind: baseTarget.kind,
    hostName: ticket.hostName,
    bridgeVersion: ticket.bridgeVersion,
    expiresAt: ticket.expiresAt,
  });
  return ticket;
}

function resolveTargetHostEnrollmentTicketState(code) {
  const ticket = hostEnrollmentTickets.get(hostEnrollmentTicketStorageKey(code));
  if (!ticket) return null;
  return cloneHostEnrollmentTicketState(ticket);
}

function redeemTargetHostEnrollmentTicketState(target, code, options = {}) {
  const baseTarget = normalizeTargetProfileState(target);
  const ticket = resolveTargetHostEnrollmentTicketState(code);
  const now = nowIso();

  if (!ticket) {
    return {
      allowed: false,
      reason: "Host enrollment code is invalid or expired.",
      target: baseTarget,
    };
  }

  if (ticket.redeemedAt) {
    return {
      allowed: false,
      reason: "Host enrollment code has already been redeemed.",
      target: baseTarget,
    };
  }

  if (new Date(ticket.expiresAt).getTime() <= Date.now()) {
    hostEnrollmentTickets.delete(hostEnrollmentTicketStorageKey(ticket.code));
    return {
      allowed: false,
      reason: "Host enrollment code is invalid or expired.",
      target: baseTarget,
    };
  }

  if (ticket.targetId && ticket.targetId !== baseTarget.id) {
    return {
      allowed: false,
      reason: "Host enrollment code does not match this target.",
      target: baseTarget,
    };
  }

  if (ticket.kind && ticket.kind !== baseTarget.kind) {
    return {
      allowed: false,
      reason: "Host enrollment code is not valid for this target kind.",
      target: baseTarget,
    };
  }

  const redeemedTicket = {
    ...ticket,
    redeemedAt: now,
  };
  hostEnrollmentTickets.set(hostEnrollmentTicketStorageKey(ticket.code), redeemedTicket);
  audit("targets.host-enrollment-ticket.redeemed", {
    targetId: baseTarget.id,
    targetName: baseTarget.displayName,
    kind: baseTarget.kind,
    code: `host-enrollment:${hashForAudit(ticket.code)}`,
  });

  return {
    allowed: true,
    reason: "Host enrollment code redeemed.",
    target: {
      ...baseTarget,
      paired: true,
      state: "connecting",
      lastSeenAt: now,
    },
    ticket: redeemedTicket,
  };
}

async function ensureTargetKnownHostsFile(target) {
  const knownHostsPath = targetKnownHostsPath(target.id);
  await fs.mkdir(path.dirname(knownHostsPath), { recursive: true });
  const entry = buildKnownHostEntry(target);
  await fs.writeFile(knownHostsPath, `${entry}\n`, "utf8");
  return knownHostsPath;
}

async function materializeTargetCredentialFile(target) {
  if (target.connection?.credentialMode !== "secret-ref" || !target.connection?.credentialRef?.trim()) {
    return null;
  }

  const privateKey = await resolveTargetCredentialSecretText(target);

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "clawdesk-ssh-key-"));
  const privateKeyPath = path.join(tempDir, "id_ed25519");
  await fs.writeFile(privateKeyPath, `${privateKey.trim().replace(/\r\n/g, "\n").replace(/\r/g, "\n")}\n`, "utf8");
  try {
    await fs.chmod(privateKeyPath, 0o600);
  } catch {
    // chmod is best-effort on Windows; ssh.exe still reads the key file.
  }

  return {
    credentialRef: target.connection.credentialRef.trim(),
    kind: resolveTargetCredentialRefState(target.connection.credentialRef)?.kind ?? "ssh-private-key",
    privateKeyPath,
    cleanup: async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    },
  };
}

async function seedRemoteDesktopCredentialState(target) {
  const baseTarget = normalizeTargetProfileState(target);
  if (baseTarget.kind !== "remote-desktop") {
    return {
      allowed: false,
      reason: "This target is not a remote desktop target.",
    };
  }

  if (process.platform !== "win32") {
    return {
      allowed: false,
      reason: "Remote desktop credential seeding is currently supported on Windows only.",
    };
  }

  if (baseTarget.connection?.credentialMode !== "secret-ref" || !baseTarget.connection?.credentialRef?.trim()) {
    return {
      allowed: false,
      reason: "Select secret-ref credentials before seeding the remote desktop client.",
    };
  }

  if (!baseTarget.connection.username) {
    return {
      allowed: false,
      reason: "Connection username is required before seeding remote desktop credentials.",
    };
  }

  const secretText = await resolveTargetCredentialSecretText(baseTarget);
  const host = extractTargetHost(baseTarget) || baseTarget.adapters[0]?.endpoint || baseTarget.displayName;
  const genericTarget = `TERMSRV/${host}`;
  const seedResult = await spawnAndCollect("cmdkey", [
    `/generic:${genericTarget}`,
    `/user:${baseTarget.connection.username}`,
    `/pass:${secretText}`,
  ]);

  if (!seedResult.ok || (typeof seedResult.exitCode === "number" && seedResult.exitCode !== 0)) {
    return {
      allowed: false,
      reason: seedResult.error || seedResult.stderr || "Failed to seed remote desktop credentials.",
      target: baseTarget,
    };
  }

  return {
    allowed: true,
    reason: "Remote desktop credential seeded.",
    target: baseTarget,
    credentialSource: baseTarget.connection.credentialMode,
    credentialSeedState: "prepared",
    credentialTarget: genericTarget,
  };
}

function spawnAndCollect(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env ?? {}) },
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > 32_768) {
        stdout = `${stdout.slice(0, 32_000)}…[truncated]`;
      }
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > 32_768) {
        stderr = `${stderr.slice(0, 32_000)}…[truncated]`;
      }
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      resolve({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        stdout,
        stderr,
        exitCode: null,
      });
    });
    child.on("close", (exitCode) => {
      if (settled) return;
      settled = true;
      resolve({
        ok: true,
        stdout,
        stderr,
        exitCode: typeof exitCode === "number" ? exitCode : null,
      });
    });

    if (typeof options.input === "string" && options.input.length > 0) {
      child.stdin?.write(options.input);
    }
    child.stdin?.end();
  });
}

async function executeTargetCommandState(target, command) {
  const now = nowIso();
  const baseTarget = normalizeTargetProfileState(target);
  const adapter = Array.isArray(baseTarget.adapters) ? baseTarget.adapters[0] : undefined;
  const normalizedCommand = typeof command === "string" ? command.trim() : "";

  if (!normalizedCommand) {
    return { allowed: false, reason: "A command is required.", target: baseTarget };
  }

  const commandSafety = classifyShellCommandState(normalizedCommand);
  if (commandSafety === "blocked") {
    return {
      allowed: false,
      reason: "The requested command is blocked by the safe-dispatch policy.",
      target: baseTarget,
    };
  }

  if (commandSafety === "needs-review") {
    return {
      allowed: false,
      reason: "The requested command needs human review before execution.",
      target: baseTarget,
    };
  }

  if (!adapter) {
    return { allowed: false, reason: "This target does not expose a connection adapter.", target: baseTarget };
  }

  if (baseTarget.kind !== "local-shell" && baseTarget.kind !== "mock" && baseTarget.state !== "ready") {
    return {
      allowed: false,
      reason: "This target is not ready for command execution yet.",
      target: baseTarget,
    };
  }

  if (baseTarget.kind === "ssh-terminal") {
    const readinessIssues = targetConnectionReadinessIssuesState(baseTarget);
    if (readinessIssues.length > 0) {
      return {
        allowed: false,
        reason: readinessIssues[0],
        target: baseTarget,
      };
    }

    if (!baseTarget.connection.username) {
      return {
        allowed: false,
        reason: "SSH username is required.",
        target: baseTarget,
      };
    }

    if (baseTarget.connection.credentialMode === "none") {
      return {
        allowed: false,
        reason: "SSH command execution requires ssh-agent or platform-managed credentials.",
        target: baseTarget,
      };
    }

    const knownHostsPath = await ensureTargetKnownHostsFile(baseTarget);
    const host = extractTargetHost(baseTarget);
    const sshExecutable = process.platform === "win32" ? "ssh.exe" : "ssh";
    const remoteTarget = `${baseTarget.connection.username}@${host}`;
    const credentialMaterial = await materializeTargetCredentialFile(baseTarget);
    try {
      const sshArgs = [
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=yes",
        "-o",
        `UserKnownHostsFile=${knownHostsPath}`,
        "-o",
        `GlobalKnownHostsFile=${process.platform === "win32" ? "NUL" : "/dev/null"}`,
        "-o",
        "ConnectTimeout=10",
      ];
      if (credentialMaterial) {
        sshArgs.push("-o", "IdentitiesOnly=yes", "-i", credentialMaterial.privateKeyPath);
      }
      sshArgs.push("-p", String(baseTarget.connection.port ?? 22), remoteTarget, normalizedCommand);
      const execution = await spawnAndCollect(sshExecutable, sshArgs, { cwd: homeDir });

      if (!execution.ok) {
        return {
          allowed: false,
          reason: execution.error || "Failed to start the SSH client.",
          target: baseTarget,
        };
      }

      const nextTarget = {
        ...baseTarget,
        lastSeenAt: now,
      };
      return {
        allowed: true,
        reason: execution.exitCode === 0 ? "SSH command executed successfully." : "SSH command finished with a non-zero exit code.",
        target: nextTarget,
        execution: {
          mode: "ssh-terminal",
          credentialSource: baseTarget.connection.credentialMode,
          command: normalizedCommand,
          stdout: execution.stdout,
          stderr: execution.stderr,
          exitCode: execution.exitCode,
          startedAt: now,
          finishedAt: nowIso(),
          targetId: baseTarget.id,
          targetName: baseTarget.displayName,
        },
      };
    } finally {
      if (credentialMaterial) {
        await credentialMaterial.cleanup().catch(() => undefined);
      }
    }
  }

  if (baseTarget.kind === "mock") {
    return {
      allowed: true,
      reason: "Mock target simulated the safe command.",
      target: {
        ...baseTarget,
        lastSeenAt: now,
      },
      execution: {
        mode: "mock",
        command: normalizedCommand,
        stdout: `Mock execution: ${normalizedCommand}\n`,
        stderr: "",
        exitCode: 0,
        startedAt: now,
        finishedAt: now,
        targetId: baseTarget.id,
        targetName: baseTarget.displayName,
      },
    };
  }

  const localShellExecutable = process.platform === "win32" ? "powershell.exe" : "sh";
  const localShellArgs =
    process.platform === "win32"
      ? ["-NoProfile", "-NonInteractive", "-Command", normalizedCommand]
      : ["-lc", normalizedCommand];
  let localShellCwd = homeDir;
  try {
    await fs.access(projectRoot);
    localShellCwd = projectRoot;
  } catch {
    localShellCwd = homeDir;
  }
  const execution = await spawnAndCollect(localShellExecutable, localShellArgs, { cwd: localShellCwd });

  if (!execution.ok) {
    return {
      allowed: false,
      reason: execution.error || "Failed to start the local shell.",
      target: baseTarget,
    };
  }

  return {
    allowed: true,
    reason: execution.exitCode === 0 ? "Local shell command executed successfully." : "Local shell command finished with a non-zero exit code.",
    target: {
      ...baseTarget,
      lastSeenAt: now,
    },
    execution: {
      mode: "local-shell",
      command: normalizedCommand,
      stdout: execution.stdout,
      stderr: execution.stderr,
      exitCode: execution.exitCode,
      startedAt: now,
      finishedAt: nowIso(),
      targetId: baseTarget.id,
      targetName: baseTarget.displayName,
    },
  };
}

function updatePrimaryTargetAdapterState(target, updater) {
  const cloned = cloneTargetProfileState(target);
  const [primaryAdapter, ...restAdapters] = Array.isArray(cloned.adapters) ? cloned.adapters : [];
  if (!primaryAdapter) return cloned;
  const updatedPrimary = updater({ ...primaryAdapter });
  return {
    ...cloned,
    adapters: [updatedPrimary, ...restAdapters.map((adapter) => ({ ...adapter }))],
  };
}

function resolveTargetConnectivityProbeState(target) {
  const baseTarget = normalizeTargetProfileState(target);
  const adapter = Array.isArray(baseTarget.adapters) ? baseTarget.adapters[0] : undefined;
  const endpointSource = typeof baseTarget.endpoint === "string" && baseTarget.endpoint.trim()
    ? baseTarget.endpoint.trim()
    : typeof adapter?.endpoint === "string"
      ? adapter.endpoint.trim()
      : "";
  const endpoint = endpointSource;
  const fallbackPort = baseTarget.kind === "remote-desktop" ? 3389 : 22;
  let host = "";
  let port = Number.isFinite(baseTarget.connection?.port) ? Number(baseTarget.connection.port) : fallbackPort;

  if (!endpoint) {
    return { allowed: false, reason: "Endpoint is required for connectivity probe.", target: baseTarget };
  }

  try {
    const url = new URL(endpoint);
    host = url.hostname || url.host || endpoint;
    if (url.port) {
      const parsedPort = Number.parseInt(url.port, 10);
      if (Number.isFinite(parsedPort) && parsedPort > 0) {
        port = parsedPort;
      }
    }
  } catch {
    host = endpoint.replace(/^[a-z]+:\/\//i, "");
  }

  if (!host) {
    return { allowed: false, reason: "Endpoint host is required for connectivity probe.", target: baseTarget };
  }

  return { allowed: true, reason: "Endpoint parsed for connectivity probe.", target: baseTarget, host, port };
}

function probeTcpReachability(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const socket = net.createConnection({ host, port });
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => {
      finish({ reachable: true, latencyMs: Date.now() - startedAt });
    });
    socket.once("timeout", () => {
      finish({ reachable: false, error: `Probe timed out after ${timeoutMs}ms.` });
    });
    socket.once("error", (error) => {
      finish({ reachable: false, error: error instanceof Error ? error.message : "Probe failed." });
    });
  });
}

async function applyTargetConnectionActionState(target, action, options = {}) {
  const now = nowIso();
  const baseTarget = normalizeTargetProfileState(target);
  const adapter = Array.isArray(baseTarget.adapters) ? baseTarget.adapters[0] : undefined;

  if (!adapter) {
    return { allowed: false, reason: "This target does not expose a connection adapter.", target: baseTarget };
  }

  if (action === "disconnect") {
    return {
      allowed: true,
      reason: "The target was marked offline.",
      target: {
        ...baseTarget,
        state: "offline",
        lastSeenAt: now,
      },
    };
  }

  if (action === "refresh") {
    return {
      allowed: true,
      reason: "The target status was refreshed.",
      target: {
        ...baseTarget,
        lastSeenAt: now,
      },
    };
  }

  if (action === "enroll_host") {
    const enrollmentCode = typeof options.enrollmentCode === "string" ? options.enrollmentCode.trim() : "";
    if (!enrollmentCode) {
      return {
        allowed: false,
        reason: "A host enrollment code is required.",
        target: baseTarget,
      };
    }

    const redeemedTicket = redeemTargetHostEnrollmentTicketState(baseTarget, enrollmentCode, options);
    if (!redeemedTicket.allowed) {
      return redeemedTicket;
    }

    const hostBridge = {
      state: "registered",
      bridgeId: redeemedTicket.ticket?.bridgeId ?? `${baseTarget.id}-bridge`,
      hostName:
        redeemedTicket.ticket?.hostName?.trim() ||
        (typeof options.hostName === "string" && options.hostName.trim() ? options.hostName.trim() : baseTarget.displayName),
      bridgeVersion:
        redeemedTicket.ticket?.bridgeVersion?.trim() ||
        (typeof options.bridgeVersion === "string" && options.bridgeVersion.trim() ? options.bridgeVersion.trim() : "1.0.0"),
      deviceId: redeemedTicket.target.connection.hostBridge?.deviceId ?? `${baseTarget.id}-device`,
      installId: redeemedTicket.target.connection.hostBridge?.installId ?? `${baseTarget.id}-install`,
      platform: redeemedTicket.target.connection.hostBridge?.platform ?? os.platform(),
      registeredAt: redeemedTicket.ticket?.redeemedAt ?? now,
      attestedAt: redeemedTicket.ticket?.redeemedAt ?? now,
      lastSeenAt: now,
      lastError: undefined,
      lastAttestationError: undefined,
    };

    return {
      allowed: true,
      reason: "The host bridge was enrolled and moved into connecting state.",
      target: updatePrimaryTargetAdapterState(
        {
          ...redeemedTicket.target,
          paired: true,
          state: "connecting",
          lastSeenAt: now,
          connection: {
            ...redeemedTicket.target.connection,
            hostBridge,
          },
        },
        (current) => ({
          ...current,
          authenticated: true,
          hostKeyVerified: baseTarget.kind === "ssh-terminal" ? false : current.hostKeyVerified,
        }),
      ),
      ticket: redeemedTicket.ticket,
    };
  }

  if (action === "attest") {
    if (baseTarget.connection.hostBridge?.state !== "registered") {
      return {
        allowed: false,
        reason: "Enroll the host bridge before attesting its identity.",
        target: baseTarget,
      };
    }

    const bridgeId = typeof options.bridgeId === "string" ? options.bridgeId.trim() : "";
    if (bridgeId && baseTarget.connection.hostBridge.bridgeId && bridgeId !== baseTarget.connection.hostBridge.bridgeId) {
      return {
        allowed: false,
        reason: "The host bridge identity does not match this target.",
        target: baseTarget,
      };
    }

    const deviceId = typeof options.deviceId === "string" && options.deviceId.trim() ? options.deviceId.trim() : baseTarget.connection.hostBridge.deviceId || `${baseTarget.id}-device`;
    const installId = typeof options.installId === "string" && options.installId.trim() ? options.installId.trim() : baseTarget.connection.hostBridge.installId || `${baseTarget.id}-install`;
    const platform = typeof options.platform === "string" && options.platform.trim() ? options.platform.trim() : baseTarget.connection.hostBridge.platform || os.platform();

    return {
      allowed: true,
      reason: "The host bridge identity was attested.",
      target: updatePrimaryTargetAdapterState(
        {
          ...baseTarget,
          state: baseTarget.state === "offline" ? "connecting" : baseTarget.state,
          lastSeenAt: now,
          connection: {
            ...baseTarget.connection,
            hostBridge: {
              ...baseTarget.connection.hostBridge,
              state: "registered",
              bridgeId: baseTarget.connection.hostBridge.bridgeId ?? `${baseTarget.id}-bridge`,
              hostName: options.hostName?.trim() || baseTarget.connection.hostBridge.hostName || baseTarget.displayName,
              bridgeVersion: options.bridgeVersion?.trim() || baseTarget.connection.hostBridge.bridgeVersion || "1.0.0",
              deviceId,
              installId,
              platform,
              registeredAt: baseTarget.connection.hostBridge.registeredAt ?? now,
              attestedAt: now,
              lastSeenAt: now,
              lastError: undefined,
              lastAttestationError: undefined,
            },
          },
        },
        (current) => ({
          ...current,
          authenticated: true,
          hostKeyVerified: current.hostKeyVerified,
        }),
      ),
      action,
    };
  }

  if (action === "heartbeat") {
    if (baseTarget.connection.hostBridge?.state !== "registered") {
      return {
        allowed: false,
        reason: "Enroll the host bridge before reporting a heartbeat.",
        target: baseTarget,
      };
    }

    const bridgeId = typeof options.bridgeId === "string" ? options.bridgeId.trim() : "";
    if (bridgeId && baseTarget.connection.hostBridge.bridgeId && bridgeId !== baseTarget.connection.hostBridge.bridgeId) {
      return {
        allowed: false,
        reason: "The host bridge identity does not match this target.",
        target: baseTarget,
      };
    }

    return {
      allowed: true,
      reason: "The host bridge heartbeat was recorded.",
      target: updatePrimaryTargetAdapterState(
        {
          ...baseTarget,
          state: baseTarget.state === "offline" ? "connecting" : baseTarget.state,
          lastSeenAt: now,
          connection: {
            ...baseTarget.connection,
            hostBridge: {
              ...baseTarget.connection.hostBridge,
              state: "registered",
              bridgeId: baseTarget.connection.hostBridge.bridgeId ?? `${baseTarget.id}-bridge`,
              hostName: options.hostName?.trim() || baseTarget.connection.hostBridge.hostName || baseTarget.displayName,
              bridgeVersion: options.bridgeVersion?.trim() || baseTarget.connection.hostBridge.bridgeVersion || "1.0.0",
              registeredAt: baseTarget.connection.hostBridge.registeredAt ?? now,
              lastSeenAt: now,
              lastError: undefined,
            },
          },
        },
        (current) => ({
          ...current,
          authenticated: true,
          hostKeyVerified: current.hostKeyVerified,
        }),
      ),
      action,
    };
  }

  if (action === "probe") {
    const probeState = resolveTargetConnectivityProbeState(baseTarget);
    if (!probeState.allowed) {
      return probeState;
    }

    if (baseTarget.kind === "local-shell" || baseTarget.kind === "mock") {
      return {
        allowed: true,
        reason: "Local target connectivity probe succeeded.",
        target: {
          ...baseTarget,
          state: "ready",
          lastSeenAt: now,
          connection: {
            ...baseTarget.connection,
            lastProbeAt: now,
            lastProbeResult: "reachable",
            lastProbeHost: probeState.host,
            lastProbePort: probeState.port,
            lastProbeLatencyMs: 0,
            lastProbeError: undefined,
          },
        },
      };
    }

    const result = await probeTcpReachability(probeState.host, probeState.port, 3000);
    return {
      allowed: true,
      reason: result.reachable
        ? `Connectivity probe succeeded for ${probeState.host}:${probeState.port}.`
        : result.error || `Connectivity probe failed for ${probeState.host}:${probeState.port}.`,
      target: {
        ...baseTarget,
        state: result.reachable ? "ready" : "degraded",
        lastSeenAt: now,
        connection: {
          ...baseTarget.connection,
          lastProbeAt: now,
          lastProbeResult: result.reachable ? "reachable" : result.error ? "error" : "unreachable",
          lastProbeHost: probeState.host,
          lastProbePort: probeState.port,
          lastProbeLatencyMs: result.reachable ? result.latencyMs : undefined,
          lastProbeError: result.reachable ? undefined : result.error,
        },
      },
    };
  }

  if (action === "pair") {
    if (baseTarget.kind === "local-shell" || baseTarget.kind === "mock") {
      return {
        allowed: true,
        reason: "Local targets remain paired and ready.",
        target: {
          ...baseTarget,
          paired: true,
          state: "ready",
          lastSeenAt: now,
          adapters: baseTarget.adapters.map((item) => ({
            ...item,
            authenticated: true,
            hostKeyVerified: true,
          })),
        },
      };
    }

    const pairingCode = typeof options.pairingCode === "string" ? options.pairingCode.trim() : "";
    if (pairingCode) {
      const redeemedTicket = redeemTargetPairingTicketState(baseTarget, pairingCode);
      if (!redeemedTicket.allowed) {
        return redeemedTicket;
      }

      return {
        allowed: true,
        reason: "The target was paired through a pairing code and moved into connecting state.",
        target: updatePrimaryTargetAdapterState(
          {
            ...redeemedTicket.target,
            paired: true,
            state: "connecting",
            lastSeenAt: now,
          },
          (current) => ({
            ...current,
            authenticated: true,
            hostKeyVerified: baseTarget.kind === "ssh-terminal" ? false : current.hostKeyVerified,
          }),
        ),
      };
    }

    return {
      allowed: true,
      reason: "The target was paired and moved into connecting state.",
      target: updatePrimaryTargetAdapterState(
        {
          ...baseTarget,
          paired: true,
          state: "connecting",
          lastSeenAt: now,
        },
        (current) => ({
          ...current,
          authenticated: true,
          hostKeyVerified: baseTarget.kind === "ssh-terminal" ? false : current.hostKeyVerified,
        }),
      ),
    };
  }

  if (action === "verify_host_key") {
    if (baseTarget.kind !== "ssh-terminal") {
      return {
        allowed: false,
        reason: "SSH host-key verification only applies to SSH targets.",
        target: baseTarget,
      };
    }

    if (!baseTarget.paired) {
      return {
        allowed: false,
        reason: "Pair the SSH target before verifying its host key.",
        target: baseTarget,
      };
    }

    if (!baseTarget.connection.knownHostFingerprint) {
      return {
        allowed: false,
        reason: "Record the SSH host key before verification.",
        target: baseTarget,
      };
    }

    await ensureTargetKnownHostsFile(baseTarget);

    return {
      allowed: true,
      reason: "SSH host key verified and stored in the gateway-managed known_hosts file.",
      target: updatePrimaryTargetAdapterState(
        {
          ...baseTarget,
          state: baseTarget.state === "offline" ? "connecting" : baseTarget.state,
          lastSeenAt: now,
        },
        (current) => ({
          ...current,
          authenticated: true,
          hostKeyVerified: true,
        }),
      ),
    };
  }

  if (action === "connect") {
    if (baseTarget.kind !== "local-shell" && !baseTarget.paired) {
      return {
        allowed: false,
        reason: "Remote targets must be paired before connecting.",
        target: baseTarget,
      };
    }

    const readinessIssues = targetConnectionReadinessIssuesState(baseTarget);
    if (readinessIssues.length > 0) {
      return {
        allowed: false,
        reason: readinessIssues[0],
        target: baseTarget,
      };
    }

    if ((baseTarget.kind === "ssh-terminal" || baseTarget.kind === "remote-desktop") && !adapter.authenticated) {
      return {
        allowed: false,
        reason: "Remote targets must be authenticated before connecting.",
        target: baseTarget,
      };
    }

    if (baseTarget.kind === "ssh-terminal" && !adapter.hostKeyVerified) {
      return {
        allowed: false,
        reason: "SSH host key verification must be completed before connecting.",
        target: baseTarget,
      };
    }

    return {
      allowed: true,
      reason: "The target is now marked ready for dispatch.",
      target: {
        ...baseTarget,
        paired: true,
        state: "ready",
        lastSeenAt: now,
      },
    };
  }

  return {
    allowed: false,
    reason: "Unknown connection action.",
    target: baseTarget,
  };
}

function remoteDesktopSessionStorageKey(targetId) {
  return sanitizeTargetStorageKey(targetId);
}

function remoteDesktopLaunchRuntimeKey(targetId) {
  return remoteDesktopSessionStorageKey(targetId);
}

function getRemoteDesktopLaunchRuntime(targetId) {
  return cloneRemoteDesktopLaunchRuntime(remoteDesktopLaunchRuntimes.get(remoteDesktopLaunchRuntimeKey(targetId)));
}

function clearRemoteDesktopLaunchRuntime(targetId) {
  remoteDesktopLaunchRuntimes.delete(remoteDesktopLaunchRuntimeKey(targetId));
}

function cloneRemoteDesktopSessionState(session) {
  return {
    ...session,
    visibleWindows: Array.isArray(session.visibleWindows) ? [...session.visibleWindows] : [],
    notes: Array.isArray(session.notes) ? [...session.notes] : [],
    launchHistory: Array.isArray(session.launchHistory) ? session.launchHistory.map((entry) => ({ ...entry })) : [],
  };
}

function cloneRemoteDesktopLaunchRuntime(runtime) {
  return runtime
    ? {
        ...runtime,
      }
    : runtime;
}

function isProcessAlive(pid) {
  if (typeof pid !== "number" || !Number.isFinite(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function buildRemoteDesktopSessionSummary(target, session) {
  const stateLabel =
    session.state === "controlling"
      ? "控制中"
      : session.state === "control-pending"
        ? "等待控制審批"
        : session.state === "released"
          ? "控制已釋放"
          : "觀察中";
  const visibleCount = Array.isArray(session.visibleWindows) ? session.visibleWindows.length : 0;
  const activeWindow = session.activeWindow || defaultRemoteDesktopVisibleWindows(target)[0];
  const launchLabel =
    session.clientLaunchState && session.clientLaunchState !== "idle"
      ? `client ${session.clientLaunchState}`
      : "client idle";
  const credentialLabel =
    session.credentialSource === "secret-ref"
      ? `credential ${session.credentialSeedState === "prepared" ? "prepared" : session.credentialSeedState ?? "pending"}`
      : `credential ${session.credentialSource ?? "none"}`;
  return [
    `${target.displayName} 遠端桌面 ${stateLabel}`,
    `視窗 ${visibleCount} 個`,
    `active ${activeWindow}`,
    credentialLabel,
    launchLabel,
  ].join(" · ");
}

function withRemoteDesktopSessionSummary(target, session) {
  return {
    ...session,
    sessionSummary: buildRemoteDesktopSessionSummary(target, session),
  };
}

function defaultRemoteDesktopVisibleWindows(target) {
  const host = extractTargetHost(target) || target.endpoint || target.displayName;
  return [
    `${target.displayName} 主視窗`,
    `${target.displayName} 工具列`,
    `${host} · 安全會話`,
  ];
}

function createRemoteDesktopSessionState(target, now = nowIso()) {
  const visibleWindows = defaultRemoteDesktopVisibleWindows(target);
  const sessionId = `rds_${crypto
    .createHash("sha256")
    .update(`clawdesk-remote-desktop:${target.id}`)
    .digest("hex")
    .slice(0, 24)}`;
  return withRemoteDesktopSessionSummary(target, {
    sessionId,
    targetId: target.id,
    targetName: target.displayName,
    endpoint: target.adapters[0]?.endpoint ?? target.endpoint,
    transport: "gateway-remote-desktop-contract",
    state: "idle",
    mode: target.connection?.sessionMode ?? "observe",
    credentialSource: target.connection?.credentialMode ?? "none",
    credentialSeedState: "idle",
    activeWindow: visibleWindows[0],
    visibleWindows,
    screenSummary: `遠端桌面契約已準備好：${target.displayName}。`,
    sessionSummary: `遠端桌面 ${target.displayName} 已就緒。`,
    notes: ["等待 observe_screen 或 request_control。"],
    launchHistory: [],
    lastUpdatedAt: now,
  });
}

function getRemoteDesktopSessionState(target) {
  const key = remoteDesktopSessionStorageKey(target.id);
  const current = remoteDesktopSessions.get(key);
  if (current) {
    return cloneRemoteDesktopSessionState(current);
  }
  const created = createRemoteDesktopSessionState(target);
  remoteDesktopSessions.set(key, created);
  return cloneRemoteDesktopSessionState(created);
}

function refreshRemoteDesktopSessionState(target, session, now = nowIso()) {
  const visibleWindows = defaultRemoteDesktopVisibleWindows(target);
  const nextState =
    session.state === "controlling"
      ? "controlling"
      : session.state === "control-pending"
        ? "control-pending"
        : "observing";
  const nextMode = nextState === "controlling" || nextState === "control-pending" ? "control" : "observe";
  const launchRuntime = getRemoteDesktopLaunchRuntime(target.id);
  const runtimeAlive = launchRuntime ? isProcessAlive(launchRuntime.pid) : false;
  const nextClientLaunchState =
    session.clientLaunchState === "launched" && launchRuntime && !runtimeAlive
      ? "failed"
      : session.clientLaunchState ?? "idle";
  const nextClientLaunchPid =
    session.clientLaunchState === "launched" && launchRuntime && !runtimeAlive
      ? session.clientLaunchPid ?? launchRuntime.pid ?? null
      : session.clientLaunchPid ?? launchRuntime?.pid ?? null;
  const nextClientLaunchError =
    session.clientLaunchState === "launched" && launchRuntime && !runtimeAlive
      ? session.clientLaunchError ?? `Remote desktop client process ${launchRuntime.pid} is no longer running.`
      : session.clientLaunchError;
  return withRemoteDesktopSessionSummary(target, {
    ...session,
    endpoint: target.adapters[0]?.endpoint ?? target.endpoint,
    targetName: target.displayName,
    state: nextState,
    mode: nextMode,
    credentialSource: session.credentialSource ?? target.connection?.credentialMode ?? "none",
    credentialSeedState: session.credentialSeedState ?? "idle",
    activeWindow: session.activeWindow && nextState === "controlling" ? session.activeWindow : visibleWindows[0],
    visibleWindows,
    screenSummary: `Gateway 遠端桌面契約觀察：${target.displayName} · ${extractTargetHost(target) || target.endpoint}.`,
    sessionSummary: buildRemoteDesktopSessionSummary(target, session),
    launchHistory: Array.isArray(session.launchHistory) ? [...session.launchHistory] : [],
    clientLaunchState: nextClientLaunchState,
    clientLaunchPid: nextClientLaunchPid,
    clientLaunchError: nextClientLaunchError,
    lastObservedAt: now,
    lastUpdatedAt: now,
    notes: [...session.notes.slice(-4), `Observation refreshed at ${now}.`],
  });
}

function buildRemoteDesktopLaunchSpec(target) {
  const host = extractTargetHost(target) || target.adapters[0]?.endpoint || target.displayName;
  const port = Number(target.connection?.port ?? 3389);
  const endpoint = port > 0 ? `${host}:${port}` : host;
  if (remoteDesktopClientExecutableOverride) {
    let args = [];
    if (remoteDesktopClientArgsOverrideJson) {
      try {
        const parsed = JSON.parse(remoteDesktopClientArgsOverrideJson);
        if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
          args = parsed;
        }
      } catch {
        // Fallback to default args if the override is malformed.
      }
    }
    return {
      executable: remoteDesktopClientExecutableOverride,
      args,
      command: [remoteDesktopClientExecutableOverride, ...args].join(" ").trim(),
      transport: "native-rdp-client",
    };
  }

  if (process.platform === "win32") {
    return {
      executable: "mstsc.exe",
      args: [`/v:${endpoint}`],
      command: `mstsc.exe /v:${endpoint}`,
      transport: "native-rdp-client",
    };
  }

  return {
    executable: "xfreerdp",
    args: [`/v:${endpoint}`],
    command: `xfreerdp /v:${endpoint}`,
    transport: "native-rdp-client",
  };
}

function buildRemoteDesktopCredentialTarget(target) {
  const host = extractTargetHost(target) || target.adapters[0]?.endpoint || target.displayName;
  return `TERMSRV/${host}`;
}

function spawnDetachedProcess(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env ?? {}) },
      shell: false,
      windowsHide: true,
      detached: true,
      stdio: "ignore",
    });

    let settled = false;
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      resolve({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        pid: null,
      });
    });
    child.once("spawn", () => {
      if (settled) return;
      settled = true;
      try {
        child.unref();
      } catch {
        // unref is best effort for GUI transports.
      }
      resolve({
        ok: true,
        pid: typeof child.pid === "number" ? child.pid : null,
      });
    });
  });
}

function markRemoteDesktopTargetActive(target, now = nowIso()) {
  return updatePrimaryTargetAdapterState(
    {
      ...target,
      paired: true,
      state: "ready",
      lastSeenAt: now,
    },
    (current) => ({
      ...current,
      authenticated: true,
    }),
  );
}

function observeRemoteDesktopSessionState(target) {
  const baseTarget = normalizeTargetProfileState(target);
  if (baseTarget.kind !== "remote-desktop") {
    return { allowed: false, reason: "This target is not a remote desktop target.", target: baseTarget };
  }

  const readinessIssues = targetConnectionReadinessIssuesState(baseTarget);
  if (readinessIssues.length > 0) {
    return { allowed: false, reason: readinessIssues[0], target: baseTarget };
  }

  const now = nowIso();
  const session = refreshRemoteDesktopSessionState(baseTarget, getRemoteDesktopSessionState(baseTarget), now);
  remoteDesktopSessions.set(remoteDesktopSessionStorageKey(baseTarget.id), session);
  return {
    allowed: true,
    reason: "Remote desktop session snapshot refreshed.",
    target: markRemoteDesktopTargetActive(baseTarget, now),
    session,
  };
}

function requestRemoteDesktopControlState(target) {
  const baseTarget = normalizeTargetProfileState(target);
  if (baseTarget.kind !== "remote-desktop") {
    return { allowed: false, reason: "This target is not a remote desktop target.", target: baseTarget };
  }

  const readinessIssues = targetConnectionReadinessIssuesState(baseTarget);
  if (readinessIssues.length > 0) {
    return { allowed: false, reason: readinessIssues[0], target: baseTarget };
  }

  const now = nowIso();
  const currentSession = refreshRemoteDesktopSessionState(baseTarget, getRemoteDesktopSessionState(baseTarget), now);
  const permissionRequest = {
    type: "permission.request",
    requestId: crypto.randomUUID(),
    action: "remote-desktop.request-control",
    target: baseTarget.displayName,
    targetId: baseTarget.id,
    sessionId: currentSession.sessionId,
    risk: "high",
    summary: `${baseTarget.displayName} 的遠端桌面控制權需要人工授權。`,
  };
  const nextSession = withRemoteDesktopSessionSummary(baseTarget, {
    ...currentSession,
    state: "control-pending",
    mode: "control",
    controlRequestId: permissionRequest.requestId,
    controlRequestedAt: now,
    lastUpdatedAt: now,
    notes: [...currentSession.notes.slice(-4), "Control request submitted for human approval."],
  });
  remoteDesktopSessions.set(remoteDesktopSessionStorageKey(baseTarget.id), nextSession);
  pendingPermissions.set(permissionRequest.requestId, permissionRequest);
  audit("targets.remote-desktop.control-request", {
    targetId: baseTarget.id,
    targetName: baseTarget.displayName,
    requestId: permissionRequest.requestId,
    sessionId: currentSession.sessionId,
    state: nextSession.state,
    mode: nextSession.mode,
    summary: permissionRequest.summary,
  });
  broadcast(permissionRequest);
  return {
    allowed: true,
    reason: "Remote desktop control request queued for approval.",
    target: markRemoteDesktopTargetActive(baseTarget, now),
    session: nextSession,
    permissionRequest,
  };
}

function releaseRemoteDesktopSessionState(target) {
  const baseTarget = normalizeTargetProfileState(target);
  if (baseTarget.kind !== "remote-desktop") {
    return { allowed: false, reason: "This target is not a remote desktop target.", target: baseTarget };
  }

  const now = nowIso();
  const currentSession = getRemoteDesktopSessionState(baseTarget);
  const nextSession = withRemoteDesktopSessionSummary(baseTarget, {
    ...currentSession,
    state: "released",
    mode: "observe",
    controlRequestId: undefined,
    releasedAt: now,
    lastUpdatedAt: now,
    notes: [...currentSession.notes.slice(-4), "Control released by operator."],
  });
  remoteDesktopSessions.set(remoteDesktopSessionStorageKey(baseTarget.id), nextSession);
  return {
    allowed: true,
    reason: "Remote desktop control was released.",
    target: markRemoteDesktopTargetActive(baseTarget, now),
    session: nextSession,
  };
}

async function launchRemoteDesktopClientState(target) {
  const baseTarget = normalizeTargetProfileState(target);
  if (baseTarget.kind !== "remote-desktop") {
    return { allowed: false, reason: "This target is not a remote desktop target.", target: baseTarget };
  }

  const readinessIssues = targetConnectionReadinessIssuesState(baseTarget);
  if (readinessIssues.length > 0) {
    return { allowed: false, reason: readinessIssues[0], target: baseTarget };
  }

  if (!baseTarget.paired) {
    return { allowed: false, reason: "Pair the remote desktop target before launching the client.", target: baseTarget };
  }

  if (!baseTarget.adapters?.[0]?.authenticated) {
    return { allowed: false, reason: "Remote desktop target must be authenticated before launching the client.", target: baseTarget };
  }

  const now = nowIso();
  const currentSession = refreshRemoteDesktopSessionState(baseTarget, getRemoteDesktopSessionState(baseTarget), now);
  const launchSpec = buildRemoteDesktopLaunchSpec(baseTarget);
  const dryRun = process.env.CLAWDESK_DISABLE_NATIVE_RDP_LAUNCH === "1" || process.env.CLAWDESK_REMOTE_DESKTOP_DRY_RUN === "1";
  const credentialSource = baseTarget.connection?.credentialMode ?? "none";
  const credentialRef = baseTarget.connection?.credentialRef?.trim() ?? "";
  const seedOnly = process.env.CLAWDESK_REMOTE_DESKTOP_SEED_ONLY === "1";
  const launchEntry = {
    launchedAt: now,
    transport: dryRun ? `${launchSpec.transport}-dry-run` : launchSpec.transport,
    command: launchSpec.command,
    mode: baseTarget.connection?.sessionMode ?? "observe",
    dryRun,
    credentialSource,
    credentialSeedState: currentSession.credentialSeedState ?? "idle",
  };

  if (credentialSource === "secret-ref" && credentialRef && !dryRun) {
    const seedResult = await seedRemoteDesktopCredentialState(baseTarget);
    if (!seedResult.allowed) {
      const failedSession = withRemoteDesktopSessionSummary(baseTarget, {
        ...currentSession,
        credentialSource,
        credentialSeedState: "failed",
        credentialSeedError: seedResult.reason,
        lastUpdatedAt: now,
        notes: [...currentSession.notes.slice(-4), `Remote desktop credential seed failed: ${seedResult.reason}`],
      });
      remoteDesktopSessions.set(remoteDesktopSessionStorageKey(baseTarget.id), failedSession);
      return {
        allowed: false,
        reason: seedResult.reason,
        target: baseTarget,
        session: failedSession,
        launch: launchEntry,
      };
    }

    const seededSession = withRemoteDesktopSessionSummary(baseTarget, {
      ...currentSession,
      credentialSource,
      credentialSeedState: "prepared",
      credentialSeedAt: now,
      credentialSeedError: undefined,
      lastUpdatedAt: now,
      notes: [...currentSession.notes.slice(-4), `Remote desktop credential seeded for ${buildRemoteDesktopCredentialTarget(baseTarget)}.`],
    });
    remoteDesktopSessions.set(remoteDesktopSessionStorageKey(baseTarget.id), seededSession);
    audit("targets.remote-desktop.credential-seed", {
      targetId: baseTarget.id,
      targetName: baseTarget.displayName,
      credentialSource,
      credentialTarget: buildRemoteDesktopCredentialTarget(baseTarget),
      state: "prepared",
    });
    if (seedOnly) {
      return {
        allowed: true,
        reason: "Remote desktop credential seeded.",
        target: markRemoteDesktopTargetActive(baseTarget, now),
        session: seededSession,
        launch: {
          ...launchEntry,
          credentialSeedState: "prepared",
        },
      };
    }
  }

  if (dryRun) {
    const nextSession = withRemoteDesktopSessionSummary(baseTarget, {
      ...currentSession,
      state: baseTarget.connection?.sessionMode === "control" ? "controlling" : "observing",
      mode: baseTarget.connection?.sessionMode ?? "observe",
      transport: launchEntry.transport,
      clientLaunchState: "dry-run",
      clientLaunchCommand: launchSpec.command,
      clientLaunchAt: now,
      clientLaunchPid: null,
      clientLaunchError: undefined,
      credentialSource,
      credentialSeedState: currentSession.credentialSeedState ?? "idle",
      launchHistory: [...(Array.isArray(currentSession.launchHistory) ? currentSession.launchHistory : []).slice(-4), launchEntry],
      lastUpdatedAt: now,
      notes: [...currentSession.notes.slice(-4), `Remote desktop client launch dry-run recorded: ${launchSpec.command}`],
    });
    remoteDesktopSessions.set(remoteDesktopSessionStorageKey(baseTarget.id), nextSession);
    return {
      allowed: true,
      reason: "Remote desktop client launch dry-run recorded.",
      target: markRemoteDesktopTargetActive(baseTarget, now),
      session: nextSession,
      launch: launchEntry,
    };
  }

  const execution = await spawnDetachedProcess(launchSpec.executable, launchSpec.args, { cwd: homeDir });
  if (!execution.ok) {
    const failedSession = withRemoteDesktopSessionSummary(baseTarget, {
      ...currentSession,
      clientLaunchState: "failed",
      clientLaunchCommand: launchSpec.command,
      clientLaunchAt: now,
      clientLaunchPid: null,
      clientLaunchError: execution.error,
      credentialSource,
      credentialSeedState: currentSession.credentialSeedState ?? "prepared",
      launchHistory: [...(Array.isArray(currentSession.launchHistory) ? currentSession.launchHistory : []).slice(-4), { ...launchEntry, error: execution.error }],
      lastUpdatedAt: now,
      notes: [...currentSession.notes.slice(-4), `Remote desktop client launch failed: ${execution.error}`],
    });
    remoteDesktopSessions.set(remoteDesktopSessionStorageKey(baseTarget.id), failedSession);
    return {
      allowed: false,
      reason: execution.error || "Failed to launch the native remote desktop client.",
      target: baseTarget,
      session: failedSession,
      launch: launchEntry,
    };
  }

  remoteDesktopLaunchRuntimes.set(remoteDesktopLaunchRuntimeKey(baseTarget.id), {
    targetId: baseTarget.id,
    pid: execution.pid ?? null,
    command: launchSpec.command,
    transport: launchSpec.transport,
    launchedAt: now,
    dryRun: false,
    closed: false,
  });

  const nextSession = withRemoteDesktopSessionSummary(baseTarget, {
    ...currentSession,
    state: baseTarget.connection?.sessionMode === "control" ? "controlling" : "observing",
    mode: baseTarget.connection?.sessionMode ?? "observe",
    transport: launchEntry.transport,
    clientLaunchState: "launched",
    clientLaunchCommand: launchSpec.command,
    clientLaunchAt: now,
    clientLaunchPid: execution.pid ?? null,
    clientLaunchError: undefined,
    credentialSource,
    credentialSeedState: currentSession.credentialSeedState ?? "prepared",
    launchHistory: [...(Array.isArray(currentSession.launchHistory) ? currentSession.launchHistory : []).slice(-4), { ...launchEntry, pid: execution.pid ?? null }],
    lastUpdatedAt: now,
    notes: [...currentSession.notes.slice(-4), `Remote desktop client launched: ${launchSpec.command}`],
  });
  remoteDesktopSessions.set(remoteDesktopSessionStorageKey(baseTarget.id), nextSession);
  return {
    allowed: true,
    reason: "Remote desktop client launched.",
    target: markRemoteDesktopTargetActive(baseTarget, now),
    session: nextSession,
    launch: {
      ...launchEntry,
      pid: execution.pid ?? null,
    },
  };
}

async function reconnectRemoteDesktopClientState(target) {
  const baseTarget = normalizeTargetProfileState(target);
  if (baseTarget.kind !== "remote-desktop") {
    return { allowed: false, reason: "This target is not a remote desktop target.", target: baseTarget };
  }

  const runtime = getRemoteDesktopLaunchRuntime(baseTarget.id);
  if (runtime && runtime.dryRun === false && isProcessAlive(runtime.pid)) {
    const currentSession = refreshRemoteDesktopSessionState(baseTarget, getRemoteDesktopSessionState(baseTarget), nowIso());
    return {
      allowed: true,
      reason: "Remote desktop client is already running.",
      target: markRemoteDesktopTargetActive(baseTarget),
      session: currentSession,
      launch: {
        launchedAt: runtime.launchedAt,
        transport: runtime.transport,
        command: runtime.command,
        mode: currentSession.mode,
        dryRun: false,
        pid: runtime.pid,
        credentialSource: currentSession.credentialSource ?? baseTarget.connection?.credentialMode ?? "none",
        credentialSeedState: currentSession.credentialSeedState ?? "idle",
      },
    };
  }

  const relaunchResult = await launchRemoteDesktopClientState(baseTarget);
  if (!relaunchResult.allowed) {
    return relaunchResult;
  }

  const now = nowIso();
  const nextSession = relaunchResult.session
    ? withRemoteDesktopSessionSummary(baseTarget, {
        ...relaunchResult.session,
        notes: [...(Array.isArray(relaunchResult.session.notes) ? relaunchResult.session.notes : []).slice(-4), "Remote desktop client relaunched via reconnect."],
        lastUpdatedAt: now,
      })
    : undefined;
  if (nextSession) {
    remoteDesktopSessions.set(remoteDesktopSessionStorageKey(baseTarget.id), nextSession);
  }
  audit("targets.remote-desktop.client-reconnect", {
    targetId: baseTarget.id,
    targetName: baseTarget.displayName,
    launchState: nextSession?.clientLaunchState ?? relaunchResult.session?.clientLaunchState ?? "unknown",
    pid: relaunchResult.launch?.pid ?? null,
  });
  return {
    ...relaunchResult,
    session: nextSession ?? relaunchResult.session,
    reason: "Remote desktop client reconnected.",
  };
}

async function terminateRemoteDesktopClientRuntime(targetId, runtime, reason = "disconnected") {
  if (!runtime || runtime.dryRun) {
    clearRemoteDesktopLaunchRuntime(targetId);
    return { ok: true, reason: "dry-run" };
  }

  const pid = runtime.pid;
  clearRemoteDesktopLaunchRuntime(targetId);
  if (typeof pid !== "number" || !Number.isFinite(pid) || pid <= 0) {
    return { ok: true, reason: "missing-pid" };
  }

  if (process.platform === "win32") {
    const taskkill = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
      cwd: homeDir,
      env: process.env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const exitCode = await new Promise((resolve) => {
      taskkill.once("error", () => resolve(1));
      taskkill.once("close", (code) => resolve(typeof code === "number" ? code : 1));
    });
    return exitCode === 0
      ? { ok: true, reason, pid }
      : { ok: false, reason: `taskkill failed with exit code ${exitCode}.`, pid };
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      pid,
    };
  }

  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return { ok: true, reason, pid };
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      pid,
    };
  }

  return { ok: true, reason, pid };
}

async function disconnectRemoteDesktopSessionState(target) {
  const baseTarget = normalizeTargetProfileState(target);
  if (baseTarget.kind !== "remote-desktop") {
    return { allowed: false, reason: "This target is not a remote desktop target.", target: baseTarget };
  }

  const now = nowIso();
  const runtime = getRemoteDesktopLaunchRuntime(baseTarget.id);
  const closeResult = await terminateRemoteDesktopClientRuntime(baseTarget.id, runtime, "disconnect");
  const currentSession = getRemoteDesktopSessionState(baseTarget);
  const nextSession = withRemoteDesktopSessionSummary(baseTarget, {
    ...currentSession,
    state: "released",
    mode: "observe",
    controlRequestId: undefined,
    releasedAt: now,
    clientLaunchState: runtime ? "idle" : currentSession.clientLaunchState ?? "idle",
    clientLaunchPid: null,
    clientLaunchError: runtime && !closeResult.ok ? closeResult.reason : undefined,
    lastUpdatedAt: now,
    notes: [
      ...currentSession.notes.slice(-4),
      runtime
        ? closeResult.ok
          ? `Remote desktop client disconnected (${runtime.pid ?? "unknown pid"}).`
          : `Remote desktop client disconnect failed: ${closeResult.reason}`
        : "Remote desktop control released without an active client runtime.",
    ],
  });
  remoteDesktopSessions.set(remoteDesktopSessionStorageKey(baseTarget.id), nextSession);
  if (closeResult.ok) {
    audit("targets.remote-desktop.client-disconnect", {
      targetId: baseTarget.id,
      targetName: baseTarget.displayName,
      pid: closeResult.pid ?? runtime?.pid ?? null,
      reason: closeResult.reason,
    });
  }
  return {
    allowed: true,
    reason: runtime && !closeResult.ok ? `Remote desktop client disconnect failed: ${closeResult.reason}` : "Remote desktop control released and client disconnected.",
    target: markRemoteDesktopTargetActive(baseTarget, now),
    session: nextSession,
  };
}

function applyRemoteDesktopPermissionDecisionState(request, allowed, reason) {
  if (!request || request.action !== "remote-desktop.request-control" || typeof request.targetId !== "string") {
    return undefined;
  }

  const sessionKey = remoteDesktopSessionStorageKey(request.targetId);
  const currentSession = remoteDesktopSessions.get(sessionKey);
  if (!currentSession) return undefined;
  const target = targetRegistry.targets.find((entry) => entry.id === request.targetId);
  if (!target) return undefined;

  const now = nowIso();
  const nextSession = withRemoteDesktopSessionSummary(target, {
    ...currentSession,
    state: allowed ? "controlling" : "observing",
    mode: allowed ? "control" : "observe",
    controlRequestId: undefined,
    controlGrantedAt: allowed ? now : currentSession.controlGrantedAt,
    releasedAt: allowed ? currentSession.releasedAt : currentSession.releasedAt,
    lastUpdatedAt: now,
    notes: [
      ...currentSession.notes.slice(-4),
      allowed ? "Control request approved." : `Control request denied${reason ? `: ${reason}` : ""}.`,
    ],
  });
  remoteDesktopSessions.set(sessionKey, nextSession);
  return nextSession;
}

function applyPermissionResultState(result) {
  const requestId = typeof result?.requestId === "string" ? result.requestId.trim() : "";
  if (!requestId) {
    return {
      applied: false,
      request: undefined,
      remoteDesktopSession: undefined,
    };
  }

  const request = pendingPermissions.get(requestId);
  pendingPermissions.delete(requestId);

  const allowed = result?.allowed === true;
  const reason = typeof result?.reason === "string" ? result.reason.trim() : "";
  const remoteDesktopSession = applyRemoteDesktopPermissionDecisionState(request, allowed, reason);
  if (remoteDesktopSession) {
    audit("targets.remote-desktop.permission-result", {
      requestId,
      targetId: request?.targetId,
      targetName: request?.target ?? request?.targetName,
      sessionId: request?.sessionId,
      allowed,
      reason,
    });
    scheduleStateSave();
  }

  return {
    applied: Boolean(request),
    request,
    remoteDesktopSession,
  };
}

function sshTerminalSessionStorageKey(targetId) {
  return sanitizeTargetStorageKey(targetId);
}

function cloneSshTerminalTranscriptEntry(entry) {
  return {
    ...entry,
  };
}

function cloneSshTerminalSessionState(session) {
  return {
    ...session,
    transcript: Array.isArray(session.transcript) ? session.transcript.map(cloneSshTerminalTranscriptEntry) : [],
    commandHistory: Array.isArray(session.commandHistory) ? [...session.commandHistory] : [],
    notes: Array.isArray(session.notes) ? [...session.notes] : [],
  };
}

function sshTerminalRuntimeKey(targetId) {
  return sshTerminalSessionStorageKey(targetId);
}

function getSshTerminalRuntime(targetId) {
  return sshTerminalInteractiveRuntimes.get(sshTerminalRuntimeKey(targetId));
}

function clearSshTerminalRuntime(targetId) {
  sshTerminalInteractiveRuntimes.delete(sshTerminalRuntimeKey(targetId));
}

function splitCommandLineArgs(commandLine) {
  return commandLine
    .split(/\s+/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildSshTerminalCommandFrame(command, token) {
  return [
    `printf '__CLAWDESK_BEGIN__${token}\\n'`,
    command,
    "status=$?",
    `printf '__CLAWDESK_STATUS__${token}:%s\\n' "$status"`,
    `printf '__CLAWDESK_END__${token}\\n'`,
  ].join("\n");
}

function createSshTerminalRuntimeState(target, child, credentialMaterial) {
  return {
    targetId: target.id,
    child,
    credentialMaterial,
    stdoutBuffer: "",
    stderrBuffer: "",
    pendingCommand: null,
    startedAt: nowIso(),
    lastActivityAt: nowIso(),
    closed: false,
  };
}

async function reconnectSshTerminalRuntime(target) {
  const baseTarget = normalizeTargetProfileState(target);
  const key = sshTerminalRuntimeKey(baseTarget.id);
  const existing = sshTerminalInteractiveRuntimes.get(key);
  if (existing && existing.child && existing.child.exitCode === null && existing.child.signalCode === null && !existing.closed) {
    const session = refreshSshTerminalSessionView(baseTarget, getSshTerminalSessionState(baseTarget), nowIso());
    return {
      allowed: true,
      reason: "SSH terminal session is already connected.",
      target: {
        ...baseTarget,
        paired: true,
        state: "ready",
        lastSeenAt: nowIso(),
      },
      session,
      runtime: existing,
    };
  }

  if (existing) {
    await disposeSshTerminalRuntime(baseTarget.id, existing, "reconnect");
  }

  const opened = await openSshTerminalRuntime(baseTarget);
  if (!opened.allowed) {
    return opened;
  }

  const now = nowIso();
  const session = refreshSshTerminalSessionView(baseTarget, getSshTerminalSessionState(baseTarget), now);
  const nextSession = withSshTerminalSessionSummary(baseTarget, {
    ...session,
    notes: [...session.notes.slice(-4), "SSH terminal session reconnected."],
    lastUpdatedAt: now,
  });
  sshTerminalSessions.set(sshTerminalSessionStorageKey(baseTarget.id), nextSession);
  audit("targets.ssh-terminal.session.reconnect", {
    targetId: baseTarget.id,
    targetName: baseTarget.displayName,
    transport: nextSession.transport,
  });
  return {
    allowed: true,
    reason: "SSH terminal session reconnected.",
    target: {
      ...baseTarget,
      paired: true,
      state: "ready",
      lastSeenAt: now,
    },
    session: nextSession,
    runtime: opened.runtime,
  };
}

async function disposeSshTerminalRuntime(targetId, runtime, reason = "disposed") {
  if (!runtime) return;
  runtime.closed = true;
  runtime.pendingCommand = null;
  try {
    if (runtime.child && !runtime.child.killed && runtime.child.exitCode === null && runtime.child.signalCode === null) {
      if (runtime.child.stdin && !runtime.child.stdin.destroyed && !runtime.child.stdin.writableEnded) {
        runtime.child.stdin.write("exit\n");
        runtime.child.stdin.end();
      }
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          try {
            runtime.child.kill("SIGKILL");
          } catch {
            // ignore
          }
          resolve();
        }, 2500);
        runtime.child.once("close", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  } catch {
    // ignore
  }
  try {
    await runtime.credentialMaterial?.cleanup?.();
  } catch {
    // ignore
  }
  clearSshTerminalRuntime(targetId);
  return reason;
}

function resolveSshTerminalCommandResult(runtime, pending) {
  const stdout = runtime.stdoutBuffer;
  const stderr = runtime.stderrBuffer;
  const beginMarker = `__CLAWDESK_BEGIN__${pending.token}`;
  const statusPrefix = `__CLAWDESK_STATUS__${pending.token}:`;
  const endMarker = `__CLAWDESK_END__${pending.token}`;
  const beginIndex = stdout.indexOf(beginMarker);
  const statusIndex = stdout.indexOf(statusPrefix);
  const endIndex = stdout.indexOf(endMarker);

  if (beginIndex < 0 || statusIndex < 0 || endIndex < 0 || statusIndex < beginIndex) {
    return null;
  }

  const beginLineEnd = stdout.indexOf("\n", beginIndex);
  const statusLineEnd = stdout.indexOf("\n", statusIndex);
  const outputStart = beginLineEnd >= 0 ? beginLineEnd + 1 : beginIndex + beginMarker.length;
  const outputEnd = statusIndex;
  const stdoutText = stdout.slice(outputStart, outputEnd).replace(/\r?\n$/, "");
  const statusText = statusLineEnd >= 0 ? stdout.slice(statusIndex + statusPrefix.length, statusLineEnd) : stdout.slice(statusIndex + statusPrefix.length, endIndex);
  const exitCode = Number.parseInt(statusText.trim(), 10);

  return {
    stdout: stdoutText,
    stderr,
    exitCode: Number.isFinite(exitCode) ? exitCode : null,
  };
}

async function openSshTerminalRuntime(target) {
  const baseTarget = normalizeTargetProfileState(target);
  const key = sshTerminalRuntimeKey(baseTarget.id);
  const existing = sshTerminalInteractiveRuntimes.get(key);
  if (existing && existing.child && existing.child.exitCode === null && existing.child.signalCode === null && !existing.closed) {
    return { allowed: true, runtime: existing };
  }

  if (existing) {
    await disposeSshTerminalRuntime(baseTarget.id, existing, "replaced");
  }

  const host = extractTargetHost(baseTarget);
  const remoteTarget = `${baseTarget.connection.username}@${host}`;
  const knownHostsPath = await ensureTargetKnownHostsFile(baseTarget);
  const credentialMaterial = await materializeTargetCredentialFile(baseTarget);
  const remoteShellArgs = splitCommandLineArgs(sshRemoteShellCommand);
  const sshArgs = [
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    `UserKnownHostsFile=${knownHostsPath}`,
    "-o",
    `GlobalKnownHostsFile=${process.platform === "win32" ? "NUL" : "/dev/null"}`,
    "-o",
    "ConnectTimeout=10",
  ];

  if (credentialMaterial) {
    sshArgs.push("-o", "IdentitiesOnly=yes", "-i", credentialMaterial.privateKeyPath);
  }

  sshArgs.push("-p", String(baseTarget.connection.port ?? 22), remoteTarget, ...remoteShellArgs);

  const child = spawn(sshExecutable, [...sshExecutableArgs, ...sshArgs], {
    cwd: homeDir,
    env: process.env,
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const runtime = createSshTerminalRuntimeState(baseTarget, child, credentialMaterial);
  sshTerminalInteractiveRuntimes.set(key, runtime);

  child.stdout?.on("data", (chunk) => {
    runtime.stdoutBuffer += chunk.toString("utf8");
    runtime.lastActivityAt = nowIso();
    const pending = runtime.pendingCommand;
    if (!pending) return;
    const resolved = resolveSshTerminalCommandResult(runtime, pending);
    if (!resolved) return;
    pending.resolve(resolved);
  });

  child.stderr?.on("data", (chunk) => {
    runtime.stderrBuffer += chunk.toString("utf8");
    runtime.lastActivityAt = nowIso();
    const pending = runtime.pendingCommand;
    if (!pending) return;
    const resolved = resolveSshTerminalCommandResult(runtime, pending);
    if (!resolved) return;
    pending.resolve(resolved);
  });

  child.on("error", async (error) => {
    runtime.closed = true;
    const pending = runtime.pendingCommand;
    if (pending) {
      pending.reject(error instanceof Error ? error.message : String(error));
      runtime.pendingCommand = null;
    }
    await disposeSshTerminalRuntime(baseTarget.id, runtime, "spawn-error");
  });

  child.on("close", async () => {
    runtime.closed = true;
    const pending = runtime.pendingCommand;
    if (pending) {
      pending.reject("The SSH shell session closed before the command completed.");
      runtime.pendingCommand = null;
    }
    await disposeSshTerminalRuntime(baseTarget.id, runtime, "closed");
  });

  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  }).catch(async (error) => {
    await disposeSshTerminalRuntime(baseTarget.id, runtime, "spawn-error");
    throw error;
  });

  return { allowed: true, runtime };
}

async function closeSshTerminalRuntime(targetId) {
  const runtime = getSshTerminalRuntime(targetId);
  if (!runtime) return;
  runtime.closed = true;
  const pending = runtime.pendingCommand;
  if (pending) {
    pending.reject("The SSH shell session was closed before the command completed.");
    runtime.pendingCommand = null;
  }
  try {
    if (runtime.child.stdin && !runtime.child.stdin.destroyed && !runtime.child.stdin.writableEnded) {
      runtime.child.stdin.write("exit\n");
      runtime.child.stdin.end();
    }
  } catch {
    // ignore
  }
  await disposeSshTerminalRuntime(targetId, runtime, "closed");
}

async function runSshTerminalInteractiveCommand(target, command) {
  const baseTarget = normalizeTargetProfileState(target);
  const key = sshTerminalRuntimeKey(baseTarget.id);
  const runtime = getSshTerminalRuntime(baseTarget.id);
  if (!runtime || runtime.closed || !runtime.child || runtime.child.exitCode !== null || runtime.child.signalCode !== null) {
    return { allowed: false, reason: "Open the SSH terminal session before sending commands.", target: baseTarget };
  }

  if (runtime.pendingCommand) {
    return { allowed: false, reason: "A previous SSH terminal command is still running.", target: baseTarget };
  }

  const normalizedCommand = typeof command === "string" ? command.trim() : "";
  if (!normalizedCommand) {
    return { allowed: false, reason: "A command is required.", target: baseTarget };
  }

  const now = nowIso();
  const currentSession = refreshSshTerminalSessionView(baseTarget, getSshTerminalSessionState(baseTarget), now);
  if (currentSession.state !== "connected") {
    return {
      allowed: false,
      reason: "Open the SSH terminal session before sending commands.",
      target: baseTarget,
      session: currentSession,
    };
  }

  const commandSafety = classifyShellCommandState(normalizedCommand);
  if (commandSafety === "blocked") {
    return {
      allowed: false,
      reason: "The requested command is blocked by the safe-dispatch policy.",
      target: baseTarget,
    };
  }

  if (commandSafety === "needs-review") {
    return {
      allowed: false,
      reason: "The requested command needs human review before execution.",
      target: baseTarget,
    };
  }

  const token = crypto.randomUUID().slice(0, 12);
  const commandFrame = buildSshTerminalCommandFrame(normalizedCommand, token);
  runtime.stdoutBuffer = "";
  runtime.stderrBuffer = "";

  const executionPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      runtime.pendingCommand = null;
      try {
        runtime.child.kill("SIGKILL");
      } catch {
        // ignore
      }
      reject(new Error(`SSH terminal command timed out after ${sshSessionCommandTimeoutMs}ms.`));
    }, sshSessionCommandTimeoutMs);

    runtime.pendingCommand = {
      token,
      command: normalizedCommand,
      stdoutStart: 0,
      stderrStart: 0,
      resolve: (result) => {
        clearTimeout(timeout);
        runtime.pendingCommand = null;
        resolve(result);
      },
      reject: (reason) => {
        clearTimeout(timeout);
        runtime.pendingCommand = null;
        reject(reason);
      },
    };

    try {
      runtime.child.stdin.write(`${commandFrame}\n`);
      runtime.lastActivityAt = nowIso();
    } catch (error) {
      clearTimeout(timeout);
      runtime.pendingCommand = null;
      reject(error);
    }
  });

  let result;
  try {
    result = await executionPromise;
  } catch (error) {
    const failedSession = {
      ...getSshTerminalSessionState(baseTarget),
      lastUpdatedAt: now,
      notes: [
        ...getSshTerminalSessionState(baseTarget).notes.slice(-4),
        `SSH terminal command failed: ${redactDiagnosticText(error instanceof Error ? error.message : String(error))}`,
      ],
      transcript: [
        ...getSshTerminalSessionState(baseTarget).transcript.slice(-12),
        {
          id: `ssh-entry-${crypto.randomUUID().slice(0, 8)}`,
          role: "command",
          text: redactDiagnosticText(normalizedCommand),
          createdAt: now,
        },
        {
          id: `ssh-entry-${crypto.randomUUID().slice(0, 8)}`,
          role: "error",
          text: redactDiagnosticText(error instanceof Error ? error.message : String(error)),
          createdAt: now,
        },
      ],
    };
    failedSession.sessionSummary = buildSshTerminalSessionSummary(baseTarget, failedSession);
    sshTerminalSessions.set(key, failedSession);
    return {
      allowed: false,
      reason: error instanceof Error ? error.message : String(error),
      target: baseTarget,
      session: failedSession,
    };
  }

  const sessionTranscript = [
    ...currentSession.transcript.slice(-12),
    {
      id: `ssh-entry-${crypto.randomUUID().slice(0, 8)}`,
      role: "command",
      text: redactDiagnosticText(normalizedCommand),
      createdAt: now,
    },
    {
      id: `ssh-entry-${crypto.randomUUID().slice(0, 8)}`,
      role: "output",
      text: redactDiagnosticText(result.stdout || "(no stdout)"),
      createdAt: now,
    },
  ];
  if (result.stderr) {
    sessionTranscript.push({
      id: `ssh-entry-${crypto.randomUUID().slice(0, 8)}`,
      role: "error",
      text: redactDiagnosticText(result.stderr),
      createdAt: now,
    });
  }
  const nextSession = {
    ...currentSession,
    state: "connected",
    transport: "gateway-ssh-terminal-shell-stream",
    lastCommand: redactDiagnosticText(normalizedCommand),
    lastCommandAt: now,
    lastExitCode: result.exitCode,
    lastUpdatedAt: now,
    notes: [
      ...currentSession.notes.slice(-4),
      result.exitCode === 0
        ? `Command completed successfully: ${redactDiagnosticText(normalizedCommand)}`
        : `Command completed with exit ${result.exitCode}: ${redactDiagnosticText(normalizedCommand)}`,
    ],
    transcript: sessionTranscript,
  };
  nextSession.sessionSummary = buildSshTerminalSessionSummary(baseTarget, nextSession);
  sshTerminalSessions.set(key, nextSession);
  const dispatchRecord = {
    id: `dispatch-${crypto.randomUUID().slice(0, 8)}`,
    targetId: baseTarget.id,
    targetName: baseTarget.displayName,
    category: "execute_safe",
    summary: `SSH terminal session command: ${redactDiagnosticText(normalizedCommand)}`,
    command: redactDiagnosticText(normalizedCommand),
    decision: {
      allowed: true,
      requiresApproval: true,
      reason: "Allowlisted SSH terminal command executed through the gateway-managed session contract.",
      adapterKind: "ssh-terminal",
      commandSafety,
    },
    createdAt: now,
  };
  targetDispatches.unshift(dispatchRecord);
  targetDispatches = targetDispatches.slice(0, 200);
  audit("targets.ssh-terminal.session.command", {
    targetId: baseTarget.id,
    command: redactDiagnosticText(normalizedCommand),
    exitCode: result.exitCode,
  });
  scheduleStateSave();
  return {
    allowed: true,
    reason: result.exitCode === 0 ? "SSH command executed successfully." : "SSH command finished with a non-zero exit code.",
    target: {
      ...baseTarget,
      lastSeenAt: now,
    },
    session: nextSession,
    execution: {
      mode: "ssh-terminal-session",
      credentialSource: baseTarget.connection.credentialMode,
      command: normalizedCommand,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      startedAt: now,
      finishedAt: nowIso(),
      targetId: baseTarget.id,
      targetName: baseTarget.displayName,
    },
    record: dispatchRecord,
  };
}

function createSshTerminalPrompt(target) {
  const host = extractTargetHost(target) || target.adapters[0]?.endpoint || target.displayName;
  const user = target.connection?.username?.trim() || "ssh";
  return `${user}@${host}:~$`;
}

function buildSshTerminalSessionSummary(target, session) {
  const stateLabel =
    session.state === "connected"
      ? "已連線"
      : session.state === "closed"
        ? "已關閉"
        : "待開啟";
  const commandLabel = session.lastCommand ? `last ${session.lastCommand}` : "last none";
  const exitLabel = typeof session.lastExitCode === "number" ? `exit ${session.lastExitCode}` : "exit n/a";
  return [`${target.displayName} SSH ${stateLabel}`, commandLabel, exitLabel].join(" · ");
}

function withSshTerminalSessionSummary(target, session) {
  return {
    ...session,
    sessionSummary: buildSshTerminalSessionSummary(target, session),
  };
}

function createSshTerminalSessionState(target, now = nowIso()) {
  const host = extractTargetHost(target) || target.adapters[0]?.endpoint || target.displayName;
  const prompt = createSshTerminalPrompt(target);
  const sessionId = `ssh_${crypto
    .createHash("sha256")
    .update(`clawdesk-ssh-terminal:${target.id}`)
    .digest("hex")
    .slice(0, 24)}`;
  return withSshTerminalSessionSummary(target, {
    sessionId,
    targetId: target.id,
    targetName: target.displayName,
    endpoint: target.adapters[0]?.endpoint ?? target.endpoint,
    transport: "gateway-ssh-terminal-contract",
    state: "idle",
    mode: target.connection?.sessionMode ?? "control",
    prompt,
    currentDirectory: "~",
    transcript: [
      {
        id: `ssh-entry-${crypto.randomUUID().slice(0, 8)}`,
        role: "system",
        text: `SSH terminal session ready for ${target.displayName} at ${host}.`,
        createdAt: now,
      },
    ],
    commandHistory: [],
    notes: ["Awaiting open_session or run_command."],
    sessionSummary: `SSH terminal ${target.displayName} 已就緒。`,
    lastUpdatedAt: now,
  });
}

function getSshTerminalSessionState(target) {
  const key = sshTerminalSessionStorageKey(target.id);
  const current = sshTerminalSessions.get(key);
  if (current) {
    return cloneSshTerminalSessionState(current);
  }
  const created = createSshTerminalSessionState(target);
  sshTerminalSessions.set(key, created);
  return cloneSshTerminalSessionState(created);
}

function refreshSshTerminalSessionState(target, session, now = nowIso()) {
  const prompt = createSshTerminalPrompt(target);
  const runtime = getSshTerminalRuntime(target.id);
  const runtimeAlive = Boolean(runtime && !runtime.closed && runtime.child && runtime.child.exitCode === null && runtime.child.signalCode === null);
  const refreshed = {
    ...session,
    endpoint: target.adapters[0]?.endpoint ?? target.endpoint,
    targetName: target.displayName,
    mode: target.connection?.sessionMode ?? session.mode ?? "control",
    transport: runtimeAlive ? "gateway-ssh-terminal-shell-stream" : session.transport,
    prompt,
    currentDirectory: session.currentDirectory ?? "~",
    sessionSummary: buildSshTerminalSessionSummary(target, session),
    lastUpdatedAt: now,
    notes: [...session.notes.slice(-4), `Session snapshot refreshed at ${now}.`],
  };
  if (session.state === "connected" && !runtimeAlive) {
    return {
      ...refreshed,
      state: "closed",
      transport: "gateway-ssh-terminal-shell-stream",
      notes: [...refreshed.notes.slice(-4), "SSH terminal runtime no longer active."],
      transcript: [
        ...refreshed.transcript.slice(-12),
        {
          id: `ssh-entry-${crypto.randomUUID().slice(0, 8)}`,
          role: "system",
          text: "Interactive SSH shell is no longer active.",
          createdAt: now,
        },
      ],
    };
  }
  return refreshed;
}

async function openSshTerminalSessionState(target) {
  const baseTarget = normalizeTargetProfileState(target);
  if (baseTarget.kind !== "ssh-terminal") {
    return { allowed: false, reason: "This target is not an SSH terminal target.", target: baseTarget };
  }

  const readinessIssues = targetConnectionReadinessIssuesState(baseTarget);
  if (readinessIssues.length > 0) {
    return { allowed: false, reason: readinessIssues[0], target: baseTarget };
  }

  const runtimeResult = await openSshTerminalRuntime(baseTarget);
  if (!runtimeResult.allowed) {
    return runtimeResult;
  }

  const now = nowIso();
  const currentSession = refreshSshTerminalSessionView(baseTarget, getSshTerminalSessionState(baseTarget), now);
  const nextSession = {
    ...currentSession,
    state: "connected",
    transport: "gateway-ssh-terminal-shell-stream",
    lastObservedAt: now,
    lastUpdatedAt: now,
    notes: [...currentSession.notes.slice(-4), "SSH terminal shell stream opened."],
    transcript: [
      ...currentSession.transcript.slice(-12),
      {
        id: `ssh-entry-${crypto.randomUUID().slice(0, 8)}`,
        role: "system",
        text: "Shell stream opened.",
        createdAt: now,
      },
    ],
  };
  nextSession.sessionSummary = buildSshTerminalSessionSummary(baseTarget, nextSession);
  sshTerminalSessions.set(sshTerminalSessionStorageKey(baseTarget.id), nextSession);
  return {
    allowed: true,
    reason: "SSH terminal shell stream opened.",
    target: {
      ...baseTarget,
      lastSeenAt: now,
    },
    session: nextSession,
  };
}

async function reconnectSshTerminalSessionState(target) {
  const baseTarget = normalizeTargetProfileState(target);
  if (baseTarget.kind !== "ssh-terminal") {
    return { allowed: false, reason: "This target is not an SSH terminal target.", target: baseTarget };
  }

  const runtime = getSshTerminalRuntime(baseTarget.id);
  if (runtime && runtime.child && runtime.child.exitCode === null && runtime.child.signalCode === null && !runtime.closed) {
    const now = nowIso();
    const session = refreshSshTerminalSessionView(baseTarget, getSshTerminalSessionState(baseTarget), now);
    const nextSession = withSshTerminalSessionSummary(baseTarget, {
      ...session,
      state: "connected",
      transport: "gateway-ssh-terminal-shell-stream",
      lastObservedAt: now,
      lastUpdatedAt: now,
      notes: [...session.notes.slice(-4), "SSH terminal runtime was already active during reconnect."],
      transcript: [
        ...session.transcript.slice(-12),
        {
          id: `ssh-entry-${crypto.randomUUID().slice(0, 8)}`,
          role: "system",
          text: "SSH terminal reconnect reused the active runtime.",
          createdAt: now,
        },
      ],
    });
    sshTerminalSessions.set(sshTerminalSessionStorageKey(baseTarget.id), nextSession);
    audit("targets.ssh-terminal.session.reconnect", {
      targetId: baseTarget.id,
      targetName: baseTarget.displayName,
      reusedRuntime: true,
    });
    return {
      allowed: true,
      reason: "SSH terminal session already connected.",
      target: {
        ...baseTarget,
        lastSeenAt: now,
      },
      session: nextSession,
    };
  }

  if (runtime) {
    await disposeSshTerminalRuntime(baseTarget.id, runtime, "reconnect");
  }

  const reopened = await openSshTerminalRuntime(baseTarget);
  if (!reopened.allowed) {
    return reopened;
  }

  const now = nowIso();
  const currentSession = refreshSshTerminalSessionView(baseTarget, getSshTerminalSessionState(baseTarget), now);
  const nextSession = withSshTerminalSessionSummary(baseTarget, {
    ...currentSession,
    state: "connected",
    transport: "gateway-ssh-terminal-shell-stream",
    lastObservedAt: now,
    lastUpdatedAt: now,
    notes: [...currentSession.notes.slice(-4), "SSH terminal session reconnected."],
    transcript: [
      ...currentSession.transcript.slice(-12),
      {
        id: `ssh-entry-${crypto.randomUUID().slice(0, 8)}`,
        role: "system",
        text: "SSH terminal session reconnected.",
        createdAt: now,
      },
    ],
  });
  nextSession.sessionSummary = buildSshTerminalSessionSummary(baseTarget, nextSession);
  sshTerminalSessions.set(sshTerminalSessionStorageKey(baseTarget.id), nextSession);
  audit("targets.ssh-terminal.session.reconnect", {
    targetId: baseTarget.id,
    targetName: baseTarget.displayName,
    reusedRuntime: false,
  });
  return {
    allowed: true,
    reason: "SSH terminal session reconnected.",
    target: {
      ...baseTarget,
      lastSeenAt: now,
    },
    session: nextSession,
  };
}

async function closeSshTerminalSessionState(target) {
  const baseTarget = normalizeTargetProfileState(target);
  if (baseTarget.kind !== "ssh-terminal") {
    return { allowed: false, reason: "This target is not an SSH terminal target.", target: baseTarget };
  }

  const now = nowIso();
  await closeSshTerminalRuntime(baseTarget.id);
  const currentSession = getSshTerminalSessionState(baseTarget);
  const nextSession = {
    ...currentSession,
    state: "closed",
    transport: "gateway-ssh-terminal-shell-stream",
    lastUpdatedAt: now,
    notes: [...currentSession.notes.slice(-4), "SSH terminal session closed."],
    transcript: [
      ...currentSession.transcript.slice(-12),
      {
        id: `ssh-entry-${crypto.randomUUID().slice(0, 8)}`,
        role: "system",
        text: "Shell stream closed.",
        createdAt: now,
      },
    ],
  };
  nextSession.sessionSummary = buildSshTerminalSessionSummary(baseTarget, nextSession);
  sshTerminalSessions.set(sshTerminalSessionStorageKey(baseTarget.id), nextSession);
  return {
    allowed: true,
    reason: "SSH terminal session closed.",
    target: {
      ...baseTarget,
      lastSeenAt: now,
    },
    session: nextSession,
  };
}

function refreshSshTerminalSessionView(target, session, now = nowIso()) {
  const refreshed = refreshSshTerminalSessionState(target, session, now);
  sshTerminalSessions.set(sshTerminalSessionStorageKey(target.id), refreshed);
  return refreshed;
}

async function runSshTerminalSessionCommandState(target, command) {
  return runSshTerminalInteractiveCommand(target, command);
}

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
    schemaVersion: 5,
    savedAt: nowIso(),
    providerSession,
    visionProbeResults,
    connectedAccounts,
    communicationChannels,
    scheduledWorkflows,
    openClawSettingsProfile,
    identityUsers,
    identityVerifications,
    identityPasswordResets,
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
    safetyQueue,
    targetRegistry,
    targetDispatches,
    pairingTickets: [...pairingTickets.values()].map((ticket) => clonePairingTicketState(ticket)),
    hostEnrollmentTickets: [...hostEnrollmentTickets.values()].map((ticket) => cloneHostEnrollmentTicketState(ticket)),
    remoteDesktopSessions: [...remoteDesktopSessions.values()].map((session) => cloneRemoteDesktopSessionState(session)),
    sshTerminalSessions: [...sshTerminalSessions.values()].map((session) => cloneSshTerminalSessionState(session)),
  };
}

function mergeArray(target, source) {
  if (!Array.isArray(source)) return;
  target.splice(0, target.length, ...source);
}

function applyPersistedState(state) {
  if (!state || (state.schemaVersion !== 1 && state.schemaVersion !== 2 && state.schemaVersion !== 3 && state.schemaVersion !== 4 && state.schemaVersion !== 5)) return;
  if (state.providerSession) providerSession = state.providerSession;
  if (state.visionProbeResults && typeof state.visionProbeResults === "object") visionProbeResults = state.visionProbeResults;
  mergeArray(connectedAccounts, state.connectedAccounts);
  mergeArray(communicationChannels, state.communicationChannels);
  mergeArray(scheduledWorkflows, state.scheduledWorkflows);
  if (state.openClawSettingsProfile) openClawSettingsProfile = state.openClawSettingsProfile;
  mergeArray(identityUsers, state.identityUsers);
  mergeArray(identityVerifications, state.identityVerifications);
  mergeArray(identityPasswordResets, state.identityPasswordResets);
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
  if (Array.isArray(state.safetyQueue)) safetyQueue = state.safetyQueue;
  if (state.targetRegistry) targetRegistry = normalizeTargetRegistryState(state.targetRegistry);
  if (Array.isArray(state.targetDispatches)) targetDispatches = state.targetDispatches.slice(0, 200);
  if (Array.isArray(state.pairingTickets)) {
    pairingTickets.clear();
    for (const ticket of state.pairingTickets) {
      if (!ticket || typeof ticket.code !== "string") continue;
      pairingTickets.set(pairingTicketStorageKey(ticket.code), clonePairingTicketState(ticket));
    }
  }
  if (Array.isArray(state.hostEnrollmentTickets)) {
    hostEnrollmentTickets.clear();
    for (const ticket of state.hostEnrollmentTickets) {
      if (!ticket || typeof ticket.code !== "string") continue;
      hostEnrollmentTickets.set(hostEnrollmentTicketStorageKey(ticket.code), cloneHostEnrollmentTicketState(ticket));
    }
  }
  if (Array.isArray(state.remoteDesktopSessions)) {
    remoteDesktopSessions.clear();
    for (const session of state.remoteDesktopSessions) {
      if (!session || typeof session.targetId !== "string") continue;
      remoteDesktopSessions.set(remoteDesktopSessionStorageKey(session.targetId), cloneRemoteDesktopSessionState(session));
    }
  }
  if (Array.isArray(state.sshTerminalSessions)) {
    sshTerminalSessions.clear();
    for (const session of state.sshTerminalSessions) {
      if (!session || typeof session.targetId !== "string") continue;
      sshTerminalSessions.set(sshTerminalSessionStorageKey(session.targetId), cloneSshTerminalSessionState(session));
    }
  }
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

function ensureBackendIdentityDeveloper(session = {}) {
  const existingUser = identityUsers.find((user) => user.email === session.email);
  const derivedMode = existingUser?.mode ?? session.mode;
  const derivedRole = existingUser?.role ?? session.role;
  const derivedOrganization = existingUser?.organization ?? session.organization;
  const normalizedSession = {
    ...session,
    mode: derivedMode,
    role: derivedRole,
    organization: derivedOrganization,
    isDeveloper: isDeveloperIdentitySession({
      authenticated: Boolean(session.authenticated ?? session.email),
      email: session.email,
      mode: derivedMode,
      role: derivedRole,
      displayName: session.displayName,
    }),
  };
  if (normalizedSession.isDeveloper) {
    identitySession = normalizedSession;
    applyDeveloperLicenseBypass();
  }
  return normalizedSession;
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

function setBackendPasswordResetCode(email, code) {
  if (!email || !code) return;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 20 * 60 * 1000).toISOString();
  identityPasswordResets.push({
    email,
    code,
    createdAt: now.toISOString(),
    expiresAt,
    used: false,
    source: "backend",
  });
  identityMailOutbox.unshift({
    to: email,
    subject: "ClawDesk 密碼重設驗證信",
    body: `請在 20 分鐘內使用重設碼 ${code} 完成 ClawDesk 密碼更新。`,
    token: code,
    code,
    createdAt: now.toISOString(),
    purpose: "password-reset",
  });
  backendIdentityPasswordResetCodes.set(email, code);
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

function getBackendPasswordResetRecord(email) {
  const now = Date.now();
  const target = identityPasswordResets.find(
    (item) => item.email === email && !item.used && new Date(item.expiresAt).getTime() > now && item.code === backendIdentityPasswordResetCodes.get(email),
  );
  if (target) return target;
  return identityPasswordResets.find((item) => item.email === email && !item.used && new Date(item.expiresAt).getTime() > now) ?? null;
}

function consumeBackendPasswordReset(email, code) {
  if (!email || !code) return null;
  const now = Date.now();
  const target = identityPasswordResets.find((item) => item.email === email && !item.used && item.code === code && new Date(item.expiresAt).getTime() > now);
  if (!target) return null;
  target.used = true;
  if (backendIdentityPasswordResetCodes.get(email) === code) {
    backendIdentityPasswordResetCodes.delete(email);
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
  const paymentProvider = "lemon-squeezy";
  const licenseProvider = "lemon-license";
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
      storedAs: "backend issued hashed Lemon Squeezy entitlement",
    },
    entitlement: payload.entitlement,
    lastValidationCode: statusOverride.lastValidationCode ?? (isActive ? "LEMON_LICENSE_ACTIVE" : "LEMON_WAIT"),
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
      "Notification service",
      "Audit and diagnostics store",
      "MCP connector proxy service",
    ],
    environmentVariables: [
      "CLAWDESK_MOCK_PORT",
      "OPENCLAW_MOCK_PORT",
      "CLAWDESK_MOCK_STATE_FILE",
      "NODE_ENV",
      "LEMON_SQUEEZY_WEBHOOK_SECRET",
      "LEMON_SQUEEZY_STORE_ID",
      "LEMON_SQUEEZY_PRODUCT_ID",
      "SMTP_URL",
      "SSO_OIDC_ISSUER",
      "SSO_OIDC_CLIENT_ID",
    ],
  };
}

function normalizeLemonLicenseKey(input) {
  return String(input ?? "").trim().toUpperCase().replace(/\s+/g, "-");
}

function isMockLemonLicenseKey(input) {
  return /^CLWD-BETA-[A-Z0-9]{4}-[0-9]{4}$/.test(normalizeLemonLicenseKey(input));
}

function licenseKeyHash(input) {
  return `lk_${crypto.createHash("sha256").update(`clawdesk-beta-direct:${normalizeLemonLicenseKey(input)}`).digest("hex").slice(0, 24)}`;
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
    paymentProvider: "lemon-squeezy",
    licenseProvider: "lemon-license",
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
      keyId: "lem_dev_master",
      payloadHash: "sha256:developer-bypass",
      signatureStatus: "dev-bypass",
      storedAs: "mock developer bypass ticket",
    },
    lastValidationCode: "LEMON_DEV_BYPASS",
  };

  audit("license.developer-bypass", { plan: licenseStatus.plan, status: licenseStatus.status });
  scheduleStateSave();
  return licenseStatus;
}

function safeModeLicense(validationCode) {
  licenseMachines = [];
  licenseStatus = {
    paymentProvider: "lemon-squeezy",
    licenseProvider: "lemon-license",
    plan: "trial",
    status: validationCode.includes("TAMPER") ? "tampered" : validationCode.includes("REVOK") ? "revoked" : validationCode.includes("LEMON") ? "safe-mode" : "free",
    seats: 1,
    supportUpdatesUntil: "2026-05-12",
    eligibleLatestVersion: "1.0.0",
    offlineGraceUntil: null,
    features: ["safe-mode", "export-data", "diagnostics"],
    deviceLimit: 1,
    machines: licenseMachines,
    entitlement: {
      provider: "lemon-squeezy",
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
  if (!isMockLemonLicenseKey(encodedKey)) {
    return safeModeLicense("LEMON_INVALID_LICENSE_KEY");
  }
  return activateLemonLicense(encodedKey);
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
    `License validation=${licenseStatus.lastValidationCode ?? "none"} Lemon event=${body.lemonEventType ?? "none"} Payment event=${body.paymentEventType ?? "none"}`,
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
      provider: "lemon-license",
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

function providerSecretRef(providerId, authMode, data = {}) {
  const source = [
    String(providerId ?? "").trim(),
    String(authMode ?? "").trim(),
    String(data.model ?? "").trim(),
    String(data.accountEmail ?? "").trim(),
    String(data.endpoint ?? "").trim(),
  ].join("|");
  return `psr_${crypto.createHash("sha256").update(`clawdesk-provider-secret-ref:${source}`).digest("hex").slice(0, 24)}`;
}

function tokenRefreshForAuthMode(authMode) {
  if (authMode === "oauth") {
    return { mode: "refreshable", lastRefreshStatus: "ready" };
  }
  if (authMode === "mock") {
    return { mode: "not-required", lastRefreshStatus: "not-configured" };
  }
  return { mode: "manual", lastRefreshStatus: "not-configured" };
}

function providerSecretRefContract() {
  return {
    version: "2026-05-15.provider-secret-ref.v1",
    storage: "server-side-secret-ref",
    rawSecretResponse: false,
    issueEndpoint: "/provider/secret-ref/issue",
    refreshEndpoint: "/provider/token-refresh",
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
  const providerId = typeof value === "string" && value.trim() ? value.trim() : "openai-api";
  return providerId === "openai" || providerId === "openai-api" ? providerId : "";
}

function normalizeOpenAiModel(value) {
  const model = typeof value === "string" ? value.trim() : "";
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
  const text = output
    .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
    .map((content) => content.text)
    .filter((value) => typeof value === "string" && value.trim())
    .join("\n")
    .trim();
  return text || "";
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
  const live = liveOpenAiRequested(body);
  if (!live) {
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
  if (!hasValidApiKey(apiKey, ["sk-"])) {
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
      payload: {
        providerId,
        model,
        status: "validated",
        live: true,
        checkedAt,
        requestId,
        rawSecretResponse: false,
      },
    };
  } catch (error) {
    return { code: 502, payload: safeOpenAiErrorPayload(error) };
  }
}

async function runOpenAiChatRuntime(body = {}) {
  const providerId = normalizeOpenAiProviderId(body.providerId);
  if (!providerId) return { code: 400, payload: { error: "Unsupported OpenAI provider", rawSecretResponse: false } };
  const model = normalizeOpenAiModel(body.model);
  const prompt = typeof body.prompt === "string" && body.prompt.trim()
    ? body.prompt.trim()
    : "Reply with a short ClawDesk OpenAI runtime check.";
  const checkedAt = nowIso();
  const live = liveOpenAiRequested(body);
  if (!live) {
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
  if (!hasValidApiKey(apiKey, ["sk-"])) {
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
      body: JSON.stringify({
        model,
        input: prompt,
        max_output_tokens: 64,
      }),
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

function parseModelValue(value, fallback) {
  const model = typeof value === "string" ? value.trim() : "";
  return model || fallback;
}

function makeProviderSession(provider, data = {}) {
  const model = parseModelValue(data.model, provider.modelDefault);
  const common = {
    displayName: provider.displayName,
    model,
    secretRef: provider.authMode === "mock" ? undefined : providerSecretRef(provider.id, provider.authMode, { ...data, model }),
    tokenRefresh: tokenRefreshForAuthMode(provider.authMode),
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
    const isOpenAiProvider = provider.id === "openai" || provider.id === "openai-api";
    return {
      ...common,
      activeProvider: provider.id,
      status: "connected",
      detail: `${provider.displayName} API key 已暫存於本機 mock Gateway，模型：${model}。`,
      maskedKey: maskSecret(apiKey),
      ...(isOpenAiProvider
        ? {
            runtime: {
              providerId: provider.id,
              apiStyle: "responses-api",
              status: "not-tested",
              live: false,
              message: "可用 OpenAI runtime probe 執行 dry-run 或 live Responses API 測試。",
            },
          }
        : {}),
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

async function readOllamaModels(endpoint) {
  const normalizedUrl = normalizeEndpoint(endpoint);
  if (!normalizedUrl) {
    return { ok: false, status: 400, error: "Ollama endpoint 格式無效。" };
  }
  const normalized = normalizedUrl.toString().replace(/\/+$/, "");
  if (!normalized.startsWith("http://127.0.0.1") && !normalized.startsWith("http://localhost")) {
    return { ok: false, status: 400, error: "Only local Ollama endpoints are allowed in this MVP." };
  }
  try {
    const response = await fetch(`${normalized}/api/tags`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, status: response.status, error: payload?.error || "Ollama model list failed." };
    }
    const models = Array.isArray(payload.models)
      ? payload.models.map((item) => ({
          name: String(item.name ?? item.model ?? ""),
          modifiedAt: item.modified_at ?? item.modifiedAt,
          capabilities: inferOllamaModelCapabilities(item),
        })).filter((item) => item.name).map((item) => ({
          ...item,
          capabilities: applyPersistedVisionProbe(normalized, item.name, item.capabilities),
        }))
      : [];
    return { ok: true, models };
  } catch (error) {
    return { ok: false, status: 503, error: String(error?.message ?? "Ollama endpoint unreachable.") };
  }
}

function visionProbeKey(endpoint, model) {
  return `${String(endpoint).replace(/\/+$/, "")}::${String(model).trim()}`;
}

function applyPersistedVisionProbe(endpoint, model, fallbackCapabilities) {
  const probe = visionProbeResults[visionProbeKey(endpoint, model)];
  if (!probe) return fallbackCapabilities;
  return {
    ...(fallbackCapabilities ?? {}),
    vision: Boolean(probe.vision),
    text: true,
    source: "probe",
    probedAt: probe.probedAt,
    reason: probe.vision
      ? "圖片能力 probe 通過；此模型可接收 image payload。"
      : "圖片能力 probe 未通過；貼圖將使用 metadata-only fallback。",
  };
}

function recordVisionProbe(endpoint, model, result) {
  const key = visionProbeKey(endpoint, model);
  visionProbeResults = {
    ...visionProbeResults,
    [key]: {
      endpoint,
      model,
      vision: Boolean(result.vision),
      mode: result.vision ? "vision-ready" : "metadata-only",
      outputText: String(result.outputText ?? result.error ?? "").slice(0, 400),
      probedAt: nowIso(),
    },
  };
  scheduleStateSave();
  return visionProbeResults[key];
}

function clearVisionProbe(endpoint, model) {
  const key = visionProbeKey(endpoint, model);
  if (!visionProbeResults[key]) return false;
  const next = { ...visionProbeResults };
  delete next[key];
  visionProbeResults = next;
  scheduleStateSave();
  return true;
}

function inferOllamaModelCapabilities(model = {}) {
  const name = String(model.name ?? model.model ?? "").toLowerCase();
  const details = model.details && typeof model.details === "object" ? model.details : {};
  const families = [
    details.family,
    ...(Array.isArray(details.families) ? details.families : []),
  ].filter(Boolean).map((item) => String(item).toLowerCase());
  const signal = [name, ...families].join(" ");
  const visionPattern = /\b(?:vision|vl|llava|bakllava|moondream|minicpm-v|pixtral|internvl|qwen2(?:\.5)?-vl|qwen-vl|llama3\.2-vision)\b/i;
  const textPattern = /\b(?:coder|text|embed|embedding)\b/i;
  const vision = visionPattern.test(signal);
  return {
    vision,
    text: true,
    source: "heuristic",
    reason: vision
      ? "模型名稱或 Ollama details 顯示 vision/VL 能力。"
      : textPattern.test(signal)
        ? "模型名稱顯示 text/coder/embed 類型；圖片將以 metadata fallback。"
        : "未偵測到 vision/VL 訊號；圖片 payload 會先嘗試，失敗時自動 fallback metadata。",
  };
}

async function runOllamaChatOnce({ endpoint, model, prompt }) {
  const normalizedUrl = normalizeEndpoint(endpoint);
  if (!normalizedUrl) {
    return { ok: false, status: 400, error: "Ollama endpoint 格式無效。" };
  }
  const normalized = normalizedUrl.toString().replace(/\/+$/, "");
  if (!normalized.startsWith("http://127.0.0.1") && !normalized.startsWith("http://localhost")) {
    return { ok: false, status: 400, error: "Only local Ollama endpoints are allowed in this MVP." };
  }
  try {
    const response = await fetch(`${normalized}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, status: response.status, error: payload?.error || "Ollama chat test failed." };
    }
    const outputText = String(payload?.message?.content ?? payload?.response ?? "").trim();
    return { ok: true, outputText, model };
  } catch (error) {
    return { ok: false, status: 503, error: String(error?.message ?? "Ollama endpoint unreachable.") };
  }
}

async function runOllamaVisionProbe({ endpoint, model }) {
  const normalizedUrl = normalizeEndpoint(endpoint);
  if (!normalizedUrl) {
    return { ok: false, status: 400, vision: false, error: "Ollama endpoint 格式無效。" };
  }
  const normalized = normalizedUrl.toString().replace(/\/+$/, "");
  if (!normalized.startsWith("http://127.0.0.1") && !normalized.startsWith("http://localhost")) {
    return { ok: false, status: 400, vision: false, error: "Only local Ollama endpoints are allowed in this MVP." };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`${normalized}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          {
            role: "user",
            content: "This is a ClawDesk image capability probe. Reply exactly VISION_OK only if you can receive and inspect the attached image payload. If you cannot inspect image pixels, reply VISION_UNSUPPORTED.",
            images: ["iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="],
          },
        ],
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const errorText = String(payload?.error ?? "");
      if (/image|vision|multimodal|unsupported|does not support/i.test(errorText)) {
        return {
          ok: true,
          vision: false,
          outputText: errorText,
          model,
        };
      }
      return {
        ok: false,
        status: response.status,
        vision: false,
        error: errorText || "Ollama vision probe failed.",
      };
    }
    const outputText = String(payload?.message?.content ?? payload?.response ?? "").trim();
    return {
      ok: true,
      vision: /\bVISION_OK\b/i.test(outputText),
      outputText,
      model,
    };
  } catch (error) {
    return {
      ok: false,
      status: 503,
      vision: false,
      error: error?.name === "AbortError" ? "Vision probe timed out." : String(error?.message ?? "Ollama endpoint unreachable."),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function runtimeReadinessSummary() {
  return openClawRuntimeSurfaces.reduce((summary, surface) => {
    summary[surface.status] = (summary[surface.status] ?? 0) + 1;
    return summary;
  }, {});
}

function summarizeProductComparison(items = productComparisonItems) {
  return items.reduce(
    (summary, item) => {
      summary[item.priority] = (summary[item.priority] ?? 0) + 1;
      summary.total += 1;
      return summary;
    },
    { p0: 0, p1: 0, p2: 0, later: 0, total: 0 },
  );
}

function summarizeSafetyPolicy(rules = defaultSafetyPolicyRules) {
  return rules.reduce(
    (summary, rule) => {
      summary[rule.riskLevel] = (summary[rule.riskLevel] ?? 0) + 1;
      if (rule.requiresApproval || rule.riskLevel === "high" || rule.riskLevel === "blocked") {
        summary.requiresApproval += 1;
      }
      return summary;
    },
    { low: 0, medium: 0, high: 0, blocked: 0, requiresApproval: 0 },
  );
}

function summarizeGatewayAdapter(methods = gatewayAdapterMethods) {
  return methods.reduce(
    (summary, method) => {
      summary[method.status] = (summary[method.status] ?? 0) + 1;
      summary.total += 1;
      return summary;
    },
    { ready: 0, partial: 0, mock: 0, deferred: 0, total: 0 },
  );
}

function createSafetyQueueItem(action, riskLevel = "medium", note = "") {
  const item = {
    id: `queue-${crypto.randomUUID().slice(0, 8)}`,
    action,
    riskLevel,
    status: "waiting-for-user",
    note: note || "等待人工審批",
    createdAt: nowIso(),
  };
  safetyQueue.unshift(item);
  safetyQueue = safetyQueue.slice(0, 200);
  scheduleStateSave();
  return item;
}

function fileSearchPreview(query, maxResults = 8) {
  const normalized = query.trim().toLowerCase();
  const matched = workspaceSearchIndex
    .filter((item) => item.path.toLowerCase().includes(normalized) || item.area.includes(normalized))
    .slice(0, Math.max(1, Math.min(maxResults, 20)));
  if (matched.length > 0) return matched;
  return workspaceSearchIndex.slice(0, Math.max(1, Math.min(maxResults, 8)));
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
      secretRefPolicy: "gateway-secret-ref",
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
      secretRefPolicy: "local-dpapi",
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
      secretRefPolicy: "none",
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
    secretRefPolicy: "gateway-secret-ref",
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

function findPasswordResetByEmail(email) {
  const now = Date.now();
  return identityPasswordResets.find((item) => item.email === email && !item.used && new Date(item.expiresAt).getTime() > now);
}

function issueIdentityPasswordReset(user) {
  const code = createIdentityVerificationCode();
  const now = Date.now();
  const expiresAt = new Date(now + 20 * 60 * 1000).toISOString();
  const record = {
    email: user.email,
    userId: user.id,
    code,
    createdAt: new Date(now).toISOString(),
    expiresAt,
    used: false,
    source: "mock",
  };
  identityPasswordResets.push(record);
  identityMailOutbox.unshift({
    to: user.email,
    subject: "ClawDesk 密碼重設驗證信",
    body: `請在 20 分鐘內使用重設碼 ${code} 完成 ClawDesk 密碼更新。`,
    token: code,
    code,
    createdAt: record.createdAt,
    purpose: "password-reset",
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

function consumeIdentityPasswordReset({ email, code }) {
  const now = Date.now();
  const target = identityPasswordResets.find((item) => item.email === email && !item.used && item.code === code);
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

async function streamTextDelta(conversationId, text) {
  const messageId = `agent-${Date.now()}`;
  for (const token of text.match(/.{1,24}/g) ?? []) {
    broadcast({
      type: "agent.message.delta",
      conversationId,
      messageId,
      delta: token,
    });
    await delay(24);
  }
  broadcast({ type: "agent.message.done", conversationId, messageId });
  return messageId;
}

async function streamRuntimeCanvas(conversationId, title, summaryText, rows = []) {
  const surfaceId = `runtime-${conversationId}`;
  broadcast({ type: "canvas.begin", surfaceId, title });
  await delay(80);
  broadcast({
    type: "canvas.patch",
    surfaceId,
    rootId: "root",
    components: [
      {
        id: "root",
        type: "Panel",
        props: { title },
        children: ["summary", "provider", "model", "table", "approve"],
      },
      { id: "summary", type: "Text", props: { text: summaryText } },
      { id: "provider", type: "Metric", props: { label: "Provider", value: providerSession.displayName ?? "本機模型 endpoint" } },
      { id: "model", type: "Metric", props: { label: "Model", value: providerSession.model ?? "not configured" } },
      {
        id: "table",
        type: "Table",
        props: {
          columns: ["項目", "狀態", "說明"],
          rows,
        },
      },
      { id: "approve", type: "Button", props: { label: "檢視後續需要授權的動作" } },
    ],
  });

  const request = {
    type: "permission.request",
    requestId: crypto.randomUUID(),
    action: "runtime.next-step",
    target: providerSession.endpoint ?? "/chat",
    risk: "low",
    summary: "LLM 回覆已完成；若下一步要讀寫檔案、呼叫工具或使用外部 connector，仍需人工確認。",
  };
  pendingPermissions.set(request.requestId, request);
  broadcast(request);
}

function normalizeImageAttachments(attachments = []) {
  if (!Array.isArray(attachments)) return [];
  return attachments
    .map((item) => {
      const name = typeof item?.name === "string" && item.name.trim() ? item.name.trim().slice(0, 160) : "未命名圖片";
      const mimeType = typeof item?.mimeType === "string" && item.mimeType.startsWith("image/") ? item.mimeType : "image/png";
      const dataUrl = typeof item?.dataUrl === "string" ? item.dataUrl : "";
      const match = dataUrl.match(/^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=]+)$/i);
      const base64 = match?.[1] ?? "";
      const sizeBytes = Number(item?.sizeBytes ?? Math.floor((base64.length * 3) / 4));
      if (base64 && sizeBytes > 4 * 1024 * 1024) {
        return { name, mimeType, sizeBytes, rejected: true, reason: "圖片超過 4MB，已只傳 metadata。" };
      }
      return { name, mimeType, sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : 0, base64 };
    })
    .filter(Boolean)
    .slice(0, 6);
}

async function streamOllamaRuntime(conversationId, prompt, attachments = []) {
  const endpoint = providerSession.endpoint || "http://127.0.0.1:11434";
  const model = providerSession.model || "llama3.3";
  const messageId = `agent-${Date.now()}`;
  const imageAttachments = normalizeImageAttachments(attachments);
  const imagePayloads = imageAttachments.filter((item) => item.base64 && !item.rejected).map((item) => item.base64);
  const attachmentText =
    imageAttachments.length > 0
      ? `\n\n使用者同時附上 ${imageAttachments.length} 個圖片附件：${imageAttachments
          .map((item) => `${item.name} (${item.base64 && !item.rejected ? "payload" : "metadata"})`)
          .join("、")}。若目前模型不支援 vision，請明確告知只能根據文字與圖片 metadata 回覆。`
      : "";

  try {
    const normalizedUrl = normalizeEndpoint(endpoint);
    if (!normalizedUrl) throw new Error("Ollama endpoint 格式無效。");
    const normalized = normalizedUrl.toString().replace(/\/+$/, "");
    const createRequest = (includeImagePayloads) => ({
      model,
      stream: true,
      messages: [
        {
          role: "user",
          content: `${prompt}${attachmentText}`,
          ...(includeImagePayloads && imagePayloads.length > 0 ? { images: imagePayloads } : {}),
        },
      ],
    });
    const fetchOllamaChat = (body, timeoutMs = 20000) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      return fetch(`${normalized}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));
    };
    let usedImagePayloads = imagePayloads.length;
    let response;
    try {
      response = await fetchOllamaChat(createRequest(true));
    } catch (error) {
      if (imagePayloads.length === 0) throw error;
      usedImagePayloads = 0;
      response = await fetchOllamaChat(createRequest(false));
    }
    if (!response.ok && imagePayloads.length > 0) {
      const payload = await response.json().catch(() => ({}));
      const reason = String(payload?.error ?? response.status);
      if (/image|vision|multimodal|unsupported|does not support/i.test(reason)) {
        usedImagePayloads = 0;
        response = await fetchOllamaChat(createRequest(false));
      } else {
        throw new Error(payload?.error || `Ollama chat failed: ${response.status}`);
      }
    }
    if (!response.ok || !response.body) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload?.error || `Ollama chat failed: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let emitted = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const payload = JSON.parse(line);
        const delta = String(payload?.message?.content ?? payload?.response ?? "");
        if (delta) {
          emitted = true;
          broadcast({ type: "agent.message.delta", conversationId, messageId, delta });
        }
      }
    }
    if (!emitted) {
      broadcast({ type: "agent.message.delta", conversationId, messageId, delta: "LLM 已完成，但沒有回傳文字內容。" });
    }
    broadcast({ type: "agent.message.done", conversationId, messageId });
    await streamRuntimeCanvas(conversationId, "本機模型 / Ollama Runtime", "聊天回覆已由目前設定的本機模型 endpoint 產生。", [
      { 項目: "Endpoint", 狀態: "connected", 說明: endpoint },
      { 項目: "Model", 狀態: "streamed", 說明: model },
      {
        項目: "Attachments",
        狀態: String(imageAttachments.length),
        說明: imageAttachments.length > 0
          ? `payload ${usedImagePayloads} / metadata ${imageAttachments.length - usedImagePayloads}`
          : "無附件",
      },
    ]);
  } catch (error) {
    const message = `本機模型 runtime 失敗：${String(error?.message ?? error)}。請重新整理模型清單或按測試確認 endpoint。`;
    await streamTextDelta(conversationId, message);
    await streamRuntimeCanvas(conversationId, "本機模型 / Ollama Runtime Error", message, [
      { 項目: "Endpoint", 狀態: "failed", 說明: endpoint },
      { 項目: "Model", 狀態: "failed", 說明: model },
    ]);
  }
}

async function streamDemo(conversationId, prompt, attachments = []) {
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
  const attachmentSummary =
    Array.isArray(attachments) && attachments.length > 0
      ? `我也收到 ${attachments.length} 個圖片附件（${attachments.map((item) => item.name || item.mimeType || "未命名圖片").join("、")}）。`
      : "";
  const response =
    `${providerPrefix} 我會透過安全的桌面邊界處理「${prompt}」；` +
    `${attachmentSummary} ClawDesk mock Gateway 正在串流回覆、更新 Live Canvas，並針對高風險動作要求使用者授權。`;

  await streamTextDelta(conversationId, response);

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
            { 區域: "Sidecar", 狀態: "Mock", 下一步: "替換為正式 Gateway" },
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

async function streamOpenAiRuntimeDemo(conversationId, prompt, attachments = []) {
  const providerId = normalizeOpenAiProviderId(providerSession.activeProvider);
  const model = normalizeOpenAiModel(providerSession.model);
  const result = await runOpenAiChatRuntime({
    providerId,
    model,
    prompt,
    secretRef: providerSession.secretRef,
  });
  const payload = result.payload;
  const runtimeStatus = String(payload?.status ?? "failed");
  const runtimeMessage = runtimeStatus === "validated" ? "已驗證" : runtimeStatus === "dry-run" ? "Dry-run" : "失敗";
  const responseText =
    payload?.outputText && typeof payload.outputText === "string"
      ? payload.outputText
      : `${runtimeMessage}：OpenAI runtime 回應不可用，已回退到 mock 流。`;
  const providerName = providerDisplayLabel(providerId ?? providerSession.activeProvider ?? "openai-api");
  const requestId = typeof payload?.requestId === "string" ? payload.requestId : "";

  providerSession = {
    ...providerSession,
    runtime: {
      providerId: payload?.providerId ?? providerId ?? "openai-api",
      apiStyle: "responses-api",
      status: runtimeStatus,
      live: Boolean(payload?.live),
      checkedAt: payload?.checkedAt ?? nowIso(),
      requestId,
      message: runtimeMessage,
    },
  };

  const attachmentSummary =
    Array.isArray(attachments) && attachments.length > 0 ? `已收到 ${attachments.length} 個圖片附件。` : "";
  await streamTextDelta(conversationId, `${runtimeMessage}（${model}）：${responseText}。${attachmentSummary}`);

  const surfaceId = "workspace-openai-runtime";
  broadcast({ type: "canvas.begin", surfaceId, title: "OpenAI Runtime 測試報告" });
  broadcast({
    type: "canvas.patch",
    surfaceId,
    rootId: "root",
    components: [
      {
        id: "root",
        type: "Panel",
        props: { title: "OpenAI Responses API" },
        children: ["summary", "provider", "model", "status", "notes", "request", "permission"],
      },
      {
        id: "summary",
        type: "Text",
        props: {
          text: `${providerName} 已完成 ${runtimeMessage}，回應內容範例：${responseText.slice(0, 140)}。`,
        },
      },
      { id: "provider", type: "Metric", props: { label: "供應商", value: payload?.providerId ?? providerId ?? "openai" } },
      { id: "model", type: "Metric", props: { label: "模型", value: model } },
      { id: "status", type: "Metric", props: { label: "狀態", value: runtimeStatus } },
      { id: "request", type: "Metric", props: { label: "requestId", value: requestId || "mock-only" } },
      {
        id: "notes",
        type: "Text",
        props: {
          text: "未設定 live 時為 dry-run；啟用 live 請設定 CLAWDESK_OPENAI_LIVE_TEST=1 並提供 OPENAI_API_KEY。",
        },
      },
      {
        id: "permission",
        type: "Button",
        props: { label: "繼續 OpenAI runtime 任務" },
      },
    ],
  });

  const permission = {
    type: "permission.request",
    requestId: crypto.randomUUID(),
    action: "openai-runtime-check",
    target: "/provider/openai/chat-test",
    risk: "low",
    summary: `${providerName} runtime 已完成 ${runtimeMessage}，請確認是否允許繼續執行。`,
  };
  pendingPermissions.set(permission.requestId, permission);
  broadcast(permission);
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

  if (
    pathname.startsWith("/api/auth/")
    || pathname.startsWith("/api/license/")
    || pathname === "/api/account/entitlements"
    || pathname === "/api/webhooks/lemonsqueezy"
    || pathname === "/api/payment/lemonsqueezy/webhook"
  ) {
    if (!identityBackendEnabled) {
      json(res, 503, { error: "UniversalServer backend is not configured for this mock gateway." });
      return;
    }
    const body = req.method === "POST" ? await readJson(req).catch(() => "__invalid_json__") : undefined;
    if (body === "__invalid_json__") {
      json(res, 400, { error: "Invalid JSON" });
      return;
    }
    const response = await callBackendApi(pathname, {
      method: req.method,
      headers: getBackendIdentityToken() ? { Authorization: `Bearer ${getBackendIdentityToken()}` } : undefined,
      body,
      query: Object.fromEntries(parsedUrl.searchParams.entries()),
    });
    if (!response) {
      json(res, 503, { error: "UniversalServer backend is unavailable." });
      return;
    }
    if (pathname === "/api/auth/login" && response.ok && response.payload?.session?.token) {
      setBackendIdentityToken(response.payload.session.token);
    }
    if (pathname === "/api/auth/logout" && response.ok) {
      setBackendIdentityToken("");
    }
    json(res, response.status || (response.ok ? 200 : 502), response.payload);
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
      licenseStatus = { ...licenseStatus, machines: licenseMachines, lastValidationCode: "LEMON_MACHINE_DEACTIVATED" };
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
        json(res, 200, { status: safeModeLicense("LEMON_TAMPERED_LICENSE_FILE") });
        return;
      }
      licenseStatus = { ...licenseStatus, lastValidationCode: licenseStatus.status === "active" ? "LEMON_LICENSE_ACTIVE" : licenseStatus.lastValidationCode };
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
          storedAs: "mock hashed Lemon Squeezy offline entitlement",
          expiresAt: "2099-12-31",
        },
      });
      return;
    }
    licenseStatus = { ...licenseStatus, offlineGraceUntil: "2026-06-11", lastValidationCode: "LEMON_OFFLINE_ENTITLEMENT_REFRESHED" };
    json(res, 200, {
      status: licenseStatus,
      ticket: {
        storedAs: "mock hashed Lemon Squeezy offline entitlement",
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
        serverAction: "report-to-lemon",
        faultCode: "CLWD-LIC-1001",
      };
      json(res, 200, { event: response?.payload?.id ? response.payload : fallbackEvent, status: safeModeLicense("LEMON_TAMPER_REPORTED") });
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
      serverAction: "report-to-lemon",
      faultCode: "CLWD-LIC-1001",
    };
    json(res, 200, { event, status: safeModeLicense("LEMON_TAMPER_REPORTED") });
    return;
  }

  if (req.method === "POST" && pathname === "/webhooks/paddle/mock") {
    json(res, 410, { error: "Paddle is disabled. Lemon Squeezy is the only payment and license provider." });
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
    json(res, 410, { error: "Keygen is disabled. Lemon Squeezy is the only payment and license provider." });
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
    const supportLicenseKey = backendLicenseState.licenseKey || "CLWD-BETA-PRO1-2026";
    if (identityBackendEnabled) {
      const latestCheck = await callBackendApi("/updates/check");
      const response = await callBackendApi("/webhooks/lemon", {
        method: "POST",
        body: {
          eventType: "subscription_updated",
          licenseKey: supportLicenseKey,
          note: "frontend-support-renewal",
        },
      });
      if (response?.ok) {
        audit("updates.renew-support", {
          supportUpdatesUntil: response.payload?.license?.supportUpdatesUntil ?? "2028-05-12",
          licenseKeyHash: licenseKeyHash(supportLicenseKey),
        });
        licenseStatus = {
          ...licenseStatus,
          supportUpdatesUntil: response.payload?.license?.supportUpdatesUntil ?? "2028-05-12",
          eligibleLatestVersion: "1.8.0",
          lastValidationCode: "LEMON_SUPPORT_RENEWED",
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
    licenseStatus = { ...licenseStatus, supportUpdatesUntil: "2028-05-12", eligibleLatestVersion: "1.8.0", lastValidationCode: "LEMON_SUPPORT_RENEWED" };
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
          privacyChecklist: ["不含 Email", "不含完整路徑", "不含完整 license key", "不含 API key", "不含聊天內容", "不含螢幕截圖", "不含 Lemon customer id 明文", "法務同意僅含版本、hash、同意時間"],
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
      privacyChecklist: ["不含 Email", "不含完整路徑", "不含完整 license key", "不含 API key", "不含聊天內容", "不含螢幕截圖", "不含 Lemon customer id 明文", "法務同意僅含版本、hash、同意時間"],
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
      const response = await callBackendApi("/api/auth/me", {
        method: "GET",
        headers: { Authorization: `Bearer ${getBackendIdentityToken()}` },
      });
      if (response?.ok && response.payload?.account) {
        const mapped = normalizeIdentitySessionFromBackend(response.payload.account);
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

  if (req.method === "GET" && pathname === "/identity/password-reset-code") {
    try {
      const email = typeof parsedUrl.searchParams.get("email") === "string"
        ? parsedUrl.searchParams.get("email").trim().toLowerCase()
        : "";
      if (!email.includes("@")) {
        json(res, 400, { error: "valid email required" });
        return;
      }
      const latest = identityBackendEnabled ? getBackendPasswordResetRecord(email) : findPasswordResetByEmail(email);
      if (!latest) {
        json(res, 404, { error: "password reset record not found" });
        return;
      }
      json(res, 200, {
        email,
        code: latest.code,
        expiresAt: latest.expiresAt,
        subject: "ClawDesk 密碼重設驗證信",
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
        const response = await callBackendApi("/api/auth/resend-verification", {
          method: "POST",
          body: { email },
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
        const response = await callBackendApi("/api/auth/verify-email", {
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
        const response = await callBackendApi("/api/auth/register", {
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
        const response = await callBackendApi("/api/auth/login", {
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
          if (developerIdentityEmails.has(email)) {
            user.mode = existing?.mode ?? "enterprise";
            user.role = existing?.role ?? "owner";
            user.organization = existing?.organization ?? user.organization;
          }
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
    if (identityBackendEnabled && getBackendIdentityToken()) {
      await callBackendApi("/api/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${getBackendIdentityToken()}` },
      });
    }
    identitySession = identitySessionSignedOut();
    setBackendIdentityToken("");
    safeModeLicense("HOBBY_MODE");
    audit("identity.logout", {});
    scheduleStateSave();
    json(res, 200, identitySession);
    return;
  }

  if (req.method === "POST" && pathname === "/identity/forgot-password") {
    try {
      const body = await readJson(req);
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      if (!email.includes("@")) {
        json(res, 400, { error: "valid email required" });
        return;
      }
      if (identityBackendEnabled) {
        const response = await callBackendApi("/api/auth/password/forgot", {
          method: "POST",
          body: { email },
        });
        if (!response?.ok) {
          json(res, response?.status ?? 400, { error: response?.payload?.error || "password reset request failed" });
          return;
        }
        if (response.payload?.debugResetToken) {
          setBackendPasswordResetCode(email, response.payload.debugResetToken);
        }
        audit("identity.password-forgot", { emailHash: hashForAudit(email), backend: true });
        scheduleStateSave();
        json(res, 200, {
          ok: true,
          email,
          expiresAt: response.payload?.expiresAt,
          message: response.payload?.message ?? "password reset challenge issued",
        });
        return;
      }
      const user = identityUsers.find((item) => item.email === email);
      if (user && user.emailVerified !== false) {
        const reset = issueIdentityPasswordReset(user);
        audit("identity.password-forgot", { emailHash: hashForAudit(email), backend: false });
        scheduleStateSave();
        json(res, 200, { ok: true, email, expiresAt: reset.expiresAt, message: "password reset challenge issued" });
        return;
      }
      audit("identity.password-forgot.ignored", { emailHash: hashForAudit(email), backend: false });
      json(res, 200, { ok: true, email, message: "If the account exists, a reset challenge has been issued." });
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/identity/reset-password") {
    try {
      const body = await readJson(req);
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const code = typeof body.code === "string" ? body.code.trim() : "";
      const password = typeof body.password === "string" ? body.password : "";
      if (!email.includes("@") || !code || password.length < 8) {
        json(res, 400, { error: "email, code, and password are required" });
        return;
      }
      if (identityBackendEnabled) {
        const response = await callBackendApi("/api/auth/password/reset", {
          method: "POST",
          body: { email, code, password },
        });
        if (!response?.ok) {
          json(res, response?.status ?? 400, { error: response?.payload?.error || "password reset failed" });
          return;
        }
        consumeBackendPasswordReset(email, code);
        audit("identity.password-reset", { emailHash: hashForAudit(email), backend: true });
        scheduleStateSave();
        json(res, 200, { ok: true, email, passwordUpdated: true });
        return;
      }
      const user = identityUsers.find((item) => item.email === email);
      if (!user) {
        json(res, 404, { error: "account not found" });
        return;
      }
      const reset = consumeIdentityPasswordReset({ email, code });
      if (!reset) {
        json(res, 400, { error: "invalid or expired reset code" });
        return;
      }
      user.passwordHash = hashIdentityPassword(password);
      identitySession = identitySessionSignedOut();
      audit("identity.password-reset", { emailHash: hashForAudit(email), backend: false });
      scheduleStateSave();
      json(res, 200, { ok: true, email, passwordUpdated: true });
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
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

  if (req.method === "GET" && pathname === "/provider/status") {
    json(res, 200, {
      ...providerSession,
      credentialPolicy:
        providerSession.activeProvider === "mock"
          ? "no-secret"
          : providerSession.accountEmail
            ? "account-token-stub"
            : "masked-in-memory",
      fallback: providerSession.activeProvider === "mock" ? [] : ["mock", "local-model"],
    });
    return;
  }

  if (req.method === "GET" && pathname === "/provider/local-model/models") {
    const endpoint = parsedUrl.searchParams.get("endpoint") || providerSession.endpoint || "http://127.0.0.1:11434";
    const result = await readOllamaModels(endpoint);
    if (!result.ok) {
      json(res, result.status ?? 503, { error: result.error, endpoint });
      return;
    }
    json(res, 200, { endpoint, models: result.models });
    return;
  }

  if (req.method === "POST" && pathname === "/provider/local-model/test") {
    try {
      const body = await readJson(req);
      const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : providerSession.endpoint || "http://127.0.0.1:11434";
      const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : providerSession.model || "llama3.3";
      const prompt = typeof body.prompt === "string" && body.prompt.trim()
        ? body.prompt.trim()
        : "Reply briefly: ClawDesk LLM connection test succeeded.";
      const result = await runOllamaChatOnce({ endpoint, model, prompt });
      if (!result.ok) {
        json(res, result.status ?? 503, { ok: false, error: result.error, endpoint, model });
        return;
      }
      json(res, 200, {
        ok: true,
        endpoint,
        model,
        outputText: result.outputText,
      });
    } catch {
      json(res, 400, { ok: false, error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/provider/local-model/vision-test") {
    try {
      const body = await readJson(req);
      const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : providerSession.endpoint || "http://127.0.0.1:11434";
      const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : providerSession.model || "llama3.3";
      const result = await runOllamaVisionProbe({ endpoint, model });
      const normalizedUrl = normalizeEndpoint(endpoint);
      const normalizedEndpoint = normalizedUrl ? normalizedUrl.toString().replace(/\/+$/, "") : endpoint;
      const persisted = result.ok ? recordVisionProbe(normalizedEndpoint, model, result) : undefined;
      json(res, result.ok ? 200 : result.status ?? 503, {
        ...result,
        endpoint,
        mode: result.vision ? "vision-ready" : "metadata-only",
        persisted,
      });
    } catch {
      json(res, 400, { ok: false, vision: false, mode: "metadata-only", error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/provider/local-model/vision-clear") {
    try {
      const body = await readJson(req);
      const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : providerSession.endpoint || "http://127.0.0.1:11434";
      const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : providerSession.model || "llama3.3";
      const normalizedUrl = normalizeEndpoint(endpoint);
      const normalizedEndpoint = normalizedUrl ? normalizedUrl.toString().replace(/\/+$/, "") : endpoint;
      const cleared = clearVisionProbe(normalizedEndpoint, model);
      json(res, 200, { ok: true, cleared, endpoint: normalizedEndpoint, model });
    } catch {
      json(res, 400, { ok: false, error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "GET" && pathname === "/provider/secret-ref/contract") {
    json(res, 200, providerSecretRefContract());
    return;
  }

  if (req.method === "POST" && pathname === "/provider/secret-ref/issue") {
    try {
      const body = await readJson(req);
      const providerId = typeof body.providerId === "string" ? body.providerId.trim() : "";
      const provider = llmProviderById(providerId);
      if (!provider) {
        json(res, 404, { error: "Unknown provider" });
        return;
      }
      const authMode = typeof body.authMode === "string" && body.authMode.trim() ? body.authMode.trim() : provider.authMode;
      const issuedAt = nowIso();
      const payload = {
        providerId,
        authMode,
        secretRef: providerSecretRef(providerId, authMode, body),
        model: typeof body.model === "string" ? body.model.trim() : provider.modelDefault,
        issuedAt,
        status: "active",
        tokenRefresh: tokenRefreshForAuthMode(authMode),
      };
      audit("provider.secret-ref.issue", { providerId, authMode, secretRef: payload.secretRef });
      json(res, 200, payload);
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/provider/token-refresh") {
    try {
      const body = await readJson(req);
      const secretRef = typeof body.secretRef === "string" ? body.secretRef.trim() : "";
      if (!secretRef.startsWith("psr_")) {
        json(res, 404, { error: "Unknown SecretRef" });
        return;
      }
      const providerId = typeof body.providerId === "string" ? body.providerId.trim() : providerSession.activeProvider;
      const expiresAt = new Date(Date.now() + 55 * 60 * 1000).toISOString();
      const response = {
        providerId,
        secretRef,
        status: providerSession.tokenRefresh?.mode === "refreshable" ? "refreshed" : "not-required",
        accessTokenRef:
          providerSession.tokenRefresh?.mode === "refreshable"
            ? `ptr_${crypto.createHash("sha256").update(`${secretRef}:${expiresAt}`).digest("hex").slice(0, 24)}`
            : undefined,
        expiresAt: providerSession.tokenRefresh?.mode === "refreshable" ? expiresAt : undefined,
      };
      providerSession = {
        ...providerSession,
        tokenRefresh: {
          ...(providerSession.tokenRefresh ?? tokenRefreshForAuthMode("mock")),
          lastRefreshStatus: response.status === "refreshed" ? "refreshed" : "not-configured",
          expiresAt: response.expiresAt,
        },
      };
      audit("provider.token-refresh", { providerId, secretRef, status: response.status });
      scheduleStateSave();
      json(res, 200, response);
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "GET" && pathname === "/provider/openai/runtime-contract") {
    json(res, 200, openAiRuntimeContract());
    return;
  }

  if (req.method === "POST" && pathname === "/provider/openai/validate-key") {
    try {
      const result = await validateOpenAiKeyRuntime(await readJson(req));
      audit("provider.openai.validate-key", {
        status: result.payload.status ?? "failed",
        live: Boolean(result.payload.live),
        requestId: result.payload.requestId,
      });
      json(res, result.code, result.payload);
    } catch {
      json(res, 400, { error: "Invalid JSON", rawSecretResponse: false });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/provider/openai/chat-test") {
    try {
      const result = await runOpenAiChatRuntime(await readJson(req));
      providerSession = {
        ...providerSession,
        runtime: {
          providerId: result.payload.providerId ?? "openai-api",
          apiStyle: "responses-api",
          status: result.payload.status ?? "failed",
          live: Boolean(result.payload.live),
          checkedAt: result.payload.checkedAt,
          requestId: result.payload.requestId,
          message: result.payload.outputText ?? result.payload.error,
        },
      };
      audit("provider.openai.chat-test", {
        status: result.payload.status ?? "failed",
        live: Boolean(result.payload.live),
        requestId: result.payload.requestId,
      });
      scheduleStateSave();
      json(res, result.code, result.payload);
    } catch {
      json(res, 400, { error: "Invalid JSON", rawSecretResponse: false });
    }
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

  if (req.method === "GET" && ["/compat/settings", "/openclaw/settings"].includes(req.url)) {
    json(res, 200, { sections: openClawSettingsSchema, profile: openClawSettingsProfile });
    return;
  }

  if (req.method === "POST" && ["/compat/settings", "/openclaw/settings"].includes(req.url)) {
    try {
      const body = await readJson(req);
      openClawSettingsProfile = {
        ...openClawSettingsProfile,
        ...body,
      };
      audit("compat.settings.update", { sections: Object.keys(body).slice(0, 20), legacyPath: req.url === "/openclaw/settings" });
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

  if (req.method === "GET" && ["/compat/upstream/import-status", "/openclaw/upstream/import-status"].includes(pathname)) {
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

  if (req.method === "GET" && ["/compat/feature-parity", "/openclaw/feature-parity"].includes(pathname)) {
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

  if (req.method === "GET" && pathname === "/product-comparison") {
    json(res, 200, {
      items: productComparisonItems,
      summary: summarizeProductComparison(),
      strategy: "Windows GUI Agent workspace, not terminal-only clone or full communication gateway clone.",
    });
    return;
  }

  if (req.method === "GET" && pathname === "/safety-policy") {
    json(res, 200, {
      rules: defaultSafetyPolicyRules,
      summary: summarizeSafetyPolicy(),
      queue: safetyQueue,
    });
    return;
  }

  if (req.method === "GET" && pathname === "/safety-queue") {
    json(res, 200, { queue: safetyQueue });
    return;
  }

  if (req.method === "POST" && pathname === "/safety-queue/decision") {
    try {
      const body = await readJson(req);
      const id = typeof body.id === "string" ? body.id.trim() : "";
      const decision = typeof body.decision === "string" ? body.decision.trim().toLowerCase() : "";
      const note = typeof body.note === "string" ? body.note.trim() : "";
      if (!id || !["approve", "reject"].includes(decision)) {
        json(res, 400, { error: "id and decision(approve|reject) are required" });
        return;
      }
      const item = safetyQueue.find((entry) => entry.id === id);
      if (!item) {
        json(res, 404, { error: "queue item not found" });
        return;
      }
      item.status = decision === "approve" ? "approved" : "rejected";
      item.note = note || item.note || "已審批";
      item.updatedAt = nowIso();
      audit("safety.queue.decision", { id, action: item.action, decision, riskLevel: item.riskLevel });
      scheduleStateSave();
      json(res, 200, { item, queue: safetyQueue });
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "GET" && pathname === "/targets") {
    json(res, 200, {
      registry: cloneTargetRegistryState(targetRegistry),
      dispatches: targetDispatches.slice(0, 200),
      summary: {
        totalTargets: targetRegistry.targets.length,
        readyTargets: targetRegistry.targets.filter((target) => target.state === "ready").length,
        pairedTargets: targetRegistry.targets.filter((target) => target.paired).length,
        defaultTargetId: targetRegistry.defaultTargetId,
      },
    });
    return;
  }

  if (req.method === "GET" && pathname === "/targets/timeline") {
    const targetId = typeof parsedUrl.searchParams.get("targetId") === "string" ? parsedUrl.searchParams.get("targetId").trim() : "";
    if (!targetId) {
      json(res, 400, { error: "targetId is required" });
      return;
    }
    const timeline = buildTargetTimelineState(targetId, 6);
    if (!timeline.targetId || !timeline.entries.length) {
      const targetExists = targetRegistry.targets.some((target) => target.id === targetId);
      if (!targetExists) {
        json(res, 404, { error: "target not found" });
        return;
      }
    }
    json(res, 200, {
      ...timeline,
      registry: cloneTargetRegistryState(targetRegistry),
    });
    return;
  }

  if (req.method === "GET" && pathname === "/targets/audit-report") {
    const targetId = typeof parsedUrl.searchParams.get("targetId") === "string" ? parsedUrl.searchParams.get("targetId").trim() : "";
    if (!targetId) {
      json(res, 400, { error: "targetId is required" });
      return;
    }
    const limit = Math.max(1, Math.min(20, Number(parsedUrl.searchParams.get("limit") ?? 12)));
    const target = targetRegistry.targets.find((entry) => entry.id === targetId);
    if (!target) {
      json(res, 404, { error: "target not found" });
      return;
    }
    const report = buildTargetAuditReportState(targetId, limit);
    audit("targets.audit.report", {
      targetId,
      kind: target.kind,
      entryCount: report.timeline.length,
      readinessReady: report.readiness.readyToConnect,
      nextAction: report.readiness.nextAction,
    });
    json(res, 200, {
      ...report,
      registry: cloneTargetRegistryState(targetRegistry),
    });
    return;
  }

  if (req.method === "POST" && pathname === "/targets") {
    try {
      const body = await readJson(req);
      const nextRegistry = normalizeTargetRegistryState(body.registry);
      targetRegistry = nextRegistry;
      audit("targets.registry.save", {
        totalTargets: nextRegistry.targets.length,
        defaultTargetId: nextRegistry.defaultTargetId,
      });
      scheduleStateSave();
      json(res, 200, {
        registry: cloneTargetRegistryState(targetRegistry),
        dispatches: targetDispatches.slice(0, 200),
      });
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/targets/dispatch-preview") {
    try {
      const body = await readJson(req);
      const preview = body.preview ?? body;
      if (!preview || typeof preview !== "object") {
        json(res, 400, { error: "preview is required" });
        return;
      }
      audit("targets.dispatch.preview", {
        targetId: preview.target?.id,
        category: preview.request?.category,
        allowed: preview.decision?.allowed,
        requiresApproval: preview.decision?.requiresApproval,
      });
      json(res, 200, { preview });
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/targets/dispatch") {
    try {
      const body = await readJson(req);
      const record = body.record ?? body;
      if (!record || typeof record !== "object" || typeof record.id !== "string" || typeof record.targetId !== "string") {
        json(res, 400, { error: "record is required" });
        return;
      }
      targetDispatches.unshift(record);
      targetDispatches = targetDispatches.slice(0, 200);
      audit("targets.dispatch.record", {
        recordId: record.id,
        targetId: record.targetId,
        category: record.category,
        allowed: record.decision?.allowed,
      });
      scheduleStateSave();
      json(res, 200, {
        record,
        dispatches: targetDispatches.slice(0, 200),
        registry: cloneTargetRegistryState(targetRegistry),
      });
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/targets/execute") {
    try {
      const body = await readJson(req);
      const preview = body.preview ?? body;
      const request = preview.request ?? body.request ?? {};
      const command = typeof request.command === "string" ? request.command : typeof body.command === "string" ? body.command : "";
      const targetId = typeof body.targetId === "string" ? body.targetId.trim() : typeof preview.target?.id === "string" ? preview.target.id.trim() : "";
      const record = body.record ?? preview.record ?? null;
      if (!targetId || !record || typeof record !== "object" || typeof record.id !== "string") {
        json(res, 400, { error: "targetId and record are required" });
        return;
      }
      const target = targetRegistry.targets.find((entry) => entry.id === targetId);
      if (!target) {
        json(res, 404, { error: "target not found" });
        return;
      }

  const execution = await runSshTerminalInteractiveCommand(target, command);
      if (!execution.allowed) {
        audit("targets.execute.rejected", {
          targetId,
          category: request.category ?? "execute_safe",
          reason: execution.reason,
        });
        json(res, 200, {
          allowed: false,
          reason: execution.reason,
          execution: execution.execution,
          target: execution.target,
          registry: cloneTargetRegistryState(targetRegistry),
          dispatches: targetDispatches.slice(0, 200),
        });
        return;
      }

      targetRegistry = {
        ...targetRegistry,
        targets: targetRegistry.targets.map((entry) => (entry.id === targetId ? execution.target : entry)),
      };
      targetDispatches.unshift(record);
      targetDispatches = targetDispatches.slice(0, 200);
      audit("targets.execute", {
        targetId,
        category: request.category ?? "execute_safe",
        runner: execution.execution?.mode,
        exitCode: execution.execution?.exitCode,
        stdoutBytes: execution.execution?.stdout?.length ?? 0,
        stderrBytes: execution.execution?.stderr?.length ?? 0,
      });
      scheduleStateSave();
      json(res, 200, {
        allowed: true,
        reason: execution.reason,
        target: execution.target,
        execution: execution.execution,
        record,
        registry: cloneTargetRegistryState(targetRegistry),
        dispatches: targetDispatches.slice(0, 200),
      });
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/targets/execute-batch") {
    try {
      const body = await readJson(req);
      const preview = body.preview ?? body;
      const request = preview.request ?? body.request ?? {};
      const command = typeof request.command === "string" ? request.command : typeof body.command === "string" ? body.command : "";
      const targetIds = Array.isArray(body.targetIds)
        ? body.targetIds.map((value) => (typeof value === "string" ? value.trim() : "")).filter(Boolean)
        : [];
      if (!targetIds.length) {
        json(res, 400, { error: "targetIds are required" });
        return;
      }
      const record = body.record ?? preview.record ?? null;
      if (!record || typeof record !== "object" || typeof record.id !== "string") {
        json(res, 400, { error: "record is required" });
        return;
      }

      const executionResults = [];
      const updatedTargets = new Map();
      const appliedRecords = [];
      for (const targetId of targetIds) {
        const target = targetRegistry.targets.find((entry) => entry.id === targetId);
        if (!target) {
          executionResults.push({ targetId, allowed: false, reason: "target not found" });
          continue;
        }

        const execution = await executeTargetCommandState(target, command);
        if (!execution.allowed) {
          executionResults.push({ targetId, allowed: false, reason: execution.reason, execution: execution.execution });
          continue;
        }

        updatedTargets.set(targetId, execution.target);
        const targetRecord = {
          ...record,
          id: `${record.id}-${sanitizeTargetStorageKey(targetId)}`,
          targetId,
          targetName: target.displayName,
          createdAt: nowIso(),
        };
        appliedRecords.push(targetRecord);
        executionResults.push({
          targetId,
          allowed: true,
          reason: execution.reason,
          execution: execution.execution,
          record: targetRecord,
          target: execution.target,
        });
      }

      if (updatedTargets.size > 0) {
        targetRegistry = {
          ...targetRegistry,
          targets: targetRegistry.targets.map((entry) => (updatedTargets.has(entry.id) ? updatedTargets.get(entry.id) : entry)),
        };
        targetDispatches.unshift(...appliedRecords);
        targetDispatches = targetDispatches.slice(0, 200);
      }
      audit("targets.execute.batch", {
        targetCount: executionResults.length,
        allowedCount: executionResults.filter((item) => item.allowed).length,
        failedCount: executionResults.filter((item) => !item.allowed).length,
        category: request.category ?? "execute_safe",
      });
      scheduleStateSave();

      json(res, 200, {
        allowed: true,
        reason: "Batch execution completed.",
        results: executionResults,
        registry: cloneTargetRegistryState(targetRegistry),
        dispatches: targetDispatches.slice(0, 200),
      });
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/targets/credential-ref/issue") {
    try {
      const body = await readJson(req);
      const targetId = typeof body.targetId === "string" ? body.targetId.trim() : "";
      const target = targetRegistry.targets.find((entry) => entry.id === targetId);
      const kind = typeof body.kind === "string" && body.kind.trim() ? body.kind.trim() : "ssh-private-key";
      const privateKey = typeof body.privateKey === "string" ? body.privateKey : typeof body.secret === "string" ? body.secret : "";
      const label = typeof body.label === "string" ? body.label : "";
      if (!targetId || !target || (target.kind !== "ssh-terminal" && target.kind !== "remote-desktop")) {
        json(res, 400, { error: "SSH or remote-desktop targetId is required" });
        return;
      }
      if (target.kind === "ssh-terminal" && kind !== "ssh-private-key") {
        json(res, 400, { error: "Unsupported credential kind" });
        return;
      }
      if (target.kind === "remote-desktop" && kind === "ssh-private-key") {
        json(res, 400, { error: "Remote desktop credential kind is required" });
        return;
      }
      const payload = await issueTargetCredentialRefState({ targetId, label, kind, privateKey });
      audit("targets.credential-ref.issue", {
        targetId,
        targetName: target.displayName,
        credentialRef: payload.credentialRef,
        kind: payload.kind,
      });
      json(res, 200, {
        ...payload,
        targetName: target.displayName,
      });
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/targets/credential-bundle/export") {
    try {
      const body = await readJson(req);
      const targetIds = Array.isArray(body.targetIds) ? body.targetIds : undefined;
      const passphrase = typeof body.passphrase === "string" ? body.passphrase : "";
      const payload = await createTargetCredentialBundleState({ targetIds, passphrase });
      const bundleText = `${JSON.stringify(payload.bundle, null, 2)}\n`;
      audit("targets.credential-bundle.export", {
        targetCount: payload.targetCount,
        secretCount: payload.secretCount,
        targetIds: Array.isArray(targetIds)
          ? targetIds.filter((value) => typeof value === "string").slice(0, 20)
          : [],
      });
      json(res, 200, {
        bundle: payload.bundle,
        bundleText,
        targetCount: payload.targetCount,
        secretCount: payload.secretCount,
      });
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/targets/credential-bundle/preview") {
    try {
      const body = await readJson(req);
      const passphrase = typeof body.passphrase === "string" ? body.passphrase : "";
      const bundle = body.bundle ?? (typeof body.bundleText === "string" && body.bundleText.trim() ? JSON.parse(body.bundleText) : undefined);
      const payload = decryptTargetCredentialBundlePayload(bundle, passphrase);
      if (!payload || typeof payload !== "object" || payload.version !== 1) {
        throw new Error("Unsupported credential bundle payload.");
      }
      const importedRegistry = normalizeTargetRegistryState(payload.registry);
      const importedSecrets = normalizeCredentialBundleSecrets(payload.credentialSecrets);
      const currentTargetById = new Map(targetRegistry.targets.map((target) => [target.id, target]));
      const currentGroupById = new Map((targetRegistry.targetGroups ?? []).map((group) => [group.id, group]));
      const addedTargets = importedRegistry.targets.filter((target) => !currentTargetById.has(target.id));
      const updatedTargets = importedRegistry.targets.filter((target) => {
        const current = currentTargetById.get(target.id);
        if (!current) return false;
        return JSON.stringify(current.connection) !== JSON.stringify(target.connection)
          || JSON.stringify(current.adapters) !== JSON.stringify(target.adapters)
          || JSON.stringify(current.trustedWorkspaces) !== JSON.stringify(target.trustedWorkspaces)
          || current.displayName !== target.displayName
          || current.kind !== target.kind
          || current.endpoint !== target.endpoint;
      });
      const unchangedTargets = importedRegistry.targets.filter((target) => !addedTargets.some((item) => item.id === target.id) && !updatedTargets.some((item) => item.id === target.id));
      const addedGroups = (importedRegistry.targetGroups ?? []).filter((group) => !currentGroupById.has(group.id));
      const updatedGroups = (importedRegistry.targetGroups ?? []).filter((group) => {
        const current = currentGroupById.get(group.id);
        if (!current) return false;
        return JSON.stringify(current.targetIds) !== JSON.stringify(group.targetIds)
          || current.name !== group.name
          || current.description !== group.description;
      });
      const unchangedGroups = (importedRegistry.targetGroups ?? []).filter((group) => !addedGroups.some((item) => item.id === group.id) && !updatedGroups.some((item) => item.id === group.id));
      const secretTargetIds = importedSecrets.map((secretEntry) => secretEntry.targetId);
      const summary = {
        version: payload.version,
        createdAt: payload.createdAt ?? null,
        targetCount: importedRegistry.targets.length,
        groupCount: Array.isArray(importedRegistry.targetGroups) ? importedRegistry.targetGroups.length : 0,
        secretCount: importedSecrets.length,
        targetIds: importedRegistry.targets.map((target) => target.id),
        targetNames: importedRegistry.targets.map((target) => target.displayName),
        groupIds: Array.isArray(importedRegistry.targetGroups) ? importedRegistry.targetGroups.map((group) => group.id) : [],
        groupNames: Array.isArray(importedRegistry.targetGroups) ? importedRegistry.targetGroups.map((group) => group.name) : [],
        secretKinds: importedSecrets.map((secretEntry) => secretEntry.kind),
        secretLabels: importedSecrets.map((secretEntry) => secretEntry.label || secretEntry.targetName || secretEntry.targetId),
        addedTargetIds: addedTargets.map((target) => target.id),
        addedTargetNames: addedTargets.map((target) => target.displayName),
        updatedTargetIds: updatedTargets.map((target) => target.id),
        updatedTargetNames: updatedTargets.map((target) => target.displayName),
        unchangedTargetIds: unchangedTargets.map((target) => target.id),
        addedGroupIds: addedGroups.map((group) => group.id),
        addedGroupNames: addedGroups.map((group) => group.name),
        updatedGroupIds: updatedGroups.map((group) => group.id),
        updatedGroupNames: updatedGroups.map((group) => group.name),
        unchangedGroupIds: unchangedGroups.map((group) => group.id),
        secretTargetIds,
        overwriteCount: updatedTargets.length,
        groupOverwriteCount: updatedGroups.length,
        importCount: importedRegistry.targets.length,
      };
      audit("targets.credential-bundle.preview", {
        targetCount: summary.targetCount,
        groupCount: summary.groupCount,
        secretCount: summary.secretCount,
        addedTargetCount: summary.addedTargetIds.length,
        updatedTargetCount: summary.updatedTargetIds.length,
        addedGroupCount: summary.addedGroupIds.length,
        updatedGroupCount: summary.updatedGroupIds.length,
      });
      json(res, 200, {
        allowed: true,
        reason: "Credential bundle preview ready.",
        summary,
      });
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/targets/credential-bundle/import") {
    try {
      const body = await readJson(req);
      const passphrase = typeof body.passphrase === "string" ? body.passphrase : "";
      const bundle = body.bundle ?? (typeof body.bundleText === "string" && body.bundleText.trim() ? JSON.parse(body.bundleText) : undefined);
      const result = await applyTargetCredentialBundleState(bundle, passphrase);
      json(res, 200, {
        allowed: result.allowed,
        reason: result.reason,
        registry: result.registry,
        targetCount: result.targetCount,
        secretCount: result.secretCount,
      });
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/targets/pairing-ticket") {
    try {
      const body = await readJson(req);
      const targetId = typeof body.targetId === "string" ? body.targetId.trim() : "";
      const targetName = typeof body.targetName === "string" ? body.targetName.trim() : "";
      const kind = typeof body.kind === "string" ? body.kind.trim() : "";
      const expiresInMinutes = Number(body.expiresInMinutes ?? 15);
      const target = targetId ? targetRegistry.targets.find((entry) => entry.id === targetId) : null;
      if (targetId && !target) {
        json(res, 404, { error: "target not found" });
        return;
      }
      const ticket = issueTargetPairingTicketState(target ?? {
        id: targetId || `pair-${crypto.randomUUID().slice(0, 8)}`,
        displayName: targetName || "Target",
        kind: kind === "remote-desktop" ? "remote-desktop" : kind === "ssh-terminal" ? "ssh-terminal" : "ssh-terminal",
        state: "offline",
        paired: false,
        trustedWorkspaces: [],
        adapters: [
          {
            kind: kind === "remote-desktop" ? "remote-desktop" : "ssh-terminal",
            endpoint: "",
            authenticated: false,
            hostKeyVerified: false,
            supportsTerminal: kind !== "remote-desktop",
            supportsScreen: kind === "remote-desktop",
            supportsClipboard: false,
            supportsFileTransfer: false,
          },
        ],
        connection: defaultTargetConnectionState(kind === "remote-desktop" ? "remote-desktop" : "ssh-terminal"),
      }, { expiresInMinutes });
      audit("targets.pairing-ticket.generated", {
        targetId: ticket.targetId,
        targetName: ticket.targetName,
        kind: ticket.kind,
        expiresAt: ticket.expiresAt,
      });
      scheduleStateSave();
      json(res, 200, {
        allowed: true,
        reason: "Pairing code issued.",
        ticket,
      });
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/targets/host-enrollment-ticket") {
    try {
      const body = await readJson(req);
      const targetId = typeof body.targetId === "string" ? body.targetId.trim() : "";
      const targetName = typeof body.targetName === "string" ? body.targetName.trim() : "";
      const kind = typeof body.kind === "string" ? body.kind.trim() : "";
      const hostName = typeof body.hostName === "string" ? body.hostName.trim() : "";
      const bridgeVersion = typeof body.bridgeVersion === "string" ? body.bridgeVersion.trim() : "";
      const expiresInMinutes = Number(body.expiresInMinutes ?? 30);
      const target = targetId ? targetRegistry.targets.find((entry) => entry.id === targetId) : null;
      if (targetId && !target) {
        json(res, 404, { error: "target not found" });
        return;
      }
      const ticket = issueTargetHostEnrollmentTicketState(
        target ?? {
          id: targetId || `host-${crypto.randomUUID().slice(0, 8)}`,
          displayName: targetName || "Target",
          kind: kind === "remote-desktop" ? "remote-desktop" : kind === "ssh-terminal" ? "ssh-terminal" : "ssh-terminal",
          state: "offline",
          paired: false,
          trustedWorkspaces: [],
          adapters: [
            {
              kind: kind === "remote-desktop" ? "remote-desktop" : "ssh-terminal",
              endpoint: "",
              authenticated: false,
              hostKeyVerified: false,
              supportsTerminal: kind !== "remote-desktop",
              supportsScreen: kind === "remote-desktop",
              supportsClipboard: false,
              supportsFileTransfer: false,
            },
          ],
          connection: defaultTargetConnectionState(kind === "remote-desktop" ? "remote-desktop" : "ssh-terminal"),
        },
        { expiresInMinutes, hostName: hostName || targetName, bridgeVersion: bridgeVersion || undefined },
      );
      scheduleStateSave();
      json(res, 200, {
        allowed: true,
        reason: "Host enrollment code issued.",
        ticket,
      });
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/targets/host-enrollment") {
    try {
      const body = await readJson(req);
      const targetId = typeof body.targetId === "string" ? body.targetId.trim() : "";
      const enrollmentCode = typeof body.enrollmentCode === "string" ? body.enrollmentCode.trim() : "";
      const bridgeId = typeof body.bridgeId === "string" ? body.bridgeId.trim() : "";
      const hostName = typeof body.hostName === "string" ? body.hostName.trim() : "";
      const bridgeVersion = typeof body.bridgeVersion === "string" ? body.bridgeVersion.trim() : "";
      if (!targetId || !enrollmentCode) {
        json(res, 400, { error: "targetId and enrollmentCode are required" });
        return;
      }
      const target = targetRegistry.targets.find((entry) => entry.id === targetId);
      if (!target) {
        json(res, 404, { error: "target not found" });
        return;
      }
      const result = await applyTargetConnectionActionState(target, "enroll_host", { enrollmentCode, bridgeId, hostName, bridgeVersion });
      if (result.allowed && result.target) {
        targetRegistry = {
          ...targetRegistry,
          targets: targetRegistry.targets.map((entry) => (entry.id === targetId ? result.target : entry)),
        };
        audit("targets.host-enrollment", {
          targetId,
          targetName: result.target.displayName,
          bridgeId: result.target.connection?.hostBridge?.bridgeId,
          hostName,
          bridgeVersion,
          allowed: result.allowed,
        });
        scheduleStateSave();
      } else {
        audit("targets.host-enrollment.rejected", { targetId, allowed: result.allowed, reason: result.reason });
      }
      json(res, 200, {
        allowed: result.allowed,
        reason: result.reason,
        target: result.target,
        registry: cloneTargetRegistryState(targetRegistry),
      });
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/targets/host-bridge/heartbeat") {
    try {
      const body = await readJson(req);
      const targetId = typeof body.targetId === "string" ? body.targetId.trim() : "";
      const bridgeId = typeof body.bridgeId === "string" ? body.bridgeId.trim() : "";
      const hostName = typeof body.hostName === "string" ? body.hostName.trim() : "";
      const bridgeVersion = typeof body.bridgeVersion === "string" ? body.bridgeVersion.trim() : "";
      if (!targetId) {
        json(res, 400, { error: "targetId is required" });
        return;
      }
      const target = targetRegistry.targets.find((entry) => entry.id === targetId);
      if (!target) {
        json(res, 404, { error: "target not found" });
        return;
      }
      const result = await applyTargetConnectionActionState(target, "heartbeat", { bridgeId, hostName, bridgeVersion });
      if (result.allowed && result.target) {
        targetRegistry = {
          ...targetRegistry,
          targets: targetRegistry.targets.map((entry) => (entry.id === targetId ? result.target : entry)),
        };
        audit("targets.host-bridge.heartbeat", {
          targetId,
          targetName: result.target.displayName,
          bridgeId: result.target.connection?.hostBridge?.bridgeId,
          hostName,
          bridgeVersion,
          allowed: result.allowed,
        });
        scheduleStateSave();
      } else {
        audit("targets.host-bridge.heartbeat.rejected", { targetId, allowed: result.allowed, reason: result.reason });
      }
      json(res, 200, {
        allowed: result.allowed,
        reason: result.reason,
        target: result.target,
        registry: cloneTargetRegistryState(targetRegistry),
      });
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/targets/host-bridge/attest") {
    try {
      const body = await readJson(req);
      const targetId = typeof body.targetId === "string" ? body.targetId.trim() : "";
      const bridgeId = typeof body.bridgeId === "string" ? body.bridgeId.trim() : "";
      const hostName = typeof body.hostName === "string" ? body.hostName.trim() : "";
      const bridgeVersion = typeof body.bridgeVersion === "string" ? body.bridgeVersion.trim() : "";
      const deviceId = typeof body.deviceId === "string" ? body.deviceId.trim() : "";
      const installId = typeof body.installId === "string" ? body.installId.trim() : "";
      const platform = typeof body.platform === "string" ? body.platform.trim() : "";
      if (!targetId) {
        json(res, 400, { error: "targetId is required" });
        return;
      }
      const target = targetRegistry.targets.find((entry) => entry.id === targetId);
      if (!target) {
        json(res, 404, { error: "target not found" });
        return;
      }
      const result = await applyTargetConnectionActionState(target, "attest", { bridgeId, hostName, bridgeVersion, deviceId, installId, platform });
      if (result.allowed && result.target) {
        targetRegistry = {
          ...targetRegistry,
          targets: targetRegistry.targets.map((entry) => (entry.id === targetId ? result.target : entry)),
        };
        audit("targets.host-bridge.attest", {
          targetId,
          targetName: result.target.displayName,
          bridgeId: result.target.connection?.hostBridge?.bridgeId,
          hostName,
          bridgeVersion,
          deviceId: result.target.connection?.hostBridge?.deviceId,
          installId: result.target.connection?.hostBridge?.installId,
          platform: result.target.connection?.hostBridge?.platform,
          allowed: result.allowed,
        });
        scheduleStateSave();
      } else {
        audit("targets.host-bridge.attest.rejected", { targetId, allowed: result.allowed, reason: result.reason });
      }
      json(res, 200, {
        allowed: result.allowed,
        reason: result.reason,
        target: result.target,
        registry: cloneTargetRegistryState(targetRegistry),
      });
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/targets/connection") {
    try {
      const body = await readJson(req);
      const targetId = typeof body.targetId === "string" ? body.targetId.trim() : "";
      const action = typeof body.action === "string" ? body.action.trim() : "";
      const pairingCode = typeof body.pairingCode === "string" ? body.pairingCode.trim() : "";
      const enrollmentCode = typeof body.enrollmentCode === "string" ? body.enrollmentCode.trim() : "";
      const bridgeId = typeof body.bridgeId === "string" ? body.bridgeId.trim() : "";
      const hostName = typeof body.hostName === "string" ? body.hostName.trim() : "";
      const bridgeVersion = typeof body.bridgeVersion === "string" ? body.bridgeVersion.trim() : "";
      const deviceId = typeof body.deviceId === "string" ? body.deviceId.trim() : "";
      const installId = typeof body.installId === "string" ? body.installId.trim() : "";
      const platform = typeof body.platform === "string" ? body.platform.trim() : "";
      if (!targetId || !action) {
        json(res, 400, { error: "targetId and action are required" });
        return;
      }
      const target = targetRegistry.targets.find((entry) => entry.id === targetId);
      if (!target) {
        json(res, 404, { error: "target not found" });
        return;
      }
      const result = await applyTargetConnectionActionState(target, action, { pairingCode, enrollmentCode, bridgeId, hostName, bridgeVersion, deviceId, installId, platform });
      if (result.allowed && result.target) {
        targetRegistry = {
          ...targetRegistry,
          targets: targetRegistry.targets.map((entry) => (entry.id === targetId ? result.target : entry)),
        };
        audit(action === "probe" ? "targets.connection.probe" : "targets.connection", {
          targetId,
          action,
          state: result.target.state,
          allowed: result.allowed,
          lastProbeAt: result.target.connection?.lastProbeAt,
          lastProbeResult: result.target.connection?.lastProbeResult,
          lastProbeHost: result.target.connection?.lastProbeHost,
          lastProbePort: result.target.connection?.lastProbePort,
          lastProbeLatencyMs: result.target.connection?.lastProbeLatencyMs,
          lastProbeError: result.target.connection?.lastProbeError,
          pairingCodeUsed: Boolean(pairingCode && action === "pair"),
          enrollmentCodeUsed: Boolean(enrollmentCode && action === "enroll_host"),
          bridgeIdUsed: Boolean(bridgeId && (action === "heartbeat" || action === "attest")),
        });
        scheduleStateSave();
      } else {
        audit("targets.connection.rejected", {
          targetId,
          action,
          allowed: result.allowed,
          reason: result.reason,
          pairingCodeUsed: Boolean(pairingCode && action === "pair"),
          enrollmentCodeUsed: Boolean(enrollmentCode && action === "enroll_host"),
          bridgeIdUsed: Boolean(bridgeId && (action === "heartbeat" || action === "attest")),
        });
      }
      json(res, 200, {
        allowed: result.allowed,
        reason: result.reason,
        target: result.target,
        registry: cloneTargetRegistryState(targetRegistry),
        dispatches: targetDispatches.slice(0, 200),
      });
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "GET" && pathname === "/targets/connection-readiness") {
    const targetId = typeof parsedUrl.searchParams.get("targetId") === "string" ? parsedUrl.searchParams.get("targetId").trim() : "";
    if (!targetId) {
      json(res, 400, { error: "targetId is required" });
      return;
    }
    const target = targetRegistry.targets.find((entry) => entry.id === targetId);
    if (!target) {
      json(res, 404, { error: "target not found" });
      return;
    }
    const report = buildTargetConnectionReadinessReportState(target);
    audit("targets.connection.readiness", {
      targetId,
      targetName: target.displayName,
      readyToConnect: report.readyToConnect,
      nextAction: report.nextAction,
      checkCount: report.checks.length,
    });
    json(res, 200, {
      report,
      target: cloneTargetRegistryState(targetRegistry).targets.find((entry) => entry.id === targetId),
    });
    return;
  }

  if (req.method === "GET" && pathname === "/targets/ssh-terminal/session") {
    const targetId = typeof parsedUrl.searchParams.get("targetId") === "string" ? parsedUrl.searchParams.get("targetId").trim() : "";
    if (!targetId) {
      json(res, 400, { error: "targetId is required" });
      return;
    }
    const target = targetRegistry.targets.find((entry) => entry.id === targetId);
    if (!target) {
      json(res, 404, { error: "target not found" });
      return;
    }
    if (target.kind !== "ssh-terminal") {
      json(res, 400, { error: "target is not an SSH terminal target" });
      return;
    }
    json(res, 200, {
      session: getSshTerminalSessionState(target),
      target: cloneTargetRegistryState(targetRegistry).targets.find((entry) => entry.id === targetId),
    });
    return;
  }

  if (req.method === "GET" && pathname === "/targets/ssh-terminal/session-export") {
    const targetId = typeof parsedUrl.searchParams.get("targetId") === "string" ? parsedUrl.searchParams.get("targetId").trim() : "";
    if (!targetId) {
      json(res, 400, { error: "targetId is required" });
      return;
    }
    const target = targetRegistry.targets.find((entry) => entry.id === targetId);
    if (!target) {
      json(res, 404, { error: "target not found" });
      return;
    }
    if (target.kind !== "ssh-terminal") {
      json(res, 400, { error: "target is not an SSH terminal target" });
      return;
    }
    const session = getSshTerminalSessionState(target);
    const text = formatTargetSessionExportText(target, session);
    audit("targets.ssh-terminal.session.export", {
      targetId,
      kind: target.kind,
      entryCount: Array.isArray(session.transcript) ? session.transcript.length : 0,
    });
    json(res, 200, {
      target: cloneTargetRegistryState(targetRegistry).targets.find((entry) => entry.id === targetId),
      session,
      text,
    });
    return;
  }

  if (req.method === "POST" && pathname === "/targets/ssh-terminal/session") {
    try {
      const body = await readJson(req);
      const targetId = typeof body.targetId === "string" ? body.targetId.trim() : "";
      const action = typeof body.action === "string" ? body.action.trim() : "";
      const command = typeof body.command === "string" ? body.command : "";
      if (!targetId || !action) {
        json(res, 400, { error: "targetId and action are required" });
        return;
      }
      const target = targetRegistry.targets.find((entry) => entry.id === targetId);
      if (!target) {
        json(res, 404, { error: "target not found" });
        return;
      }
      if (target.kind !== "ssh-terminal") {
        json(res, 400, { error: "target is not an SSH terminal target" });
        return;
      }

      let result;
      if (action === "open_session" || action === "open" || action === "connect") {
        result = await openSshTerminalSessionState(target);
      } else if (action === "run_command" || action === "send_command" || action === "execute") {
        result = await runSshTerminalSessionCommandState(target, command);
      } else if (action === "close_session" || action === "close" || action === "disconnect") {
        result = await closeSshTerminalSessionState(target);
      } else if (action === "reconnect" || action === "resume_session") {
        result = await reconnectSshTerminalRuntime(target);
      } else if (action === "refresh" || action === "observe") {
        const now = nowIso();
        const session = refreshSshTerminalSessionView(target, getSshTerminalSessionState(target), now);
        result = {
          allowed: true,
          reason: "SSH terminal session snapshot refreshed.",
          target: {
            ...normalizeTargetProfileState(target),
            lastSeenAt: now,
          },
          session,
        };
      } else {
        json(res, 400, { error: "Unsupported SSH terminal session action" });
        return;
      }

      if (result.target && result.allowed !== false) {
        targetRegistry = {
          ...targetRegistry,
          targets: targetRegistry.targets.map((entry) => (entry.id === targetId ? result.target : entry)),
        };
      }
      if (result.session || result.record || result.target) {
        scheduleStateSave();
      }

      if (result.allowed) {
        audit("targets.ssh-terminal.session", {
          targetId,
          action,
          state: result.session?.state,
          exitCode: result.execution?.exitCode,
        });
      } else {
        audit("targets.ssh-terminal.session.rejected", {
          targetId,
          action,
          allowed: result.allowed,
          reason: result.reason,
        });
      }

      json(res, 200, {
        allowed: result.allowed,
        reason: result.reason,
        target: result.target,
        session: result.session,
        execution: result.execution,
        record: result.record,
        registry: cloneTargetRegistryState(targetRegistry),
        dispatches: targetDispatches.slice(0, 200),
      });
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : "Invalid JSON" });
    }
    return;
  }

  if (req.method === "GET" && pathname === "/targets/remote-desktop/session") {
    const targetId = typeof parsedUrl.searchParams.get("targetId") === "string" ? parsedUrl.searchParams.get("targetId").trim() : "";
    if (!targetId) {
      json(res, 400, { error: "targetId is required" });
      return;
    }
    const target = targetRegistry.targets.find((entry) => entry.id === targetId);
    if (!target) {
      json(res, 404, { error: "target not found" });
      return;
    }
    if (target.kind !== "remote-desktop") {
      json(res, 400, { error: "target is not a remote desktop target" });
      return;
    }
    json(res, 200, {
      session: getRemoteDesktopSessionState(target),
      target: cloneTargetRegistryState(targetRegistry).targets.find((entry) => entry.id === targetId),
    });
    return;
  }

  if (req.method === "GET" && pathname === "/targets/remote-desktop/session-export") {
    const targetId = typeof parsedUrl.searchParams.get("targetId") === "string" ? parsedUrl.searchParams.get("targetId").trim() : "";
    if (!targetId) {
      json(res, 400, { error: "targetId is required" });
      return;
    }
    const target = targetRegistry.targets.find((entry) => entry.id === targetId);
    if (!target) {
      json(res, 404, { error: "target not found" });
      return;
    }
    if (target.kind !== "remote-desktop") {
      json(res, 400, { error: "target is not a remote desktop target" });
      return;
    }
    const session = getRemoteDesktopSessionState(target);
    const text = formatTargetSessionExportText(target, session);
    audit("targets.remote-desktop.session.export", {
      targetId,
      kind: target.kind,
      entryCount: Array.isArray(session.launchHistory) ? session.launchHistory.length : 0,
    });
    json(res, 200, {
      target: cloneTargetRegistryState(targetRegistry).targets.find((entry) => entry.id === targetId),
      session,
      text,
    });
    return;
  }

  if (req.method === "POST" && pathname === "/targets/remote-desktop/session") {
    try {
      const body = await readJson(req);
      const targetId = typeof body.targetId === "string" ? body.targetId.trim() : "";
      const action = typeof body.action === "string" ? body.action.trim() : "";
      if (!targetId || !action) {
        json(res, 400, { error: "targetId and action are required" });
        return;
      }
      const target = targetRegistry.targets.find((entry) => entry.id === targetId);
      if (!target) {
        json(res, 404, { error: "target not found" });
        return;
      }
      if (target.kind !== "remote-desktop") {
        json(res, 400, { error: "target is not a remote desktop target" });
        return;
      }

      let result;
      if (action === "observe_screen" || action === "observe" || action === "refresh") {
        result = observeRemoteDesktopSessionState(target);
      } else if (action === "request_control" || action === "request-approval") {
        result = requestRemoteDesktopControlState(target);
      } else if (action === "seed_credentials" || action === "prepare_credentials") {
        result = await seedRemoteDesktopCredentialState(target);
        if (result.allowed && result.target) {
          const currentSession = refreshRemoteDesktopSessionState(target, getRemoteDesktopSessionState(target), nowIso());
          const seededSession = withRemoteDesktopSessionSummary(result.target, {
            ...currentSession,
            credentialSource: result.credentialSource ?? currentSession.credentialSource ?? "none",
            credentialSeedState: result.credentialSeedState ?? "prepared",
            credentialSeedAt: nowIso(),
            credentialSeedError: undefined,
            lastUpdatedAt: nowIso(),
            notes: [...currentSession.notes.slice(-4), `Remote desktop credential seeded for ${result.credentialTarget ?? "TERMSRV"}.`],
          });
          remoteDesktopSessions.set(remoteDesktopSessionStorageKey(target.id), seededSession);
          audit("targets.remote-desktop.credential-seed", {
            targetId: target.id,
            targetName: target.displayName,
            credentialSource: result.credentialSource ?? target.connection?.credentialMode ?? "none",
            credentialSeedState: result.credentialSeedState ?? "prepared",
            credentialTarget: result.credentialTarget,
          });
          result = {
            ...result,
            session: seededSession,
          };
        }
      } else if (action === "release_control") {
        result = releaseRemoteDesktopSessionState(target);
      } else if (action === "disconnect") {
        result = await disconnectRemoteDesktopSessionState(target);
      } else if (action === "launch_client" || action === "launch" || action === "open_client") {
        result = await launchRemoteDesktopClientState(target);
      } else if (action === "reconnect" || action === "relaunch" || action === "resume_client") {
        result = await reconnectRemoteDesktopClientState(target);
      } else {
        json(res, 400, { error: "Unsupported remote desktop action" });
        return;
      }

      if (result.allowed && result.target) {
        targetRegistry = {
          ...targetRegistry,
          targets: targetRegistry.targets.map((entry) => (entry.id === targetId ? result.target : entry)),
        };
        scheduleStateSave();
        audit("targets.remote-desktop.session", {
          targetId,
          action,
          state: result.session?.state,
          mode: result.session?.mode,
          clientLaunchState: result.session?.clientLaunchState,
          clientLaunchCommand: result.session?.clientLaunchCommand,
          clientLaunchPid: result.session?.clientLaunchPid,
          credentialSource: result.session?.credentialSource,
          credentialSeedState: result.session?.credentialSeedState,
        });
      } else {
        audit("targets.remote-desktop.session.rejected", {
          targetId,
          action,
          allowed: result.allowed,
          reason: result.reason,
        });
      }

      json(res, 200, {
        allowed: result.allowed,
        reason: result.reason,
        target: result.target,
        session: result.session,
        permissionRequest: result.permissionRequest,
        launch: result.launch,
        registry: cloneTargetRegistryState(targetRegistry),
        dispatches: targetDispatches.slice(0, 200),
      });
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : "Invalid JSON" });
    }
    return;
  }

  if (req.method === "GET" && pathname === "/coding-workspace") {
    json(res, 200, {
      ...codingWorkspaceSnapshot,
      adapterSummary: summarizeGatewayAdapter(),
    });
    return;
  }

  if (req.method === "POST" && pathname === "/coding-workspace/file-search") {
    try {
      const body = await readJson(req);
      const query = typeof body.query === "string" ? body.query.trim() : "";
      const maxResults = Number.isFinite(body.maxResults) ? Number(body.maxResults) : 8;
      if (!query) {
        json(res, 400, { error: "query is required" });
        return;
      }
      const results = fileSearchPreview(query, maxResults).map((item) => ({
        ...item,
        preview: `Match in ${item.area}: ${item.path}`,
      }));
      audit("coding.file-search", { query, count: results.length });
      json(res, 200, { query, count: results.length, results });
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/coding-workspace/patch-preview") {
    try {
      const body = await readJson(req);
      const target = typeof body.target === "string" ? body.target.trim() : "";
      const summary = typeof body.summary === "string" ? body.summary.trim() : "";
      const riskLevel = typeof body.riskLevel === "string" ? body.riskLevel.trim().toLowerCase() : "medium";
      if (!target || !summary) {
        json(res, 400, { error: "target and summary are required" });
        return;
      }
      const normalizedRisk = ["low", "medium", "high", "blocked"].includes(riskLevel) ? riskLevel : "medium";
      const queueItem = createSafetyQueueItem(`patch.apply:${target}`, normalizedRisk, "Patch preview produced; waiting approval");
      const preview = {
        id: `preview-${crypto.randomUUID().slice(0, 8)}`,
        target,
        summary,
        riskLevel: normalizedRisk,
        requiresApproval: normalizedRisk !== "low",
        queueItemId: queueItem.id,
        createdAt: nowIso(),
      };
      audit("coding.patch-preview", { target, riskLevel: normalizedRisk, queueItemId: queueItem.id });
      json(res, 200, { preview, queue: safetyQueue });
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "GET" && pathname === "/context-budget") {
    json(res, 200, {
      budget: defaultContextBudget,
      recommendation: defaultContextBudget.recommendedAction,
    });
    return;
  }

  if (req.method === "GET" && pathname === "/gateway-adapter/contract") {
    json(res, 200, {
      mode: "windows-sidecar-contract",
      methods: gatewayAdapterMethods,
      summary: summarizeGatewayAdapter(),
      productionGap: "Mock endpoint only; signed production Gateway adapter is still a release gate.",
    });
    return;
  }

  if (req.method === "GET" && ["/compat/runtime-contract", "/openclaw/runtime-contract"].includes(pathname)) {
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

  if (req.method === "POST" && ["/compat/runtime/auth-plan", "/openclaw/runtime/auth-plan"].includes(pathname)) {
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
          `上游帳號授權已登錄：${(body.accountEmail || "").trim()}，模型為 ${providerSession.model ?? "gpt-5.3-codex"}。` +
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
      const prompt = typeof body.prompt === "string" && body.prompt.trim() ? body.prompt : "empty prompt";
      const attachments = Array.isArray(body.attachments) ? body.attachments : [];
      json(res, 202, { accepted: true, conversationId });
      const openAiProviderId = normalizeOpenAiProviderId(providerSession.activeProvider);
      if (providerSession.activeProvider === "local-model" || providerSession.activeProvider === "ollama") {
        void streamOllamaRuntime(conversationId, prompt, attachments);
      } else if (openAiProviderId) {
        void streamOpenAiRuntimeDemo(conversationId, prompt, attachments);
      } else {
        void streamDemo(conversationId, prompt, attachments);
      }
    } catch {
      json(res, 400, { error: "Invalid JSON" });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/permission-result") {
    try {
      const body = await readJson(req);
      const result = applyPermissionResultState(body);
      broadcast(body);
      json(res, 200, {
        accepted: true,
        applied: result.applied,
        remoteDesktopSession: result.remoteDesktopSession,
      });
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
        applyPermissionResultState(message);
        broadcast(message);
      }
    } catch {
      // Ignore malformed client frames in the mock server.
    }
  });

  socket.on("close", () => clients.delete(socket));
  socket.on("error", () => clients.delete(socket));
});

await Promise.all([loadPersistedState(), loadTargetCredentialVaultState()]);

server.listen(port, host, () => {
  console.log(`ClawDesk mock gateway 已啟動：http://${host}:${port}`);
});

function shutdown() {
  for (const socket of clients) {
    socket.destroy();
  }
  void Promise.all([savePersistedState(), persistTargetCredentialVaultState()]).finally(() => {
    server.close(() => process.exit(0));
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
