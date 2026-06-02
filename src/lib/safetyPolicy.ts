export type SafetyRiskLevel = "low" | "medium" | "high" | "blocked";

export type AuditCategory =
  | "file-system"
  | "external-send"
  | "browser"
  | "shell"
  | "payment-account"
  | "credential"
  | "workspace";

export interface SafetyPolicyRule {
  id: string;
  label: string;
  denyPaths: string[];
  allowCommands: string[];
  requiresApproval: boolean;
  riskLevel: SafetyRiskLevel;
  auditCategory: AuditCategory;
  dryRunRequired: boolean;
  description: string;
}

export const defaultSafetyPolicyRules: SafetyPolicyRule[] = [
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

const riskOrder: Record<SafetyRiskLevel, number> = { low: 1, medium: 2, high: 3, blocked: 4 };

export function riskRank(riskLevel: SafetyRiskLevel): number {
  return riskOrder[riskLevel];
}

export function requiresHumanApproval(rule: SafetyPolicyRule): boolean {
  return rule.requiresApproval || rule.riskLevel === "high" || rule.riskLevel === "blocked";
}

export function summarizeSafetyPolicy(rules = defaultSafetyPolicyRules) {
  return rules.reduce<Record<SafetyRiskLevel | "requiresApproval", number>>(
    (summary, rule) => {
      summary[rule.riskLevel] += 1;
      if (requiresHumanApproval(rule)) summary.requiresApproval += 1;
      return summary;
    },
    { low: 0, medium: 0, high: 0, blocked: 0, requiresApproval: 0 },
  );
}
