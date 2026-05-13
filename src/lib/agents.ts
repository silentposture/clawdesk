export interface AgentProfile {
  id: string;
  name: string;
  role: string;
  model: string;
  workspaceId: string;
  toolPermissions: string[];
  knowledgeBaseIds: string[];
  memoryScope: "private" | "project" | "shared";
  learningMode: "off" | "observe" | "rehearse-only";
}

export interface AgentKnowledgeItem {
  id: string;
  agentId: string;
  title: string;
  shared: boolean;
}

export const defaultAgents: AgentProfile[] = [
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

export function canAgentReadKnowledge(agent: AgentProfile, item: AgentKnowledgeItem): boolean {
  return item.agentId === agent.id || item.shared || agent.memoryScope === "shared";
}
