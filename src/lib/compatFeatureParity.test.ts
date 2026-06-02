import { describe, expect, it } from "vitest";
import {
  compatFeatureParity,
  compatFeatureParitySnapshot,
  summarizeCompatFeatureParity,
} from "./compatFeatureParity";

describe("Compat feature parity matrix", () => {
  it("tracks upstream source and all major Windows landing domains", () => {
    expect(compatFeatureParitySnapshot.license).toBe("MIT");
    expect(compatFeatureParitySnapshot.commit).toHaveLength(40);
    expect(compatFeatureParity.length).toBeGreaterThanOrEqual(18);
    expect(compatFeatureParity.map((item) => item.id)).toContain("model-auth-openai");
    expect(compatFeatureParity.map((item) => item.id)).toContain("windows-release");
  });

  it("summarizes implementation statuses deterministically", () => {
    const summary = summarizeCompatFeatureParity();
    expect(summary.partial).toBeGreaterThan(0);
    expect(summary.mock).toBeGreaterThan(0);
    expect(summary.deferred).toBeGreaterThan(0);
  });

  it("exposes dashboard fields for risk, test endpoint, and milestone planning", () => {
    const gateway = compatFeatureParity.find((item) => item.id === "gateway-protocol");
    const signing = compatFeatureParity.find((item) => item.id === "windows-release");
    expect(gateway).toMatchObject({
      riskLevel: "high",
      testEndpoint: "/gateway-adapter/contract",
      targetMilestone: "production-gateway",
    });
    expect(signing).toMatchObject({
      riskLevel: "blocked",
      targetMilestone: "signed-beta",
    });
    expect(compatFeatureParity.filter((item) => item.targetMilestone === "signed-beta").length).toBeGreaterThan(0);
  });
});
