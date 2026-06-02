import type { ProviderId } from "./providers";

export type OpenAiRuntimeStatus = "not-tested" | "dry-run" | "validated" | "failed";

export interface OpenAiRuntimeContract {
  providerIds: ProviderId[];
  apiStyle: "responses-api";
  apiBaseUrl: string;
  responseEndpoint: "/v1/responses";
  modelFallback: string;
  rawSecretResponse: false;
  endpoints: Array<{
    method: "GET" | "POST";
    path: string;
    purpose: string;
  }>;
  liveMode: {
    defaultEnabled: false;
    enableFlag: "CLAWDESK_OPENAI_LIVE_TEST";
    secretSources: ["request.apiKey", "OPENAI_API_KEY"];
  };
}

export interface OpenAiRuntimeProbe {
  providerId: ProviderId;
  model: string;
  status: OpenAiRuntimeStatus;
  live: boolean;
  checkedAt: string;
  rawSecretResponse: false;
  requestId?: string;
  outputText?: string;
  errorCode?: string;
}

export const openAiRuntimeContract: OpenAiRuntimeContract = {
  providerIds: ["openai", "openai-api"],
  apiStyle: "responses-api",
  apiBaseUrl: "https://api.openai.com/v1",
  responseEndpoint: "/v1/responses",
  modelFallback: "gpt-4o-mini",
  rawSecretResponse: false,
  endpoints: [
    {
      method: "GET",
      path: "/provider/openai/runtime-contract",
      purpose: "回傳 OpenAI Responses API runtime 合約，不包含任何 secret。",
    },
    {
      method: "POST",
      path: "/provider/openai/validate-key",
      purpose: "驗證 OpenAI API key 或 dry-run 驗證請求形狀，不回傳原始 key。",
    },
    {
      method: "POST",
      path: "/provider/openai/chat-test",
      purpose: "執行最小 Responses API 對話測試，預設 dry-run。",
    },
  ],
  liveMode: {
    defaultEnabled: false,
    enableFlag: "CLAWDESK_OPENAI_LIVE_TEST",
    secretSources: ["request.apiKey", "OPENAI_API_KEY"],
  },
};

export function isOpenAiRuntimeProvider(providerId: ProviderId): boolean {
  return openAiRuntimeContract.providerIds.includes(providerId);
}

export function normalizeOpenAiRuntimeModel(model?: string, fallback = openAiRuntimeContract.modelFallback): string {
  const trimmed = String(model ?? "").trim();
  return trimmed || fallback;
}

export function createDryRunOpenAiProbe(providerId: ProviderId, model?: string): OpenAiRuntimeProbe {
  return {
    providerId,
    model: normalizeOpenAiRuntimeModel(model),
    status: "dry-run",
    live: false,
    checkedAt: new Date(0).toISOString(),
    rawSecretResponse: false,
  };
}
