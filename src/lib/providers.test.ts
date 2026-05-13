import { describe, expect, it } from "vitest";
import {
  isOpenClawOpenAiProvider,
  openClawOpenAiAuthModes,
  openClawUpstreamSnapshot,
  providerName,
  providerStatusLabel,
  upstreamAuthModeForProvider,
} from "./providers";

describe("provider labels", () => {
  it("returns Traditional Chinese status labels", () => {
    expect(providerStatusLabel("connected")).toBe("已連線");
    expect(providerStatusLabel("configured")).toBe("已設定");
    expect(providerStatusLabel("account-required")).toBe("需網站帳號登入");
    expect(providerStatusLabel("not-connected")).toBe("未連線");
  });

  it("returns provider display names", () => {
    expect(providerName("chatgpt-pro")).toBe("ChatGPT Pro");
    expect(providerName("openai-api")).toBe("OpenAI API");
    expect(providerName("google-gemini")).toBe("Google Gemini API");
    expect(providerName("local-model")).toBe("本機模型");
    expect(providerName("mock")).toBe("Mock Gateway");
  });

  it("documents imported OpenClaw upstream OpenAI auth modes", () => {
    expect(openClawUpstreamSnapshot.license).toBe("MIT");
    expect(openClawUpstreamSnapshot.repository).toContain("github.com/openclaw/openclaw");
    expect(openClawOpenAiAuthModes.map((mode) => mode.id)).toEqual([
      "openai-api-key",
      "openai-account-oauth",
    ]);
    expect(isOpenClawOpenAiProvider("openai-api")).toBe(true);
    expect(isOpenClawOpenAiProvider("openai-codex")).toBe(true);
    expect(upstreamAuthModeForProvider("openai-api")).toBe("openai:api_key");
    expect(upstreamAuthModeForProvider("openai-codex")).toBe("openai-codex:oauth");
  });
});
