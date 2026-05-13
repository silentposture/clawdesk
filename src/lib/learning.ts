import type { ScheduledWorkflow, WorkflowStep } from "./workflows";

export type LearningStatus = "idle" | "recording" | "draft-ready";

export type ObservedActionKind = "click" | "type" | "open-app" | "file-action" | "browser" | "confirm";

export interface ObservedAction {
  id: string;
  app: string;
  kind: ObservedActionKind;
  description: string;
  target: string;
  risk: "low" | "medium" | "high";
}

export interface LearningSession {
  status: LearningStatus;
  startedAt?: string;
  consentRequired: boolean;
  capturePasswords: boolean;
  captureScreenImages: boolean;
  actions: ObservedAction[];
}

export const defaultLearningSession: LearningSession = {
  status: "idle",
  consentRequired: true,
  capturePasswords: false,
  captureScreenImages: false,
  actions: [],
};

export function startLearningSession(now = new Date().toISOString()): LearningSession {
  return {
    ...defaultLearningSession,
    status: "recording",
    startedAt: now,
  };
}

export function recordObservedAction(session: LearningSession, action: Omit<ObservedAction, "id">): LearningSession {
  if (session.status !== "recording") return session;
  const observed: ObservedAction = {
    ...action,
    id: `observed-${session.actions.length + 1}`,
  };
  return {
    ...session,
    actions: [...session.actions, observed],
  };
}

export function observedActionToStep(action: ObservedAction): WorkflowStep {
  const connectorId = action.app.toLowerCase().includes("browser") ? "browser-screen" : "local-windows";
  const toolId = action.kind === "file-action" ? "file.prepare-change" : `learned.${action.kind}`;
  return {
    id: `step-${action.id}`,
    title: action.description,
    connectorId,
    toolId,
    requiresApproval: action.risk !== "low",
  };
}

export function learningSessionToWorkflow(session: LearningSession): Omit<ScheduledWorkflow, "id" | "nextRun"> {
  return {
    name: "學習模式產生的工作流草稿",
    status: "draft",
    scheduleKind: "manual",
    scheduleText: "手動執行",
    steps: session.actions.map(observedActionToStep),
  };
}

export function stopLearningSession(session: LearningSession): LearningSession {
  return {
    ...session,
    status: "draft-ready",
  };
}
