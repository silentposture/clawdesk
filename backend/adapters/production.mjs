import crypto from "node:crypto";
import {
  mapKeygenEventToLicenseMutation,
  mapLemonEventToEntitlementMutation,
  mapPaddleEventToLicenseMutation,
  summarizeBetaDirectEnv,
  summarizeProductionEnv,
} from "../contracts.mjs";

const DEFAULT_PADDLE_SIGNATURE_TOLERANCE_SECONDS = 300;
const KEYGEN_ED25519_SPKI_PREFIX = "302a300506032b6570032100";

function parsePaddleSignatureHeader(header) {
  const raw = Array.isArray(header) ? header[0] : header;
  if (typeof raw !== "string" || !raw.trim()) return null;
  const parts = Object.fromEntries(
    raw
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([key, value]) => key && value),
  );
  if (!parts.ts || !parts.h1) return null;
  return { timestamp: parts.ts, signature: parts.h1 };
}

function timingSafeHexEqual(left, right) {
  if (!/^[a-f0-9]+$/i.test(left) || !/^[a-f0-9]+$/i.test(right)) return false;
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyPaddleSignature({
  rawBody,
  signatureHeader,
  secret,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = DEFAULT_PADDLE_SIGNATURE_TOLERANCE_SECONDS,
}) {
  if (!secret) {
    return { ok: false, statusCode: 503, faultCode: "CLWD-PAY-9001", error: "Paddle webhook secret is not configured" };
  }
  if (typeof rawBody !== "string") {
    return { ok: false, statusCode: 400, faultCode: "CLWD-PAY-1002", error: "Raw webhook body is required" };
  }
  const parsed = parsePaddleSignatureHeader(signatureHeader);
  if (!parsed) {
    return { ok: false, statusCode: 401, faultCode: "CLWD-PAY-1001", error: "Invalid Paddle signature header" };
  }
  const timestamp = Number(parsed.timestamp);
  if (!Number.isFinite(timestamp)) {
    return { ok: false, statusCode: 401, faultCode: "CLWD-PAY-1003", error: "Invalid Paddle signature timestamp" };
  }
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    return { ok: false, statusCode: 401, faultCode: "CLWD-PAY-1004", error: "Paddle signature timestamp is outside tolerance" };
  }

  const signedPayload = `${parsed.timestamp}:${rawBody}`;
  const expected = crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");
  if (!timingSafeHexEqual(expected, parsed.signature)) {
    return { ok: false, statusCode: 401, faultCode: "CLWD-PAY-1005", error: "Paddle signature mismatch" };
  }

  return { ok: true, timestamp, signatureStatus: "valid" };
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

function base64DecodeToString(value) {
  return Buffer.from(String(value ?? "").replace(/\s+/g, ""), "base64").toString("utf8");
}

function extractKeygenCertificate(licenseFile) {
  const raw = String(licenseFile ?? "").trim();
  if (!raw) return null;
  if (raw.startsWith("{")) {
    return { type: "license", json: JSON.parse(raw) };
  }
  const match = raw.match(/-----BEGIN (LICENSE|MACHINE) FILE-----\s*([\s\S]+?)\s*-----END \1 FILE-----/);
  if (!match) return null;
  return {
    type: match[1].toLowerCase(),
    json: JSON.parse(base64DecodeToString(match[2])),
  };
}

function keygenPublicKeyObject(publicKey) {
  const raw = String(publicKey ?? "").trim();
  if (!raw) return null;
  if (raw.includes("BEGIN PUBLIC KEY")) return crypto.createPublicKey(raw);
  if (!/^[a-f0-9]{64}$/i.test(raw)) return null;
  return crypto.createPublicKey({
    key: Buffer.from(`${KEYGEN_ED25519_SPKI_PREFIX}${raw}`, "hex"),
    format: "der",
    type: "spki",
  });
}

function pickMachineFingerprint(payload) {
  return (
    payload?.machineFingerprintHash ??
    payload?.machineFingerprint ??
    payload?.machine?.fingerprintHash ??
    payload?.machine?.fingerprint ??
    payload?.meta?.machineFingerprintHash ??
    payload?.meta?.machineFingerprint ??
    null
  );
}

function pickExpiry(payload) {
  return payload?.meta?.expiry ?? payload?.expiry ?? payload?.expiresAt ?? payload?.ttlExpiresAt ?? null;
}

export function verifyKeygenLicenseFile({
  licenseFile,
  publicKey,
  expectedMachineFingerprintHash,
  now = new Date(),
  expectedAlgorithm = "base64+ed25519",
}) {
  let certificate;
  try {
    certificate = extractKeygenCertificate(licenseFile);
  } catch {
    return { ok: false, statusCode: 400, faultCode: "CLWD-LIC-2001", error: "Invalid Keygen license file JSON" };
  }
  if (!certificate?.json) {
    return { ok: false, statusCode: 400, faultCode: "CLWD-LIC-2002", error: "Invalid Keygen license file certificate" };
  }

  const { alg, enc, sig } = certificate.json;
  if (alg !== expectedAlgorithm) {
    return { ok: false, statusCode: 400, faultCode: "CLWD-LIC-2003", error: "Unsupported Keygen license file algorithm" };
  }
  if (!enc || !sig) {
    return { ok: false, statusCode: 400, faultCode: "CLWD-LIC-2004", error: "Keygen license file is missing enc or sig" };
  }

  let keyObject;
  try {
    keyObject = keygenPublicKeyObject(publicKey);
  } catch {
    return { ok: false, statusCode: 503, faultCode: "CLWD-LIC-9003", error: "Invalid Keygen signing public key" };
  }
  if (!keyObject) {
    return { ok: false, statusCode: 503, faultCode: "CLWD-LIC-9001", error: "Keygen signing public key is not configured" };
  }

  const signature = Buffer.from(String(sig), "base64");
  const signedPayload = Buffer.from(`${certificate.type}/${enc}`, "utf8");
  const signatureValid = crypto.verify(null, signedPayload, keyObject, signature);
  if (!signatureValid) {
    return { ok: false, statusCode: 401, faultCode: "CLWD-LIC-1001", error: "Keygen license file signature mismatch" };
  }

  let payload;
  try {
    payload = JSON.parse(base64DecodeToString(enc));
  } catch {
    return { ok: false, statusCode: 400, faultCode: "CLWD-LIC-2005", error: "Keygen license file payload is not valid JSON" };
  }

  const expiry = pickExpiry(payload);
  if (expiry && Date.parse(expiry) < now.getTime()) {
    return { ok: false, statusCode: 426, faultCode: "CLWD-LIC-2006", error: "Keygen license file is expired" };
  }

  const fileMachineFingerprint = pickMachineFingerprint(payload);
  const machineMatched =
    !expectedMachineFingerprintHash ||
    !fileMachineFingerprint ||
    fileMachineFingerprint === expectedMachineFingerprintHash;
  if (!machineMatched) {
    return {
      ok: false,
      statusCode: 426,
      faultCode: "CLWD-LIC-1002",
      error: "Keygen license file machine fingerprint mismatch",
      signatureStatus: "valid",
      machineMatched: false,
    };
  }

  return {
    ok: true,
    statusCode: 200,
    signatureStatus: "valid",
    machineMatched,
    type: certificate.type,
    payload,
  };
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
    paddle: {
      verifyWebhookSignature({ rawBody, signatureHeader } = {}) {
        if (!envSummary.ready) return notConfiguredError("Paddle", envSummary);
        return verifyPaddleSignature({
          rawBody,
          signatureHeader,
          secret: env.PADDLE_WEBHOOK_SECRET,
        });
      },
      mapWebhookEvent: mapPaddleEventToLicenseMutation,
    },
    keygen: {
      mapWebhookEvent: mapKeygenEventToLicenseMutation,
      validateOfflineTicket({ licenseFile, machineFingerprintHash } = {}) {
        if (!envSummary.ready) return notConfiguredError("Keygen", envSummary);
        return verifyKeygenLicenseFile({
          licenseFile,
          publicKey: env.KEYGEN_SIGNING_PUBLIC_KEY,
          expectedMachineFingerprintHash: machineFingerprintHash,
        });
      },
    },
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
