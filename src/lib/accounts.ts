export type AccountProvider =
  | "chatgpt"
  | "google"
  | "microsoft"
  | "github"
  | "slack"
  | "line"
  | "email"
  | "cloud";

export type AccountStatus = "not-connected" | "pending" | "connected" | "revoked";

export type CollaborationRole = "owner" | "admin" | "editor" | "viewer" | "automation";

export interface AccountScope {
  id: string;
  label: string;
  description: string;
  risk: "low" | "medium" | "high";
}

export interface ConnectedAccount {
  id: string;
  provider: AccountProvider;
  displayName: string;
  email: string;
  status: AccountStatus;
  role: CollaborationRole;
  projectIds: string[];
  softwareTargets: string[];
  scopes: AccountScope[];
}

export interface AccountLoginDraft {
  provider: AccountProvider;
  email: string;
  role: CollaborationRole;
  projectIds: string[];
  softwareTargets: string[];
  scopes: string[];
}

export interface AccountAuthPreview {
  provider: AccountProvider;
  title: string;
  summary: string;
  requiresApproval: boolean;
}

export const accountProviders: Array<{
  id: AccountProvider;
  name: string;
  description: string;
  defaultScopes: AccountScope[];
}> = [
  {
    id: "chatgpt",
    name: "ChatGPT Pro",
    description: "用網站帳號狀態作為 AI 功能入口，不保存密碼或 cookie。",
    defaultScopes: [
      { id: "ai.chat", label: "AI 對話", description: "允許在桌面端使用 AI 對話功能。", risk: "low" },
      { id: "ai.workflow", label: "工作流協助", description: "允許工作流引用 AI 產生草稿。", risk: "medium" },
    ],
  },
  {
    id: "google",
    name: "Google Workspace",
    description: "Drive、Docs、Sheets、Slides、Gmail、Calendar 的協作帳號。",
    defaultScopes: [
      { id: "drive.read", label: "Drive 讀取", description: "讀取授權檔案清單。", risk: "medium" },
      { id: "gmail.draft", label: "Gmail 草稿", description: "建立草稿但不自動寄送。", risk: "high" },
      { id: "calendar.suggest", label: "Calendar 建議", description: "產生排程建議。", risk: "medium" },
    ],
  },
  {
    id: "microsoft",
    name: "Microsoft 365",
    description: "Word、Excel、PowerPoint、Outlook、Teams、OneDrive 的協作帳號。",
    defaultScopes: [
      { id: "files.read", label: "檔案讀取", description: "讀取 OneDrive/Office 文件。", risk: "medium" },
      { id: "outlook.draft", label: "Outlook 草稿", description: "建立郵件草稿。", risk: "high" },
      { id: "teams.notify", label: "Teams 通知", description: "建立 Teams 訊息預覽。", risk: "high" },
    ],
  },
  {
    id: "github",
    name: "GitHub",
    description: "Issue、PR、Actions 與 repository 協作。",
    defaultScopes: [
      { id: "repo.read", label: "Repo 讀取", description: "讀取 repository 與 PR。", risk: "medium" },
      { id: "issues.draft", label: "Issue 草稿", description: "建立 issue/留言草稿。", risk: "medium" },
    ],
  },
  {
    id: "slack",
    name: "Slack",
    description: "團隊頻道通知與協作草稿。",
    defaultScopes: [
      { id: "channels.read", label: "頻道讀取", description: "讀取允許頻道名稱與狀態。", risk: "medium" },
      { id: "messages.draft", label: "訊息草稿", description: "建立訊息草稿不送出。", risk: "high" },
    ],
  },
  {
    id: "line",
    name: "LINE",
    description: "LINE Messaging API 入口。",
    defaultScopes: [
      { id: "line.profile", label: "Profile 讀取", description: "讀取允許使用者/群組識別。", risk: "medium" },
      { id: "line.message.preview", label: "訊息預覽", description: "建立訊息預覽。", risk: "medium" },
    ],
  },
  {
    id: "email",
    name: "Email / SMTP",
    description: "一般 Email 帳號、SMTP/IMAP 或公司信箱。",
    defaultScopes: [
      { id: "mail.read", label: "信件讀取", description: "讀取允許信箱或資料夾。", risk: "high" },
      { id: "mail.draft", label: "草稿", description: "建立郵件草稿。", risk: "high" },
    ],
  },
  {
    id: "cloud",
    name: "雲端服務帳號",
    description: "AWS、Azure、Google Cloud、Cloudflare、Vercel、Supabase。",
    defaultScopes: [
      { id: "cloud.read", label: "資源讀取", description: "讀取資源與成本摘要。", risk: "medium" },
      { id: "cloud.plan", label: "變更計畫", description: "建立變更計畫但不直接套用。", risk: "high" },
    ],
  },
];

export function providerScopes(provider: AccountProvider): AccountScope[] {
  return accountProviders.find((item) => item.id === provider)?.defaultScopes ?? [];
}

export function createLoginDraft(provider: AccountProvider, email: string): AccountLoginDraft {
  return {
    provider,
    email,
    role: "editor",
    projectIds: ["openclaw-desktop"],
    softwareTargets: [],
    scopes: providerScopes(provider).map((scope) => scope.id),
  };
}

export function authPreview(draft: AccountLoginDraft): AccountAuthPreview {
  const scopes = providerScopes(draft.provider).filter((scope) => draft.scopes.includes(scope.id));
  return {
    provider: draft.provider,
    title: `${draft.email || "未命名帳號"} 授權`,
    summary: `將以 ${draft.role} 角色加入 ${draft.projectIds.length} 個專案，授權 ${scopes.length} 個範圍。`,
    requiresApproval: scopes.some((scope) => scope.risk === "high") || draft.role === "admin" || draft.role === "owner",
  };
}
