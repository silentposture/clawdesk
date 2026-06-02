import { describe, expect, it } from "vitest";
import {
  activateMockLemonLicense,
  canInstallLatestVersion,
  createMockMachineFingerprint,
  createTrialEntitlement,
  detectLicenseTamper,
  downgradeEntitlementToSafeMode,
  hashLicenseKeyForStorage,
  isMockLemonLicenseKey,
} from "./licensing";

describe("Lemon Squeezy only licensing", () => {
  it("accepts a Lemon Squeezy key and binds the current Windows device", () => {
    const fingerprint = createMockMachineFingerprint("2026-05-12T00:00:00.000Z");
    const status = activateMockLemonLicense("CLWD-BETA-PRO1-2026", fingerprint, "2026-05-12T00:00:00.000Z");

    expect(isMockLemonLicenseKey("CLWD-BETA-PRO1-2026")).toBe(true);
    expect(status.paymentProvider).toBe("lemon-squeezy");
    expect(status.licenseProvider).toBe("lemon-license");
    expect(status.status).toBe("active");
    expect(status.deviceLimit).toBe(2);
    expect(status.machines[0].fingerprintHash).toBe(fingerprint.fingerprintHash);
  });

  it("rejects invalid Lemon activations into safe mode", () => {
    const fingerprint = createMockMachineFingerprint();
    const status = activateMockLemonLicense("bad-key", fingerprint);
    expect(status.paymentProvider).toBe("lemon-squeezy");
    expect(status.licenseProvider).toBe("lemon-license");
    expect(status.status).toBe("safe-mode");
    expect(status.lastValidationCode).toBe("LEMON_INVALID_LICENSE_KEY");
  });

  it("detects tampering of protected Lemon entitlement fields", () => {
    const original = {
      keyId: "lem_mock",
      encodedKey: "CLWD-BETA-PRO1-2026",
      signatureStatus: "valid" as const,
      payloadHash: "sha256:demo",
      plan: "pro-yearly" as const,
      status: "active" as const,
      supportUpdatesUntil: "2027-05-14",
      deviceLimit: 2,
    };
    const tampered = { ...original, supportUpdatesUntil: "2099-01-01" };

    const event = detectLicenseTamper(original, tampered, "2026-05-12T00:00:00.000Z");
    expect(event?.faultCode).toBe("CLWD-LIC-1001");
    expect(event?.localAction).toBe("downgrade-to-hobby");
    expect(event?.serverAction).toBe("report-to-lemon");
  });

  it("uses support update expiry to decide whether the latest version can install", () => {
    const status = activateMockLemonLicense("CLWD-BETA-PRO1-2026", createMockMachineFingerprint());
    expect(canInstallLatestVersion(status, "2027-01-01")).toBe(true);
    expect(canInstallLatestVersion(status, "2028-01-01")).toBe(false);
  });
});

describe("Lemon Squeezy beta entitlement", () => {
  it("creates trial, licensed, and safe-mode entitlements without storing license key plaintext", () => {
    const fingerprint = createMockMachineFingerprint("2026-05-14T00:00:00.000Z");
    const trial = createTrialEntitlement("2026-05-14T00:00:00.000Z");
    const licensed = activateMockLemonLicense("CLWD-BETA-PRO1-2026", fingerprint, "2026-05-14T00:00:00.000Z");
    const safeMode = downgradeEntitlementToSafeMode("LEMON_REFUND_REVOKED", "2026-05-14T00:00:00.000Z");

    expect(trial.status).toBe("trial");
    expect(isMockLemonLicenseKey("CLWD-BETA-PRO1-2026")).toBe(true);
    expect(licensed.paymentProvider).toBe("lemon-squeezy");
    expect(licensed.licenseProvider).toBe("lemon-license");
    expect(licensed.entitlement?.status).toBe("licensed");
    expect(licensed.entitlement?.licenseKeyHash).toBe(hashLicenseKeyForStorage("CLWD-BETA-PRO1-2026"));
    expect(JSON.stringify(licensed)).not.toContain("CLWD-BETA-PRO1-2026");
    expect(safeMode.status).toBe("safe-mode");
  });

  it("expires the beta trial after the launch allowance", () => {
    expect(createTrialEntitlement("2026-05-14T00:00:00.000Z", 30).status).toBe("trial-expired");
  });
});
