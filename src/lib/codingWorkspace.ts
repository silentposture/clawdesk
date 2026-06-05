export type CodingWorkspaceStatus = "ready" | "mock" | "partial" | "deferred";

export interface CodingWorkspaceCapability {
  id: string;
  label: string;
  status: CodingWorkspaceStatus;
  description: string;
}

export interface SubagentTemplate {
  id: "planner" | "implementer" | "reviewer" | "tester";
  label: string;
  responsibility: string;
  defaultTools: string[];
  status: CodingWorkspaceStatus;
}

export interface ContextBudget {
  messageCount: number;
  estimatedTokens: number;
  tokenLimit: number;
  budgetPercent: number;
  loadedTools: string[];
  mcpConnectors: string[];
  recommendedAction: "none" | "compact" | "clear";
  note: string;
}

export interface GatewayAdapterMethod {
  name:
    | "health"
    | "chat"
    | "permissionResult"
    | "providerStatus"
    | "workflow"
    | "diagnostics"
  | "providerSecretRef"
  | "providerOpenAiRuntime"
  | "memory"
  | "targetsRegistry"
  | "targetsSave"
  | "targetsCredentialRefIssue"
  | "targetsCredentialBundleExport"
  | "targetsCredentialBundlePreview"
  | "targetsCredentialBundleImport"
  | "targetsPairingTicket"
  | "targetsHostEnrollmentTicket"
  | "targetsHostEnrollment"
  | "targetsConnection"
  | "targetsConnectionReadiness"
  | "targetsDispatchPreview"
  | "targetsDispatch"
  | "targetsTimeline"
  | "targetsExecute"
  | "targetsExecuteBatch"
  | "targetsSshTerminalSessionRead"
  | "targetsSshTerminalSession"
  | "targetsRemoteDesktopSessionRead"
  | "targetsRemoteDesktopSession";
  method: "GET" | "POST";
  path: string;
  status: CodingWorkspaceStatus;
  purpose: string;
}

export const requiredGatewayAdapterMethods: ReadonlyArray<
  "health" | "chat" | "permissionResult" | "providerStatus" | "workflow" | "diagnostics"
> = ["health", "chat", "permissionResult", "providerStatus", "workflow", "diagnostics"];

export interface CodingWorkspaceSnapshot {
  mode: "windows-coding-workspace";
  capabilities: CodingWorkspaceCapability[];
  subagents: SubagentTemplate[];
  contextBudget: ContextBudget;
  gatewayAdapter: GatewayAdapterMethod[];
}

export const defaultSubagentTemplates: SubagentTemplate[] = [
  {
    id: "planner",
    label: "Planner",
    responsibility: "拆解需求、列風險、決定驗證路徑。",
    defaultTools: ["repo-read", "rg", "plan"],
    status: "mock",
  },
  {
    id: "implementer",
    label: "Implementer",
    responsibility: "依既有架構做最小安全修改。",
    defaultTools: ["apply_patch", "npm", "cargo"],
    status: "mock",
  },
  {
    id: "reviewer",
    label: "Reviewer",
    responsibility: "檢查 regression、安全與可維護性。",
    defaultTools: ["git diff", "tests", "static-analysis"],
    status: "mock",
  },
  {
    id: "tester",
    label: "Tester",
    responsibility: "執行 smoke、build、release guard 並整理結果。",
    defaultTools: ["npm test", "playwright", "tauri smoke"],
    status: "mock",
  },
];

export const gatewayAdapterMethods: GatewayAdapterMethod[] = [
  { name: "health", method: "GET", path: "/health", status: "ready", purpose: "確認 Gateway、版本、相容性與 Windows sidecar 狀態。" },
  { name: "chat", method: "POST", path: "/chat", status: "partial", purpose: "串流 agent 訊息、Canvas patch 與 permission request。" },
  { name: "permissionResult", method: "POST", path: "/permission-result", status: "ready", purpose: "把 GUI 審批結果送回 runtime。" },
  { name: "providerStatus", method: "GET", path: "/provider/status", status: "partial", purpose: "回報 active provider、auth mode、masked credential 與 fallback。" },
  { name: "workflow", method: "GET", path: "/workflows", status: "partial", purpose: "讀取 workflow templates 與 schedule 狀態。建立流程仍需審批。" },
  { name: "diagnostics", method: "POST", path: "/diagnostics/create-report", status: "ready", purpose: "產生 redacted support bundle 與 release/build/signature 狀態。" },
  { name: "providerSecretRef", method: "POST", path: "/provider/secret-ref/issue", status: "partial", purpose: "把 provider secret 轉成不可逆 SecretRef，refresh 只回傳 token reference。" },
  { name: "providerOpenAiRuntime", method: "POST", path: "/provider/openai/chat-test", status: "partial", purpose: "用 OpenAI Responses API 合約做最小 provider runtime probe，預設 dry-run。" },
  { name: "memory", method: "POST", path: "/memory/items", status: "mock", purpose: "建立與查詢本機記憶；後續接 durable store/vector store。" },
  { name: "targetsRegistry", method: "GET", path: "/targets", status: "mock", purpose: "讀取多電腦 target registry 與 dispatch log。" },
  { name: "targetsSave", method: "POST", path: "/targets", status: "mock", purpose: "儲存 target registry 與 default target 選擇。" },
  { name: "targetsCredentialRefIssue", method: "POST", path: "/targets/credential-ref/issue", status: "partial", purpose: "將 SSH private key 或遠端桌面登入 secret 發行成 gateway-managed credential ref，供安全 SSH / RDP dispatch 使用。" },
  { name: "targetsCredentialBundleExport", method: "POST", path: "/targets/credential-bundle/export", status: "partial", purpose: "將 target registry 與已發行的 credential refs 匯出成 passphrase-protected encrypted bundle，用於換機或跨機器遷移。" },
  { name: "targetsCredentialBundlePreview", method: "POST", path: "/targets/credential-bundle/preview", status: "partial", purpose: "在匯入前預覽 passphrase-protected encrypted bundle 的 target / secret 摘要與來源資訊。" },
  { name: "targetsCredentialBundleImport", method: "POST", path: "/targets/credential-bundle/import", status: "partial", purpose: "匯入 passphrase-protected encrypted bundle，還原 target registry 與 gateway-managed credential refs。" },
  { name: "targetsPairingTicket", method: "POST", path: "/targets/pairing-ticket", status: "partial", purpose: "發行短效 pairing code，讓新安裝的 SSH / remote-desktop target 可用一次性 enrollment code 完成安全 pairing。" },
  { name: "targetsHostEnrollmentTicket", method: "POST", path: "/targets/host-enrollment-ticket", status: "partial", purpose: "發行短效 host enrollment code，讓新安裝的 host bridge 可先完成身分註冊。" },
  { name: "targetsHostEnrollment", method: "POST", path: "/targets/host-enrollment", status: "partial", purpose: "由 host bridge redeem enrollment code，註冊主機身分並回寫 paired / connection readiness。" },
  { name: "targetsConnection", method: "POST", path: "/targets/connection", status: "partial", purpose: "處理 target 的 pair / probe / verify_host_key / connect / disconnect / refresh 動作，並回寫連線可達性與驗證狀態。" },
  { name: "targetsConnectionReadiness", method: "GET", path: "/targets/connection-readiness", status: "partial", purpose: "讀取 target 連線前檢查報告，顯示 pairing、credential、host key 與 probe readiness。"},
  { name: "targetsDispatchPreview", method: "POST", path: "/targets/dispatch-preview", status: "mock", purpose: "建立 target dispatch 預覽與 audit record。" },
  { name: "targetsDispatch", method: "POST", path: "/targets/dispatch", status: "mock", purpose: "儲存 target dispatch record 與 audit trail。" },
  { name: "targetsTimeline", method: "GET", path: "/targets/timeline", status: "partial", purpose: "讀取單一 target 的 session / dispatch timeline，讓控制面直接看到最近操作。" },
  { name: "targetsExecute", method: "POST", path: "/targets/execute", status: "partial", purpose: "執行 allowlisted local-shell 或 SSH safe command，必要時可經 gateway-managed SSH credential ref，並回傳 stdout/stderr 摘要。" },
  { name: "targetsExecuteBatch", method: "POST", path: "/targets/execute-batch", status: "partial", purpose: "對多個已選 target 或已套用的 target group 同步執行同一個 allowlisted local-shell 或 SSH safe command，並回收 per-target results。" },
  { name: "targetsSshTerminalSessionRead", method: "GET", path: "/targets/ssh-terminal/session", status: "partial", purpose: "讀取 SSH terminal session、redacted transcript snapshot 與 session summary。" },
  { name: "targetsSshTerminalSession", method: "POST", path: "/targets/ssh-terminal/session", status: "partial", purpose: "建立 SSH terminal open / command / close contract，並維持 allowlisted command、redacted transcript、session summary 與審批安全邊界。" },
  { name: "targetsRemoteDesktopSessionRead", method: "GET", path: "/targets/remote-desktop/session", status: "partial", purpose: "讀取遠端桌面 session 快照、觀察摘要、session summary 與 native client launch 狀態。" },
  { name: "targetsRemoteDesktopSession", method: "POST", path: "/targets/remote-desktop/session", status: "partial", purpose: "建立遠端桌面 observe / control / credential seed / native launch session contract，控制請求會進入 permission queue，並保留 session summary。" },
];

export const defaultContextBudget: ContextBudget = {
  messageCount: 42,
  estimatedTokens: 48000,
  tokenLimit: 120000,
  budgetPercent: 40,
  loadedTools: ["file-search", "patch-preview", "test-runner", "permission-queue"],
  mcpConnectors: ["microsoft-office", "google-workspace", "developer-tools"],
  recommendedAction: "none",
  note: "目前仍在可操作區間；超過 70% 建議 compact，超過 88% 建議 clear 或新 session。",
};

export const defaultCodingWorkspaceSnapshot: CodingWorkspaceSnapshot = {
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

export function contextRecommendation(budgetPercent: number): ContextBudget["recommendedAction"] {
  if (budgetPercent >= 88) return "clear";
  if (budgetPercent >= 70) return "compact";
  return "none";
}

export function summarizeGatewayAdapter(methods = gatewayAdapterMethods) {
  return methods.reduce<Record<CodingWorkspaceStatus | "total", number>>(
    (summary, method) => {
      summary[method.status] += 1;
      summary.total += 1;
      return summary;
    },
    { ready: 0, mock: 0, partial: 0, deferred: 0, total: 0 },
  );
}

export function hasRequiredGatewayMethods(methods: GatewayAdapterMethod[]): boolean {
  const names = new Set(methods.map((method) => method.name));
  return requiredGatewayAdapterMethods.every((method) => names.has(method));
}
