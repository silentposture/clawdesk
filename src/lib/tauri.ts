import { invoke } from "@tauri-apps/api/core";
import type { PermissionResultEvent } from "./events";
import type { LegalConsentRecord } from "./legalConsent";
import type { ProviderAuthMode, ProviderId } from "./providers";

export interface GatewayInfo {
  baseUrl: string;
  wsUrl: string;
  mode: "sidecar" | "external" | "browser-dev";
}

const FALLBACK_PORTS = [18890, 18790];
const GATEWAY_PROTOCOL = "http://127.0.0.1:";
const GATEWAY_WS_PROTOCOL = "ws://127.0.0.1:";

declare global {
  interface Window {
    __CLAWDESK_GATEWAY_PORT__?: string | number;
  }
}

function parseGatewayPort(candidate: string | number | undefined | null): number | null {
  const parsed = Number.parseInt(String(candidate), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getStaticFallbackPort(): number | null {
  const queryPort =
    typeof window !== "undefined"
      ? (() => {
          try {
            return new URLSearchParams(window.location.search).get("clawdesk-gateway-port");
          } catch {
            return undefined;
          }
        })()
      : undefined;

  const strictGateway =
    typeof window !== "undefined"
      ? (() => {
          try {
            return new URLSearchParams(window.location.search).get("clawdesk-gateway-strict") === "1";
          } catch {
            return false;
          }
        })()
      : false;

  const candidates: Array<string | number | null | undefined> = [
    (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_GATEWAY_PORT) || undefined,
    typeof window !== "undefined" ? window.__CLAWDESK_GATEWAY_PORT__ : undefined,
    typeof window !== "undefined"
      ? (() => {
          try {
            return window.localStorage?.getItem("clawdesk-gateway-port");
          } catch {
            return undefined;
          }
        })()
      : undefined,
  ];

  const candidatePorts = [...candidates, queryPort];

  for (const candidate of candidatePorts) {
    const parsed = parseGatewayPort(candidate);
    if (parsed) return parsed;
  }

  return null;
}

function buildGatewayInfo(port: number): GatewayInfo {
  return {
    baseUrl: `${GATEWAY_PROTOCOL}${port}`,
    wsUrl: `${GATEWAY_WS_PROTOCOL}${port}/events`,
    mode: "browser-dev",
  };
}

let browserFallbackPromise: Promise<GatewayInfo> | null = null;
let browserFallbackPort: number | null = null;

async function checkGatewayHealth(port: number): Promise<boolean> {
  try {
    const response = await fetch(`${GATEWAY_PROTOCOL}${port}/health`, { method: "GET", cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}

async function resolveBrowserGateway(): Promise<GatewayInfo> {
  if (browserFallbackPromise) {
    return browserFallbackPromise;
  }

  browserFallbackPromise = (async () => {
    const strict = (() => {
      if (typeof window === "undefined") return false;
      try {
        const params = new URLSearchParams(window.location.search);
        return params.get("clawdesk-gateway-strict") === "1";
      } catch {
        return false;
      }
    })();
    const configured = getStaticFallbackPort();
    if (strict && configured) {
      const ports = [configured];
      if (await checkGatewayHealth(configured)) {
        browserFallbackPort = configured;
        return buildGatewayInfo(configured);
      }
      const fallbackPort = configured;
      browserFallbackPort = fallbackPort;
      return buildGatewayInfo(fallbackPort);
    }
    const ports = [...new Set([...(configured ? [configured] : []), ...FALLBACK_PORTS])];

    for (const port of ports) {
      if (await checkGatewayHealth(port)) {
        browserFallbackPort = port;
        return buildGatewayInfo(port);
      }
    }
    const fallbackPort = configured ?? FALLBACK_PORTS[0];
    browserFallbackPort = fallbackPort;
    return buildGatewayInfo(fallbackPort);
  })();

  return browserFallbackPromise;
}

async function ensureHealthyBrowserGateway(): Promise<GatewayInfo> {
  const gatewayInfo = await resolveBrowserGateway();
  if (browserFallbackPort && (await checkGatewayHealth(browserFallbackPort))) {
    return gatewayInfo;
  }
  browserFallbackPromise = null;
  browserFallbackPort = null;
  return resolveBrowserGateway();
}

export function hasTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export async function ensureGateway(): Promise<GatewayInfo> {
  if (!hasTauriRuntime()) {
    return ensureHealthyBrowserGateway();
  }
  return invoke<GatewayInfo>("ensure_gateway");
}

export async function getGatewayInfo(): Promise<GatewayInfo> {
  if (!hasTauriRuntime()) {
    return ensureHealthyBrowserGateway();
  }
  return invoke<GatewayInfo>("get_gateway_info");
}

export async function sendPermissionResult(result: PermissionResultEvent): Promise<void> {
  if (!hasTauriRuntime()) {
    const gatewayInfo = await ensureHealthyBrowserGateway();
    await fetch(`${gatewayInfo.baseUrl}/permission-result`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
    });
    return;
  }

  await invoke("resolve_permission", { result });
}

export async function pickProjectFolder(initialPath?: string): Promise<string | undefined> {
  if (!hasTauriRuntime()) return undefined;
  return invoke<string | undefined>("pick_project_folder", { initialPath });
}

export async function readLegalConsentFromApp(): Promise<LegalConsentRecord | undefined> {
  if (!hasTauriRuntime()) return undefined;
  const record = await invoke<LegalConsentRecord | null>("read_legal_consent");
  return record ?? undefined;
}

export async function writeLegalConsentToApp(record: LegalConsentRecord): Promise<LegalConsentRecord | undefined> {
  if (!hasTauriRuntime()) return undefined;
  return invoke<LegalConsentRecord>("write_legal_consent", { record });
}

export async function saveLegalExport(defaultFileName: string, contents: string): Promise<string | undefined> {
  if (!hasTauriRuntime()) {
    const blob = new Blob([contents], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = defaultFileName || "clawdesk-legal-summary.json";
    anchor.rel = "noreferrer";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    return undefined;
  }
  const savedPath = await invoke<string | null>("save_legal_export", { defaultFileName, contents });
  return savedPath ?? undefined;
}

export interface ProviderCredentialInput {
  providerId: ProviderId;
  authMode: ProviderAuthMode;
  secret?: string;
  accountEmail?: string;
  endpoint?: string;
  model?: string;
}

export interface ProviderCredentialSummary {
  providerId: ProviderId;
  authMode: ProviderAuthMode;
  hasSecret: boolean;
  secretLabel?: string;
  secretRef?: string;
  accountEmail?: string;
  endpoint?: string;
  model?: string;
  storage: "windows-dpapi" | "portable-dev";
  updatedAtEpochMs: number;
}

export interface ProviderCredentialDeleteResult {
  deleted: boolean;
  summaries: ProviderCredentialSummary[];
}

export interface MachineIdentityRecord {
  hwid: string;
  instanceId: string;
  source: string;
}

export async function writeProviderCredentialToApp(
  credential: ProviderCredentialInput,
): Promise<ProviderCredentialSummary | undefined> {
  if (!hasTauriRuntime()) return undefined;
  return invoke<ProviderCredentialSummary>("write_provider_credential", { credential });
}

export async function readProviderCredentialSummariesFromApp(): Promise<ProviderCredentialSummary[]> {
  if (!hasTauriRuntime()) return [];
  return invoke<ProviderCredentialSummary[]>("read_provider_credential_summaries");
}

export async function deleteProviderCredentialFromApp(
  providerId: ProviderId,
): Promise<ProviderCredentialDeleteResult | undefined> {
  if (!hasTauriRuntime()) return undefined;
  return invoke<ProviderCredentialDeleteResult>("delete_provider_credential", { providerId });
}

export async function readLicenseCacheFromApp<T>(): Promise<T | undefined> {
  if (!hasTauriRuntime()) return undefined;
  const raw = await invoke<string | null>("read_license_cache");
  return raw ? (JSON.parse(raw) as T) : undefined;
}

export async function writeLicenseCacheToApp(record: unknown): Promise<void> {
  if (!hasTauriRuntime()) return;
  await invoke("write_license_cache", { recordJson: JSON.stringify(record) });
}

export async function deleteLicenseCacheFromApp(): Promise<boolean> {
  if (!hasTauriRuntime()) return false;
  return invoke<boolean>("delete_license_cache");
}

export async function getMachineIdentityFromApp(): Promise<MachineIdentityRecord | undefined> {
  if (!hasTauriRuntime()) return undefined;
  return invoke<MachineIdentityRecord>("get_machine_identity");
}
