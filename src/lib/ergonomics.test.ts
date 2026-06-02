import { describe, expect, it } from "vitest";
import { aggregateErgonomicsScore, scoreErgonomicsCheck } from "./ergonomics";

describe("ergonomics scoring", () => {
  it("scores desktop task paths with tooltip and risk prompt coverage", () => {
    const check = scoreErgonomicsCheck({
      id: "license-activation",
      taskName: "啟用 Lemon Squeezy 授權",
      viewport: "desktop",
      steps: 4,
      keyboardReachable: true,
      noTextOverflow: true,
      tooltipCoverage: 0.95,
      riskPromptCoverage: true,
    });

    expect(check.score).toBeGreaterThanOrEqual(95);
    expect(aggregateErgonomicsScore([check])).toBe(check.score);
  });
});
