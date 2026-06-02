import fs from "node:fs/promises";
import path from "node:path";

const cwd = process.cwd();
const outDir = path.join(cwd, "artifacts", "lemon-onboarding");
const guiDir = path.join(cwd, "artifacts", "gui-smoke");

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function newestReport(dir, suffix = "-report.json") {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(suffix)) continue;
      const filePath = path.join(dir, entry.name);
      const stat = await fs.stat(filePath);
      files.push({ filePath, mtimeMs: stat.mtimeMs, name: entry.name });
    }
    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return files[0]?.filePath ?? "";
  } catch {
    return "";
  }
}

async function copyIfExists(src, dst) {
  try {
    await fs.copyFile(src, dst);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  await ensureDir(outDir);

  const preferredPng = ["01-login-before.png", "02-after-login.png", "03-after-flow.png"];
  const copied = [];
  for (const name of preferredPng) {
    const src = path.join(guiDir, name);
    const dst = path.join(outDir, name);
    if (await copyIfExists(src, dst)) copied.push(name);
  }

  const reportPairs = [
    ["qa-loop", await newestReport(path.join(cwd, "artifacts", "qa-loop"))],
    ["release-guard", await newestReport(path.join(cwd, "artifacts", "release-guard"))],
    ["win-app-smoke", await newestReport(path.join(cwd, "artifacts", "win-app-smoke"))],
    ["win-installer-smoke", await newestReport(path.join(cwd, "artifacts", "win-installer-smoke"))],
    ["production-gateway-sim", await newestReport(path.join(cwd, "artifacts", "production-gateway-sim"))],
  ];

  const copiedReports = [];
  for (const [name, src] of reportPairs) {
    if (!src) continue;
    const dst = path.join(outDir, `${name}.json`);
    if (await copyIfExists(src, dst)) copiedReports.push(path.basename(dst));
  }

  const reply = `Subject: Re: Your application has been received

Hi Lemon Squeezy Team,

Thank you for your message.

Please find the requested information below:

1) Product examples / demo
- Product: ClawDesk (Windows desktop AI workspace, OpenClaw-compatible workflow)
- Website: https://naviaworks.net/
- Product page draft: https://naviaworks.net/clawdesk
- Product category: downloadable Windows desktop productivity / AI workspace software
- Demo evidence package prepared locally:
  ${outDir}

2) Business URL / where we plan to sell
- Business website: https://naviaworks.net/
- Planned product page: https://naviaworks.net/clawdesk

Additional summary
- Target users: individual developers, independent workers, and small teams using Windows 11.
- Core capabilities: local workspace operations, guarded agent actions, model/provider setup, license handling, diagnostics export.
- Delivery: direct-download signed Windows NSIS installer.
- Payments and license keys: Lemon Squeezy hosted checkout and license key flow.
- Support contact: alison.ai.tech.studio@gmail.com

Best regards,
Huang Kuo Ling
Alisonsoftware
Support: alison.ai.tech.studio@gmail.com
`;

  await fs.writeFile(path.join(outDir, "lemon-reply-email.txt"), reply, "utf8");

  const productSetup = `# Lemon Squeezy Product Setup For ClawDesk

Use this checklist after Lemon Squeezy approves the store.

## Product

- Product name: ClawDesk
- Product type: Digital product / Software
- Delivery: Windows x64 NSIS installer download from https://naviaworks.net/
- Support email: alison.ai.tech.studio@gmail.com
- Public publisher/developer: Alisonsoftware

## Variants

Create exactly these first-release variants:

| Variant | Suggested price | Billing | Env key |
| --- | ---: | --- | --- |
| Pro Yearly | USD 79 | yearly subscription | LEMON_SQUEEZY_VARIANT_ID_PRO_YEARLY |
| Lifetime | USD 99 | one-time | LEMON_SQUEEZY_VARIANT_ID_LIFETIME |

## Required Env Values

Copy values from Lemon Squeezy into .env.production:

\`\`\`text
LEMON_SQUEEZY_STORE_ID=
LEMON_SQUEEZY_PRODUCT_ID=
LEMON_SQUEEZY_VARIANT_ID_PRO_YEARLY=
LEMON_SQUEEZY_VARIANT_ID_LIFETIME=
LEMON_SQUEEZY_WEBHOOK_SECRET=
\`\`\`

Do not put Lemon API keys in the desktop app. If an API key is needed, keep it server-side only.

## Webhook

Production URL:

\`\`\`text
https://api.naviaworks.net/webhooks/lemon
\`\`\`

Enable events:

- order_created
- subscription_created
- subscription_updated
- subscription_cancelled
- license_key_created
- refund_created

## Verification

After filling .env.production:

\`\`\`powershell
npm run beta:env:doctor
npm run verify:lemon:production
npm run beta:readiness
\`\`\`

The local production verification confirms unsigned webhooks are rejected, valid signatures are accepted, and refund/cancel events downgrade entitlement to safe-mode.
`;
  await fs.writeFile(path.join(outDir, "lemon-product-setup.md"), productSetup, "utf8");

  const webhookEvents = {
    webhookUrl: "https://api.naviaworks.net/webhooks/lemon",
    events: [
      "order_created",
      "subscription_created",
      "subscription_updated",
      "subscription_cancelled",
      "license_key_created",
      "refund_created",
    ],
    entitlementDowngradeEvents: ["subscription_cancelled", "refund_created"],
    localVerificationCommand: "npm run verify:lemon:production",
  };
  await fs.writeFile(path.join(outDir, "lemon-webhook-events.json"), `${JSON.stringify(webhookEvents, null, 2)}\n`, "utf8");

  const envChecklist = `# Lemon Env Checklist

These are presence-only release blockers. Never paste real values into chat or commit them.

- [ ] LEMON_SQUEEZY_STORE_ID
- [ ] LEMON_SQUEEZY_PRODUCT_ID
- [ ] LEMON_SQUEEZY_VARIANT_ID_PRO_YEARLY
- [ ] LEMON_SQUEEZY_VARIANT_ID_LIFETIME
- [ ] LEMON_SQUEEZY_WEBHOOK_SECRET

Validation:

\`\`\`powershell
npm run beta:env:doctor
npm run beta:readiness
\`\`\`
`;
  await fs.writeFile(path.join(outDir, "lemon-env-checklist.md"), envChecklist, "utf8");

  const index = `# Lemon Onboarding Evidence Pack

Generated at: ${new Date().toISOString()}

## Website
- https://naviaworks.net/
- https://naviaworks.net/clawdesk

## Screenshots
${copied.length > 0 ? copied.map((name) => `- ${name}`).join("\n") : "- (none copied)"}

## Reports
${copiedReports.length > 0 ? copiedReports.map((name) => `- ${name}`).join("\n") : "- (none copied)"}

## Email Draft
- lemon-reply-email.txt

## Setup Files
- lemon-product-setup.md
- lemon-webhook-events.json
- lemon-env-checklist.md
`;
  await fs.writeFile(path.join(outDir, "README.md"), index, "utf8");

  console.log(JSON.stringify({ result: "PASS", outDir, screenshots: copied, reports: copiedReports }, null, 2));
}

await main();
