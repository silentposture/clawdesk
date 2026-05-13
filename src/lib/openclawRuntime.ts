import { gatewayEventTypes } from "./events";
import { llmProviderCatalog, openClawUpstreamSnapshot, type ProviderId } from "./providers";

export type RuntimeImplementationStatus = "contract-compatible" | "mock-backed" | "deferred";

export interface OpenClawRuntimeSurface {
  id: string;
  upstreamPaths: string[];
  status: RuntimeImplementationStatus;
  windowsAdapter: string;
  remainingWork: string;
}

export interface RuntimeAuthPlan {
  providerId: ProviderId;
  upstreamProviderId: string;
  authMode: "api-key" | "oauth" | "local-endpoint" | "mock";
  endpoint: string;
  credentialPolicy: "masked-in-memory" | "account-token-stub" | "loopback-only" | "no-secret";
  upstreamSource: string;
  canUseNow: boolean;
}

export const openClawRuntimeSurfaces: OpenClawRuntimeSurface[] = [
  {
    id: "provider-auth",
    upstreamPaths: ["src/agents/model-auth.ts", "src/agents/model-auth-env.ts", "src/agents/auth-profiles/*"],
    status: "contract-compatible",
    windowsAdapter: "Provider auth plans map OpenClaw API key, OAuth, local endpoint, and mock modes to desktop-safe endpoints. Tauri desktop stores provider secrets with Windows DPAPI.",
    remainingWork: "Replace OAuth account stubs with real token refresh and optional Windows Credential Manager integration.",
  },
  {
    id: "provider-catalog",
    upstreamPaths: ["src/model-catalog/*", "src/agents/models-config.providers.*", "src/plugin-sdk/provider-catalog-shared.ts"],
    status: "contract-compatible",
    windowsAdapter: "Provider catalog is exposed in React and mock Gateway with upstream ids/source metadata.",
    remainingWork: "Import live model context window, pricing, feature flags, and cache policy metadata.",
  },
  {
    id: "gateway-events",
    upstreamPaths: ["src/gateway/control-ui-contract.ts", "src/gateway/client.ts", "src/gateway/call.ts"],
    status: "contract-compatible",
    windowsAdapter: "Desktop WebSocket events cover agent delta/done, canvas, permission, and gateway status events.",
    remainingWork: "Replace mock event producer with signed production Gateway runtime.",
  },
  {
    id: "agent-session-runtime",
    upstreamPaths: ["src/agents/*", "src/gateway/agent-*.ts", "src/gateway/chat-*.ts"],
    status: "mock-backed",
    windowsAdapter: "Session and agent UX use deterministic local mock flows for Windows Beta validation.",
    remainingWork: "Embed or launch upstream runner with Windows process supervision and cancellation.",
  },
  {
    id: "permissions-tools",
    upstreamPaths: ["src/gateway/permission*.ts", "src/plugin-sdk/*", "extensions/*"],
    status: "contract-compatible",
    windowsAdapter: "Permission request/result event contract is available and GUI approval flow is tested.",
    remainingWork: "Load real plugin/tool manifests and enforce a Windows sandbox policy.",
  },
  {
    id: "config-runtime",
    upstreamPaths: ["src/config/*", "src/commands/*"],
    status: "contract-compatible",
    windowsAdapter: "Guided settings and release config are mapped to Windows-first profile sections.",
    remainingWork: "Add import/export compatibility with upstream OpenClaw config files.",
  },
  {
    id: "memory-workflows",
    upstreamPaths: ["packages/memory-host-sdk/*", "src/cron/*"],
    status: "mock-backed",
    windowsAdapter: "Memory and workflow panels expose local desktop flows and deterministic mock Gateway state.",
    remainingWork: "Add local durable store, scheduler, and embeddings/vector integration.",
  },
  {
    id: "media-tts-pairing",
    upstreamPaths: ["src/media-understanding/*", "src/media-generation/*", "src/tts/*", "src/pairing/*"],
    status: "deferred",
    windowsAdapter: "Windows capability declarations are present; realtime audio/device pairing are not first Beta blockers.",
    remainingWork: "Implement Windows Media Foundation/WASAPI/WIC or ffmpeg sidecar, then pairing.",
  },
];

export const openClawRuntimeContract = {
  upstream: openClawUpstreamSnapshot,
  adapterMode: "windows-sidecar-contract",
  target: "Windows 11 x64 MSVC",
  eventTypes: [...gatewayEventTypes],
  surfaces: openClawRuntimeSurfaces,
} as const;

export function runtimeReadinessSummary() {
  return openClawRuntimeSurfaces.reduce<Record<RuntimeImplementationStatus, number>>(
    (summary, surface) => {
      summary[surface.status] += 1;
      return summary;
    },
    { "contract-compatible": 0, "mock-backed": 0, deferred: 0 },
  );
}

export function resolveRuntimeAuthPlan(providerId: ProviderId): RuntimeAuthPlan {
  const provider = llmProviderCatalog.find((item) => item.id === providerId);
  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}`);
  }

  if (provider.authMode === "oauth") {
    return {
      providerId,
      upstreamProviderId: provider.upstreamProviderId ?? provider.id,
      authMode: provider.authMode,
      endpoint: provider.id === "chatgpt-pro" ? "/auth/chatgpt-pro/oauth-login" : "/auth/openai-codex/oauth-login",
      credentialPolicy: "account-token-stub",
      upstreamSource: provider.upstreamSource ?? "src/agents/model-auth.ts",
      canUseNow: true,
    };
  }

  if (provider.authMode === "local-endpoint") {
    return {
      providerId,
      upstreamProviderId: provider.upstreamProviderId ?? provider.id,
      authMode: provider.authMode,
      endpoint: "/auth/local-model",
      credentialPolicy: "loopback-only",
      upstreamSource: provider.upstreamSource ?? "src/agents/models-config.providers.*",
      canUseNow: true,
    };
  }

  if (provider.authMode === "mock") {
    return {
      providerId,
      upstreamProviderId: provider.id,
      authMode: provider.authMode,
      endpoint: "/auth/mock",
      credentialPolicy: "no-secret",
      upstreamSource: "sidecars/mock-gateway/server.mjs",
      canUseNow: true,
    };
  }

  return {
    providerId,
    upstreamProviderId: provider.upstreamProviderId ?? provider.id,
    authMode: provider.authMode,
    endpoint: provider.id === "openai" || provider.id === "openai-api" ? "/auth/openai-api-key" : "/auth/provider",
    credentialPolicy: "masked-in-memory",
    upstreamSource: provider.upstreamSource ?? "src/agents/model-auth-env.ts",
    canUseNow: true,
  };
}
