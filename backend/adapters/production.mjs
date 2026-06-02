import crypto from "node:crypto";
import {
  mapLemonEventToEntitlementMutation,
  summarizeBetaDirectEnv,
  summarizeProductionEnv,
} from "../contracts.mjs";

function timingSafeHexEqual(left, right) {
  if (!/^[a-f0-9]+$/i.test(left) || !/^[a-f0-9]+$/i.test(right)) return false;
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyLemonSignature({ rawBody, signatureHeader, secret } = {}) {
  if (!secret) {
    return { ok: false, statusCode: 503, faultCode: "CLWD-LEM-9001", error: "Lemon Squeezy webhook secret is not configured" };
  }
  if (typeof rawBody !== "string") {
    return { ok: false, statusCode: 400, faultCode: "CLWD-LEM-1002", error: "Raw webhook body is required" };
  }
  const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
  if (typeof signature !== "string" || !/^[a-f0-9]{64}$/i.test(signature)) {
    return { ok: false, statusCode: 401, faultCode: "CLWD-LEM-1001", error: "Invalid Lemon Squeezy signature header" };
  }
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  if (!timingSafeHexEqual(expected, signature)) {
    return { ok: false, statusCode: 401, faultCode: "CLWD-LEM-1005", error: "Lemon Squeezy signature mismatch" };
  }
  return { ok: true, signatureStatus: "valid" };
}

function notConfiguredError(service, envSummary) {
  const missing = envSummary.missing.join(", ");
  return {
    ok: false,
    statusCode: 503,
    faultCode: "CLWD-BE-9001",
    error: `${service} production adapter is not configured`,
    missingEnv: envSummary.missing,
    detail: missing ? `Missing env: ${missing}` : "Production credentials are present but implementation is not connected yet",
  };
}

export function createProductionAdapters({ env = process.env } = {}) {
  const envSummary = summarizeProductionEnv(env);
  const betaDirectEnvSummary = summarizeBetaDirectEnv(env);
  const readiness = {
    ready: envSummary.ready,
    productionEnv: envSummary,
    betaDirectEnv: betaDirectEnvSummary,
    warnings: envSummary.ready
      ? ["production credentials are present; live API calls are still scaffolded"]
      : ["production credentials are incomplete"],
  };

  return {
    mode: "production",
    readiness,
    lemon: {
      verifyWebhookSignature({ rawBody, signatureHeader } = {}) {
        if (!betaDirectEnvSummary.ready) return notConfiguredError("Lemon Squeezy", betaDirectEnvSummary);
        return verifyLemonSignature({
          rawBody,
          signatureHeader,
          secret: env.LEMON_SQUEEZY_WEBHOOK_SECRET,
        });
      },
      mapWebhookEvent: mapLemonEventToEntitlementMutation,
      validateOfflineTicket() {
        return {
          ok: false,
          statusCode: 501,
          faultCode: "CLWD-LEM-9002",
          error: "Lemon Squeezy production offline entitlement validation is scaffolded but not enabled",
        };
      },
    },
    identity: {
      ssoProviders() {
        return [
          { id: "apple", name: "Apple ID", singleSignOn: true },
          { id: "google", name: "Google", singleSignOn: true },
          { id: "microsoft", name: "Microsoft", singleSignOn: true },
          { id: "enterprise", name: "SAML/OIDC SSO", singleSignOn: true },
        ];
      },
      validateOidcCallback() {
        if (!envSummary.ready) return notConfiguredError("OIDC", envSummary);
        return {
          ok: false,
          statusCode: 501,
          faultCode: "CLWD-SSO-9002",
          error: "OIDC production callback validation is scaffolded but not enabled",
        };
      },
    },
  };
}
