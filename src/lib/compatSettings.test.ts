import { describe, expect, it } from "vitest";
import {
  defaultCompatSetupProfile,
  compatSettingSections,
  setupCompletion,
  visibleSettingsForAudience,
} from "./compatSettings";

describe("Compat settings map", () => {
  it("covers the major compatible configuration groups", () => {
    const ids = compatSettingSections.map((section) => section.id);
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
    expect(setupCompletion(defaultCompatSetupProfile)).toBe(100);
  });
});
