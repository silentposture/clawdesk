import fs from "node:fs/promises";
import path from "node:path";

const cwd = process.cwd();
const outDir = path.join(cwd, "artifacts", "beta-handoff");

async function copyFile(src, dst) {
  await fs.mkdir(path.dirname(dst), { recursive: true });
  await fs.copyFile(src, dst);
}

async function copyDir(src, dst) {
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const source = path.join(src, entry.name);
    const target = path.join(dst, entry.name);
    if (entry.isDirectory()) await copyDir(source, target);
    else if (entry.isFile()) await copyFile(source, target);
  }
}

async function newestFile(dir, suffix) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(suffix)) continue;
    const filePath = path.join(dir, entry.name);
    const stat = await fs.stat(filePath);
    files.push({ filePath, name: entry.name, mtimeMs: stat.mtimeMs });
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files[0] ?? null;
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

const copied = [];
const warnings = [];

await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

for (const [src, dst] of [
  ["artifacts/website/clawdesk", "website/clawdesk"],
  ["artifacts/lemon-onboarding", "lemon-onboarding"],
]) {
  const absoluteSrc = path.join(cwd, src);
  try {
    await copyDir(absoluteSrc, path.join(outDir, dst));
    copied.push(dst);
  } catch {
    warnings.push(`missing:${src}`);
  }
}

for (const [src, dst] of [
  ["docs/deploy/PRODUCTION_GATEWAY_DIRECT_BETA.md", "docs/PRODUCTION_GATEWAY_DIRECT_BETA.md"],
  ["docs/windows/WINDOWS_SIGNING_SETUP.md", "docs/WINDOWS_SIGNING_SETUP.md"],
  ["docs/payments/LEMON_SQUEEZY_SETUP.md", "docs/LEMON_SQUEEZY_SETUP.md"],
  [".env.production.example", "env/.env.production.example"],
  ["docker-compose.production-gateway.yml", "deploy/docker-compose.production-gateway.yml"],
]) {
  try {
    await copyFile(path.join(cwd, src), path.join(outDir, dst));
    copied.push(dst);
  } catch {
    warnings.push(`missing:${src}`);
  }
}

const readiness = await newestFile(path.join(cwd, "artifacts", "beta-readiness"), "-beta-readiness.json");
if (readiness) {
  await copyFile(readiness.filePath, path.join(outDir, "reports", "latest-beta-readiness.json"));
  copied.push("reports/latest-beta-readiness.json");
} else {
  warnings.push("missing:artifacts/beta-readiness/*-beta-readiness.json");
}

const readinessReport = readiness ? await readJsonIfExists(readiness.filePath) : null;
const websiteManifest = await readJsonIfExists(path.join(cwd, "artifacts", "website", "clawdesk", "publish-manifest.json"));
const blockers = readinessReport?.blockers ?? [];
const signatureStatus = websiteManifest?.release?.signature ?? "unknown";

const actionPlan = `# ClawDesk Windows Direct Beta Handoff

Generated at: ${new Date().toISOString()}

## Current Status

- Readiness: ${readinessReport?.result ?? "UNKNOWN"}
- Website package: ${websiteManifest ? "prepared" : "missing"}
- Installer signature: ${signatureStatus}
- Microsoft Store: not part of first release gate

## Blocking Items

${blockers.length > 0 ? blockers.map((item) => `- ${item.label}: ${item.nextAction}`).join("\n") : "- none"}

## External Tasks To Complete

1. Lemon Squeezy
   - Reply with \`lemon-onboarding/lemon-reply-email.txt\`.
   - After approval, create ClawDesk product and variants from \`lemon-onboarding/lemon-product-setup.md\`.
   - Create webhook URL \`https://api.clawdesk.example/webhooks/license\`.
   - Fill \`LEMON_SQUEEZY_*\` values in \`.env.production\`.

2. Production Gateway
   - Deploy \`deploy/docker-compose.production-gateway.yml\` to the API host.
   - Point \`https://api.clawdesk.example\` to the Gateway through HTTPS reverse proxy.
   - Set \`CLAWDESK_GATEWAY_BASE_URL=https://api.clawdesk.example\`.

3. Windows signing
   - Choose exactly one method from \`docs/WINDOWS_SIGNING_SETUP.md\`.
   - Run \`npm run sign:win:doctor\`.
   - Sign installer, regenerate metadata, and verify signature.

4. Website
   - Upload \`website/clawdesk/\` to \`https://clawdesk.example/clawdesk/\`.
   - Do not publish as paid Beta until installer signature is \`valid\` and \`npm run beta:readiness:check\` passes.

## Final Commands After External Tasks

\`\`\`powershell
npm run beta:env:doctor
npm run gateway:doctor
npm run sign:win:doctor
npm run sign:win-installer
npm run release:metadata:win
npm run website:prepare
npm run beta:readiness:check
\`\`\`
`;

await fs.writeFile(path.join(outDir, "ACTION_PLAN.md"), actionPlan, "utf8");

const manifest = {
  createdAt: new Date().toISOString(),
  result: warnings.length > 0 ? "WARN" : "PASS",
  outDir,
  copied,
  warnings,
  readiness: readinessReport
    ? {
        result: readinessReport.result,
        blocked: readinessReport.summary?.blocked,
        passed: readinessReport.summary?.passed,
        blockers,
      }
    : null,
  website: websiteManifest
    ? {
        publishTarget: websiteManifest.publishTarget,
        signature: websiteManifest.release?.signature,
        installer: websiteManifest.release?.installer,
      }
    : null,
};

await fs.writeFile(path.join(outDir, "handoff-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify(manifest, null, 2));
