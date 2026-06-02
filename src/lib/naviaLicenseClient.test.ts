import { describe, expect, it } from "vitest";
import {
  canonicalizeNaviaPayload,
  createInMemoryNaviaLicenseCacheStore,
  mapNaviaLicenseToClawDeskStatus,
  runNaviaLicenseStartupCheck,
  verifyNaviaLicenseCertificateLocally,
  type NaviaLicenseCacheRecord,
  type NaviaLicenseGatewayClient,
  type NaviaLicensePayload,
  type NaviaLicensePublicKeyRing,
} from "./naviaLicenseClient";

describe("Navia license client canonical payload", () => {
  it("matches .NET-oriented canonical formatting for offsets and escaped plus sign", () => {
    const payload: NaviaLicensePayload = {
      licenseId: "abc",
      planType: "lifetime",
      subjectEmailHash: "EMAIL",
      hwidHash: "HWID",
      issuedAtUtc: "2026-05-15T22:04:42.947256+00:00",
      expiresAtUtc: "2126-04-21T22:04:42.947256+00:00",
      orderNo: "ORDER",
      nonce: "NONCE",
      version: 2,
      productKey: "stocknavia",
      planKey: "perpetual_updates_1y_1dev",
      licenseType: "perpetual_with_updates_1y",
      features: ["stocknavia.core"],
      maxDevices: 1,
      updatesUntilUtc: "2027-05-15T22:04:42.947256+00:00",
      graceUntilUtc: "2126-05-21T22:04:42.947256+00:00",
      accountIdHash: "",
      machineBindingHash: "BIND",
      keyVersion: "dpapi-backup",
    };

    const canonical = canonicalizeNaviaPayload(payload);
    expect(canonical).toContain("2026-05-15T22:04:42.9472560\\u002B00:00");
    expect(canonical).toContain("2027-05-15T22:04:42.9472560\\u002B00:00");
  });
});

describe("Navia local verification", () => {
  it("verifies a signed certificate locally", async () => {
    const keyPair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    );
    const publicKeyDer = new Uint8Array(await crypto.subtle.exportKey("spki", keyPair.publicKey));
    const publicKeyPem = `-----BEGIN PUBLIC KEY-----\n${toBase64(publicKeyDer)}\n-----END PUBLIC KEY-----`;

    const payload: NaviaLicensePayload = {
      licenseId: "license-1",
      planType: "lifetime",
      subjectEmailHash: "EMAIL",
      hwidHash: "HWID",
      issuedAtUtc: "2026-05-15T22:04:42.947256+00:00",
      expiresAtUtc: "2126-04-21T22:04:42.947256+00:00",
      orderNo: "ORDER",
      nonce: "NONCE",
      version: 2,
      productKey: "stocknavia",
      planKey: "perpetual_updates_1y_1dev",
      licenseType: "perpetual_with_updates_1y",
      features: ["stocknavia.core"],
      maxDevices: 1,
      updatesUntilUtc: "2027-05-15T22:04:42.947256+00:00",
      graceUntilUtc: "2126-05-21T22:04:42.947256+00:00",
      accountIdHash: "",
      machineBindingHash: "BIND",
      keyVersion: "dpapi-backup",
    };
    const canonical = canonicalizeNaviaPayload(payload);
    const signature = new Uint8Array(await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      keyPair.privateKey,
      new TextEncoder().encode(canonical),
    ));
    const certificate = JSON.stringify({
      payload,
      signature: toBase64(normalizeEcdsaSignatureToP1363(signature, 32)),
      keyId: "dpapi-backup",
    });

    const keyRing: NaviaLicensePublicKeyRing = {
      algorithm: "ECDSA_P256_SHA256",
      activeKeyId: "dpapi-backup",
      keys: [{ keyId: "dpapi-backup", algorithm: "ECDSA_P256_SHA256", active: true, publicKeyPem }],
    };

    const result = await verifyNaviaLicenseCertificateLocally(
      certificate,
      keyRing,
      "stocknavia",
      "2026-05-16T00:00:00.000Z",
      "2026-05-16T00:00:00.000Z",
    );

    expect(result.signatureValid).toBe(true);
    expect(result.productMatched).toBe(true);
    expect(result.updatesAllowed).toBe(true);
    expect(result.reason).toBe("ok");
  });
});

describe("Navia startup flow", () => {
  it("loads cache, performs local verification, and runs remote validation when interval elapsed", async () => {
    const cache: NaviaLicenseCacheRecord = {
      baseUrl: "http://127.0.0.1:5000",
      productKey: "stocknavia",
      orderNo: "ORDER",
      email: "test@example.com",
      hwid: "HWID",
      instanceId: "INSTANCE",
      certificateJson: "{}",
      features: ["stocknavia.core"],
      updatesUntilUtc: "2027-05-15T00:00:00.000Z",
      gracePolicy: { licenseType: "subscription" },
      appVersion: "1.0.0",
      activatedAtUtc: "2026-05-15T00:00:00.000Z",
      lastValidatedAtUtc: "2026-05-14T00:00:00.000Z",
      maxDevices: 1,
    };
    const store = createInMemoryNaviaLicenseCacheStore(cache);
    const gateway: NaviaLicenseGatewayClient = {
      async getPublicKeys() {
        return {
          algorithm: "ECDSA_P256_SHA256",
          activeKeyId: "dpapi-backup",
          keys: [{ keyId: "dpapi-backup", algorithm: "ECDSA_P256_SHA256", active: true, publicKeyPem: "pem" }],
        };
      },
      async activate() {
        throw new Error("unused");
      },
      async validate() {
        return {
          ok: true,
          data: {
            active: true,
            message: "validated",
            licenseId: "license-1",
            productKey: "stocknavia",
            planKey: "perpetual_updates_1y_1dev",
            licenseType: "perpetual_with_updates_1y",
            features: ["stocknavia.core"],
            revoked: false,
            expired: false,
            withinGrace: false,
            hwidMatched: true,
            instanceMatched: true,
            machineBindingMatched: true,
            updatesAllowed: true,
            productMatched: true,
            expiresAtUtc: "2126-04-21T00:00:00.000Z",
            updatesUntilUtc: "2027-05-15T00:00:00.000Z",
            graceUntilUtc: "2126-05-21T00:00:00.000Z",
            maxDevices: 1,
            activeDeviceCount: 1,
          },
        };
      },
      async refresh() {
        throw new Error("unused");
      },
      async deactivate() {
        throw new Error("unused");
      },
    };

    const mockResult = {
      signatureValid: true,
      productMatched: true,
      updatesAllowed: true,
      notExpiredOrWithinGrace: true,
      requiresOnlineMachineBindingValidation: true as const,
      reason: "ok",
      payload: {
        licenseId: "license-1",
        planType: "lifetime",
        subjectEmailHash: "EMAIL",
        hwidHash: "HWID",
        issuedAtUtc: "2026-05-15T00:00:00.000Z",
        expiresAtUtc: "2126-04-21T00:00:00.000Z",
        orderNo: "ORDER",
        nonce: "NONCE",
        version: 2,
        productKey: "stocknavia",
        planKey: "perpetual_updates_1y_1dev",
        licenseType: "perpetual_with_updates_1y",
        features: ["stocknavia.core"],
        maxDevices: 1,
        updatesUntilUtc: "2027-05-15T00:00:00.000Z",
        graceUntilUtc: "2126-05-21T00:00:00.000Z",
        accountIdHash: "",
        machineBindingHash: "BIND",
        keyVersion: "dpapi-backup",
      },
    };

    const state = await runNaviaLicenseStartupCheck({
      gateway,
      store,
      productKey: "stocknavia",
      appVersion: "1.0.0",
      appReleaseDateUtc: "2026-05-16T00:00:00.000Z",
      validateIntervalHours: 24,
      localVerifier: async () => mockResult,
    }, "2026-05-16T00:00:00.000Z");

    expect(state.hasCache).toBe(true);
    expect(state.local?.signatureValid).toBe(true);
    expect(state.shouldValidateRemotely).toBe(true);
    expect(state.remote?.active).toBe(true);
  });
});

describe("Navia status mapping", () => {
  it("maps validated perpetual license into ClawDesk active status", () => {
    const cache: NaviaLicenseCacheRecord = {
      baseUrl: "http://127.0.0.1:5000",
      productKey: "stocknavia",
      orderNo: "ORDER",
      hwid: "HWID",
      instanceId: "INSTANCE",
      certificateJson: "{}",
      features: ["stocknavia.core", "updates.1y"],
      updatesUntilUtc: "2027-05-15T00:00:00.000Z",
      gracePolicy: { licenseType: "perpetual_with_updates_1y", graceUntilUtc: "2126-05-21T00:00:00.000Z" },
      appVersion: "1.0.0",
      activatedAtUtc: "2026-05-15T00:00:00.000Z",
      lastValidatedAtUtc: "2026-05-16T00:00:00.000Z",
      maxDevices: 1,
    };
    const status = mapNaviaLicenseToClawDeskStatus(
      cache,
      {
        signatureValid: true,
        productMatched: true,
        updatesAllowed: true,
        notExpiredOrWithinGrace: true,
        requiresOnlineMachineBindingValidation: true,
        reason: "ok",
      },
      {
        active: true,
        message: "validated",
        licenseId: "license-1",
        productKey: "stocknavia",
        planKey: "perpetual_updates_1y_1dev",
        licenseType: "perpetual_with_updates_1y",
        features: ["stocknavia.core", "updates.1y"],
        revoked: false,
        expired: false,
        withinGrace: false,
        hwidMatched: true,
        instanceMatched: true,
        machineBindingMatched: true,
        updatesAllowed: true,
        productMatched: true,
        expiresAtUtc: "2126-04-21T00:00:00.000Z",
        updatesUntilUtc: "2027-05-15T00:00:00.000Z",
        graceUntilUtc: "2126-05-21T00:00:00.000Z",
        maxDevices: 1,
        activeDeviceCount: 1,
      },
    );

    expect(status.status).toBe("active");
    expect(status.plan).toBe("lifetime-local");
    expect(status.deviceLimit).toBe(1);
    expect(status.features).toContain("updates.1y");
  });

  it("maps canonical clawdesk plan keys into ClawDesk commercial plans", () => {
    const cache: NaviaLicenseCacheRecord = {
      baseUrl: "http://127.0.0.1:5000",
      productKey: "clawdesk",
      orderNo: "ORDER",
      hwid: "HWID",
      instanceId: "INSTANCE",
      certificateJson: "{}",
      features: ["clawdesk.core", "updates.1y"],
      updatesUntilUtc: "2027-05-15T00:00:00.000Z",
      gracePolicy: { licenseType: "perpetual_with_updates_1y", graceUntilUtc: "2126-05-21T00:00:00.000Z" },
      appVersion: "1.0.0",
      activatedAtUtc: "2026-05-15T00:00:00.000Z",
      lastValidatedAtUtc: "2026-05-16T00:00:00.000Z",
      maxDevices: 2,
    };

    const status = mapNaviaLicenseToClawDeskStatus(
      cache,
      {
        signatureValid: true,
        productMatched: true,
        updatesAllowed: true,
        notExpiredOrWithinGrace: true,
        requiresOnlineMachineBindingValidation: true,
        reason: "ok",
      },
      {
        active: true,
        message: "validated",
        licenseId: "license-1",
        productKey: "clawdesk",
        planKey: "clawdesk.lifetime_updates_1y_2dev",
        licenseType: "perpetual_with_updates_1y",
        features: ["clawdesk.core", "updates.1y"],
        revoked: false,
        expired: false,
        withinGrace: false,
        hwidMatched: true,
        instanceMatched: true,
        machineBindingMatched: true,
        updatesAllowed: true,
        productMatched: true,
        expiresAtUtc: "2126-04-21T00:00:00.000Z",
        updatesUntilUtc: "2027-05-15T00:00:00.000Z",
        graceUntilUtc: "2126-05-21T00:00:00.000Z",
        maxDevices: 2,
        activeDeviceCount: 1,
      },
    );

    expect(status.plan).toBe("lifetime-local");
    expect(status.deviceLimit).toBe(2);
  });

  it("keeps legacy clawdesk plan keys as fallback mappings", () => {
    const cache = buildBaseCache();
    const status = mapNaviaLicenseToClawDeskStatus(
      cache,
      buildLocalOk(),
      {
        ...buildRemoteBase(),
        planKey: "clawdesk_sub_365d_2dev",
        licenseType: "subscription",
        maxDevices: 2,
      },
    );

    expect(status.plan).toBe("pro-yearly");
    expect(status.deviceLimit).toBe(2);
  });

  it("maps inactive but within grace into offline-grace", () => {
    const cache = buildBaseCache();
    const status = mapNaviaLicenseToClawDeskStatus(
      cache,
      buildLocalOk(),
      {
        ...buildRemoteBase(),
        active: false,
        expired: true,
        withinGrace: true,
        message: "ok_within_grace",
      },
    );

    expect(status.status).toBe("offline-grace");
  });

  it("maps revoked remote state into revoked", () => {
    const cache = buildBaseCache();
    const status = mapNaviaLicenseToClawDeskStatus(
      cache,
      buildLocalOk(),
      {
        ...buildRemoteBase(),
        active: false,
        revoked: true,
        message: "revoked",
      },
    );

    expect(status.status).toBe("revoked");
  });

  it("maps inactive expired state into expired", () => {
    const cache = buildBaseCache();
    const status = mapNaviaLicenseToClawDeskStatus(
      cache,
      buildLocalOk(),
      {
        ...buildRemoteBase(),
        active: false,
        expired: true,
        withinGrace: false,
        message: "expired",
      },
    );

    expect(status.status).toBe("expired");
  });

  it("maps invalid local signature into tampered", () => {
    const cache = buildBaseCache();
    const status = mapNaviaLicenseToClawDeskStatus(
      cache,
      {
        signatureValid: false,
        productMatched: true,
        updatesAllowed: true,
        notExpiredOrWithinGrace: true,
        requiresOnlineMachineBindingValidation: true,
        reason: "signature_invalid",
      },
      undefined,
    );

    expect(status.status).toBe("tampered");
  });
});

function buildBaseCache(): NaviaLicenseCacheRecord {
  return {
    baseUrl: "http://127.0.0.1:5000",
    productKey: "clawdesk",
    orderNo: "ORDER",
    hwid: "HWID",
    instanceId: "INSTANCE",
    certificateJson: "{}",
    features: ["clawdesk.core", "updates.1y"],
    updatesUntilUtc: "2027-05-15T00:00:00.000Z",
    gracePolicy: { licenseType: "perpetual_with_updates_1y", graceUntilUtc: "2126-05-21T00:00:00.000Z" },
    appVersion: "1.0.0",
    activatedAtUtc: "2026-05-15T00:00:00.000Z",
    lastValidatedAtUtc: "2026-05-16T00:00:00.000Z",
    maxDevices: 1,
  };
}

function buildLocalOk() {
  return {
    signatureValid: true,
    productMatched: true,
    updatesAllowed: true,
    notExpiredOrWithinGrace: true,
    requiresOnlineMachineBindingValidation: true as const,
    reason: "ok",
  };
}

function buildRemoteBase() {
  return {
    active: true,
    message: "validated",
    licenseId: "license-1",
    productKey: "clawdesk",
    planKey: "clawdesk_perpetual_updates_1y_1dev",
    licenseType: "perpetual_with_updates_1y",
    features: ["clawdesk.core", "updates.1y"],
    revoked: false,
    expired: false,
    withinGrace: false,
    hwidMatched: true,
    instanceMatched: true,
    machineBindingMatched: true,
    updatesAllowed: true,
    productMatched: true,
    expiresAtUtc: "2126-04-21T00:00:00.000Z",
    updatesUntilUtc: "2027-05-15T00:00:00.000Z",
    graceUntilUtc: "2126-05-21T00:00:00.000Z",
    maxDevices: 1,
    activeDeviceCount: 1,
  };
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function normalizeEcdsaSignatureToP1363(signature: Uint8Array, size: number): Uint8Array {
  if (signature.length === size * 2) {
    return signature;
  }
  return derToP1363(signature, size);
}

function derToP1363(der: Uint8Array, size: number): Uint8Array {
  let offset = 0;
  if (der[offset++] !== 0x30) {
    throw new Error("invalid_der_sequence");
  }
  offset += der[offset] > 0x7f ? 1 + (der[offset] & 0x7f) : 1;
  if (der[offset++] !== 0x02) {
    throw new Error("invalid_der_r");
  }
  let rLength = der[offset++];
  const r = der.slice(offset, offset + rLength);
  offset += rLength;
  if (der[offset++] !== 0x02) {
    throw new Error("invalid_der_s");
  }
  let sLength = der[offset++];
  const s = der.slice(offset, offset + sLength);

  const out = new Uint8Array(size * 2);
  out.set(trimInteger(r, size), size - trimInteger(r, size).length);
  out.set(trimInteger(s, size), size * 2 - trimInteger(s, size).length);
  return out;
}

function trimInteger(bytes: Uint8Array, size: number): Uint8Array {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0x00) {
    start += 1;
  }
  const value = bytes.slice(start);
  return value.length > size ? value.slice(value.length - size) : value;
}
