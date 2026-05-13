export type SettingsAudience = "basic" | "advanced";

import type { ProviderId } from "./providers";

export interface OpenClawSettingItem {
  id: string;
  label: string;
  plainLabel: string;
  description: string;
  defaultValue: string;
  audience: SettingsAudience;
}

export interface OpenClawSettingSection {
  id: string;
  title: string;
  plainTitle: string;
  summary: string;
  setupQuestion: string;
  items: OpenClawSettingItem[];
}

export interface OpenClawSetupProfile {
  goal: "personal" | "office" | "automation" | "advanced";
  modelProvider: ProviderId;
  workspaceFolder: string;
  internetEnabled: boolean;
  screenVisionEnabled: boolean;
  enableMessagingChannels: boolean;
  enableWorkflows: boolean;
}

export const defaultOpenClawSetupProfile: OpenClawSetupProfile = {
  goal: "office",
  modelProvider: "chatgpt-pro",
  workspaceFolder: "~/ClawDesk Projects/桌面 GUI",
  internetEnabled: true,
  screenVisionEnabled: false,
  enableMessagingChannels: false,
  enableWorkflows: true,
};

export const openClawSettingSections: OpenClawSettingSection[] = [
  {
    id: "workspace",
    title: "工作區與專案沙盒",
    plainTitle: "你的 AI 可以在哪裡工作？",
    summary: "對應 OpenClaw workspace 與專案層設定，決定檔案作業根目錄。",
    setupQuestion: "選一個專案資料夾，AI 只能在這裡自動改動；外面都要問你。",
    items: [
      {
        id: "workspace.folder",
        label: "agents.defaults.workspace",
        plainLabel: "專案資料夾",
        description: "OpenClaw 的檔案工作目錄。本桌面版會把它當成沙盒根目錄。",
        defaultValue: "~/clawd",
        audience: "basic",
      },
      {
        id: "workspace.projectConfig",
        label: "openclaw.config.json",
        plainLabel: "專案專屬設定",
        description: "放在專案內的設定可覆蓋全域設定，適合不同客戶或工作分類。",
        defaultValue: "專案內可選",
        audience: "advanced",
      },
    ],
  },
  {
    id: "models",
    title: "模型與 AI 供應商",
    plainTitle: "你要用哪一種 AI？",
    summary: "涵蓋 providers、預設模型、模型參數與 fallback。",
    setupQuestion: "一般使用者只要選 ChatGPT Pro、OpenAI API、本機模型或 Google Gemini。",
    items: [
      {
        id: "models.providers",
        label: "models.providers",
        plainLabel: "AI 供應商",
        description: "OpenAI、Anthropic、Google、Ollama 或 OpenAI-compatible endpoint。",
        defaultValue: "mock",
        audience: "basic",
      },
      {
        id: "models.primary",
        label: "agents.defaults.model.primary",
        plainLabel: "主要模型",
        description: "平常回答與執行任務使用的主要模型。",
        defaultValue: "openai/gpt-4o",
        audience: "basic",
      },
      {
        id: "models.fallbacks",
        label: "agents.defaults.model.fallbacks",
        plainLabel: "備援模型",
        description: "主要模型失敗時依序嘗試的備用模型。",
        defaultValue: "自動",
        audience: "advanced",
      },
      {
        id: "models.params",
        label: "agents.defaults.models.*.params",
        plainLabel: "模型細部參數",
        description: "temperature、maxTokens、prompt cache TTL 等細節。",
        defaultValue: "保守預設",
        audience: "advanced",
      },
    ],
  },
  {
    id: "agents",
    title: "Agent 身分、多 Agent 與記憶",
    plainTitle: "AI 要扮演什麼角色？",
    summary: "涵蓋 agent defaults、agent list、identity、SOUL.md、memory、concurrency。",
    setupQuestion: "先選「個人助理」「辦公文書」「自動化管家」即可，細節之後再調。",
    items: [
      {
        id: "agents.identity",
        label: "agents.list[].identity",
        plainLabel: "助理名稱與角色",
        description: "設定 AI 名稱、用途、語氣與專屬規則。",
        defaultValue: "OpenClaw 助理",
        audience: "basic",
      },
      {
        id: "agents.memory",
        label: "agents.defaults.memory",
        plainLabel: "記憶保存",
        description: "對話記憶、資料庫位置與長期上下文策略。",
        defaultValue: "sqlite / 本機",
        audience: "advanced",
      },
      {
        id: "agents.concurrency",
        label: "maxConcurrent / subagents.maxConcurrent",
        plainLabel: "同時工作數量",
        description: "限制同時處理的對話與子代理，避免一般電腦負擔過高。",
        defaultValue: "4 / 8",
        audience: "advanced",
      },
    ],
  },
  {
    id: "channels",
    title: "訊息頻道",
    plainTitle: "要不要接通聊天軟體？",
    summary: "涵蓋 Telegram、Discord、WhatsApp、Slack、Teams 等 channel 設定。",
    setupQuestion: "一般桌面版可以先關閉；要讓 AI 進聊天軟體再逐一開啟。",
    items: [
      {
        id: "channels.telegram",
        label: "channels.telegram",
        plainLabel: "Telegram",
        description: "Bot token、DM 政策、群組政策、允許名單與串流模式。",
        defaultValue: "關閉",
        audience: "advanced",
      },
      {
        id: "channels.discord",
        label: "channels.discord",
        plainLabel: "Discord",
        description: "Bot token、application id、允許伺服器與頻道。",
        defaultValue: "關閉",
        audience: "advanced",
      },
      {
        id: "channels.whatsapp",
        label: "channels.whatsapp",
        plainLabel: "WhatsApp",
        description: "Phone number id、access token、verify token、webhook URL。",
        defaultValue: "關閉",
        audience: "advanced",
      },
      {
        id: "channels.slack",
        label: "channels.slack",
        plainLabel: "Slack / Teams",
        description: "Bot token、app token、簽章祕密與工作區允許範圍。",
        defaultValue: "關閉",
        audience: "advanced",
      },
    ],
  },
  {
    id: "gateway",
    title: "Gateway 與背景服務",
    plainTitle: "AI 背景服務怎麼跑？",
    summary: "涵蓋 port、mode、bind、auth、token、Tailscale、daemon。",
    setupQuestion: "一般使用者選「只在本機執行」最安全。",
    items: [
      {
        id: "gateway.local",
        label: "gateway.mode / gateway.bind",
        plainLabel: "本機或外部連線",
        description: "local + loopback 代表只有本機桌面程式能連。",
        defaultValue: "local / loopback",
        audience: "basic",
      },
      {
        id: "gateway.auth",
        label: "gateway.auth",
        plainLabel: "Gateway 密碼/Token",
        description: "保護 Gateway API，不把 token 顯示在畫面或 log。",
        defaultValue: "token",
        audience: "advanced",
      },
      {
        id: "gateway.daemon",
        label: "daemon / gateway start",
        plainLabel: "開機常駐",
        description: "是否把 Gateway 裝成背景服務。",
        defaultValue: "桌面 app 啟動時執行",
        audience: "advanced",
      },
    ],
  },
  {
    id: "security",
    title: "祕密、安全與權限",
    plainTitle: "哪些事一定要先問你？",
    summary: "涵蓋 .env、SecretRef、API key、沙盒、授權與敏感資料。",
    setupQuestion: "保留預設：專案外改動要問、專案內先備份、不自動刪除。",
    items: [
      {
        id: "security.env",
        label: "~/.openclaw/.env / SecretRef",
        plainLabel: "金鑰保存",
        description: "API key、channel token 與 Gateway token 使用環境變數或 SecretRef。",
        defaultValue: "本機保管",
        audience: "basic",
      },
      {
        id: "security.sandbox",
        label: "workspace permission policy",
        plainLabel: "專案沙盒",
        description: "超出專案資料夾必須人工授權，專案內改動先備份。",
        defaultValue: "嚴格",
        audience: "basic",
      },
    ],
  },
  {
    id: "tools",
    title: "Plugins、Skills、Tools 與多模態",
    plainTitle: "AI 可以使用哪些工具？",
    summary: "涵蓋 plugins、skills、web search、media audio、talk/TTS。",
    setupQuestion: "一般先開網路搜尋與本機文件處理，其他功能需要時再開。",
    items: [
      {
        id: "tools.web",
        label: "tools.web.search",
        plainLabel: "網路搜尋",
        description: "Brave、Google 或其他搜尋供應商。",
        defaultValue: "brave / mock",
        audience: "basic",
      },
      {
        id: "tools.media",
        label: "tools.media.audio",
        plainLabel: "音訊/影片處理",
        description: "語音轉文字、媒體分析、多模態資料處理。",
        defaultValue: "啟用",
        audience: "basic",
      },
      {
        id: "tools.plugins",
        label: "plugins.entries / skills.entries",
        plainLabel: "外掛與技能",
        description: "安裝、啟用、更新與設定 OpenClaw plugins / skills。",
        defaultValue: "按需啟用",
        audience: "advanced",
      },
    ],
  },
  {
    id: "advanced",
    title: "Hooks 與進階行為",
    plainTitle: "進階自動化規則",
    summary: "涵蓋 hooks、context pruning、messages、update、commands。",
    setupQuestion: "不熟悉就保留預設；這些是給進階使用者微調。",
    items: [
      {
        id: "advanced.hooks",
        label: "hooks.internal",
        plainLabel: "啟動與記錄 Hook",
        description: "BOOT.md、command logger、session memory 等生命週期 hook。",
        defaultValue: "啟用",
        audience: "advanced",
      },
      {
        id: "advanced.context",
        label: "contextPruning / compaction",
        plainLabel: "上下文整理",
        description: "控制長對話怎麼壓縮、保留與快取。",
        defaultValue: "cache-ttl / safeguard",
        audience: "advanced",
      },
      {
        id: "advanced.messages",
        label: "messages / commands / update",
        plainLabel: "訊息、命令與更新",
        description: "訊息長度、斜線命令 prefix、更新檢查與更新通道。",
        defaultValue: "穩定預設",
        audience: "advanced",
      },
    ],
  },
];

export function visibleSettingsForAudience(audience: SettingsAudience): OpenClawSettingItem[] {
  return openClawSettingSections.flatMap((section) =>
    section.items.filter((item) => audience === "advanced" || item.audience === "basic"),
  );
}

export function setupCompletion(profile: OpenClawSetupProfile): number {
  const checks = [
    Boolean(profile.workspaceFolder.trim()),
    Boolean(profile.modelProvider),
    profile.internetEnabled || !profile.internetEnabled,
    profile.screenVisionEnabled || !profile.screenVisionEnabled,
    profile.enableWorkflows || !profile.enableWorkflows,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}
