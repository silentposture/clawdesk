export const BACKEND_CONTRACT_VERSION = "2026-05-13.production-adapter.v1";

export const PAYMENT_PROVIDER = "lemon-squeezy";
export const LICENSE_PROVIDER = "lemon-license";

export const PRODUCTION_REQUIRED_ENV = [
  "CLAWDESK_GATEWAY_BASE_URL",
  "LEMON_SQUEEZY_WEBHOOK_SECRET",
  "LEMON_SQUEEZY_STORE_ID",
  "LEMON_SQUEEZY_PRODUCT_ID",
  "LEMON_SQUEEZY_VARIANT_ID_PRO_YEARLY",
  "LEMON_SQUEEZY_VARIANT_ID_LIFETIME",
  "CLAWDESK_SSO_ISSUER_URL",
  "CLAWDESK_SSO_CLIENT_ID",
];

export const BETA_DIRECT_REQUIRED_ENV = [
  "CLAWDESK_GATEWAY_BASE_URL",
  "LEMON_SQUEEZY_WEBHOOK_SECRET",
  "LEMON_SQUEEZY_STORE_ID",
  "LEMON_SQUEEZY_PRODUCT_ID",
  "LEMON_SQUEEZY_VARIANT_ID_PRO_YEARLY",
  "LEMON_SQUEEZY_VARIANT_ID_LIFETIME",
];

export const BACKEND_ENDPOINT_CONTRACT = [
  { method: "GET", path: "/health", adapter: "gateway", purpose: "service health and contract version" },
  { method: "GET", path: "/contract", adapter: "gateway", purpose: "production adapter interface manifest" },
  { method: "GET", path: "/machine/fingerprint", adapter: "lemon-squeezy", purpose: "salted machine fingerprint summary" },
  { method: "POST", path: "/api/license/activate", adapter: "universal-server", purpose: "signed certificate activation and machine binding" },
  { method: "POST", path: "/api/license/validate", adapter: "universal-server", purpose: "signed certificate validation and entitlement check" },
  { method: "POST", path: "/api/license/refresh-certificate", adapter: "universal-server", purpose: "signed certificate refresh" },
  { method: "POST", path: "/api/license/deactivate", adapter: "universal-server", purpose: "device deactivation and binding release" },
  { method: "GET", path: "/api/license/me", adapter: "universal-server", purpose: "current account license summary" },
  { method: "GET", path: "/api/license/public-keys", adapter: "universal-server", purpose: "license certificate public key ring" },
  { method: "GET", path: "/api/account/entitlements", adapter: "universal-server", purpose: "current account entitlements" },
  { method: "POST", path: "/api/webhooks/lemonsqueezy", adapter: "universal-server", purpose: "payment, license, refund, and cancellation webhook ingress" },
  { method: "GET", path: "/updates/check", adapter: "updates", purpose: "support entitlement and release metadata" },
  { method: "GET", path: "/updates/history", adapter: "updates", purpose: "release history" },
  { method: "POST", path: "/api/auth/register", adapter: "identity", purpose: "email account registration" },
  { method: "POST", path: "/api/auth/resend-verification", adapter: "identity", purpose: "re-issue email verification challenge" },
  { method: "GET", path: "/api/auth/verify-email", adapter: "identity", purpose: "email verification token confirmation" },
  { method: "POST", path: "/api/auth/verify-email", adapter: "identity", purpose: "email verification code confirmation" },
  { method: "POST", path: "/api/auth/login", adapter: "identity", purpose: "password login" },
  { method: "GET", path: "/api/auth/me", adapter: "identity", purpose: "session lookup" },
  { method: "POST", path: "/api/auth/logout", adapter: "identity", purpose: "session revoke" },
  { method: "POST", path: "/api/auth/password/forgot", adapter: "identity", purpose: "issue password reset challenge" },
  { method: "POST", path: "/api/auth/password/reset", adapter: "identity", purpose: "reset password with email challenge" },
  { method: "POST", path: "/provider/secret-refs/issue", adapter: "provider-secrets", purpose: "issue a server-side provider SecretRef without returning raw secrets" },
  { method: "POST", path: "/provider/token-refresh", adapter: "provider-secrets", purpose: "refresh provider account token and return token reference metadata only" },
  { method: "GET", path: "/provider/secret-refs/contract", adapter: "provider-secrets", purpose: "provider secret reference and refresh contract" },
  { method: "GET", path: "/provider/openai/runtime-contract", adapter: "provider-runtime", purpose: "OpenAI Responses API runtime manifest" },
  { method: "POST", path: "/provider/openai/validate-key", adapter: "provider-runtime", purpose: "validate OpenAI key or return dry-run runtime validation" },
  { method: "POST", path: "/provider/openai/chat-test", adapter: "provider-runtime", purpose: "minimal OpenAI Responses API chat probe without returning raw secrets" },
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

const lemonEventMutations = {
  order_created: { status: "active", entitlementStatus: "licensed", refreshSupportUpdatesUntil: true },
  subscription_created: { status: "active", entitlementStatus: "licensed", refreshSupportUpdatesUntil: true },
  subscription_updated: { status: "active", entitlementStatus: "licensed", refreshSupportUpdatesUntil: true },
  subscription_cancelled: { status: "safe-mode", entitlementStatus: "safe-mode", refreshSupportUpdatesUntil: false },
  license_key_created: { status: "active", entitlementStatus: "licensed", refreshSupportUpdatesUntil: true },
  refund_created: { status: "safe-mode", entitlementStatus: "safe-mode", refreshSupportUpdatesUntil: false },
};

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
    "POST:/api/license/activate",
    "POST:/api/license/validate",
    "POST:/api/webhooks/lemonsqueezy",
    "GET:/api/license/public-keys",
    "GET:/api/account/entitlements",
    "POST:/api/auth/resend-verification",
    "POST:/api/auth/password/forgot",
    "POST:/api/auth/password/reset",
    "POST:/provider/secret-refs/issue",
    "POST:/provider/token-refresh",
    "GET:/provider/openai/runtime-contract",
    "POST:/provider/openai/chat-test",
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
