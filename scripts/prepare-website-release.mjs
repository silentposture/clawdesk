import fs from "node:fs/promises";
import path from "node:path";

const cwd = process.cwd();
const outDir = path.join(cwd, "artifacts", "website", "clawdesk");
const metadataPath = path.join(cwd, "artifacts", "windows-release", "latest-windows-beta.json");

async function copyFile(src, dst) {
  await fs.mkdir(path.dirname(dst), { recursive: true });
  await fs.copyFile(src, dst);
}

async function copyIfExists(src, dst) {
  try {
    await copyFile(src, dst);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function transformDownloadPage() {
  const src = path.join(cwd, "docs", "download", "beta-windows.html");
  let html = await fs.readFile(src, "utf8");
  html = html
    .replaceAll('href="../legal/', 'href="./legal/')
    .replaceAll('href="../support/', 'href="./support/');
  await fs.writeFile(path.join(outDir, "index.html"), html, "utf8");
}

const metadata = await readJson(metadataPath);
const copied = [];
const warnings = [];

await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

await transformDownloadPage();
copied.push("index.html");

for (const [src, dst] of [
  ["docs/download/FAQ.md", "FAQ.md"],
  ["docs/support/CONTACT.md", "support/CONTACT.md"],
  ["docs/support/AUTO_REPLY_TEMPLATE.txt", "support/AUTO_REPLY_TEMPLATE.txt"],
  ["docs/legal/EULA.md", "legal/EULA.md"],
  ["docs/legal/DEVELOPER_DISCLOSURE.md", "legal/DEVELOPER_DISCLOSURE.md"],
  ["docs/legal/PRIVACY.md", "legal/PRIVACY.md"],
  ["docs/legal/REFUND_POLICY.md", "legal/REFUND_POLICY.md"],
  ["docs/legal/DIGITAL_CONTENT_WAIVER.md", "legal/DIGITAL_CONTENT_WAIVER.md"],
  ["docs/legal/AI_AGENT_RISK_NOTICE.md", "legal/AI_AGENT_RISK_NOTICE.md"],
  ["docs/legal/OPENCLAW_MIT_NOTICE.md", "legal/OPENCLAW_MIT_NOTICE.md"],
  ["docs/legal/THIRD_PARTY_NOTICES.md", "legal/THIRD_PARTY_NOTICES.md"],
]) {
  if (await copyIfExists(path.join(cwd, src), path.join(outDir, dst))) copied.push(dst);
  else warnings.push(`missing:${src}`);
}

await fs.writeFile(path.join(outDir, "latest-windows-beta.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
copied.push("latest-windows-beta.json");

const installerSource = path.join(cwd, metadata.installer.relativePath);
const installerTarget = path.join(outDir, metadata.installer.fileName);
if (await copyIfExists(installerSource, installerTarget)) copied.push(metadata.installer.fileName);
else warnings.push(`missing-installer:${metadata.installer.relativePath}`);

if (metadata.installer.signature.status !== "valid") {
  warnings.push(`signature-${metadata.installer.signature.status}:do-not-publish-paid-beta`);
}

const manifest = {
  createdAt: new Date().toISOString(),
  publishTarget: "https://clawdesk.example/clawdesk/",
  sourceMetadata: "artifacts/windows-release/latest-windows-beta.json",
  copied,
  warnings,
  release: {
    version: metadata.version,
    installer: metadata.installer.fileName,
    sha256: metadata.installer.sha256,
    signature: metadata.installer.signature.status,
  },
};

await fs.writeFile(path.join(outDir, "publish-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
await fs.writeFile(
  path.join(outDir, "README_UPLOAD.md"),
  `# ClawDesk Website Upload Package

Upload this folder's contents to:

\`\`\`text
https://clawdesk.example/clawdesk/
\`\`\`

Entry point:

\`\`\`text
index.html
\`\`\`

Installer:

\`\`\`text
${metadata.installer.fileName}
\`\`\`

SHA256:

\`\`\`text
${metadata.installer.sha256}
\`\`\`

Signature status:

\`\`\`text
${metadata.installer.signature.status}
\`\`\`

Warnings:

${warnings.length > 0 ? warnings.map((item) => `- ${item}`).join("\n") : "- none"}

Do not publish as a paid Beta while signature status is not \`valid\`.
`,
  "utf8",
);
copied.push("README_UPLOAD.md", "publish-manifest.json");

console.log(JSON.stringify({ result: warnings.length > 0 ? "WARN" : "PASS", outDir, copied, warnings }, null, 2));
