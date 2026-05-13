import { describe, expect, it } from "vitest";
import {
  defaultOpenClawSetupProfile,
  openClawSettingSections,
  setupCompletion,
  visibleSettingsForAudience,
} from "./openclawSettings";

describe("OpenClaw settings map", () => {
  it("covers the major OpenClaw configuration groups", () => {
    const ids = openClawSettingSections.map((section) => section.id);
    expect(ids).toEqual([
      "workspace",
      "models",
      "agents",
      "channels",
      "gateway",
      "security",
      "tools",
      "advanced",
    ]);
  });

  it("keeps basic settings smaller than advanced settings", () => {
    expect(visibleSettingsForAudience("basic").length).toBeLessThan(visibleSettingsForAudience("advanced").length);
  });

  it("reports guided setup completion", () => {
    expect(setupCompletion(defaultOpenClawSetupProfile)).toBe(100);
  });
});
