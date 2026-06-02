import { describe, expect, it } from "vitest";
import {
  createDryRunOpenAiProbe,
  isOpenAiRuntimeProvider,
  normalizeOpenAiRuntimeModel,
  openAiRuntimeContract,
} from "./openaiRuntime";

describe("OpenAI runtime contract", () => {
  it("uses the Responses API without returning raw secrets", () => {
    expect(openAiRuntimeContract.apiStyle).toBe("responses-api");
    expect(openAiRuntimeContract.responseEndpoint).toBe("/v1/responses");
    expect(openAiRuntimeContract.rawSecretResponse).toBe(false);
    expect(openAiRuntimeContract.endpoints.map((endpoint) => endpoint.path)).toContain("/provider/openai/chat-test");
  });

  it("recognizes OpenAI API providers only", () => {
    expect(isOpenAiRuntimeProvider("openai-api")).toBe(true);
    expect(isOpenAiRuntimeProvider("openai")).toBe(true);
    expect(isOpenAiRuntimeProvider("anthropic")).toBe(false);
  });

  it("creates deterministic dry-run probes for offline validation", () => {
    expect(normalizeOpenAiRuntimeModel("")).toBe(openAiRuntimeContract.modelFallback);
    expect(createDryRunOpenAiProbe("openai-api", "gpt-5.2")).toMatchObject({
      providerId: "openai-api",
      model: "gpt-5.2",
      status: "dry-run",
      live: false,
      rawSecretResponse: false,
    });
  });
});
