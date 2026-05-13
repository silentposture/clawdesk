import { describe, expect, it } from "vitest";
import {
  learningSessionToWorkflow,
  recordObservedAction,
  startLearningSession,
  stopLearningSession,
} from "./learning";

describe("learning mode", () => {
  it("starts with explicit recording state and privacy defaults", () => {
    const session = startLearningSession("2026-05-11T00:00:00.000Z");
    expect(session.status).toBe("recording");
    expect(session.capturePasswords).toBe(false);
    expect(session.captureScreenImages).toBe(false);
  });

  it("turns observed actions into reviewable workflow steps", () => {
    const session = recordObservedAction(startLearningSession(), {
      app: "File Explorer",
      kind: "file-action",
      description: "把下載檔案複製到專案 uploads",
      target: "~/Downloads/report.pdf",
      risk: "medium",
    });
    const workflow = learningSessionToWorkflow(stopLearningSession(session));
    expect(workflow.status).toBe("draft");
    expect(workflow.steps[0].requiresApproval).toBe(true);
    expect(workflow.steps[0].toolId).toBe("file.prepare-change");
  });

  it("does not record actions unless recording is active", () => {
    const session = recordObservedAction(stopLearningSession(startLearningSession()), {
      app: "Safari",
      kind: "browser",
      description: "打開網站",
      target: "https://example.com",
      risk: "low",
    });
    expect(session.actions).toHaveLength(0);
  });
});
