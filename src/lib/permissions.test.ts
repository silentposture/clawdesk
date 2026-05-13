import { describe, expect, it } from "vitest";
import { evaluatePermissionRequest, type PermissionSettings } from "./permissions";
import type { PermissionRequestEvent } from "./events";

const baseRequest: PermissionRequestEvent = {
  type: "permission.request",
  requestId: "r1",
  action: "read_file",
  target: "/workspace/report.csv",
  risk: "low",
  summary: "Read report",
};

describe("permission policy", () => {
  it("prompts by default", () => {
    const decision = evaluatePermissionRequest(baseRequest, {
      mode: "ask-before-acting",
      trustedWorkspaces: ["/workspace"],
    });

    expect(decision.requiresPrompt).toBe(true);
    expect(decision.allowed).toBe(false);
  });

  it("allows low-risk actions inside trusted workspaces", () => {
    const settings: PermissionSettings = {
      mode: "trusted-workspace",
      trustedWorkspaces: ["/workspace"],
    };

    const decision = evaluatePermissionRequest(baseRequest, settings);

    expect(decision.requiresPrompt).toBe(false);
    expect(decision.allowed).toBe(true);
  });

  it("prompts for destructive actions even inside trusted workspaces", () => {
    const decision = evaluatePermissionRequest(
      { ...baseRequest, action: "delete_file", risk: "high" },
      { mode: "trusted-workspace", trustedWorkspaces: ["/workspace"] },
    );

    expect(decision.requiresPrompt).toBe(true);
    expect(decision.allowed).toBe(false);
  });

  it("prompts for targets outside trusted workspaces", () => {
    const decision = evaluatePermissionRequest(baseRequest, {
      mode: "trusted-workspace",
      trustedWorkspaces: ["/other"],
    });

    expect(decision.requiresPrompt).toBe(true);
    expect(decision.allowed).toBe(false);
  });
});
