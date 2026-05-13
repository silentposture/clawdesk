import { describe, expect, it } from "vitest";
import {
  BACKEND_CONTRACT,
  BACKEND_CONTRACT_VERSION,
  createBackendHealthPayload,
  mapKeygenEventToLicenseMutation,
  mapLemonEventToEntitlementMutation,
  mapPaddleEventToLicenseMutation,
  summarizeBetaDirectEnv,
  summarizeProductionEnv,
  validateBackendContractShape,
} from "./contracts.mjs";

describe("production backend contract", () => {
  it("declares the required Paddle, Keygen, identity, and gateway adapters", () => {
    const validation = validateBackendContractShape(BACKEND_CONTRACT);
    const endpointKeys = BACKEND_CONTRACT.endpoints.map((endpoint) => `${endpoint.method}:${endpoint.path}`);

    expect(validation.ok).toBe(true);
    expect(BACKEND_CONTRACT.version).toBe(BACKEND_CONTRACT_VERSION);
    expect(endpointKeys).toContain("GET:/health");
    expect(endpointKeys).toContain("GET:/contract");
    expect(endpointKeys).toContain("POST:/licenses/activate-key");
    expect(endpointKeys).toContain("POST:/webhooks/paddle");
    expect(endpointKeys).toContain("POST:/webhooks/keygen");
    expect(endpointKeys).toContain("POST:/webhooks/lemon");
  });

  it("maps supported Paddle webhook events to deterministic license mutations", () => {
    expect(mapPaddleEventToLicenseMutation("payment_succeeded")).toMatchObject({
      status: "active",
      refreshSupportUpdatesUntil: true,
    });
    expect(mapPaddleEventToLicenseMutation("subscription.canceled")).toMatchObject({
      status: "canceled",
    });
    expect(mapPaddleEventToLicenseMutation("unknown.event")).toBeNull();
  });

  it("maps supported Keygen webhook events to deterministic license mutations", () => {
    expect(mapKeygenEventToLicenseMutation("license.revoked")).toMatchObject({
      signatureStatus: "revoked",
      status: "revoked",
    });
    expect(mapKeygenEventToLicenseMutation("machine.reset")).toMatchObject({
      increaseDeviceLimit: 1,
    });
    expect(mapKeygenEventToLicenseMutation("unknown.event")).toBeNull();
  });

  it("maps Lemon Squeezy beta events to direct-sale entitlement mutations", () => {
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
      PADDLE_API_KEY: "pdl_secret",
    });

    expect(summary.ready).toBe(false);
    expect(summary.required.find((item) => item.name === "PADDLE_API_KEY")).toEqual({
      name: "PADDLE_API_KEY",
      present: true,
    });
    expect(JSON.stringify(summary)).not.toContain("pdl_secret");
  });

  it("reports beta direct Lemon env readiness without exposing secret values", () => {
    const summary = summarizeBetaDirectEnv({
      CLAWDESK_GATEWAY_BASE_URL: "https://gateway.example.test",
      LEMON_SQUEEZY_WEBHOOK_SECRET: "lemon_secret",
      LEMON_SQUEEZY_STORE_ID: "store_1",
    });

    expect(summary.ready).toBe(false);
    expect(summary.required.find((item) => item.name === "LEMON_SQUEEZY_WEBHOOK_SECRET")).toEqual({
      name: "LEMON_SQUEEZY_WEBHOOK_SECRET",
      present: true,
    });
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
    expect(payload.paymentProvider).toBe("paddle");
    expect(payload.licenseProvider).toBe("keygen");
    expect(payload.betaPaymentProvider).toBe("lemon-squeezy");
    expect(payload.betaLicenseProvider).toBe("lemon-license");
    expect(payload.productionEnv.ready).toBe(false);
  });
});
