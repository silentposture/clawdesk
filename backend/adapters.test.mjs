import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { createBackendAdapters, normalizeBackendAdapterMode } from "./adapters/index.mjs";
import { verifyKeygenLicenseFile, verifyLemonSignature, verifyPaddleSignature } from "./adapters/production.mjs";

const completeProductionEnv = {
  CLAWDESK_BACKEND_ADAPTER_MODE: "production",
  CLAWDESK_GATEWAY_BASE_URL: "https://gateway.example.test",
  PADDLE_API_KEY: "pdl_secret",
  PADDLE_WEBHOOK_SECRET: "pdl_webhook_secret",
  KEYGEN_ACCOUNT_ID: "acct",
  KEYGEN_PRODUCT_ID: "prod",
  KEYGEN_SIGNING_PUBLIC_KEY: "pub",
  CLAWDESK_SSO_ISSUER_URL: "https://issuer.example.test",
  CLAWDESK_SSO_CLIENT_ID: "client",
  LEMON_SQUEEZY_WEBHOOK_SECRET: "lemon_secret",
  LEMON_SQUEEZY_STORE_ID: "store_1",
  LEMON_SQUEEZY_PRODUCT_ID: "product_1",
};

function createSignedKeygenLicenseFile({ payload, type = "license", keyPair, alg = "base64+ed25519" }) {
  const enc = Buffer.from(JSON.stringify(payload)).toString("base64");
  const sig = crypto.sign(null, Buffer.from(`${type}/${enc}`, "utf8"), keyPair.privateKey).toString("base64");
  const body = Buffer.from(JSON.stringify({ alg, enc, sig })).toString("base64");
  const label = type.toUpperCase();
  return `-----BEGIN ${label} FILE-----\n${body}\n-----END ${label} FILE-----`;
}

function tamperKeygenLicenseSignature(licenseFile) {
  const match = licenseFile.match(/-----BEGIN (LICENSE|MACHINE) FILE-----\s*([\s\S]+?)\s*-----END \1 FILE-----/);
  const body = JSON.parse(Buffer.from(match[2].replace(/\s+/g, ""), "base64").toString("utf8"));
  body.sig = Buffer.from("tampered-signature").toString("base64");
  const nextBody = Buffer.from(JSON.stringify(body)).toString("base64");
  return `-----BEGIN ${match[1]} FILE-----\n${nextBody}\n-----END ${match[1]} FILE-----`;
}

describe("backend adapter registry", () => {
  it("defaults to mock mode for local development", () => {
    const adapters = createBackendAdapters({ env: {} });

    expect(normalizeBackendAdapterMode("unknown")).toBe("mock");
    expect(adapters.mode).toBe("mock");
    expect(adapters.readiness.ready).toBe(true);
    expect(adapters.identity.ssoProviders().map((provider) => provider.id)).toContain("github");
  });

  it("creates production adapters with explicit env readiness", () => {
    const adapters = createBackendAdapters({ env: { CLAWDESK_BACKEND_ADAPTER_MODE: "production" } });

    expect(adapters.mode).toBe("production");
    expect(adapters.readiness.ready).toBe(false);
    expect(adapters.readiness.productionEnv.missing).toContain("PADDLE_API_KEY");
  });

  it("does not expose production secret values in readiness output", () => {
    const adapters = createBackendAdapters({ env: completeProductionEnv });
    const serialized = JSON.stringify(adapters.readiness);

    expect(adapters.mode).toBe("production");
    expect(adapters.readiness.ready).toBe(true);
    expect(serialized).not.toContain("pdl_secret");
    expect(serialized).not.toContain("pdl_webhook_secret");
  });

  it("keeps Paddle and Keygen event mapping identical across adapter modes", () => {
    const mock = createBackendAdapters({ env: {} });
    const production = createBackendAdapters({ env: completeProductionEnv });

    expect(mock.paddle.mapWebhookEvent("payment_succeeded")).toEqual(production.paddle.mapWebhookEvent("payment_succeeded"));
    expect(mock.keygen.mapWebhookEvent("license.revoked")).toEqual(production.keygen.mapWebhookEvent("license.revoked"));
    expect(mock.lemon.mapWebhookEvent("refund_created")).toEqual(production.lemon.mapWebhookEvent("refund_created"));
  });

  it("verifies Paddle production webhook signatures without exposing secrets", () => {
    const rawBody = JSON.stringify({ eventType: "payment_succeeded", licenseKey: "CLWD-PRO-YEARLY-2026-DEV" });
    const timestamp = 1778614000;
    const secret = "pdl_webhook_secret";
    const signature = crypto.createHmac("sha256", secret).update(`${timestamp}:${rawBody}`).digest("hex");

    expect(
      verifyPaddleSignature({
        rawBody,
        signatureHeader: `ts=${timestamp};h1=${signature}`,
        secret,
        nowSeconds: timestamp,
      }),
    ).toMatchObject({ ok: true, signatureStatus: "valid" });

    const mismatch = verifyPaddleSignature({
      rawBody,
      signatureHeader: `ts=${timestamp};h1=${"0".repeat(64)}`,
      secret,
      nowSeconds: timestamp,
    });
    expect(mismatch).toMatchObject({ ok: false, statusCode: 401, faultCode: "CLWD-PAY-1005" });
    expect(JSON.stringify(mismatch)).not.toContain(secret);
  });

  it("rejects stale Paddle signatures", () => {
    const rawBody = "{}";
    const timestamp = 1778614000;
    const secret = "pdl_webhook_secret";
    const signature = crypto.createHmac("sha256", secret).update(`${timestamp}:${rawBody}`).digest("hex");

    expect(
      verifyPaddleSignature({
        rawBody,
        signatureHeader: `ts=${timestamp};h1=${signature}`,
        secret,
        nowSeconds: timestamp + 301,
      }),
    ).toMatchObject({ ok: false, statusCode: 401, faultCode: "CLWD-PAY-1004" });
  });

  it("verifies Lemon Squeezy webhook signatures without exposing secrets", () => {
    const rawBody = JSON.stringify({ meta: { event_name: "license_key_created" } });
    const secret = "lemon_secret";
    const signature = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

    expect(verifyLemonSignature({ rawBody, signatureHeader: signature, secret })).toMatchObject({
      ok: true,
      signatureStatus: "valid",
    });

    const mismatch = verifyLemonSignature({
      rawBody,
      signatureHeader: "0".repeat(64),
      secret,
    });
    expect(mismatch).toMatchObject({ ok: false, statusCode: 401, faultCode: "CLWD-LEM-1005" });
    expect(JSON.stringify(mismatch)).not.toContain(secret);
  });

  it("verifies Keygen Ed25519 license files and matches machine fingerprints", () => {
    const keyPair = crypto.generateKeyPairSync("ed25519");
    const publicKey = keyPair.publicKey.export({ type: "spki", format: "pem" });
    const licenseFile = createSignedKeygenLicenseFile({
      keyPair,
      payload: {
        plan: "pro-yearly",
        status: "active",
        machineFingerprintHash: "mfp-prod-1",
        supportUpdatesUntil: "2027-05-13T00:00:00.000Z",
        meta: { expiry: "2026-06-13T00:00:00.000Z" },
      },
    });

    expect(
      verifyKeygenLicenseFile({
        licenseFile,
        publicKey,
        expectedMachineFingerprintHash: "mfp-prod-1",
        now: new Date("2026-05-13T00:00:00.000Z"),
      }),
    ).toMatchObject({
      ok: true,
      signatureStatus: "valid",
      machineMatched: true,
      payload: { plan: "pro-yearly", status: "active" },
    });
  });

  it("rejects tampered Keygen license files and machine mismatches", () => {
    const keyPair = crypto.generateKeyPairSync("ed25519");
    const publicKey = keyPair.publicKey.export({ type: "spki", format: "pem" });
    const licenseFile = createSignedKeygenLicenseFile({
      keyPair,
      payload: {
        plan: "pro-yearly",
        status: "active",
        machineFingerprintHash: "mfp-prod-1",
        meta: { expiry: "2026-06-13T00:00:00.000Z" },
      },
    });

    expect(
      verifyKeygenLicenseFile({
        licenseFile,
        publicKey,
        expectedMachineFingerprintHash: "mfp-prod-2",
        now: new Date("2026-05-13T00:00:00.000Z"),
      }),
    ).toMatchObject({
      ok: false,
      statusCode: 426,
      faultCode: "CLWD-LIC-1002",
    });

    expect(
      verifyKeygenLicenseFile({
        licenseFile: tamperKeygenLicenseSignature(licenseFile),
        publicKey,
        expectedMachineFingerprintHash: "mfp-prod-1",
        now: new Date("2026-05-13T00:00:00.000Z"),
      }),
    ).toMatchObject({
      ok: false,
      statusCode: 401,
      faultCode: "CLWD-LIC-1001",
    });
  });

  it("rejects expired Keygen license files", () => {
    const keyPair = crypto.generateKeyPairSync("ed25519");
    const publicKey = keyPair.publicKey.export({ type: "spki", format: "pem" });
    const licenseFile = createSignedKeygenLicenseFile({
      keyPair,
      payload: {
        plan: "pro-yearly",
        status: "active",
        machineFingerprintHash: "mfp-prod-1",
        meta: { expiry: "2026-01-01T00:00:00.000Z" },
      },
    });

    expect(
      verifyKeygenLicenseFile({
        licenseFile,
        publicKey,
        expectedMachineFingerprintHash: "mfp-prod-1",
        now: new Date("2026-05-13T00:00:00.000Z"),
      }),
    ).toMatchObject({
      ok: false,
      statusCode: 426,
      faultCode: "CLWD-LIC-2006",
    });
  });
});
