export type OpenClawParityStatus = "covered" | "partial" | "mock" | "deferred" | "not-applicable";

export interface OpenClawFeatureParityItem {
  id: string;
  domain: string;
  upstreamPaths: string[];
  upstreamFileCount?: number;
  localSurface: string;
  status: OpenClawParityStatus;
  windowsAction: string;
  difference: string;
}

export const openClawFeatureParitySnapshot = {
  repository: "https://github.com/openclaw/openclaw",
  commit: "d4484158d9291820d7af236d4277704da019f609",
  license: "MIT",
  scannedAt: "2026-05-14",
  sourceFileCount: 14886,
} as const;

export const openClawFeatureParity: OpenClawFeatureParityItem[] = [
  {
    id: "model-auth-openai",
    domain: "模型連線與 OpenAI 登入",
    upstreamPaths: ["src/agents/model-auth.ts", "src/agents/auth-profiles/*", "src/plugin-sdk/provider-auth.ts"],
    upstreamFileCount: 1588,
    localSurface: "src/lib/providers.ts, ProviderPanel, /auth/openai-api-key, /auth/openai-codex/oauth-login",
    status: "partial",
    windowsAction: "把 mock credential state 改接 Windows Credential Manager，保留 OpenAI API key 與 OpenAI/Codex OAuth 兩種模式。",
    difference: "已納入 provider/auth 契約與 UI，尚未執行真實 OAuth token refresh 或 encrypted credential store。",
  },
  {
    id: "provider-catalog",
    domain: "Provider catalog / model catalog",
    upstreamPaths: ["src/model-catalog/*", "src/agents/models-config.providers.ts", "src/plugin-sdk/provider-catalog-shared.ts"],
    upstreamFileCount: 17,
    localSurface: "src/lib/providers.ts, /llm-providers",
    status: "partial",
    windowsAction: "匯入 OpenClaw provider index normalized metadata，建立 Windows-safe allowlist。",
    difference: "本機已有主要 provider 清單，但尚未完整支援 upstream live catalog/cache/cost/context window。",
  },
  {
    id: "gateway-protocol",
    domain: "Gateway protocol / WebSocket / RPC",
    upstreamPaths: ["src/gateway/*"],
    upstreamFileCount: 697,
    localSurface: "sidecars/mock-gateway/server.mjs, backend/production-gateway-sim.mjs",
    status: "mock",
    windowsAction: "建立 signed Windows sidecar 啟動器，逐步替換 mock Gateway endpoint。",
    difference: "目前對齊健康檢查、chat、permission、identity、license、provider endpoint；未納入 upstream gateway auth hardening 與完整 RPC。",
  },
  {
    id: "agents-runtime",
    domain: "Agents runtime / subagents / harness",
    upstreamPaths: ["src/agents/*"],
    upstreamFileCount: 1588,
    localSurface: "AgentsPanel, workflows, mock project agents",
    status: "mock",
    windowsAction: "先導入 agent session model、model selection、failover、tool approval contract。",
    difference: "GUI 有 agent 管理與 mock 任務，尚未執行 upstream embedded runner / harness。",
  },
  {
    id: "plugins-sdk",
    domain: "Plugin SDK / tools",
    upstreamPaths: ["src/plugin-sdk/*", "packages/plugin-sdk/*"],
    upstreamFileCount: 556,
    localSurface: "McpPanel, provider catalog, local tool previews",
    status: "partial",
    windowsAction: "建立 Windows plugin sandbox policy，優先支援 provider-auth、web-search、tool approval。",
    difference: "本機有 UI 與 mock MCP connector；未載入 upstream plugin runtime 或 package boundary。",
  },
  {
    id: "extensions",
    domain: "Extensions / external connectors",
    upstreamPaths: ["extensions/*"],
    upstreamFileCount: 5822,
    localSurface: "ChannelsPanel, McpPanel, mock connector catalog",
    status: "mock",
    windowsAction: "先選 Teams/Gmail/Slack/LINE/Telegram 等 Windows 直售 Beta 需要的 connector 做 allowlist。",
    difference: "upstream extension 數量大；本機目前只納入 mock catalog 與權限預覽。",
  },
  {
    id: "channels",
    domain: "Messaging channels",
    upstreamPaths: ["src/channels/*", "extensions/discord", "extensions/telegram", "extensions/slack", "extensions/msteams"],
    upstreamFileCount: 348,
    localSurface: "ChannelsPanel, AccountsPanel",
    status: "partial",
    windowsAction: "把 channel auth、allowlist、draft-only sending 納入 Windows safe defaults。",
    difference: "本機有跨平台 channel UI，尚未執行 upstream channel runtime / webhook delivery。",
  },
  {
    id: "cron-workflows",
    domain: "Cron / workflow automation",
    upstreamPaths: ["src/cron/*"],
    upstreamFileCount: 172,
    localSurface: "WorkflowsPanel, mock schedules",
    status: "mock",
    windowsAction: "映射到 Windows Task Scheduler 或 app-owned local scheduler。",
    difference: "本機有 workflow CRUD mock；未接 upstream isolated-agent cron runner。",
  },
  {
    id: "memory",
    domain: "Memory / embeddings / vector store",
    upstreamPaths: ["packages/memory-host-sdk/*", "src/agents/context-*"],
    upstreamFileCount: 14,
    localSurface: "MemoryPanel, diagnostics memory summaries",
    status: "mock",
    windowsAction: "先支援本機 SQLite/JSON 記憶，後續再接 embeddings provider。",
    difference: "本機只有記憶 UI 與 mock items，沒有 upstream batch embeddings / LanceDB path。",
  },
  {
    id: "security-auth",
    domain: "Security / auth profiles / secret refs",
    upstreamPaths: ["src/agents/auth-profiles/*", "src/config/types.secrets.ts", "src/secrets/*"],
    upstreamFileCount: 120,
    localSurface: "ProviderPanel, diagnostics redaction, release guard",
    status: "partial",
    windowsAction: "用 Windows Credential Manager 實作 SecretRef/credential profile。",
    difference: "已避免明文顯示與診斷外洩；尚未實作 profile store、token refresh lock、portable auth policy。",
  },
  {
    id: "config-schema",
    domain: "Config schema / guided setup",
    upstreamPaths: ["src/config/*", "src/commands/*"],
    upstreamFileCount: 975,
    localSurface: "OpenClawSettingsPanel, src/lib/openclawSettings.ts",
    status: "partial",
    windowsAction: "補匯入/匯出 openclaw config JSON，並加 Windows-safe validation。",
    difference: "GUI 已把設定映射成導引；尚未完整讀寫 upstream schema。",
  },
  {
    id: "ui-control",
    domain: "Control UI / TUI / chat model selection",
    upstreamPaths: ["ui/src/*", "src/tui/*"],
    upstreamFileCount: 364,
    localSurface: "React/Tauri GUI",
    status: "partial",
    windowsAction: "把 upstream model picker、auth status、login gate 行為導入現有 ProviderPanel。",
    difference: "本機 GUI 已有桌面版 layout；未直接使用 upstream Lit UI/TUI。",
  },
  {
    id: "media-understanding",
    domain: "Media understanding / image/audio/video",
    upstreamPaths: ["src/media-understanding/*", "src/media-generation/*"],
    upstreamFileCount: 76,
    localSurface: "MediaPanel, Windows Media Foundation/WASAPI/WIC 文案",
    status: "mock",
    windowsAction: "接 Windows media pipeline 或 ffmpeg sidecar，保留 provider allowlist。",
    difference: "目前僅能力宣告與 mock workflow，未接 upstream provider runtime。",
  },
  {
    id: "tts-talk",
    domain: "TTS / talk / realtime transcription",
    upstreamPaths: ["src/tts/*", "src/realtime-transcription/*"],
    upstreamFileCount: 20,
    localSurface: "MediaPanel",
    status: "deferred",
    windowsAction: "首發 Beta 不阻塞；後續接 Windows audio capture 與 OpenAI-compatible speech provider。",
    difference: "本機尚未提供語音輸入/輸出 runtime。",
  },
  {
    id: "pairing-device",
    domain: "Pairing / device auth / node mode",
    upstreamPaths: ["src/pairing/*", "apps/android/*", "apps/ios/*"],
    upstreamFileCount: 412,
    localSurface: "AccountsPanel, Gateway health, diagnostics",
    status: "deferred",
    windowsAction: "先支援本機 loopback；第二階段再做手機/節點 pairing。",
    difference: "Windows Beta 不先做 mobile node pairing。",
  },
  {
    id: "macos-ios-android",
    domain: "Native Apple/Android apps",
    upstreamPaths: ["apps/macos/*", "apps/ios/*", "apps/android/*"],
    upstreamFileCount: 778,
    localSurface: "Tauri Windows app",
    status: "not-applicable",
    windowsAction: "不納入 Windows 首發 installer，只保留 protocol/UX 參考。",
    difference: "平台不同；只擷取可跨平台的 gateway/auth/model contract。",
  },
  {
    id: "sdk",
    domain: "SDK / client API",
    upstreamPaths: ["packages/sdk/*"],
    upstreamFileCount: 10,
    localSurface: "backend contract + mock Gateway APIs",
    status: "deferred",
    windowsAction: "Beta 穩定後提供 ClawDesk local API SDK 或直接相容 upstream SDK。",
    difference: "目前以桌面 app 內部 contract 為主，尚未發布 SDK。",
  },
  {
    id: "windows-release",
    domain: "Windows packaging / certification",
    upstreamPaths: ["package.json", "scripts/windows-cmd-helpers.mjs"],
    upstreamFileCount: 1,
    localSurface: "Tauri NSIS, release guard, signing scripts",
    status: "partial",
    windowsAction: "完成 Authenticode/Trusted Signing、SBOM、NOTICE、installer smoke。",
    difference: "本機 Windows packaging 已超前 upstream 通用 CLI，但簽章/認證仍保留未完成。",
  },
];

export function summarizeOpenClawFeatureParity(items = openClawFeatureParity) {
  return items.reduce<Record<OpenClawParityStatus, number>>(
    (acc, item) => {
      acc[item.status] += 1;
      return acc;
    },
    { covered: 0, partial: 0, mock: 0, deferred: 0, "not-applicable": 0 },
  );
}
