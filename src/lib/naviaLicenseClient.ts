import { deleteLicenseCacheFromApp, getMachineIdentityFromApp, readLicenseCacheFromApp, writeLicenseCacheToApp } from "./tauri";
import { createMockMachineFingerprint, type LicensePlan, type LicenseStatus } from "./licensing";

export interface NaviaLicenseCacheRecord {
  baseUrl: string;
  productKey: string;
  orderNo: string;
  email?: string;
  hwid: string;
  instanceId: string;
  certificateJson: string;
  features: string[];
  updatesUntilUtc: string | null;
  gracePolicy: NaviaLicenseGracePolicy | null;
  appVersion: string;
  activatedAtUtc: string;
  lastValidatedAtUtc: string | null;
  maxDevices: number;
}

export interface NaviaLicenseGracePolicy {
  licenseType?: string | null;
  expiresAtUtc?: string | null;
  graceUntilUtc?: string | null;
  updatesUntilUtc?: string | null;
}

export interface NaviaLicensePayload {
  licenseId: string;
  planType: string;
  subjectEmailHash: string;
  hwidHash: string;
  issuedAtUtc: string;
  expiresAtUtc: string;
  orderNo: string;
  nonce: string;
  version: number;
  productKey?: string | null;
  planKey?: string | null;
  licenseType?: string | null;
  features?: string[] | null;
  maxDevices?: number;
  updatesUntilUtc?: string | null;
  graceUntilUtc?: string | null;
  accountIdHash?: string | null;
  machineBindingHash?: string | null;
  keyVersion?: string | null;
}

export interface NaviaLicenseEnvelope {
  payload: NaviaLicensePayload;
  signature: string;
  keyId: string;
}

export interface NaviaLicensePublicKeyItem {
  keyId: string;
  algorithm: string;
  active: boolean;
  publicKeyPem: string;
}

export interface NaviaLicensePublicKeyRing {
  algorithm: string;
  activeKeyId: string;
  keys: NaviaLicensePublicKeyItem[];
}

export interface NaviaLicenseActivationRequest {
  orderNo: string;
  email: string;
  hwid: string;
  productKey: string;
  instanceId: string;
  appVersion: string;
}

export interface NaviaLicenseActivationResponse {
  ok: boolean;
  message: string;
  licenseId?: string;
  instanceId?: string;
  license?: string;
  gracePolicy?: NaviaLicenseGracePolicy | null;
  features?: string[];
  updatesUntilUtc?: string | null;
  maxDevices?: number;
}

export interface NaviaLicenseValidateData {
  active: boolean;
  message: string;
  licenseId?: string | null;
  productKey: string;
  planKey: string;
  licenseType: string;
  features: string[];
  revoked: boolean;
  expired: boolean;
  withinGrace: boolean;
  hwidMatched: boolean;
  instanceMatched: boolean;
  machineBindingMatched: boolean;
  updatesAllowed: boolean;
  productMatched: boolean;
  expiresAtUtc?: string | null;
  updatesUntilUtc?: string | null;
  graceUntilUtc?: string | null;
  maxDevices: number;
  activeDeviceCount: number;
}

export interface NaviaLicenseValidateEnvelope {
  ok: boolean;
  error?: string;
  data: NaviaLicenseValidateData;
}

export interface NaviaLicenseRefreshResponse extends NaviaLicenseActivationResponse {}

export interface NaviaLicenseOperationResponse {
  ok: boolean;
  message?: string;
  error?: string;
}

export interface NaviaLocalVerificationResult {
  signatureValid: boolean;
  productMatched: boolean;
  updatesAllowed: boolean;
  notExpiredOrWithinGrace: boolean;
  requiresOnlineMachineBindingValidation: true;
  reason: string;
  payload?: NaviaLicensePayload;
}

export interface NaviaLicenseGatewayClient {
  baseUrl?: string;
  getPublicKeys(): Promise<NaviaLicensePublicKeyRing>;
  activate(request: NaviaLicenseActivationRequest): Promise<NaviaLicenseActivationResponse>;
  validate(cache: NaviaLicenseCacheRecord, appReleaseDateUtc?: string): Promise<NaviaLicenseValidateEnvelope>;
  refresh(cache: NaviaLicenseCacheRecord): Promise<NaviaLicenseRefreshResponse>;
  deactivate(cache: NaviaLicenseCacheRecord): Promise<NaviaLicenseOperationResponse>;
}

export interface NaviaLicenseCacheStore {
  read(): Promise<NaviaLicenseCacheRecord | undefined>;
  write(record: NaviaLicenseCacheRecord): Promise<void>;
  delete(): Promise<boolean>;
}

export interface NaviaLicenseServiceOptions {
  gateway: NaviaLicenseGatewayClient;
  store: NaviaLicenseCacheStore;
  productKey: string;
  appVersion: string;
  appReleaseDateUtc: string;
  validateIntervalHours?: number;
  localVerifier?: typeof verifyNaviaLicenseCertificateLocally;
}

export interface NaviaLicenseStartupState {
  hasCache: boolean;
  local: NaviaLocalVerificationResult | null;
  remote?: NaviaLicenseValidateData;
  shouldValidateRemotely: boolean;
  cache?: NaviaLicenseCacheRecord;
}

export interface NaviaMachineIdentity {
  hwid: string;
  instanceId: string;
  source: "tauri-machine" | "mock-fallback";
}

export function createNaviaLicenseGatewayClient(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): NaviaLicenseGatewayClient {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");

  async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetchImpl(`${normalizedBaseUrl}${path}`, init);
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${init?.method ?? "GET"} ${path} failed: ${response.status} ${text}`);
    }
    return JSON.parse(text) as T;
  }

  return {
    baseUrl: normalizedBaseUrl,
    getPublicKeys() {
      return getJson<NaviaLicensePublicKeyRing>("/api/license/public-keys");
    },
    activate(request) {
      return getJson<NaviaLicenseActivationResponse>("/api/license/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
    },
    validate(cache, appReleaseDateUtc) {
      return getJson<NaviaLicenseValidateEnvelope>("/api/license/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          licenseCertificateJson: cache.certificateJson,
          hwid: cache.hwid,
          instanceId: cache.instanceId,
          appVersion: cache.appVersion,
          productKey: cache.productKey,
          appReleaseDateUtc: appReleaseDateUtc ?? new Date().toISOString(),
        }),
      });
    },
    refresh(cache) {
      const licenseId = getNaviaLicenseIdFromCertificate(cache.certificateJson);
      return getJson<NaviaLicenseRefreshResponse>("/api/license/refresh-certificate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          licenseId,
          hwid: cache.hwid,
          instanceId: cache.instanceId,
        }),
      });
    },
    deactivate(cache) {
      const licenseId = getNaviaLicenseIdFromCertificate(cache.certificateJson);
      return getJson<NaviaLicenseOperationResponse>("/api/license/deactivate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          licenseId,
          hwid: cache.hwid,
          instanceId: cache.instanceId,
        }),
      });
    },
  };
}

export function createInMemoryNaviaLicenseCacheStore(initial?: NaviaLicenseCacheRecord): NaviaLicenseCacheStore {
  let current = initial;
  return {
    async read() {
      return current;
    },
    async write(record) {
      current = record;
    },
    async delete() {
      const existed = Boolean(current);
      current = undefined;
      return existed;
    },
  };
}

export function createTauriNaviaLicenseCacheStore(): NaviaLicenseCacheStore {
  return {
    async read() {
      return readLicenseCacheFromApp();
    },
    async write(record) {
      await writeLicenseCacheToApp(record);
    },
    async delete() {
      return deleteLicenseCacheFromApp();
    },
  };
}

export async function getCurrentNaviaMachineIdentity(): Promise<NaviaMachineIdentity> {
  const record = await getMachineIdentityFromApp();
  if (record?.hwid && record.instanceId) {
    return {
      hwid: record.hwid,
      instanceId: record.instanceId,
      source: "tauri-machine",
    };
  }

  const fingerprint = createMockMachineFingerprint();
  const normalized = fingerprint.fingerprintHash.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return {
    hwid: fingerprint.fingerprintHash,
    instanceId: `clawdesk-${normalized.slice(-16)}`,
    source: "mock-fallback",
  };
}

export async function verifyNaviaLicenseCertificateLocally(
  certificateJson: string,
  keyRing: NaviaLicensePublicKeyRing,
  expectedProductKey: string,
  nowUtc: string,
  appReleaseDateUtc?: string,
): Promise<NaviaLocalVerificationResult> {
  if (!certificateJson.trim()) {
    return failure("certificate_missing");
  }

  let envelope: NaviaLicenseEnvelope;
  try {
    envelope = normalizeNaviaEnvelope(JSON.parse(certificateJson));
  } catch {
    return failure("certificate_invalid_json");
  }

  const key = keyRing.keys.find((item) => item.keyId === envelope.keyId);
  if (!key) {
    return failure("public_key_not_found", envelope.payload);
  }

  const payloadJson = canonicalizeNaviaPayload(envelope.payload);
  const signatureValid = await verifyNaviaEcdsaSignature(
    key.publicKeyPem,
    payloadJson,
    base64ToUint8Array(envelope.signature),
  );
  if (!signatureValid) {
    return failure("signature_invalid", envelope.payload);
  }

  const productMatched = (envelope.payload.productKey ?? "stocknavia").toLowerCase() === expectedProductKey.toLowerCase();
  const nowEpoch = Date.parse(nowUtc);
  const expiresEpoch = Date.parse(envelope.payload.expiresAtUtc);
  const graceEpoch = envelope.payload.graceUntilUtc ? Date.parse(envelope.payload.graceUntilUtc) : Number.NaN;
  const notExpiredOrWithinGrace = expiresEpoch > nowEpoch || (Number.isFinite(graceEpoch) && graceEpoch > nowEpoch);
  const updatesEpoch = envelope.payload.updatesUntilUtc ? Date.parse(envelope.payload.updatesUntilUtc) : Number.NaN;
  const releaseEpoch = appReleaseDateUtc ? Date.parse(appReleaseDateUtc) : Number.NaN;
  const updatesAllowed = !Number.isFinite(releaseEpoch) || !Number.isFinite(updatesEpoch) || releaseEpoch <= updatesEpoch;

  return {
    signatureValid,
    productMatched,
    updatesAllowed,
    notExpiredOrWithinGrace,
    requiresOnlineMachineBindingValidation: true,
    reason: !productMatched
      ? "product_mismatch"
      : !notExpiredOrWithinGrace
        ? "expired_and_grace_elapsed"
        : !updatesAllowed
          ? "release_after_updates_until"
          : "ok",
    payload: envelope.payload,
  };
}

export async function activateNaviaLicense(
  options: NaviaLicenseServiceOptions,
  request: Omit<NaviaLicenseActivationRequest, "productKey" | "appVersion">,
): Promise<NaviaLicenseCacheRecord> {
  const response = await options.gateway.activate({
    ...request,
    productKey: options.productKey,
    appVersion: options.appVersion,
  });
  if (!response.ok || !response.license || !response.instanceId) {
    throw new Error(response.message || "license_activate_failed");
  }

  const record: NaviaLicenseCacheRecord = {
    baseUrl: options.gateway.baseUrl ?? "",
    productKey: options.productKey,
    orderNo: request.orderNo,
    email: request.email,
    hwid: request.hwid,
    instanceId: response.instanceId,
    certificateJson: response.license,
    features: response.features ?? [],
    updatesUntilUtc: response.updatesUntilUtc ?? null,
    gracePolicy: response.gracePolicy ?? null,
    appVersion: options.appVersion,
    activatedAtUtc: new Date().toISOString(),
    lastValidatedAtUtc: null,
    maxDevices: response.maxDevices ?? 0,
  };
  await options.store.write(record);
  return record;
}

export async function runNaviaLicenseStartupCheck(
  options: NaviaLicenseServiceOptions,
  nowUtc = new Date().toISOString(),
): Promise<NaviaLicenseStartupState> {
  const cache = await options.store.read();
  if (!cache) {
    return {
      hasCache: false,
      local: null,
      shouldValidateRemotely: false,
    };
  }

  const keyRing = await options.gateway.getPublicKeys();
  const localVerifier = options.localVerifier ?? verifyNaviaLicenseCertificateLocally;
  const local = await localVerifier(
    cache.certificateJson,
    keyRing,
    options.productKey,
    nowUtc,
    options.appReleaseDateUtc,
  );

  const shouldValidateRemotely = shouldValidateNaviaLicense(cache, options.validateIntervalHours ?? defaultIntervalHours(cache));
  if (!local.signatureValid || !local.productMatched || !local.notExpiredOrWithinGrace || !local.updatesAllowed) {
    return {
      hasCache: true,
      cache,
      local,
      shouldValidateRemotely,
    };
  }

  if (!shouldValidateRemotely) {
    return {
      hasCache: true,
      cache,
      local,
      shouldValidateRemotely: false,
    };
  }

  const remote = await options.gateway.validate(cache, options.appReleaseDateUtc);
  const updatedCache = { ...cache, lastValidatedAtUtc: nowUtc };
  await options.store.write(updatedCache);

  return {
    hasCache: true,
    cache: updatedCache,
    local,
    remote: remote.data,
    shouldValidateRemotely: true,
  };
}

export async function refreshNaviaLicense(
  options: NaviaLicenseServiceOptions,
): Promise<NaviaLicenseCacheRecord | undefined> {
  const cache = await options.store.read();
  if (!cache) {
    return undefined;
  }
  const response = await options.gateway.refresh(cache);
  if (!response.ok || !response.license || !response.instanceId) {
    throw new Error(response.message || "license_refresh_failed");
  }
  const updated: NaviaLicenseCacheRecord = {
    ...cache,
    certificateJson: response.license,
    instanceId: response.instanceId,
    features: response.features ?? cache.features,
    updatesUntilUtc: response.updatesUntilUtc ?? cache.updatesUntilUtc,
    gracePolicy: response.gracePolicy ?? cache.gracePolicy,
  };
  await options.store.write(updated);
  return updated;
}

export async function deactivateNaviaLicense(options: NaviaLicenseServiceOptions): Promise<boolean> {
  const cache = await options.store.read();
  if (!cache) {
    return false;
  }
  const response = await options.gateway.deactivate(cache);
  if (!response.ok) {
    throw new Error(response.error || response.message || "license_deactivate_failed");
  }
  return options.store.delete();
}

export function mapNaviaLicenseToClawDeskStatus(
  cache: NaviaLicenseCacheRecord,
  local: NaviaLocalVerificationResult,
  remote?: NaviaLicenseValidateData,
): LicenseStatus {
  const plan = mapNaviaPlanToClawDeskPlan(remote?.planKey ?? local.payload?.planKey);
  const features = remote?.features ?? cache.features;
  const supportUpdatesUntil = remote?.updatesUntilUtc ?? cache.updatesUntilUtc ?? cache.gracePolicy?.updatesUntilUtc ?? "1970-01-01T00:00:00.000Z";
  const machine = {
    machineId: cache.instanceId,
    fingerprintHash: "server-bound",
    deviceName: "Current Tauri device",
    platform: "Windows Tauri",
    activatedAt: cache.activatedAtUtc,
    lastSeenAt: cache.lastValidatedAtUtc ?? cache.activatedAtUtc,
  };

  return {
    paymentProvider: "lemon-squeezy",
    licenseProvider: "lemon-license",
    plan,
    status: !local.signatureValid
      ? "tampered"
      : remote?.revoked
        ? "revoked"
        : remote && !remote.active && remote.withinGrace
          ? "offline-grace"
          : remote && !remote.active
            ? "expired"
            : "active",
    seats: 1,
    supportUpdatesUntil,
    eligibleLatestVersion: remote?.updatesAllowed === false ? "locked-by-support-window" : "latest",
    offlineGraceUntil: remote?.graceUntilUtc ?? cache.gracePolicy?.graceUntilUtc ?? undefined,
    features,
    deviceLimit: remote?.maxDevices ?? cache.maxDevices,
    machines: [machine],
    lastValidationCode: remote?.message ?? local.reason,
    entitlement: {
      plan,
      status: remote?.active ? "licensed" : "safe-mode",
      expiresAt: remote?.expiresAtUtc ?? cache.gracePolicy?.expiresAtUtc ?? undefined,
      graceUntil: remote?.graceUntilUtc ?? cache.gracePolicy?.graceUntilUtc ?? undefined,
      features,
      lastVerifiedAt: cache.lastValidatedAtUtc ?? cache.activatedAtUtc,
      lastValidationCode: remote?.message ?? local.reason,
    },
  };
}

function defaultIntervalHours(cache: NaviaLicenseCacheRecord): number {
  const type = cache.gracePolicy?.licenseType ?? "";
  return type === "subscription" ? 24 : 24 * 7;
}

function shouldValidateNaviaLicense(cache: NaviaLicenseCacheRecord, intervalHours: number): boolean {
  if (!cache.lastValidatedAtUtc) {
    return true;
  }
  const last = Date.parse(cache.lastValidatedAtUtc);
  if (!Number.isFinite(last)) {
    return true;
  }
  return Date.now() - last >= intervalHours * 60 * 60 * 1000;
}

function mapNaviaPlanToClawDeskPlan(planKey?: string | null): LicensePlan {
  switch ((planKey ?? "").toLowerCase()) {
    case "clawdesk.trial.14d.1dev":
    case "trial_14d_1dev":
    case "clawdesk_trial_14d_1dev":
      return "trial";
    case "clawdesk.lifetime_updates_1y_1dev":
    case "clawdesk.lifetime_updates_1y_2dev":
    case "perpetual_updates_1y_1dev":
    case "perpetual_updates_1y_2dev":
    case "clawdesk_perpetual_updates_1y_1dev":
    case "clawdesk_perpetual_updates_1y_2dev":
      return "lifetime-local";
    case "clawdesk.subscription.monthly.1dev":
    case "subscription_30d_1dev":
    case "sub_30d_1dev":
    case "sub_30d_2dev":
    case "clawdesk_sub_30d_1dev":
      return "pro-monthly";
    case "clawdesk.subscription.yearly.2dev":
    case "subscription_365d_2dev":
    case "sub_365d_2dev":
    case "clawdesk_sub_365d_2dev":
      return "pro-yearly";
    default:
      return "hobby";
  }
}

function failure(reason: string, payload?: NaviaLicensePayload): NaviaLocalVerificationResult {
  return {
    signatureValid: false,
    productMatched: false,
    updatesAllowed: false,
    notExpiredOrWithinGrace: false,
    requiresOnlineMachineBindingValidation: true,
    reason,
    payload,
  };
}

function normalizeNaviaEnvelope(raw: unknown): NaviaLicenseEnvelope {
  if (!raw || typeof raw !== "object") {
    throw new Error("certificate_envelope_invalid");
  }
  const source = raw as Record<string, unknown>;
  const payload = source.payload ?? source.Payload;
  const signature = source.signature ?? source.Signature;
  const keyId = source.keyId ?? source.KeyId;
  if (!payload || typeof signature !== "string" || typeof keyId !== "string") {
    throw new Error("certificate_envelope_invalid");
  }
  return {
    payload: normalizeNaviaPayload(payload),
    signature,
    keyId,
  };
}

function normalizeNaviaPayload(raw: unknown): NaviaLicensePayload {
  if (!raw || typeof raw !== "object") {
    throw new Error("certificate_payload_invalid");
  }
  const source = raw as Record<string, unknown>;
  return {
    licenseId: String(source.licenseId ?? source.LicenseId ?? ""),
    planType: String(source.planType ?? source.PlanType ?? ""),
    subjectEmailHash: String(source.subjectEmailHash ?? source.SubjectEmailHash ?? ""),
    hwidHash: String(source.hwidHash ?? source.HwidHash ?? ""),
    issuedAtUtc: String(source.issuedAtUtc ?? source.IssuedAtUtc ?? ""),
    expiresAtUtc: String(source.expiresAtUtc ?? source.ExpiresAtUtc ?? ""),
    orderNo: String(source.orderNo ?? source.OrderNo ?? ""),
    nonce: String(source.nonce ?? source.Nonce ?? ""),
    version: Number(source.version ?? source.Version ?? 0),
    productKey: optionalString(source.productKey ?? source.ProductKey),
    planKey: optionalString(source.planKey ?? source.PlanKey),
    licenseType: optionalString(source.licenseType ?? source.LicenseType),
    features: Array.isArray(source.features ?? source.Features) ? (source.features ?? source.Features) as string[] : [],
    maxDevices: Number(source.maxDevices ?? source.MaxDevices ?? 1),
    updatesUntilUtc: optionalString(source.updatesUntilUtc ?? source.UpdatesUntilUtc),
    graceUntilUtc: optionalString(source.graceUntilUtc ?? source.GraceUntilUtc),
    accountIdHash: optionalString(source.accountIdHash ?? source.AccountIdHash),
    machineBindingHash: optionalString(source.machineBindingHash ?? source.MachineBindingHash),
    keyVersion: optionalString(source.keyVersion ?? source.KeyVersion),
  };
}

function optionalString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const text = String(value);
  return text.length > 0 ? text : null;
}

function getNaviaLicenseIdFromCertificate(certificateJson: string): string {
  return normalizeNaviaEnvelope(JSON.parse(certificateJson)).payload.licenseId;
}

export function canonicalizeNaviaPayload(payload: NaviaLicensePayload): string {
  const normalized: Record<string, unknown> = {
    licenseId: payload.licenseId,
    planType: payload.planType,
    subjectEmailHash: payload.subjectEmailHash,
    hwidHash: payload.hwidHash,
    issuedAtUtc: normalizeDateTimeOffsetString(payload.issuedAtUtc),
    expiresAtUtc: normalizeDateTimeOffsetString(payload.expiresAtUtc),
    orderNo: payload.orderNo,
    nonce: payload.nonce,
    version: payload.version,
  };

  if (payload.version >= 2) {
    normalized.productKey = payload.productKey ?? "stocknavia";
    normalized.planKey = payload.planKey ?? "legacy";
    normalized.licenseType = payload.licenseType ?? payload.planType;
    normalized.features = Array.isArray(payload.features) ? payload.features : [];
    normalized.maxDevices = (payload.maxDevices ?? 0) > 0 ? payload.maxDevices : 1;
    normalized.updatesUntilUtc = payload.updatesUntilUtc ? normalizeDateTimeOffsetString(payload.updatesUntilUtc) : null;
    normalized.graceUntilUtc = payload.graceUntilUtc ? normalizeDateTimeOffsetString(payload.graceUntilUtc) : null;
    normalized.accountIdHash = payload.accountIdHash ?? "";
    normalized.machineBindingHash = payload.machineBindingHash ?? "";
    normalized.keyVersion = payload.keyVersion ?? "";
  }

  return JSON.stringify(normalized)
    .replace(/\+/g, "\\u002B")
    .replace(/</g, "\\u003C")
    .replace(/>/g, "\\u003E")
    .replace(/&/g, "\\u0026");
}

function normalizeDateTimeOffsetString(value: string): string {
  const match = value.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,7}))?((?:Z)|(?:[+-]\d{2}:\d{2}))$/);
  if (!match) {
    return value;
  }
  const fraction = (match[2] ?? "").padEnd(7, "0");
  const offset = match[3] === "Z" ? "+00:00" : match[3];
  return `${match[1]}.${fraction}${offset}`;
}

async function verifyNaviaEcdsaSignature(publicKeyPem: string, payloadJson: string, signature: Uint8Array): Promise<boolean> {
  const key = await importEcdsaPublicKey(publicKeyPem);
  const webCryptoSignature = normalizeEcdsaSignatureForWebCrypto(signature, 32);
  return crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    toArrayBuffer(webCryptoSignature),
    toArrayBuffer(new TextEncoder().encode(payloadJson)),
  );
}

async function importEcdsaPublicKey(publicKeyPem: string): Promise<CryptoKey> {
  const body = publicKeyPem
    .replace("-----BEGIN PUBLIC KEY-----", "")
    .replace("-----END PUBLIC KEY-----", "")
    .replace(/\s+/g, "");
  return crypto.subtle.importKey(
    "spki",
    toArrayBuffer(base64ToUint8Array(body)),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function normalizeEcdsaSignatureForWebCrypto(signature: Uint8Array, size: number): Uint8Array {
  if (signature.length === size * 2) {
    return signature;
  }
  if (signature[0] === 0x30) {
    return derToP1363(signature, size);
  }
  throw new Error("invalid_ecdsa_signature");
}

function derToP1363(der: Uint8Array, size: number): Uint8Array {
  let offset = 0;
  if (der[offset++] !== 0x30) {
    throw new Error("invalid_der_sequence");
  }
  const sequenceLength = der[offset++];
  if (sequenceLength > 0x7f) {
    offset += sequenceLength & 0x7f;
  }
  if (der[offset++] !== 0x02) {
    throw new Error("invalid_der_r");
  }
  const rLength = der[offset++];
  const r = der.slice(offset, offset + rLength);
  offset += rLength;
  if (der[offset++] !== 0x02) {
    throw new Error("invalid_der_s");
  }
  const sLength = der[offset++];
  const s = der.slice(offset, offset + sLength);

  const out = new Uint8Array(size * 2);
  const normalizedR = trimDerInteger(r, size);
  const normalizedS = trimDerInteger(s, size);
  out.set(normalizedR, size - normalizedR.length);
  out.set(normalizedS, size * 2 - normalizedS.length);
  return out;
}

function trimDerInteger(bytes: Uint8Array, size: number): Uint8Array {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0x00) {
    start += 1;
  }
  const value = bytes.slice(start);
  return value.length > size ? value.slice(value.length - size) : value;
}

function base64ToUint8Array(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
