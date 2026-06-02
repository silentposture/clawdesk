import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const cwd = process.cwd();
const bundleDir = path.join(cwd, "src-tauri", "target", "release", "bundle", "nsis");
const metadataDir = path.join(cwd, "artifacts", "windows-release");
const metadataPath = path.join(metadataDir, "latest-windows-beta.json");
const htmlPath = path.join(cwd, "docs", "download", "beta-windows.html");
const packageJson = JSON.parse(await fs.readFile(path.join(cwd, "package.json"), "utf8"));
const checkOnly = process.argv.includes("--check");
const requireSignature = process.argv.includes("--require-signature");
const updateDownloadPage = !process.argv.includes("--no-update-download-page");

function commandInvocation(command, args) {
  if (process.platform !== "win32") return { command, args };
  if (command.endsWith(".exe")) return { command, args };
  const cmdCommand = command.endsWith(".cmd") ? command : `${command}.cmd`;
  return { command: "cmd.exe", args: ["/d", "/s", "/c", cmdCommand, ...args] };
}

function run(command, args) {
  const invocation = commandInvocation(command, args);
  return spawnSync(invocation.command, invocation.args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    windowsHide: process.platform === "win32",
  });
}

async function newestInstaller() {
  const entries = await fs.readdir(bundleDir, { withFileTypes: true }).catch(() => []);
  const installers = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".exe")) continue;
    const filePath = path.join(bundleDir, entry.name);
    const stat = await fs.stat(filePath);
    installers.push({ name: entry.name, filePath, relativePath: path.relative(cwd, filePath), bytes: stat.size, mtimeMs: stat.mtimeMs });
  }
  installers.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return installers[0] ?? null;
}

async function sha256(filePath) {
  const buffer = await fs.readFile(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}

async function findSigntool() {
  if (process.platform !== "win32") return null;
  const where = run("where.exe", ["signtool.exe"]);
  if (where.status === 0) {
    const found = where.stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => line.toLowerCase().endsWith("signtool.exe"));
    if (found) return found;
  }
  const roots = [
    process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"], "Windows Kits", "10", "bin") : null,
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "Windows Kits", "10", "bin") : null,
  ].filter(Boolean);
  const candidates = [];
  for (const root of roots) {
    const versions = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    for (const version of versions) {
      if (!version.isDirectory()) continue;
      const filePath = path.join(root, version.name, "x64", "signtool.exe");
      const stat = await fs.stat(filePath).catch(() => null);
      if (stat?.isFile()) candidates.push({ filePath, version: version.name });
    }
  }
  candidates.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
  return candidates[0]?.filePath ?? null;
}

async function verifySignature(filePath) {
  const signtool = await findSigntool();
  if (!signtool) return { status: "unknown", signtool: null, reason: "signtool-not-found" };
  const result = run(signtool, ["verify", "/pa", "/v", filePath]);
  return {
    status: result.status === 0 ? "valid" : "invalid",
    signtool,
    stdout: result.stdout.slice(0, 2000),
    stderr: result.stderr.slice(0, 2000),
  };
}

function replaceDefinition(html, term, value) {
  const pattern = new RegExp(`(<dt>${term}</dt>\\s*<dd>)([\\s\\S]*?)(</dd>)`, "i");
  if (!pattern.test(html)) return html;
  return html.replace(pattern, `$1${value}$3`);
}

async function renderDownloadPage(metadata) {
  let html = await fs.readFile(htmlPath, "utf8");
  html = replaceDefinition(html, "Version", metadata.version);
  html = replaceDefinition(html, "Installer", metadata.installer.fileName);
  html = replaceDefinition(html, "SHA256", metadata.installer.sha256);
  html = replaceDefinition(html, "Updated", metadata.updatedDate);
  html = replaceDefinition(html, "Signature", metadata.installer.signature.status);
  html = html.replace(/href="\.\/ClawDesk_[^"]+?\.exe"/i, `href="./${metadata.installer.fileName}"`);
  if (!/<dt>Signature<\/dt>/i.test(html)) {
    html = html.replace(
      /(<dt>SHA256<\/dt>\s*<dd>[\s\S]*?<\/dd>)/i,
      `$1\n        <dt>Signature</dt>\n        <dd>${metadata.installer.signature.status}</dd>`,
    );
  }
  await fs.writeFile(htmlPath, html, "utf8");
}

const installer = await newestInstaller();
if (!installer) {
  console.error(`No NSIS installer found under ${bundleDir}`);
  process.exit(1);
}

const signature = await verifySignature(installer.filePath);
const metadata = {
  createdAt: new Date().toISOString(),
  productName: "ClawDesk",
  channel: "beta-direct",
  version: packageJson.version,
  updatedDate: new Date().toISOString().slice(0, 10),
  developer: "ClawDesk Contributors",
  supportEmail: "support@clawdesk.example",
  installer: {
    fileName: installer.name,
    relativePath: installer.relativePath.replace(/\\/g, "/"),
    bytes: installer.bytes,
    sha256: await sha256(installer.filePath),
    signature,
  },
  legal: [
    "docs/legal/EULA.md",
    "docs/legal/PRIVACY.md",
    "docs/legal/REFUND_POLICY.md",
    "docs/legal/DIGITAL_CONTENT_WAIVER.md",
    "docs/legal/AI_AGENT_RISK_NOTICE.md",
    "docs/legal/OPENCLAW_MIT_NOTICE.md",
    "docs/legal/THIRD_PARTY_NOTICES.md",
  ],
};

function stableMetadataForCheck(input) {
  return {
    productName: input.productName,
    channel: input.channel,
    version: input.version,
    developer: input.developer,
    supportEmail: input.supportEmail,
    installer: {
      fileName: input.installer?.fileName,
      relativePath: input.installer?.relativePath,
      bytes: input.installer?.bytes,
      sha256: input.installer?.sha256,
      signatureStatus: input.installer?.signature?.status,
    },
    legal: input.legal,
  };
}

const failures = [];
if (!metadata.installer.fileName.includes("ClawDesk")) failures.push("installer-name-missing-product");
if (!metadata.installer.fileName.includes(metadata.version)) failures.push("installer-name-missing-version");
if (metadata.installer.bytes < 1024 * 1024) failures.push("installer-too-small");
if (requireSignature && metadata.installer.signature.status !== "valid") failures.push("signature-invalid");

await fs.mkdir(metadataDir, { recursive: true });

if (checkOnly) {
  const existing = JSON.parse(await fs.readFile(metadataPath, "utf8").catch(() => "{}"));
  if (JSON.stringify(stableMetadataForCheck(existing), null, 2) !== JSON.stringify(stableMetadataForCheck(metadata), null, 2)) {
    failures.push("metadata-stale");
  }
} else {
  await fs.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  if (updateDownloadPage) await renderDownloadPage(metadata);
}

console.log(`Windows release metadata: ${metadataPath}`);
console.log(`Installer: ${metadata.installer.fileName}`);
console.log(`SHA256: ${metadata.installer.sha256}`);
console.log(`Signature: ${metadata.installer.signature.status}`);
if (failures.length > 0) {
  console.error(`Failures: ${failures.join(", ")}`);
  process.exitCode = 1;
}


