export type PaymentProvider = "lemon-squeezy";
export type LicenseProvider = "lemon-license";

export type LicensePlan =
  | "hobby"
  | "trial"
  | "pro-monthly"
  | "pro-yearly"
  | "lifetime-local"
  | "team"
  | "enterprise"
  | "byok-managed";

export type LicenseStatusType =
  | "free"
  | "trial"
  | "active"
  | "past-due"
  | "canceled"
  | "expired"
  | "offline-grace"
  | "safe-mode"
  | "tampered"
  | "revoked";

export type EntitlementStatus = "trial" | "licensed" | "safe-mode" | "trial-expired";

export interface BetaEntitlement {
  plan: LicensePlan;
  status: EntitlementStatus;
  expiresAt?: string;
  graceUntil?: string;
  features: string[];
  licenseKeyHash?: string;
  machineHash?: string;
  lastVerifiedAt?: string;
  lastValidationCode: string;
}

export interface PricingPlan {
  id: LicensePlan;
  name: string;
  priceUsd: number;
  cadence: "free" | "monthly" | "yearly" | "one-time" | "contract";
  description: string;
}

export interface EncryptedLicenseKey {
  keyId: string;
  encodedKey: string;
  signatureStatus: "valid" | "invalid" | "missing";
  payloadHash: string;
  plan: LicensePlan;
  status: LicenseStatusType;
  supportUpdatesUntil: string;
  expiresAt?: string;
  deviceLimit: number;
}

export interface MachineFingerprint {
  fingerprintHash: string;
  hardwareSources: string[];
  platform: "macOS" | "Windows" | "Linux" | "unknown";
  confidence: number;
  createdAt: string;
}

export interface MachineActivation {
  machineId: string;
  fingerprintHash: string;
  deviceName: string;
  platform: string;
  activatedAt: string;
  lastSeenAt: string;
  revokedAt?: string;
}

export interface LicenseTamperEvent {
  eventId: string;
  reason: string;
  detectedAt: string;
  localAction: "downgrade-to-hobby" | "clear-offline-ticket";
  serverAction: "report-to-lemon" | "manual-review";
  faultCode: string;
}

export interface LicenseStatus {
  paymentProvider: PaymentProvider;
  licenseProvider: LicenseProvider;
  plan: LicensePlan;
  status: LicenseStatusType;
  seats: number;
  supportUpdatesUntil: string;
  eligibleLatestVersion: string;
  offlineGraceUntil?: string;
  features: string[];
  deviceLimit: number;
  machines: MachineActivation[];
  lastValidationCode?: string;
  entitlement?: BetaEntitlement;
}

export const pricingPlans: PricingPlan[] = [
  { id: "trial", name: "Free Trial", priceUsd: 0, cadence: "free", description: "7 天或 30 次本機試用，不需信用卡。" },
  { id: "pro-yearly", name: "Pro Yearly", priceUsd: 79, cadence: "yearly", description: "個人完整桌面 Agent，年繳方案。" },
  { id: "lifetime-local", name: "Lifetime", priceUsd: 99, cadence: "one-time", description: "永久本機 Pro，含 12 個月支援更新。" },
];

export const betaPricingPlans: PricingPlan[] = [
  { id: "trial", name: "Free Trial", priceUsd: 0, cadence: "free", description: "7 天或 30 次本機啟動/對話測試。" },
  { id: "pro-yearly", name: "Pro Yearly", priceUsd: 79, cadence: "yearly", description: "Windows direct-download Beta 主力方案。" },
  { id: "lifetime-local", name: "Lifetime", priceUsd: 99, cadence: "one-time", description: "買斷含 12 個月更新維護。" },
];

export function normalizeLemonLicenseKey(input: string): string {
  return input.trim().replace(/\s+/g, "-");
}

export function isMockLemonLicenseKey(input: string): boolean {
  return /^CLWD-BETA-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(normalizeLemonLicenseKey(input).toUpperCase());
}

export function hashLicenseKeyForStorage(input: string): string {
  const normalized = normalizeLemonLicenseKey(input).toUpperCase();
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `lk_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function createMockMachineFingerprint(now = new Date().toISOString()): MachineFingerprint {
  return {
    fingerprintHash: "mfp_salted_mock_win_x64_a9d2",
    hardwareSources: ["machine-guid", "baseboard-serial", "cpu-brand", "cpu-architecture"],
    platform: "Windows",
    confidence: 0.86,
    createdAt: now,
  };
}

export function createTrialEntitlement(now = new Date().toISOString(), launchCount = 0): BetaEntitlement {
  const expiresAt = new Date(Date.parse(now) + 1000 * 60 * 60 * 24 * 7).toISOString();
  return {
    plan: "trial",
    status: launchCount >= 30 ? "trial-expired" : "trial",
    expiresAt,
    features: ["local-chat", "provider-setup", "diagnostics-export"],
    lastVerifiedAt: now,
    lastValidationCode: launchCount >= 30 ? "TRIAL_LAUNCH_LIMIT" : "TRIAL_READY",
  };
}

export function createLemonLicensedEntitlement(
  licenseKey: string,
  fingerprint: MachineFingerprint,
  now = new Date().toISOString(),
): BetaEntitlement {
  const normalized = normalizeLemonLicenseKey(licenseKey).toUpperCase();
  const expiresAt = normalized.includes("LIFE")
    ? undefined
    : new Date(Date.parse(now) + 1000 * 60 * 60 * 24 * 365).toISOString();
  return {
    plan: normalized.includes("LIFE") ? "lifetime-local" : "pro-yearly",
    status: "licensed",
    expiresAt,
    graceUntil: new Date(Date.parse(now) + 1000 * 60 * 60 * 24 * 7).toISOString(),
    features: ["pro-agent", "local-memory", "workflow-builder", "mcp-connectors", "diagnostics-export", "updates"],
    licenseKeyHash: hashLicenseKeyForStorage(normalized),
    machineHash: fingerprint.fingerprintHash,
    lastVerifiedAt: now,
    lastValidationCode: isMockLemonLicenseKey(normalized) ? "LEMON_VALID" : "LEMON_UNVERIFIED_MOCK",
  };
}

export function downgradeEntitlementToSafeMode(reason: string, now = new Date().toISOString()): BetaEntitlement {
  return {
    plan: "hobby",
    status: reason === "trial-expired" ? "trial-expired" : "safe-mode",
    features: ["diagnostics-export", "data-export", "manual-settings"],
    lastVerifiedAt: now,
    lastValidationCode: reason,
  };
}

export function activateMockLemonLicense(
  encodedKey: string,
  fingerprint: MachineFingerprint,
  now = new Date().toISOString(),
): LicenseStatus {
  if (!isMockLemonLicenseKey(encodedKey)) {
    return {
      ...createFreeStatus("LEMON_INVALID_LICENSE_KEY"),
      paymentProvider: "lemon-squeezy",
      licenseProvider: "lemon-license",
      status: "safe-mode",
      entitlement: downgradeEntitlementToSafeMode("LEMON_INVALID_LICENSE_KEY", now),
    };
  }

  const entitlement = createLemonLicensedEntitlement(encodedKey, fingerprint, now);
  const machine: MachineActivation = {
    machineId: `win_${fingerprint.fingerprintHash.slice(-8)}`,
    fingerprintHash: fingerprint.fingerprintHash,
    deviceName: "Windows 11 x64 direct-download beta",
    platform: "Windows x64 MSVC",
    activatedAt: now,
    lastSeenAt: now,
  };
  return {
    paymentProvider: "lemon-squeezy",
    licenseProvider: "lemon-license",
    plan: entitlement.plan,
    status: "active",
    seats: 1,
    supportUpdatesUntil: entitlement.expiresAt ?? "2027-05-14",
    eligibleLatestVersion: "0.1.0-beta",
    offlineGraceUntil: entitlement.graceUntil,
    features: entitlement.features,
    deviceLimit: 2,
    machines: [machine],
    lastValidationCode: entitlement.lastValidationCode,
    entitlement,
  };
}

export function createFreeStatus(validationCode = "HOBBY_MODE"): LicenseStatus {
  return {
    paymentProvider: "lemon-squeezy",
    licenseProvider: "lemon-license",
    plan: "hobby",
    status: validationCode.includes("TAMPER") ? "tampered" : validationCode.includes("REVOK") ? "revoked" : "free",
    seats: 1,
    supportUpdatesUntil: "2026-05-12",
    eligibleLatestVersion: "1.0.0",
    features: ["safe-mode", "local-chat", "manual-permissions"],
    deviceLimit: 1,
    machines: [],
    lastValidationCode: validationCode,
  };
}

export function detectLicenseTamper(original: EncryptedLicenseKey, candidate: EncryptedLicenseKey, now = new Date().toISOString()): LicenseTamperEvent | null {
  const protectedFields: Array<keyof EncryptedLicenseKey> = ["payloadHash", "plan", "supportUpdatesUntil", "expiresAt", "deviceLimit", "signatureStatus"];
  const changedField = protectedFields.find((field) => original[field] !== candidate[field]);
  if (!changedField) return null;

  return {
    eventId: `tamper-${Date.parse(now) || 0}`,
    reason: `受保護授權欄位被修改：${changedField}`,
    detectedAt: now,
    localAction: "downgrade-to-hobby",
    serverAction: "report-to-lemon",
    faultCode: "CLWD-LIC-1001",
  };
}

export function canInstallLatestVersion(status: LicenseStatus, latestReleasedAt: string): boolean {
  if (status.status !== "active" && status.status !== "offline-grace") return false;
  return Date.parse(status.supportUpdatesUntil) >= Date.parse(latestReleasedAt);
}
