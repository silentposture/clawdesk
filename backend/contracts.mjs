export const BACKEND_CONTRACT_VERSION = "2026-05-13.production-adapter.v1";

export const PAYMENT_PROVIDER = "paddle";
export const LICENSE_PROVIDER = "keygen";
export const BETA_PAYMENT_PROVIDER = "lemon-squeezy";
export const BETA_LICENSE_PROVIDER = "lemon-license";

export const PRODUCTION_REQUIRED_ENV = [
  "CLAWDESK_GATEWAY_BASE_URL",
  "PADDLE_API_KEY",
  "PADDLE_WEBHOOK_SECRET",
  "KEYGEN_ACCOUNT_ID",
  "KEYGEN_PRODUCT_ID",
  "KEYGEN_SIGNING_PUBLIC_KEY",
  "CLAWDESK_SSO_ISSUER_URL",
  "CLAWDESK_SSO_CLIENT_ID",
];

export const BETA_DIRECT_REQUIRED_ENV = [
  "CLAWDESK_GATEWAY_BASE_URL",
  "LEMON_SQUEEZY_WEBHOOK_SECRET",
  "LEMON_SQUEEZY_STORE_ID",
  "LEMON_SQUEEZY_PRODUCT_ID",
];

export const BACKEND_ENDPOINT_CONTRACT = [
  { method: "GET", path: "/health", adapter: "gateway", purpose: "service health and contract version" },
  { method: "GET", path: "/contract", adapter: "gateway", purpose: "production adapter interface manifest" },
  { method: "GET", path: "/machine/fingerprint", adapter: "keygen", purpose: "salted machine fingerprint summary" },
  { method: "POST", path: "/licenses/activate-key", adapter: "keygen", purpose: "license activation and machine binding" },
  { method: "POST", path: "/licenses/validate", adapter: "keygen", purpose: "offline ticket validation and tamper detection" },
  { method: "POST", path: "/licenses/refresh-offline-ticket", adapter: "keygen", purpose: "signed offline license refresh" },
  { method: "POST", path: "/licenses/report-tamper", adapter: "keygen", purpose: "tamper event relay" },
  { method: "GET", path: "/license/status", adapter: "keygen", purpose: "license status summary" },
  { method: "POST", path: "/webhooks/paddle", adapter: "paddle", purpose: "payment and subscription webhook ingress" },
  { method: "POST", path: "/webhooks/keygen", adapter: "keygen", purpose: "license and machine webhook ingress" },
  { method: "POST", path: "/webhooks/lemon", adapter: "lemon-squeezy", purpose: "beta direct payment, license, refund, and cancellation webhook ingress" },
  { method: "GET", path: "/updates/check", adapter: "updates", purpose: "support entitlement and release metadata" },
  { method: "GET", path: "/updates/history", adapter: "updates", purpose: "release history" },
  { method: "POST", path: "/auth/register", adapter: "identity", purpose: "email account registration" },
  { method: "POST", path: "/auth/confirm", adapter: "identity", purpose: "email verification confirmation" },
  { method: "POST", path: "/auth/login", adapter: "identity", purpose: "password login" },
  { method: "POST", path: "/auth/sso/start", adapter: "identity", purpose: "SSO login handoff" },
  { method: "POST", path: "/auth/sso/finish", adapter: "identity", purpose: "SSO login callback finalization" },
  { method: "GET", path: "/auth/sso/providers", adapter: "identity", purpose: "available SSO providers" },
  { method: "GET", path: "/auth/session", adapter: "identity", purpose: "session lookup" },
  { method: "POST", path: "/diagnostics/create-report", adapter: "diagnostics", purpose: "redacted diagnostic report creation" },
  { method: "GET", path: "/legal/documents", adapter: "legal", purpose: "installer/EULA/privacy documents" },
  { method: "GET", path: "/legal/notices", adapter: "legal", purpose: "third-party and OpenClaw MIT notices" },
];

export const BACKEND_CONTRACT = {
  version: BACKEND_CONTRACT_VERSION,
  paymentProvider: PAYMENT_PROVIDER,
  licenseProvider: LICENSE_PROVIDER,
  endpoints: BACKEND_ENDPOINT_CONTRACT,
  productionRequiredEnv: PRODUCTION_REQUIRED_ENV,
  adapterModes: ["mock", "production"],
};

const paddleEventMutations = {
  "subscription.created": { status: "active", refreshSupportUpdatesUntil: true },
  payment_succeeded: { status: "active", refreshSupportUpdatesUntil: true },
  renewed: { status: "active", refreshSupportUpdatesUntil: true },
  "subscription.canceled": { status: "canceled", refreshSupportUpdatesUntil: false },
  payment_failed: { status: "past-due", refreshSupportUpdatesUntil: false },
  "subscription.updated-failed": { status: "past-due", refreshSupportUpdatesUntil: false },
  refund_issued: { status: "revoked", refreshSupportUpdatesUntil: false },
  lifetime_purchased: { status: "active", refreshSupportUpdatesUntil: true, planHint: "lifetime-local" },
  support_renewed: { status: "active", refreshSupportUpdatesUntil: true },
};

const keygenEventMutations = {
  "license.revoked": { signatureStatus: "revoked", status: "revoked" },
  "license.suspended": { signatureStatus: "invalid", status: "past-due" },
  "license.reinstated": { signatureStatus: "valid", status: "active" },
  "machine.reset": { increaseDeviceLimit: 1 },
};

const lemonEventMutations = {
  order_created: { status: "active", entitlementStatus: "licensed", refreshSupportUpdatesUntil: true },
  subscription_created: { status: "active", entitlementStatus: "licensed", refreshSupportUpdatesUntil: true },
  subscription_updated: { status: "active", entitlementStatus: "licensed", refreshSupportUpdatesUntil: true },
  subscription_cancelled: { status: "safe-mode", entitlementStatus: "safe-mode", refreshSupportUpdatesUntil: false },
  license_key_created: { status: "active", entitlementStatus: "licensed", refreshSupportUpdatesUntil: true },
  refund_created: { status: "safe-mode", entitlementStatus: "safe-mode", refreshSupportUpdatesUntil: false },
};

export function mapPaddleEventToLicenseMutation(eventType) {
  return paddleEventMutations[String(eventType ?? "").trim()] ?? null;
}

export function mapKeygenEventToLicenseMutation(eventType) {
  return keygenEventMutations[String(eventType ?? "").trim()] ?? null;
}

export function mapLemonEventToEntitlementMutation(eventType) {
  return lemonEventMutations[String(eventType ?? "").trim()] ?? null;
}

export function summarizeProductionEnv(env = process.env) {
  const required = PRODUCTION_REQUIRED_ENV.map((name) => ({ name, present: Boolean(env[name]) }));
  return {
    required,
    missing: required.filter((item) => !item.present).map((item) => item.name),
    ready: required.every((item) => item.present),
  };
}

export function summarizeBetaDirectEnv(env = process.env) {
  const required = BETA_DIRECT_REQUIRED_ENV.map((name) => ({ name, present: Boolean(env[name]) }));
  return {
    required,
    missing: required.filter((item) => !item.present).map((item) => item.name),
    ready: required.every((item) => item.present),
  };
}

export function createBackendHealthPayload({
  port,
  now,
  metrics,
  region = "local-mock",
  env = process.env,
  adapterMode = "mock",
  adapterReadiness,
}) {
  return {
    service: "ClawDesk License & Identity Simulator",
    version: "0.2.0",
    contractVersion: BACKEND_CONTRACT_VERSION,
    paymentProvider: PAYMENT_PROVIDER,
    licenseProvider: LICENSE_PROVIDER,
    betaPaymentProvider: BETA_PAYMENT_PROVIDER,
    betaLicenseProvider: BETA_LICENSE_PROVIDER,
    adapterMode,
    adapterReadiness,
    region,
    port,
    now,
    metrics,
    productionEnv: summarizeProductionEnv(env),
    betaDirectEnv: summarizeBetaDirectEnv(env),
  };
}

export function validateBackendContractShape(contract = BACKEND_CONTRACT) {
  const endpointKeys = new Set(contract.endpoints.map((endpoint) => `${endpoint.method}:${endpoint.path}`));
  const requiredEndpointKeys = [
    "GET:/health",
    "GET:/contract",
    "POST:/licenses/activate-key",
    "POST:/licenses/validate",
    "POST:/webhooks/paddle",
    "POST:/webhooks/keygen",
    "POST:/webhooks/lemon",
    "GET:/updates/check",
  ];
  return {
    ok:
      contract.version === BACKEND_CONTRACT_VERSION &&
      contract.paymentProvider === PAYMENT_PROVIDER &&
      contract.licenseProvider === LICENSE_PROVIDER &&
      requiredEndpointKeys.every((key) => endpointKeys.has(key)),
    missingEndpoints: requiredEndpointKeys.filter((key) => !endpointKeys.has(key)),
  };
}
