import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const cwd = process.cwd();
const reportDir = path.join(cwd, "artifacts", "windows-signing");

function loadDotEnv(filePath) {
  if (!fsSync.existsSync(filePath)) return false;
  const lines = fsSync.readFileSync(filePath, "utf8").split(/\r?\n/);
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

function run(command, args) {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    windowsHide: process.platform === "win32",
  });
}

async function windowsKitSignTool() {
  if (process.platform !== "win32") return null;
  const roots = [
    process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"], "Windows Kits", "10", "bin") : null,
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "Windows Kits", "10", "bin") : null,
  ].filter(Boolean);

  const candidates = [];
  for (const root of roots) {
    const versions = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    for (const version of versions) {
      if (!version.isDirectory()) continue;
      for (const arch of ["x64", "x86"]) {
        const filePath = path.join(root, version.name, arch, "signtool.exe");
        const stat = await fs.stat(filePath).catch(() => null);
        if (stat?.isFile()) candidates.push({ filePath, version: version.name, arch });
      }
    }
  }

  candidates.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
  return candidates[0] ?? null;
}

async function newestInstaller() {
  const dir = path.join(cwd, "src-tauri", "target", "release", "bundle", "nsis");
  const files = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const installers = [];
  for (const file of files) {
    if (!file.isFile() || !file.name.toLowerCase().endsWith(".exe")) continue;
    const filePath = path.join(dir, file.name);
    const stat = await fs.stat(filePath);
    installers.push({ filePath, mtimeMs: stat.mtimeMs });
  }
  installers.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return installers[0]?.filePath ?? null;
}

function envPresence(names) {
  return Object.fromEntries(names.map((name) => [name, Boolean(process.env[name])]));
}

function redactPath(value) {
  if (!value) return "";
  const parsed = path.parse(value);
  return `${parsed.root || ""}...${path.sep}${path.basename(value)}`;
}

function certificateSubjectExists(subject) {
  if (process.platform !== "win32" || !subject) return { checked: false, found: false };
  const escaped = subject.replace(/'/g, "''");
  const result = run("powershell.exe", [
    "-NoProfile",
    "-Command",
    `$subject='${escaped}'; $certs = @(Get-ChildItem Cert:\\CurrentUser\\My, Cert:\\LocalMachine\\My -ErrorAction SilentlyContinue | Where-Object { $_.Subject -like "*$subject*" -or $_.FriendlyName -like "*$subject*" }); if ($certs.Count -gt 0) { 'FOUND' } else { 'NOT_FOUND' }`,
  ]);
  return {
    checked: true,
    found: result.status === 0 && result.stdout.includes("FOUND"),
    status: result.status,
  };
}

const loadedEnvFiles = [
  [".env.production", loadDotEnv(path.join(cwd, ".env.production"))],
  [".env", loadDotEnv(path.join(cwd, ".env"))],
].filter(([, loaded]) => loaded).map(([name]) => name);

const whereSigntool = process.platform === "win32" ? run("where.exe", ["signtool.exe"]) : { status: 1, stdout: "" };
const pathSigntool =
  whereSigntool.status === 0
    ? whereSigntool.stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => line.toLowerCase().endsWith("signtool.exe"))
    : null;
const kitSigntool = pathSigntool ? null : await windowsKitSignTool();
const installer = await newestInstaller();

const traditionalEnv = envPresence(["WINDOWS_SIGNING_CERTIFICATE", "WINDOWS_SIGNING_CERTIFICATE_PASSWORD", "WINDOWS_SIGNING_CERTIFICATE_SUBJECT"]);
const trustedSigningEnv = envPresence([
  "AZURE_TRUSTED_SIGNING_ACCOUNT_NAME",
  "AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME",
  "AZURE_TRUSTED_SIGNING_ENDPOINT",
]);
const hasPfxSigning = Boolean(process.env.WINDOWS_SIGNING_CERTIFICATE && process.env.WINDOWS_SIGNING_CERTIFICATE_PASSWORD);
const hasSubjectSigning = Boolean(process.env.WINDOWS_SIGNING_CERTIFICATE_SUBJECT);
const hasTrustedSigning = Object.values(trustedSigningEnv).every(Boolean);
const signingMethods = [
  hasPfxSigning ? "pfx" : null,
  hasSubjectSigning ? "certificate-store" : null,
  hasTrustedSigning ? "azure-trusted-signing" : null,
].filter(Boolean);
const signtoolPath = pathSigntool ?? kitSigntool?.filePath ?? null;
const pfxPath = process.env.WINDOWS_SIGNING_CERTIFICATE ? path.resolve(process.env.WINDOWS_SIGNING_CERTIFICATE) : "";
const pfxExists = pfxPath ? fsSync.existsSync(pfxPath) : false;
const subjectLookup = certificateSubjectExists(process.env.WINDOWS_SIGNING_CERTIFICATE_SUBJECT);

const blockers = [];
if (!signtoolPath) blockers.push("signtool.exe not found. Install Windows SDK Signing Tools.");
if (signingMethods.length === 0) blockers.push("No Windows signing env found. Configure exactly one of PFX, certificate store subject, or Azure Trusted Signing.");
if (signingMethods.length > 1) blockers.push(`Multiple Windows signing methods configured (${signingMethods.join(", ")}). Configure exactly one to avoid signing the wrong artifact.`);
if (process.env.WINDOWS_SIGNING_CERTIFICATE && !process.env.WINDOWS_SIGNING_CERTIFICATE_PASSWORD) blockers.push("PFX signing requires WINDOWS_SIGNING_CERTIFICATE_PASSWORD.");
if (hasPfxSigning && !pfxExists) blockers.push("WINDOWS_SIGNING_CERTIFICATE path does not exist.");
if (hasSubjectSigning && subjectLookup.checked && !subjectLookup.found) blockers.push("WINDOWS_SIGNING_CERTIFICATE_SUBJECT was not found in CurrentUser/My or LocalMachine/My certificate stores.");
if (!installer) blockers.push("No NSIS installer found. Run npm run tauri:build:win first.");

const nextActions = [];
if (!signtoolPath) nextActions.push("Install Windows SDK Signing Tools so signtool.exe is available.");
if (signingMethods.length === 0) {
  nextActions.push("Choose one signing method: PFX, Windows certificate store subject, or Azure Trusted Signing.");
}
if (signingMethods.length > 1) {
  nextActions.push("Remove extra signing env vars so only one signing method remains configured.");
}
if (process.env.WINDOWS_SIGNING_CERTIFICATE && !process.env.WINDOWS_SIGNING_CERTIFICATE_PASSWORD) {
  nextActions.push("Set WINDOWS_SIGNING_CERTIFICATE_PASSWORD for the PFX file.");
}
if (hasPfxSigning && !pfxExists) {
  nextActions.push("Move the PFX outside the repo and set WINDOWS_SIGNING_CERTIFICATE to its real absolute path.");
}
if (hasSubjectSigning && subjectLookup.checked && !subjectLookup.found) {
  nextActions.push("Install the code signing certificate into CurrentUser/My or LocalMachine/My, or correct WINDOWS_SIGNING_CERTIFICATE_SUBJECT.");
}
if (!installer) nextActions.push("Build the NSIS installer with npm run tauri:build:win before signing.");
if (blockers.length === 0) {
  if (hasTrustedSigning) {
    nextActions.push("Azure Trusted Signing env is complete; sign in CI or Azure signing workflow, then run npm run release:metadata:win:check -- --require-signature.");
  } else {
    nextActions.push("Run npm run sign:win-installer, then npm run release:metadata:win and npm run smoke:win-installer -- --no-build --require-signature.");
  }
}

const report = {
  result: blockers.length === 0 ? "PASS" : "BLOCKED",
  platform: process.platform,
  loadedEnvFiles,
  signtool: signtoolPath ? { found: true, path: signtoolPath, source: pathSigntool ? "PATH" : "Windows SDK" } : { found: false },
  installer,
  signingEnv: {
    traditional: traditionalEnv,
    trustedSigning: trustedSigningEnv,
    configuredMethods: signingMethods,
    hasPfxSigning,
    hasSubjectSigning,
    hasTrustedSigning,
    pfx: {
      configured: Boolean(process.env.WINDOWS_SIGNING_CERTIFICATE),
      path: redactPath(process.env.WINDOWS_SIGNING_CERTIFICATE),
      exists: pfxExists,
      passwordPresent: Boolean(process.env.WINDOWS_SIGNING_CERTIFICATE_PASSWORD),
    },
    certificateStore: {
      configured: hasSubjectSigning,
      subjectPresent: hasSubjectSigning,
      lookup: subjectLookup,
    },
  },
  blockers,
  nextActions,
};

await fs.mkdir(reportDir, { recursive: true });
const reportPath = path.join(reportDir, `${new Date().toISOString().replace(/[:.]/g, "_")}-signing-doctor.json`);
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(JSON.stringify(report, null, 2));
console.log(`Windows signing doctor report: ${reportPath}`);
process.exitCode = blockers.length === 0 ? 0 : 1;


