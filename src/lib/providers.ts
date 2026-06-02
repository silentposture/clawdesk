export type ProviderStatus = "connected" | "not-connected" | "configured" | "account-required";

export type ProviderId =
  | "chatgpt-pro"
  | "openai-codex"
  | "openai"
  | "openai-api"
  | "anthropic"
  | "google"
  | "google-gemini"
  | "google-vertex"
  | "google-gemini-cli"
  | "openrouter"
  | "moonshot"
  | "byteplus"
  | "byteplus-plan"
  | "cloudflare-ai-gateway"
  | "deepseek"
  | "deepinfra"
  | "github-copilot"
  | "xai"
  | "groq"
  | "mistral"
  | "azure-openai"
  | "minimax"
  | "minimax-portal"
  | "nvidia"
  | "qianfan"
  | "qwen"
  | "qwen-portal"
  | "cerebras"
  | "kimi"
  | "kilocode"
  | "opencode"
  | "opencode-go"
  | "runway"
  | "stepfun"
  | "stepfun-plan"
  | "together"
  | "venice"
  | "volcengine"
  | "volcengine-plan"
  | "xiaomi"
  | "zai"
  | "vercel-ai-gateway"
  | "huggingface"
  | "ollama"
  | "lmstudio"
  | "vllm"
  | "sglang"
  | "local-model"
  | "mock";

export type ProviderAuthMode = "oauth" | "api-key" | "local-endpoint" | "mock";

export interface ProviderSession {
  activeProvider: ProviderId;
  status: ProviderStatus;
  displayName: string;
  detail: string;
  model?: string;
  endpoint?: string;
  accountEmail?: string;
  maskedKey?: string;
  secretRef?: string;
  tokenRefresh?: {
    mode: "not-required" | "manual" | "refreshable";
    expiresAt?: string;
    lastRefreshStatus?: "ready" | "refreshed" | "failed" | "not-configured";
  };
  runtime?: {
    providerId: ProviderId;
    apiStyle: "responses-api" | "chat-completions" | "local-openai-compatible" | "mock";
    status: "not-tested" | "dry-run" | "validated" | "failed";
    live: boolean;
    checkedAt?: string;
    requestId?: string;
    message?: string;
  };
}

export interface LlmProviderSpec {
  id: ProviderId;
  shortName: string;
  displayName: string;
  authMode: ProviderAuthMode;
  modelPlaceholder: string;
  modelDefault: string;
  keyPlaceholder?: string;
  keyPrefixes?: string[];
  endpointPlaceholder?: string;
  accountPlaceholder?: string;
  upstreamAuthKind?: "api_key" | "oauth" | "token" | "local";
  upstreamProviderId?: string;
  upstreamSource?: string;
  description: string;
}

export const compatUpstreamSnapshot = {
  repository: "https://github.com/openclaw/openclaw",
  commit: "278e3eabf29dd8ff31d633907525bda35ec6474a",
  license: "MIT",
  importedSurfaces: [
    "src/agents/model-auth.ts",
    "src/agents/auth-profiles/*",
    "src/plugin-sdk/provider-auth.ts",
    "src/commands/auth-choice-options.static.ts",
    "src/plugin-sdk/provider-catalog-shared.ts",
  ],
} as const;

export const compatOpenAiAuthModes = [
  {
    id: "openai-api-key",
    providerId: "openai-api",
    upstreamProviderId: "openai",
    authKind: "api_key",
    label: "OpenAI API Key",
  },
  {
    id: "openai-account-oauth",
    providerId: "openai-codex",
    upstreamProviderId: "openai-codex",
    authKind: "oauth",
    label: "OpenAI / Codex account OAuth",
  },
] as const;

export const llmProviderCatalog: LlmProviderSpec[] = [
  {
    id: "chatgpt-pro",
    shortName: "ChatGPT Pro",
    displayName: "ChatGPT Pro",
    authMode: "oauth",
    modelPlaceholder: "gpt-5.4",
    modelDefault: "gpt-5.4",
    accountPlaceholder: "ChatGPT Pro 帳號 Email",
    upstreamAuthKind: "oauth",
    upstreamProviderId: "openai-codex",
    upstreamSource: "src/agents/auth-profiles/oauth.ts",
    description: "無金鑰協議（Keyless），使用 ChatGPT Pro 訂閱權限進行 Cloud-Main 路由。",
  },
  {
    id: "openai-codex",
    shortName: "OpenAI Codex",
    displayName: "OpenAI Codex",
    authMode: "oauth",
    modelPlaceholder: "gpt-5.3-codex",
    modelDefault: "gpt-5.3-codex",
    accountPlaceholder: "OpenAI Codex 帳號 Email",
    upstreamAuthKind: "oauth",
    upstreamProviderId: "openai-codex",
    upstreamSource: "src/agents/model-auth.ts",
    description: "OpenAI Codex OAuth（相容供應商方式）。",
  },
  {
    id: "openai",
    shortName: "OpenAI API",
    displayName: "OpenAI API",
    authMode: "api-key",
    modelPlaceholder: "gpt-5.2",
    modelDefault: "gpt-5.2",
    keyPlaceholder: "sk-...",
    keyPrefixes: ["sk-"],
    upstreamAuthKind: "api_key",
    upstreamProviderId: "openai",
    upstreamSource: "src/agents/model-auth-env.ts",
    description: "官方 OpenAI API 金鑰。",
  },
  {
    id: "openai-api",
    shortName: "OpenAI API",
    displayName: "OpenAI API",
    authMode: "api-key",
    modelPlaceholder: "gpt-5.2",
    modelDefault: "gpt-5.2",
    keyPlaceholder: "sk-...",
    keyPrefixes: ["sk-"],
    upstreamAuthKind: "api_key",
    upstreamProviderId: "openai",
    upstreamSource: "src/agents/model-auth.ts",
    description: "舊版 OpenAI API 相容欄位。",
  },
  {
    id: "anthropic",
    shortName: "Anthropic",
    displayName: "Anthropic",
    authMode: "api-key",
    modelPlaceholder: "claude-opus-4-6",
    modelDefault: "claude-opus-4-6",
    keyPlaceholder: "sk-ant-...",
    keyPrefixes: ["sk-ant-", "sk-ant-api03-"],
    description: "Anthropic Claude 系列模型。",
  },
  {
    id: "google",
    shortName: "Gemini",
    displayName: "Google Gemini API",
    authMode: "api-key",
    modelPlaceholder: "gemini-1.5-flash",
    modelDefault: "gemini-1.5-flash",
    keyPlaceholder: "AIza...",
    keyPrefixes: ["AIza"],
    description: "Google Gemini API Key。",
  },
  {
    id: "google-gemini",
    shortName: "Gemini",
    displayName: "Google Gemini API",
    authMode: "api-key",
    modelPlaceholder: "gemini-1.5-flash",
    modelDefault: "gemini-1.5-flash",
    keyPlaceholder: "AIza...",
    keyPrefixes: ["AIza"],
    description: "Gemini 欄位名稱相容。",
  },
  {
    id: "google-vertex",
    shortName: "Vertex AI",
    displayName: "Google Vertex AI",
    authMode: "api-key",
    modelPlaceholder: "vertex-flash",
    modelDefault: "vertex-flash",
    keyPlaceholder: "GOOGLE_API_KEY",
    description: "Google Vertex AI API Key。",
  },
  {
    id: "google-gemini-cli",
    shortName: "Gemini CLI",
    displayName: "Google Gemini CLI（OAuth）",
    authMode: "oauth",
    modelPlaceholder: "gemini-1.5-flash",
    modelDefault: "gemini-1.5-flash",
    accountPlaceholder: "Google 帳號 Email",
    description: "Gemini CLI / OAuth 模式。",
  },
  {
    id: "openrouter",
    shortName: "OpenRouter",
    displayName: "OpenRouter",
    authMode: "api-key",
    modelPlaceholder: "anthropic/claude-3.5-sonnet",
    modelDefault: "anthropic/claude-3.5-sonnet",
    keyPlaceholder: "sk-or-v1-...",
    keyPrefixes: ["sk-or-v1-"],
    description: "聚合多家模型供應商。",
  },
  {
    id: "byteplus",
    shortName: "BytePlus",
    displayName: "BytePlus",
    authMode: "api-key",
    modelPlaceholder: "byteplus-plan/ark-code-latest",
    modelDefault: "byteplus-plan/ark-code-latest",
    keyPlaceholder: "BYTEPLUS_API_KEY",
    keyPrefixes: ["sk-", "bp_"],
    description: "BytePlus/Ark 平台。",
  },
  {
    id: "byteplus-plan",
    shortName: "BytePlus Plan",
    displayName: "BytePlus Plan",
    authMode: "api-key",
    modelPlaceholder: "byteplus-plan/ark-code-latest",
    modelDefault: "byteplus-plan/ark-code-latest",
    keyPlaceholder: "BYTEPLUS_API_KEY",
    keyPrefixes: ["sk-", "bp_"],
    description: "BytePlus coding surface。",
  },
  {
    id: "cloudflare-ai-gateway",
    shortName: "Cloudflare AI Gateway",
    displayName: "Cloudflare AI Gateway",
    authMode: "api-key",
    modelPlaceholder: "cloudflare/model",
    modelDefault: "cloudflare/model",
    keyPlaceholder: "CLOUDFLARE_AI_GATEWAY_API_KEY",
    description: "Cloudflare AI Gateway OpenAI 相容轉發。",
  },
  {
    id: "deepseek",
    shortName: "DeepSeek",
    displayName: "DeepSeek",
    authMode: "api-key",
    modelPlaceholder: "deepseek/deepseek-v4-flash",
    modelDefault: "deepseek/deepseek-v4-flash",
    keyPlaceholder: "DEEPSEEK_API_KEY",
    keyPrefixes: ["sk-"],
    description: "DeepSeek 深度推理供應商。",
  },
  {
    id: "deepinfra",
    shortName: "DeepInfra",
    displayName: "DeepInfra",
    authMode: "api-key",
    modelPlaceholder: "deepinfra/deepseek-ai/DeepSeek-V3.2",
    modelDefault: "deepinfra/deepseek-ai/DeepSeek-V3.2",
    keyPlaceholder: "DEEPINFRA_API_KEY",
    keyPrefixes: ["sk-"],
    description: "DeepInfra OpenAI 相容模型。",
  },
  {
    id: "github-copilot",
    shortName: "GitHub Copilot",
    displayName: "GitHub Copilot",
    authMode: "api-key",
    modelPlaceholder: "copilot/default",
    modelDefault: "copilot/default",
    keyPlaceholder: "COPILOT_GITHUB_TOKEN",
    description: "使用 GitHub Copilot Token 的模型代理。",
  },
  {
    id: "minimax",
    shortName: "MiniMax",
    displayName: "MiniMax",
    authMode: "api-key",
    modelPlaceholder: "minimax/MiniMax-M2.7",
    modelDefault: "minimax/MiniMax-M2.7",
    keyPlaceholder: "MINIMAX_API_KEY",
    keyPrefixes: ["sk-", "minimax_"],
    description: "MiniMax 模型服務。",
  },
  {
    id: "minimax-portal",
    shortName: "MiniMax Portal",
    displayName: "MiniMax Portal",
    authMode: "api-key",
    modelPlaceholder: "minimax/MiniMax-M2.7",
    modelDefault: "minimax/MiniMax-M2.7",
    keyPlaceholder: "MINIMAX_OAUTH_TOKEN",
    description: "MiniMax Coding Plan 專用入口。",
  },
  {
    id: "moonshot",
    shortName: "Moonshot",
    displayName: "Moonshot",
    authMode: "api-key",
    modelPlaceholder: "moonshot/kimi-k2.6",
    modelDefault: "moonshot/kimi-k2.6",
    keyPlaceholder: "MOONSHOT_API_KEY",
    keyPrefixes: ["sk-", "moonshot_"],
    description: "Moonshot Kimi model 平台。",
  },
  {
    id: "nvidia",
    shortName: "NVIDIA",
    displayName: "NVIDIA",
    authMode: "api-key",
    modelPlaceholder: "nvidia/nvidia/nemotron-3-super-120b-a12b",
    modelDefault: "nvidia/nvidia/nemotron-3-super-120b-a12b",
    keyPlaceholder: "NVIDIA_API_KEY",
    description: "NVIDIA 平台模型。",
  },
  {
    id: "qianfan",
    shortName: "Qianfan",
    displayName: "Qianfan",
    authMode: "api-key",
    modelPlaceholder: "qianfan/deepseek-v3.2",
    modelDefault: "qianfan/deepseek-v3.2",
    keyPlaceholder: "QIANFAN_API_KEY",
    keyPrefixes: ["sk-", "qf_"],
    description: "百度 Qianfan。",
  },
  {
    id: "qwen",
    shortName: "Qwen",
    displayName: "Qwen",
    authMode: "api-key",
    modelPlaceholder: "qwen/qwen3.5-plus",
    modelDefault: "qwen/qwen3.5-plus",
    keyPlaceholder: "QWEN_API_KEY",
    keyPrefixes: ["sk-", "qwen_"],
    description: "Qwen Cloud / DashScope。",
  },
  {
    id: "kimi",
    shortName: "Kimi",
    displayName: "Kimi Coding",
    authMode: "api-key",
    modelPlaceholder: "kimi/kimi-for-coding",
    modelDefault: "kimi/kimi-for-coding",
    keyPlaceholder: "KIMI_API_KEY",
    keyPrefixes: ["sk-", "kimi_"],
    description: "Kimi Coding 平台入口。",
  },
  {
    id: "kilocode",
    shortName: "Kilo Gateway",
    displayName: "Kilo Gateway",
    authMode: "api-key",
    modelPlaceholder: "kilocode/kilo/auto",
    modelDefault: "kilocode/kilo/auto",
    keyPlaceholder: "KILOCODE_API_KEY",
    description: "Kilo Gateway 聚合式入口。",
  },
  {
    id: "opencode",
    shortName: "OpenCode",
    displayName: "OpenCode",
    authMode: "api-key",
    modelPlaceholder: "opencode/claude-opus-4-6",
    modelDefault: "opencode/claude-opus-4-6",
    keyPlaceholder: "OPENCODE_API_KEY",
    keyPrefixes: ["sk-"] ,
    description: "OpenCode Zen runtime。",
  },
  {
    id: "opencode-go",
    shortName: "OpenCode Go",
    displayName: "OpenCode Go",
    authMode: "api-key",
    modelPlaceholder: "opencode-go/kimi-k2.6",
    modelDefault: "opencode-go/kimi-k2.6",
    keyPlaceholder: "OPENCODE_ZEN_API_KEY",
    keyPrefixes: ["sk-"] ,
    description: "OpenCode Go runtime。",
  },
  {
    id: "runway",
    shortName: "Runway",
    displayName: "Runway",
    authMode: "api-key",
    modelPlaceholder: "runway/gpt",
    modelDefault: "runway/gpt",
    keyPlaceholder: "RUNWAY_API_KEY",
    description: "Runway 模型供應層。",
  },
  {
    id: "stepfun",
    shortName: "StepFun",
    displayName: "StepFun",
    authMode: "api-key",
    modelPlaceholder: "stepfun/step-3.5-flash",
    modelDefault: "stepfun/step-3.5-flash",
    keyPlaceholder: "STEPFUN_API_KEY",
    keyPrefixes: ["sk-", "sf_"],
    description: "StepFun 模型入口。",
  },
  {
    id: "stepfun-plan",
    shortName: "StepFun Plan",
    displayName: "StepFun Plan",
    authMode: "api-key",
    modelPlaceholder: "stepfun/step-3.5-flash",
    modelDefault: "stepfun/step-3.5-flash",
    keyPlaceholder: "STEPFUN_API_KEY",
    keyPrefixes: ["sk-", "sf_"],
    description: "StepFun coding surface。",
  },
  {
    id: "together",
    shortName: "Together AI",
    displayName: "Together",
    authMode: "api-key",
    modelPlaceholder: "together/moonshotai/Kimi-K2.5",
    modelDefault: "together/moonshotai/Kimi-K2.5",
    keyPlaceholder: "TOGETHER_API_KEY",
    keyPrefixes: ["sk-"] ,
    description: "Together 代理。",
  },
  {
    id: "venice",
    shortName: "Venice AI",
    displayName: "Venice",
    authMode: "api-key",
    modelPlaceholder: "venice/default",
    modelDefault: "venice/default",
    keyPlaceholder: "VENICE_API_KEY",
    description: "Venice AI 平台。",
  },
  {
    id: "volcengine",
    shortName: "Volcengine",
    displayName: "Volcengine",
    authMode: "api-key",
    modelPlaceholder: "volcengine/doubao-seed-1-8-251228",
    modelDefault: "volcengine/doubao-seed-1-8-251228",
    keyPlaceholder: "VOLCANO_ENGINE_API_KEY",
    keyPrefixes: ["sk-", "vo_"],
    description: "火山引擎 Doubao 通道。",
  },
  {
    id: "volcengine-plan",
    shortName: "Volcengine Plan",
    displayName: "Volcengine Plan",
    authMode: "api-key",
    modelPlaceholder: "volcengine-plan/ark-code-latest",
    modelDefault: "volcengine-plan/ark-code-latest",
    keyPlaceholder: "VOLCANO_ENGINE_API_KEY",
    keyPrefixes: ["sk-", "vo_"],
    description: "火山引擎 coding surface。",
  },
  {
    id: "xiaomi",
    shortName: "Xiaomi",
    displayName: "Xiaomi",
    authMode: "api-key",
    modelPlaceholder: "xiaomi/mimo-v2-flash",
    modelDefault: "xiaomi/mimo-v2-flash",
    keyPlaceholder: "XIAOMI_API_KEY",
    keyPrefixes: ["sk-", "xm_"],
    description: "Xiaomi MiMo 平台。",
  },
  {
    id: "xai",
    shortName: "xAI",
    displayName: "xAI",
    authMode: "api-key",
    modelPlaceholder: "grok-beta",
    modelDefault: "grok-beta",
    keyPlaceholder: "xai-...",
    description: "xAI API。",
  },
  {
    id: "groq",
    shortName: "Groq",
    displayName: "Groq",
    authMode: "api-key",
    modelPlaceholder: "llama-3.1-70b-versatile",
    modelDefault: "llama-3.1-70b-versatile",
    keyPlaceholder: "gsk_...",
    keyPrefixes: ["gsk_", "xai-"],
    description: "Groq API。",
  },
  {
    id: "mistral",
    shortName: "Mistral",
    displayName: "Mistral",
    authMode: "api-key",
    modelPlaceholder: "mistral-large-latest",
    modelDefault: "mistral-large-latest",
    keyPlaceholder: "mist_...",
    description: "Mistral API。",
  },
  {
    id: "azure-openai",
    shortName: "Azure OpenAI",
    displayName: "Azure OpenAI",
    authMode: "local-endpoint",
    modelPlaceholder: "gpt-4.1",
    modelDefault: "gpt-4.1",
    endpointPlaceholder: "https://xxx.openai.azure.com/openai/deployments/xxx/chat/completions",
    keyPlaceholder: "Azure API key",
    description: "Azure OpenAI 相容 API endpoint。",
  },
  {
    id: "cerebras",
    shortName: "Cerebras",
    displayName: "Cerebras",
    authMode: "api-key",
    modelPlaceholder: "llama-4-maverick",
    modelDefault: "llama-4-maverick",
    keyPlaceholder: "CEREBRAS_API_KEY",
    description: "Cerebras API。",
  },
  {
    id: "zai",
    shortName: "Z.AI",
    displayName: "Z.AI（GLM）",
    authMode: "api-key",
    modelPlaceholder: "zai/glm-4.7",
    modelDefault: "zai/glm-4.7",
    keyPlaceholder: "ZAI_API_KEY",
    description: "Z.AI / GLM。",
  },
  {
    id: "vercel-ai-gateway",
    shortName: "Vercel AI Gateway",
    displayName: "Vercel AI Gateway",
    authMode: "api-key",
    modelPlaceholder: "anthropic/claude-sonnet-4-5",
    modelDefault: "anthropic/claude-sonnet-4-5",
    keyPlaceholder: "AI_GATEWAY_API_KEY",
    description: "Vercel AI Gateway API。",
  },
  {
    id: "huggingface",
    shortName: "Hugging Face",
    displayName: "Hugging Face Inference",
    authMode: "api-key",
    modelPlaceholder: "deepseek-ai/DeepSeek-R1",
    modelDefault: "deepseek-ai/DeepSeek-R1",
    keyPlaceholder: "HF_TOKEN",
    description: "Hugging Face Inference API。",
  },
  {
    id: "qwen-portal",
    shortName: "Qwen",
    displayName: "Qwen",
    authMode: "oauth",
    modelPlaceholder: "qwen/coder",
    modelDefault: "qwen/coder",
    accountPlaceholder: "Qwen 帳號 Email",
    description: "Qwen OAuth/Portal。",
  },
  {
    id: "ollama",
    shortName: "Ollama",
    displayName: "Ollama",
    authMode: "local-endpoint",
    modelPlaceholder: "llama3.3",
    modelDefault: "llama3.3",
    endpointPlaceholder: "http://127.0.0.1:11434",
    description: "本機模型 server（Ollama）。",
  },
  {
    id: "lmstudio",
    shortName: "LM Studio",
    displayName: "LM Studio",
    authMode: "local-endpoint",
    modelPlaceholder: "local-model",
    modelDefault: "local-model",
    endpointPlaceholder: "http://127.0.0.1:1234/v1",
    description: "本機 OpenAI 相容伺服器。",
  },
  {
    id: "vllm",
    shortName: "vLLM",
    displayName: "vLLM",
    authMode: "local-endpoint",
    modelPlaceholder: "your-model-id",
    modelDefault: "your-model-id",
    endpointPlaceholder: "http://127.0.0.1:8000/v1",
    keyPlaceholder: "vllm-local",
    description: "本機或自架 vLLM 相容 endpoint。",
  },
  {
    id: "sglang",
    shortName: "SGLang",
    displayName: "SGLang",
    authMode: "local-endpoint",
    modelPlaceholder: "your-model-id",
    modelDefault: "your-model-id",
    endpointPlaceholder: "http://127.0.0.1:30000/v1",
    keyPlaceholder: "sglang-local",
    description: "本機或自架 SGLang 相容 endpoint。",
  },
  {
    id: "local-model",
    shortName: "本機模型",
    displayName: "本機模型",
    authMode: "local-endpoint",
    modelPlaceholder: "llama3.3",
    modelDefault: "llama3.3",
    endpointPlaceholder: "http://127.0.0.1:11434",
    description: "通用本機/OpenAI 相容 endpoint。",
  },
  {
    id: "mock",
    shortName: "Mock Gateway",
    displayName: "Mock Gateway",
    authMode: "mock",
    modelPlaceholder: "mock-model",
    modelDefault: "mock-model",
    description: "本機 Mock 回覆與測試模式。",
  },
];

export const defaultProviderSession: ProviderSession = {
  activeProvider: "local-model",
  status: "connected",
  displayName: "Ollama",
  detail: "目前預設使用本機 Ollama endpoint（http://127.0.0.1:11434）。",
  endpoint: "http://127.0.0.1:11434",
  model: "llama3.3",
};

export function providerStatusLabel(status: ProviderStatus): string {
  if (status === "connected") return "已連線";
  if (status === "configured") return "已設定";
  if (status === "account-required") return "需網站帳號登入";
  return "未連線";
}

export function providerName(provider: ProviderId): string {
  return llmProviderCatalog.find((item) => item.id === provider)?.displayName ?? provider;
}

export function isProviderId(value: string): value is ProviderId {
  return llmProviderCatalog.some((provider) => provider.id === value);
}

export function canonicalProviderForSession(providerId: ProviderId): ProviderId {
  if (providerId === "openai-codex") return "chatgpt-pro";
  return providerId;
}

export function isCompatOpenAiProvider(providerId: ProviderId): boolean {
  return compatOpenAiAuthModes.some((mode) => mode.providerId === providerId);
}

export function upstreamAuthModeForProvider(providerId: ProviderId): string {
  const provider = llmProviderCatalog.find((item) => item.id === providerId);
  if (!provider?.upstreamAuthKind) return "none";
  return `${provider.upstreamProviderId ?? provider.id}:${provider.upstreamAuthKind}`;
}
