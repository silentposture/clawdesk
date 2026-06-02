import { describe, expect, it } from "vitest";
import {
  defaultSafetyPolicyRules,
  requiresHumanApproval,
  riskRank,
  summarizeSafetyPolicy,
} from "./safetyPolicy";

describe("desktop action safety policy", () => {
  it("blocks common secret and certificate paths", () => {
    const secretRule = defaultSafetyPolicyRules.find((rule) => rule.id === "secret-paths");
    expect(secretRule?.riskLevel).toBe("blocked");
    expect(secretRule?.denyPaths).toContain(".env*");
    expect(secretRule?.denyPaths).toContain("secrets/**");
    expect(secretRule?.denyPaths).toContain("**/*.pfx");
  });

  it("requires approval for high-risk and blocked rules", () => {
    for (const rule of defaultSafetyPolicyRules.filter((item) => riskRank(item.riskLevel) >= riskRank("high"))) {
      expect(requiresHumanApproval(rule)).toBe(true);
      expect(rule.dryRunRequired).toBe(true);
    }
  });

  it("keeps external sends and payment operations behind the queue", () => {
    const externalSend = defaultSafetyPolicyRules.find((rule) => rule.id === "external-send");
    const payment = defaultSafetyPolicyRules.find((rule) => rule.id === "payment-account");
    expect(externalSend).toMatchObject({ auditCategory: "external-send", requiresApproval: true });
    expect(payment).toMatchObject({ auditCategory: "payment-account", riskLevel: "blocked" });
  });

  it("summarizes approval pressure for the GUI queue", () => {
    const summary = summarizeSafetyPolicy();
    expect(summary.requiresApproval).toBe(defaultSafetyPolicyRules.length);
    expect(summary.blocked).toBeGreaterThan(0);
    expect(summary.high).toBeGreaterThan(0);
  });
});
