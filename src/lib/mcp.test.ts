import { describe, expect, it } from "vitest";
import { connectorSupportsTool, planMcpAction, summarizeConnector, type McpConnector } from "./mcp";

const connector: McpConnector = {
  id: "microsoft-office",
  name: "Microsoft 365 文書工具",
  vendor: "Microsoft",
  status: "connected",
  transport: "mock",
  description: "Word、Excel、PowerPoint 與 Outlook 的 MCP adapter。",
  tools: [
    {
      id: "word.redline",
      name: "文件修訂",
      app: "Word",
      description: "建立 Word 文件修訂建議。",
      risk: "medium",
      permission: "ask",
    },
    {
      id: "onedrive.search",
      name: "OneDrive 搜尋",
      app: "OneDrive",
      description: "搜尋受信任工作區內的雲端檔案。",
      risk: "low",
      permission: "trusted-workspace",
    },
  ],
};

describe("MCP connector catalog", () => {
  it("summarizes connector state", () => {
    expect(summarizeConnector(connector)).toBe("Microsoft 365 文書工具：已連線，2 個工具");
  });

  it("checks tool support", () => {
    expect(connectorSupportsTool(connector, "word.redline")).toBe(true);
    expect(connectorSupportsTool(connector, "excel.inspect")).toBe(false);
  });

  it("requires approval for medium-risk Office actions", () => {
    const preview = planMcpAction(connector, "word.redline", "/Users/demo/report.docx");
    expect(preview.requiresApproval).toBe(true);
    expect(preview.title).toBe("Word · 文件修訂");
  });

  it("allows low-risk trusted workspace previews without extra approval", () => {
    const preview = planMcpAction(connector, "onedrive.search", "/Users/demo/Documents");
    expect(preview.requiresApproval).toBe(false);
  });

  it("requires approval for developer command plans", () => {
    const devConnector: McpConnector = {
      id: "developer-tools",
      name: "程式開發工具",
      vendor: "Developer",
      status: "available",
      transport: "mock",
      description: "開發工具 adapter。",
      tools: [
        {
          id: "terminal.command.plan",
          name: "Terminal 指令計畫",
          app: "Terminal",
          description: "產生 shell 指令計畫。",
          risk: "high",
          permission: "ask",
        },
      ],
    };
    const preview = planMcpAction(devConnector, "terminal.command.plan", "~/OpenClaw Project");
    expect(preview.requiresApproval).toBe(true);
    expect(preview.risk).toBe("high");
  });
});
