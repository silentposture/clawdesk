import { describe, expect, it } from "vitest";
import {
  openClawFeatureParity,
  openClawFeatureParitySnapshot,
  summarizeOpenClawFeatureParity,
} from "./openclawFeatureParity";

describe("OpenClaw feature parity matrix", () => {
  it("tracks upstream source and all major Windows landing domains", () => {
    expect(openClawFeatureParitySnapshot.license).toBe("MIT");
    expect(openClawFeatureParitySnapshot.commit).toHaveLength(40);
    expect(openClawFeatureParity.length).toBeGreaterThanOrEqual(18);
    expect(openClawFeatureParity.map((item) => item.id)).toContain("model-auth-openai");
    expect(openClawFeatureParity.map((item) => item.id)).toContain("windows-release");
  });

  it("summarizes implementation statuses deterministically", () => {
    const summary = summarizeOpenClawFeatureParity();
    expect(summary.partial).toBeGreaterThan(0);
    expect(summary.mock).toBeGreaterThan(0);
    expect(summary.deferred).toBeGreaterThan(0);
  });
});
