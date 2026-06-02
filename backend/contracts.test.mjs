import { describe, expect, it } from "vitest";
import {
  BACKEND_CONTRACT,
  BACKEND_CONTRACT_VERSION,
  createBackendHealthPayload,
  mapLemonEventToEntitlementMutation,
  summarizeBetaDirectEnv,
  summarizeProductionEnv,
  validateBackendContractShape,
} from "./contracts.mjs";

describe("production backend contract", () => {
  it("declares Lemon Squeezy as the only payment and license adapter", () => {
    const validation = validateBackendContractShape(BACKEND_CONTRACT);
    const endpointKeys = BACKEND_CONTRACT.endpoints.map((endpoint) => `${endpoint.method}:${endpoint.path}`);

    expect(validation.ok).toBe(true);
    expect(BACKEND_CONTRACT.version).toBe(BACKEND_CONTRACT_VERSION);
    expect(endpointKeys).toContain("GET:/health");
    expect(endpointKeys).toContain("GET:/contract");
    expect(endpointKeys).toContain("POST:/api/license/activate");
    expect(endpointKeys).toContain("POST:/api/webhooks/lemonsqueezy");
    expect(endpointKeys).toContain("GET:/api/license/public-keys");
    expect(endpointKeys).toContain("GET:/api/account/entitlements");
    expect(endpointKeys).toContain("POST:/api/auth/resend-verification");
    expect(endpointKeys).toContain("POST:/api/auth/password/forgot");
    expect(endpointKeys).toContain("POST:/api/auth/password/reset");
    expect(endpointKeys).toContain("POST:/provider/secret-refs/issue");
    expect(endpointKeys).toContain("POST:/provider/token-refresh");
    expect(endpointKeys).toContain("GET:/provider/openai/runtime-contract");
    expect(endpointKeys).toContain("POST:/provider/openai/chat-test");
    expect(BACKEND_CONTRACT.paymentProvider).toBe("lemon-squeezy");
    expect(BACKEND_CONTRACT.licenseProvider).toBe("lemon-license");
  });

  it("maps Lemon Squeezy events to direct-sale entitlement mutations", () => {
    expect(mapLemonEventToEntitlementMutation("license_key_created")).toMatchObject({
      status: "active",
      entitlementStatus: "licensed",
    });
    expect(mapLemonEventToEntitlementMutation("refund_created")).toMatchObject({
      status: "safe-mode",
      entitlementStatus: "safe-mode",
    });
    expect(mapLemonEventToEntitlementMutation("unknown.event")).toBeNull();
  });

  it("reports production env readiness without exposing secret values", () => {
    const summary = summarizeProductionEnv({
      CLAWDESK_GATEWAY_BASE_URL: "https://gateway.example.test",
      LEMON_SQUEEZY_WEBHOOK_SECRET: "lemon_secret",
    });

    expect(summary.ready).toBe(false);
    expect(summary.required.find((item) => item.name === "LEMON_SQUEEZY_WEBHOOK_SECRET")).toEqual({
      name: "LEMON_SQUEEZY_WEBHOOK_SECRET",
      present: true,
    });
    expect(JSON.stringify(summary)).not.toContain("lemon_secret");
  });

  it("reports beta direct Lemon env readiness without exposing secret values", () => {
    const summary = summarizeBetaDirectEnv({
      CLAWDESK_GATEWAY_BASE_URL: "https://gateway.example.test",
      LEMON_SQUEEZY_WEBHOOK_SECRET: "lemon_secret",
      LEMON_SQUEEZY_STORE_ID: "store_1",
      LEMON_SQUEEZY_PRODUCT_ID: "product_1",
      LEMON_SQUEEZY_VARIANT_ID_PRO_YEARLY: "variant_yearly",
    });

    expect(summary.ready).toBe(false);
    expect(summary.missing).toEqual(["LEMON_SQUEEZY_VARIANT_ID_LIFETIME"]);
    expect(summary.required.find((item) => item.name === "LEMON_SQUEEZY_WEBHOOK_SECRET")).toEqual({
      name: "LEMON_SQUEEZY_WEBHOOK_SECRET",
      present: true,
    });
    expect(summary.required.map((item) => item.name)).toContain("LEMON_SQUEEZY_VARIANT_ID_PRO_YEARLY");
    expect(summary.required.map((item) => item.name)).toContain("LEMON_SQUEEZY_VARIANT_ID_LIFETIME");
    expect(JSON.stringify(summary)).not.toContain("lemon_secret");
  });

  it("includes contract metadata in health payloads", () => {
    const payload = createBackendHealthPayload({
      port: 19090,
      now: "2026-05-13T00:00:00.000Z",
      metrics: { accounts: 1, activeSessions: 1, licenses: 1 },
      env: {},
    });

    expect(payload.contractVersion).toBe(BACKEND_CONTRACT_VERSION);
    expect(payload.paymentProvider).toBe("lemon-squeezy");
    expect(payload.licenseProvider).toBe("lemon-license");
    expect(payload.productionEnv.ready).toBe(false);
  });
});
