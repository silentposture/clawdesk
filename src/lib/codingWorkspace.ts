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
    | "targetsDispatchPreview"
    | "targetsDispatch"
    | "targetsExecute";
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
  { name: "targetsCredentialRefIssue", method: "POST", path: "/targets/credential-ref/issue", status: "partial", purpose: "將 SSH private key 發行成 gateway-managed credential ref，供安全 SSH dispatch 使用。" },
  { name: "targetsDispatchPreview", method: "POST", path: "/targets/dispatch-preview", status: "mock", purpose: "建立 target dispatch 預覽與 audit record。" },
  { name: "targetsDispatch", method: "POST", path: "/targets/dispatch", status: "mock", purpose: "儲存 target dispatch record 與 audit trail。" },
  { name: "targetsExecute", method: "POST", path: "/targets/execute", status: "partial", purpose: "執行 allowlisted local-shell 或 SSH safe command，必要時可經 gateway-managed SSH credential ref，並回傳 stdout/stderr 摘要。" },
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
