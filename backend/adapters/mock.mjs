import {
  mapKeygenEventToLicenseMutation,
  mapLemonEventToEntitlementMutation,
  mapPaddleEventToLicenseMutation,
  summarizeProductionEnv,
} from "../contracts.mjs";

const ssoProviders = [
  { id: "apple", name: "Apple ID", singleSignOn: true },
  { id: "google", name: "Google", singleSignOn: true },
  { id: "microsoft", name: "Microsoft", singleSignOn: true },
  { id: "github", name: "GitHub", singleSignOn: true },
  { id: "okta", name: "Okta", singleSignOn: true },
  { id: "enterprise", name: "SAML/SSO", singleSignOn: true },
];

export function createMockAdapters({ env = process.env } = {}) {
  return {
    mode: "mock",
    readiness: {
      ready: true,
      productionEnv: summarizeProductionEnv(env),
      warnings: ["mock adapters are for local simulation only"],
    },
    paddle: {
      verifyWebhookSignature() {
        return { ok: true, mode: "mock", reason: "signature verification bypassed in mock mode" };
      },
      mapWebhookEvent: mapPaddleEventToLicenseMutation,
    },
    keygen: {
      mapWebhookEvent: mapKeygenEventToLicenseMutation,
      validateOfflineTicket({ parsed, machineFingerprintHash }) {
        if (!parsed) return { ok: false, statusCode: 400, error: "Invalid offline ticket" };
        if (!parsed.signatureMatch) {
          return { ok: false, statusCode: 400, error: "Ticket signature invalid", faultCode: "CLWD-LIC-1001" };
        }
        const machineMatched =
          !machineFingerprintHash ||
          parsed.payload?.machineFingerprintHash === machineFingerprintHash;
        return {
          ok: true,
          machineMatched,
          tampered: !machineMatched,
          statusCode: machineMatched ? 200 : 426,
        };
      },
    },
    lemon: {
      verifyWebhookSignature() {
        return { ok: true, mode: "mock", reason: "Lemon Squeezy signature verification bypassed in mock mode" };
      },
      mapWebhookEvent: mapLemonEventToEntitlementMutation,
    },
    identity: {
      ssoProviders() {
        return ssoProviders;
      },
      validateOidcCallback({ email }) {
        return { ok: typeof email === "string" && email.includes("@") };
      },
    },
  };
}
