import fs from "node:fs/promises";
import path from "node:path";

const cwd = process.cwd();
const outDir = path.join(cwd, "artifacts", "gateway-deploy");

async function copyFile(src, dst) {
  await fs.mkdir(path.dirname(dst), { recursive: true });
  await fs.copyFile(src, dst);
}

async function copyIfExists(src, dst, warnings) {
  try {
    await copyFile(src, dst);
    return true;
  } catch {
    warnings.push(`missing:${src}`);
    return false;
  }
}

const warnings = [];
const copied = [];

await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

for (const [src, dst] of [
  ["docker-compose.production-gateway.yml", "docker-compose.production-gateway.yml"],
  ["docker-compose.production-gateway.proxy.yml", "docker-compose.production-gateway.proxy.yml"],
  ["infra/nginx.production-gateway.conf", "infra/nginx.production-gateway.conf"],
  [".env.production.example", ".env.production.example"],
  ["docs/deploy/PRODUCTION_GATEWAY_DIRECT_BETA.md", "PRODUCTION_GATEWAY_DIRECT_BETA.md"],
]) {
  if (await copyIfExists(path.join(cwd, src), path.join(outDir, dst), warnings)) copied.push(dst);
}

await fs.mkdir(path.join(outDir, "infra", "certbot-www"), { recursive: true });
await fs.writeFile(path.join(outDir, "infra", "certbot-www", ".gitkeep"), "", "utf8");

const runbook = `# ClawDesk Gateway VPS Deploy Package

Target host: api.clawdesk.example

## 1. Copy Files

Upload this folder to the VPS, for example:

\`\`\`text
/opt/clawdesk-gateway
\`\`\`

Also copy the production repo files needed by \`backend/server.mjs\` and \`backend/production-gateway-sim.mjs\`, or deploy this package from the repo root.

## 2. Prepare .env.production

Copy:

\`\`\`powershell
cp .env.production.example .env.production
\`\`\`

Fill at least:

- CLAWDESK_GATEWAY_BASE_URL=https://api.clawdesk.example
- CLAWDESK_BACKEND_ADAPTER_MODE=production
- LEMON_SQUEEZY_WEBHOOK_SECRET
- LEMON_SQUEEZY_STORE_ID
- LEMON_SQUEEZY_PRODUCT_ID
- LEMON_SQUEEZY_VARIANT_ID_PRO_YEARLY
- LEMON_SQUEEZY_VARIANT_ID_LIFETIME
- CLAWDESK_SUPPORT_EMAIL

Do not commit or publish .env.production.

## 3. TLS Certificate

The proxy expects Let's Encrypt files at:

\`\`\`text
/etc/letsencrypt/live/api.clawdesk.example/fullchain.pem
/etc/letsencrypt/live/api.clawdesk.example/privkey.pem
\`\`\`

Obtain the certificate using your preferred method. Example on Linux with certbot standalone:

\`\`\`bash
sudo certbot certonly --standalone -d api.clawdesk.example
\`\`\`

## 4. Start Gateway

\`\`\`bash
docker compose -f docker-compose.production-gateway.yml -f docker-compose.production-gateway.proxy.yml config
docker compose -f docker-compose.production-gateway.yml -f docker-compose.production-gateway.proxy.yml up -d
\`\`\`

## 5. Verify From Development Machine

\`\`\`powershell
$env:CLAWDESK_GATEWAY_BASE_URL="https://api.clawdesk.example"
npm run gateway:doctor
npm run beta:readiness
\`\`\`

Expected public endpoints:

- https://api.clawdesk.example/health
- https://api.clawdesk.example/contract
- https://api.clawdesk.example/webhooks/license

`;

await fs.writeFile(path.join(outDir, "RUNBOOK.md"), runbook, "utf8");

const manifest = {
  createdAt: new Date().toISOString(),
  result: warnings.length > 0 ? "WARN" : "PASS",
  outDir,
  copied,
  warnings,
  targetHost: "api.clawdesk.example",
  publicUrl: "https://api.clawdesk.example",
};

await fs.writeFile(path.join(outDir, "gateway-deploy-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify(manifest, null, 2));
