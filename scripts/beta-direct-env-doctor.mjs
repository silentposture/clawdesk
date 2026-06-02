import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const cwd = process.cwd();

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env) && value) process.env[key] = value;
  }
  return true;
}

function envPresent(names) {
  return Object.fromEntries(names.map((name) => [name, Boolean(process.env[name])]));
}

function missing(names) {
  return names.filter((name) => !process.env[name]);
}

function urlStatus(name, options = {}) {
  const value = process.env[name];
  if (!value) return { name, present: false, valid: false, issue: "missing" };
  try {
    const parsed = new URL(value);
    const issues = [];
    if (parsed.protocol !== "https:") issues.push("must-use-https");
    if (options.rejectHomepageHost && parsed.hostname === options.rejectHomepageHost) issues.push("must-not-use-homepage-host");
    return {
      name,
      present: true,
      valid: issues.length === 0,
      host: parsed.hostname,
      issues,
    };
  } catch {
    return { name, present: true, valid: false, issue: "invalid-url" };
  }
}

async function readSupportDocPresence() {
  const docPath = path.join(cwd, "docs", "support", "CONTACT.md");
  try {
    const content = await fsp.readFile(docPath, "utf8");
    return {
      exists: true,
      hasEmail: /Support email:\s*\S+/i.test(content),
      hasUrl: /https?:\/\/\S+/i.test(content),
    };
  } catch {
    return { exists: false, hasEmail: false, hasUrl: false };
  }
}

async function fileExists(relativePath) {
  try {
    await fsp.access(path.join(cwd, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function newestInstaller() {
  const dir = path.join(cwd, "src-tauri", "target", "release", "bundle", "nsis");
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  const installers = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".exe")) continue;
    const filePath = path.join(dir, entry.name);
    const stat = await fsp.stat(filePath);
    installers.push({ name: entry.name, relativePath: path.relative(cwd, filePath), mtimeMs: stat.mtimeMs, bytes: stat.size });
  }
  installers.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return installers[0] ?? null;
}

const loadedEnvFiles = [
  [".env.production", loadDotEnv(path.join(cwd, ".env.production"))],
  [".env", loadDotEnv(path.join(cwd, ".env"))],
].filter(([, loaded]) => loaded).map(([name]) => name);

const gatewayRequired = ["CLAWDESK_GATEWAY_BASE_URL"];
const lemonRequired = [
  "LEMON_SQUEEZY_WEBHOOK_SECRET",
  "LEMON_SQUEEZY_STORE_ID",
  "LEMON_SQUEEZY_PRODUCT_ID",
  "LEMON_SQUEEZY_VARIANT_ID_PRO_YEARLY",
  "LEMON_SQUEEZY_VARIANT_ID_LIFETIME",
];
const supportRequiredAny = ["CLAWDESK_SUPPORT_EMAIL", "CLAWDESK_SUPPORT_URL"];
const pfxSigning = ["WINDOWS_SIGNING_CERTIFICATE", "WINDOWS_SIGNING_CERTIFICATE_PASSWORD"];
const subjectSigning = ["WINDOWS_SIGNING_CERTIFICATE_SUBJECT"];
const trustedSigning = [
  "AZURE_TRUSTED_SIGNING_ACCOUNT_NAME",
  "AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME",
  "AZURE_TRUSTED_SIGNING_ENDPOINT",
];

const gatewayUrl = urlStatus("CLAWDESK_GATEWAY_BASE_URL", { rejectHomepageHost: "clawdesk.example" });
const supportDoc = await readSupportDocPresence();
const supportOk = supportRequiredAny.some((name) => Boolean(process.env[name])) || supportDoc.hasEmail || supportDoc.hasUrl;
const pfxOk = pfxSigning.every((name) => Boolean(process.env[name]));
const subjectOk = subjectSigning.every((name) => Boolean(process.env[name]));
const trustedOk = trustedSigning.every((name) => Boolean(process.env[name]));
const signingOk = pfxOk || subjectOk || trustedOk;
const installer = await newestInstaller();
const sbom = {
  npm: await fileExists("artifacts/sbom/npm-sbom.json"),
  cargo: await fileExists("artifacts/sbom/cargo-sbom.json"),
};

const blockers = [
  ...missing(gatewayRequired).map((name) => `missing:${name}`),
  ...missing(lemonRequired).map((name) => `missing:${name}`),
  ...(gatewayUrl.present && !gatewayUrl.valid ? [`invalid:${gatewayUrl.name}:${gatewayUrl.issue ?? gatewayUrl.issues?.join(",")}`] : []),
  ...(supportOk ? [] : ["missing:any-of:CLAWDESK_SUPPORT_EMAIL,CLAWDESK_SUPPORT_URL,docs/support/CONTACT.md"]),
  ...(signingOk ? [] : ["missing:any-signing-method:WINDOWS_SIGNING_CERTIFICATE+WINDOWS_SIGNING_CERTIFICATE_PASSWORD or WINDOWS_SIGNING_CERTIFICATE_SUBJECT or AZURE_TRUSTED_SIGNING_*"]),
  ...(installer ? [] : ["missing:nsis-installer-artifact"]),
  ...(sbom.npm && sbom.cargo ? [] : ["missing:sbom-artifacts"]),
];

const report = {
  createdAt: new Date().toISOString(),
  result: blockers.length === 0 ? "PASS" : "BLOCKED",
  loadedEnvFiles,
  envPresence: {
    gateway: envPresent(gatewayRequired),
    lemon: envPresent(lemonRequired),
    support: envPresent(supportRequiredAny),
    signing: {
      pfx: envPresent(pfxSigning),
      subject: envPresent(subjectSigning),
      trustedSigning: envPresent(trustedSigning),
    },
    optional: envPresent(["CLAWDESK_GATEWAY_WS_URL", "CLAWDESK_SSO_ISSUER_URL", "CLAWDESK_SSO_CLIENT_ID"]),
  },
  gateway: gatewayUrl,
  support: {
    ok: supportOk,
    doc: supportDoc,
  },
  signing: {
    ok: signingOk,
    pfxOk,
    subjectOk,
    trustedOk,
    missingPfx: missing(pfxSigning),
    missingSubject: missing(subjectSigning),
    missingTrusted: missing(trustedSigning),
  },
  artifacts: {
    installer,
    sbom,
  },
  blockers,
  nextActions: blockers.length === 0
    ? ["Run npm run sign:win:doctor, npm run sign:win-installer, then npm run release:guard:beta."]
    : [
        "Fill the missing keys in .env.production or the current shell environment.",
        "Build the installer with npm run tauri:build:win if the NSIS artifact is missing.",
        "Generate SBOM artifacts with npm run sbom if SBOM is missing.",
      ],
};

const reportDir = path.join(cwd, "artifacts", "beta-direct-env");
await fsp.mkdir(reportDir, { recursive: true });
const reportPath = path.join(reportDir, `${new Date().toISOString().replace(/[:.]/g, "_")}-beta-direct-env.json`);
await fsp.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(`Beta direct env report: ${reportPath}`);
console.log(`Result: ${report.result}`);
if (loadedEnvFiles.length > 0) console.log(`Loaded env files: ${loadedEnvFiles.join(", ")}`);
if (blockers.length > 0) {
  console.log("Blockers:");
  for (const blocker of blockers) console.log(`- ${blocker}`);
}

process.exitCode = blockers.length === 0 ? 0 : 1;
