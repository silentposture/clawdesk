import { describe, expect, it } from "vitest";
import { productComparisonItems, summarizeProductComparison } from "./productComparison";

describe("product comparison matrix", () => {
  it("covers upstream reference, Claude Cowork, Claude Code, and ClawDesk domains", () => {
    expect(productComparisonItems.length).toBeGreaterThanOrEqual(7);
    const serialized = JSON.stringify(productComparisonItems);
    expect(serialized).toContain("Gateway");
    expect(serialized).toContain("Claude");
    expect(serialized).toContain("ClawDesk");
    expect(productComparisonItems.map((item) => item.domain)).toContain("Agent runtime");
  });

  it("marks runtime, providers, plugins, and safety as P0 gaps", () => {
    const p0Domains = productComparisonItems.filter((item) => item.priority === "p0").map((item) => item.domain);
    expect(p0Domains).toContain("Agent runtime");
    expect(p0Domains).toContain("模型支援");
    expect(p0Domains).toContain("MCP / plugin");
    expect(p0Domains).toContain("安全與權限");
  });

  it("summarizes priority counts deterministically", () => {
    const summary = summarizeProductComparison();
    expect(summary.total).toBe(productComparisonItems.length);
    expect(summary.p0).toBeGreaterThanOrEqual(4);
    expect(summary.p1).toBeGreaterThan(0);
  });
});
