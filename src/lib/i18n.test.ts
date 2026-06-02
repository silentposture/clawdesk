import { describe, expect, it } from "vitest";

import {
  fallbackResolveLocale,
  normalizeLocalePreference,
  resolveSystemLocaleFromLanguages,
} from "./i18n";

describe("i18n locale resolution", () => {
  it("defaults new installs to the operating system language", () => {
    expect(normalizeLocalePreference(null)).toBe("system");
    expect(normalizeLocalePreference("unsupported")).toBe("system");
  });

  it("maps common operating system locales to supported app languages", () => {
    expect(resolveSystemLocaleFromLanguages(["zh-Hant-TW", "en-US"])).toBe("zh-TW");
    expect(resolveSystemLocaleFromLanguages(["ja-JP", "en-US"])).toBe("ja-JP");
    expect(resolveSystemLocaleFromLanguages(["en-GB", "zh-TW"])).toBe("en-US");
  });

  it("falls back to English when the operating system language is unsupported", () => {
    expect(resolveSystemLocaleFromLanguages(["fr-FR", "de-DE"])).toBe("en-US");
  });

  it("keeps explicit user locale preferences stable", () => {
    expect(fallbackResolveLocale("zh-TW")).toBe("zh-TW");
    expect(fallbackResolveLocale("en-US")).toBe("en-US");
    expect(fallbackResolveLocale("ja-JP")).toBe("ja-JP");
  });
});
