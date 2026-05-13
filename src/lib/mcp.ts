export type McpStatus = "disabled" | "available" | "connected" | "requires-approval";

export type McpRisk = "low" | "medium" | "high";

export interface McpProtocol {
  id: string;
  name: string;
  auth: string;
  transport: "https" | "stdio" | "http" | "mock" | "sse" | "websocket";
  description: string;
  scopes?: string[];
  endpoints?: string[];
  localAdapter?: boolean;
}

export interface McpTool {
  id: string;
  name: string;
  app:
    | "Word"
    | "Excel"
    | "PowerPoint"
    | "Outlook"
    | "OneDrive"
    | "Teams"
    | "Google Drive"
    | "Google Docs"
    | "Google Sheets"
    | "Google Slides"
    | "Gmail"
    | "Google Calendar"
    | "Chrome"
    | "Browser"
    | "VS Code"
    | "Xcode"
    | "JetBrains"
    | "GitHub"
    | "GitLab"
    | "Docker"
    | "Terminal"
    | "AutoCAD"
    | "Fusion 360"
    | "SolidWorks"
    | "MATLAB"
    | "Jupyter"
    | "AWS"
    | "Azure"
    | "Google Cloud"
    | "Cloudflare"
    | "Vercel"
    | "Supabase";
  description: string;
  risk: McpRisk;
  permission: "ask" | "trusted-workspace";
}

export interface McpConnector {
  id: string;
  name: string;
  vendor: "Microsoft" | "Google" | "Local" | "Developer" | "Engineering" | "Cloud";
  status: McpStatus;
  transport: "stdio" | "http" | "mock";
  description: string;
  tools: McpTool[];
  protocols?: McpProtocol[];
}

export interface McpActionPreview {
  connectorId: string;
  toolId: string;
  title: string;
  target: string;
  risk: McpRisk;
  requiresApproval: boolean;
  summary: string;
  protocol?: {
    id: string;
    name: string;
    auth: string;
    transport: McpProtocol["transport"];
  };
}

export const microsoftOfficeToolIds = [
  "word.summarize",
  "word.redline",
  "excel.inspect",
  "excel.build-chart",
  "powerpoint.outline",
  "outlook.draft-reply",
  "onedrive.search",
] as const;

export function summarizeConnector(connector: McpConnector): string {
  const connected = connector.status === "connected" ? "已連線" : "未連線";
  return `${connector.name}：${connected}，${connector.tools.length} 個工具`;
}

export function connectorSupportsTool(connector: McpConnector, toolId: string): boolean {
  return connector.tools.some((tool) => tool.id === toolId);
}

export function planMcpAction(connector: McpConnector, toolId: string, target: string): McpActionPreview {
  const tool = connector.tools.find((item) => item.id === toolId);
  if (!tool) {
    throw new Error(`MCP 工具不存在：${toolId}`);
  }

  return {
    connectorId: connector.id,
    toolId: tool.id,
    title: `${tool.app} · ${tool.name}`,
    target,
    risk: tool.risk,
    requiresApproval: tool.permission === "ask" || tool.risk !== "low",
    summary: `${tool.description} 目標：${target}`,
  };
}
