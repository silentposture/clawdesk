export type ChannelKind =
  | "telegram"
  | "discord"
  | "whatsapp"
  | "slack"
  | "teams"
  | "gmail"
  | "line"
  | "matrix";

export type ChannelStatus = "disabled" | "needs-setup" | "configured" | "connected";

export type StreamMode = "off" | "partial" | "final";

export interface CommunicationChannel {
  id: ChannelKind;
  name: string;
  status: ChannelStatus;
  description: string;
  setupHint: string;
  requiredFields: string[];
  allowlistLabel: string;
  streamMode: StreamMode;
  risk: "low" | "medium" | "high";
  guideSteps: ChannelGuideStep[];
}

export interface ChannelGuideStep {
  id: string;
  title: string;
  instruction: string;
  helperText: string;
  userAction: string;
}

export interface ChannelDraft {
  channelId: ChannelKind;
  enabled: boolean;
  allowlist: string[];
  streamMode: StreamMode;
}

export interface ChannelPreview {
  channelId: ChannelKind;
  title: string;
  summary: string;
  requiresApproval: boolean;
}

export const defaultChannels: CommunicationChannel[] = [
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
    guideSteps: [
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
    guideSteps: [
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
        instruction: "只填入要讓 OpenClaw 使用的 server/channel。",
        helperText: "避免整個伺服器都能叫用 AI。",
        userAction: "填寫允許 server/channel。",
      },
    ],
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
    guideSteps: [
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
    guideSteps: [
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
    guideSteps: [
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
    guideSteps: [
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
    guideSteps: [
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
    guideSteps: [
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
  },
];

export function channelGuideCompletion(channel: CommunicationChannel, completedStepIds: string[]): number {
  if (channel.guideSteps.length === 0) return 100;
  const completed = channel.guideSteps.filter((step) => completedStepIds.includes(step.id)).length;
  return Math.round((completed / channel.guideSteps.length) * 100);
}

export function buildChannelDraft(
  channel: CommunicationChannel,
  allowlistText: string,
  enabled = true,
): ChannelDraft {
  return {
    channelId: channel.id,
    enabled,
    allowlist: allowlistText
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    streamMode: channel.streamMode,
  };
}

export function channelRequiresApproval(channel: CommunicationChannel): boolean {
  return channel.risk !== "low" || channel.status !== "connected";
}

export function channelPreview(channel: CommunicationChannel, draft: ChannelDraft): ChannelPreview {
  return {
    channelId: channel.id,
    title: `${channel.name} 溝通頻道`,
    summary: draft.enabled
      ? `將啟用 ${channel.name}，限制在 ${draft.allowlist.length || 0} 個允許對象，串流模式：${draft.streamMode}。`
      : `將停用 ${channel.name}。`,
    requiresApproval: channelRequiresApproval(channel),
  };
}
