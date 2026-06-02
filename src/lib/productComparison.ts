export type ComparisonPriority = "p0" | "p1" | "p2" | "later";

export interface ProductComparisonItem {
  domain: string;
  openClaw: string;
  claudeCowork: string;
  claudeCode: string;
  clawDesk: string;
  gap: string;
  priority: ComparisonPriority;
}

export const productComparisonItems: ProductComparisonItem[] = [
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

export function summarizeProductComparison(items = productComparisonItems) {
  return items.reduce<Record<ComparisonPriority | "total", number>>(
    (summary, item) => {
      summary[item.priority] += 1;
      summary.total += 1;
      return summary;
    },
    { p0: 0, p1: 0, p2: 0, later: 0, total: 0 },
  );
}
