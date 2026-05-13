export type ScheduleKind = "manual" | "interval" | "daily" | "weekly";

export type WorkflowStatus = "draft" | "active" | "paused";

export interface WorkflowStep {
  id: string;
  title: string;
  connectorId: string;
  toolId: string;
  requiresApproval: boolean;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  scheduleKind: ScheduleKind;
  steps: WorkflowStep[];
}

export interface ScheduledWorkflow {
  id: string;
  name: string;
  status: WorkflowStatus;
  scheduleKind: ScheduleKind;
  scheduleText: string;
  nextRun: string;
  steps: WorkflowStep[];
}

export function workflowNeedsApproval(workflow: Pick<ScheduledWorkflow | WorkflowTemplate, "steps">): boolean {
  return workflow.steps.some((step) => step.requiresApproval);
}

export function scheduleLabel(kind: ScheduleKind, value: string): string {
  if (kind === "manual") return "手動執行";
  if (kind === "interval") return `每 ${value || "30 分鐘"} 執行`;
  if (kind === "daily") return `每天 ${value || "09:00"} 執行`;
  return `每週 ${value || "週一 09:00"} 執行`;
}

export function buildWorkflowFromTemplate(
  template: WorkflowTemplate,
  scheduleValue: string,
): Omit<ScheduledWorkflow, "id" | "nextRun"> {
  return {
    name: template.name,
    status: "draft",
    scheduleKind: template.scheduleKind,
    scheduleText: scheduleLabel(template.scheduleKind, scheduleValue),
    steps: template.steps,
  };
}
