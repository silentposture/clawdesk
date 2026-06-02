import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { createBackendAdapters, normalizeBackendAdapterMode } from "./adapters/index.mjs";
import { verifyLemonSignature } from "./adapters/production.mjs";

const completeProductionEnv = {
  CLAWDESK_BACKEND_ADAPTER_MODE: "production",
  CLAWDESK_GATEWAY_BASE_URL: "https://gateway.example.test",
  CLAWDESK_SSO_ISSUER_URL: "https://issuer.example.test",
  CLAWDESK_SSO_CLIENT_ID: "client",
  LEMON_SQUEEZY_WEBHOOK_SECRET: "lemon_secret",
  LEMON_SQUEEZY_STORE_ID: "store_1",
  LEMON_SQUEEZY_PRODUCT_ID: "product_1",
  LEMON_SQUEEZY_VARIANT_ID_PRO_YEARLY: "variant_yearly",
  LEMON_SQUEEZY_VARIANT_ID_LIFETIME: "variant_lifetime",
};

describe("backend adapter registry", () => {
  it("defaults to mock mode for local development", () => {
    const adapters = createBackendAdapters({ env: {} });

    expect(normalizeBackendAdapterMode("unknown")).toBe("mock");
    expect(adapters.mode).toBe("mock");
    expect(adapters.readiness.ready).toBe(true);
    expect(adapters.identity.ssoProviders().map((provider) => provider.id)).toContain("github");
  });

  it("creates production adapters with explicit Lemon Squeezy env readiness", () => {
    const adapters = createBackendAdapters({ env: { CLAWDESK_BACKEND_ADAPTER_MODE: "production" } });

    expect(adapters.mode).toBe("production");
    expect(adapters.readiness.ready).toBe(false);
    expect(adapters.readiness.productionEnv.missing).toContain("LEMON_SQUEEZY_WEBHOOK_SECRET");
  });

  it("does not expose production secret values in readiness output", () => {
    const adapters = createBackendAdapters({ env: completeProductionEnv });
    const serialized = JSON.stringify(adapters.readiness);

    expect(adapters.mode).toBe("production");
    expect(adapters.readiness.ready).toBe(true);
    expect(serialized).not.toContain("lemon_secret");
  });

  it("keeps Lemon Squeezy event mapping identical across adapter modes", () => {
    const mock = createBackendAdapters({ env: {} });
    const production = createBackendAdapters({ env: completeProductionEnv });

    expect(mock.lemon.mapWebhookEvent("refund_created")).toEqual(production.lemon.mapWebhookEvent("refund_created"));
    expect(mock.lemon.mapWebhookEvent("license_key_created")).toEqual(production.lemon.mapWebhookEvent("license_key_created"));
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
});
