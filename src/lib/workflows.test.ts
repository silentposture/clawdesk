import { describe, expect, it } from "vitest";
import { buildWorkflowFromTemplate, scheduleLabel, workflowNeedsApproval, type WorkflowTemplate } from "./workflows";

const template: WorkflowTemplate = {
  id: "daily-doc-brief",
  name: "每日文件摘要",
  description: "彙整 Google Drive 與 Word 文件。",
  scheduleKind: "daily",
  steps: [
    {
      id: "drive",
      title: "搜尋 Drive",
      connectorId: "google-workspace",
      toolId: "drive.search",
      requiresApproval: false,
    },
    {
      id: "word",
      title: "建立 Word 修訂草稿",
      connectorId: "microsoft-office",
      toolId: "word.redline",
      requiresApproval: true,
    },
  ],
};

describe("workflow schedules", () => {
  it("labels common schedule kinds", () => {
    expect(scheduleLabel("manual", "")).toBe("手動執行");
    expect(scheduleLabel("interval", "15 分鐘")).toBe("每 15 分鐘 執行");
    expect(scheduleLabel("daily", "08:30")).toBe("每天 08:30 執行");
  });

  it("detects approval requirements", () => {
    expect(workflowNeedsApproval(template)).toBe(true);
  });

  it("builds a draft workflow from a template", () => {
    const workflow = buildWorkflowFromTemplate(template, "09:00");
    expect(workflow.status).toBe("draft");
    expect(workflow.scheduleText).toBe("每天 09:00 執行");
    expect(workflow.steps).toHaveLength(2);
  });
});
