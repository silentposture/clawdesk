import { describe, expect, it } from "vitest";
import {
  contextRecommendation,
  defaultCodingWorkspaceSnapshot,
  defaultSubagentTemplates,
  gatewayAdapterMethods,
  hasRequiredGatewayMethods,
  requiredGatewayAdapterMethods,
  summarizeGatewayAdapter,
} from "./codingWorkspace";

describe("coding workspace contract", () => {
  it("defines the expected subagent templates", () => {
    expect(defaultSubagentTemplates.map((agent) => agent.id)).toEqual([
      "planner",
      "implementer",
      "reviewer",
      "tester",
    ]);
    expect(defaultSubagentTemplates.every((agent) => agent.status === "mock")).toBe(true);
  });

  it("recommends compact and clear at deterministic context thresholds", () => {
    expect(contextRecommendation(20)).toBe("none");
    expect(contextRecommendation(70)).toBe("compact");
    expect(contextRecommendation(88)).toBe("clear");
  });

  it("tracks the Gateway adapter methods required by the plan", () => {
    expect(requiredGatewayAdapterMethods).toEqual([
      "health",
      "chat",
      "permissionResult",
      "providerStatus",
      "workflow",
      "diagnostics",
    ]);
    expect(hasRequiredGatewayMethods(gatewayAdapterMethods)).toBe(true);
    expect(gatewayAdapterMethods.every((method) => method.path.startsWith("/"))).toBe(true);
  });

  it("summarizes workspace capabilities and adapter status", () => {
    const summary = summarizeGatewayAdapter();
    expect(defaultCodingWorkspaceSnapshot.mode).toBe("windows-coding-workspace");
    expect(defaultCodingWorkspaceSnapshot.capabilities.length).toBeGreaterThanOrEqual(5);
    expect(summary.total).toBe(gatewayAdapterMethods.length);
    expect(summary.ready).toBeGreaterThan(0);
    expect(summary.mock).toBeGreaterThan(0);
  });
});
