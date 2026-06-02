import { describe, expect, it } from "vitest";
import {
  defaultProviderSession,
  compatOpenAiAuthModes,
  compatUpstreamSnapshot,
  isCompatOpenAiProvider,
  providerName,
  providerStatusLabel,
  upstreamAuthModeForProvider,
} from "./providers";

describe("provider labels", () => {
  it("defaults to a local Ollama session without secrets", () => {
    expect(defaultProviderSession.activeProvider).toBe("local-model");
    expect(defaultProviderSession.displayName).toBe("Ollama");
    expect(defaultProviderSession.endpoint).toBe("http://127.0.0.1:11434");
    expect(defaultProviderSession.model).toBe("llama3.3");
    expect(defaultProviderSession.runtime?.live).not.toBe(true);
    expect(JSON.stringify(defaultProviderSession)).not.toContain("sk-");
  });

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

  it("documents imported upstream OpenAI auth modes", () => {
    expect(compatUpstreamSnapshot.license).toBe("MIT");
    expect(compatUpstreamSnapshot.repository).toContain("github.com/openclaw/openclaw");
    expect(compatOpenAiAuthModes.map((mode) => mode.id)).toEqual([
      "openai-api-key",
      "openai-account-oauth",
    ]);
    expect(isCompatOpenAiProvider("openai-api")).toBe(true);
    expect(isCompatOpenAiProvider("openai-codex")).toBe(true);
    expect(upstreamAuthModeForProvider("openai-api")).toBe("openai:api_key");
    expect(upstreamAuthModeForProvider("openai-codex")).toBe("openai-codex:oauth");
  });
});
