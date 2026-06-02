import { spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const cwd = process.cwd();
const failOnBlocked = process.argv.includes("--fail-on-blocked");
const reportDir = path.join(cwd, "artifacts", "beta-readiness");
const createdAt = new Date().toISOString();
const baseName = createdAt.replace(/[:.]/g, "_");

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

function commandInvocation(command, args) {
  if (process.platform !== "win32") return { command, args };
  if (command.endsWith(".exe")) return { command, args };
  if (command === "node") return { command: "node.exe", args };
  const cmdCommand = command.endsWith(".cmd") ? command : `${command}.cmd`;
  return { command: "cmd.exe", args: ["/d", "/s", "/c", cmdCommand, ...args] };
}

function redact(value) {
  return String(value ?? "")
    .replace(/(LEMON_SQUEEZY_WEBHOOK_SECRET(?:=|:\s*))([^\s",]+)/g, "$1[REDACTED]")
    .replace(/(WINDOWS_SIGNING_CERTIFICATE_PASSWORD(?:=|:\s*))([^\s",]+)/g, "$1[REDACTED]")
    .replace(/(LEMON_SQUEEZY_API_KEY(?:=|:\s*))([^\s",]+)/g, "$1[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "sk-[REDACTED]")
    .slice(0, 6000);
}

function runStep(step) {
  const invocation = commandInvocation(step.command, step.args);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    windowsHide: process.platform === "win32",
    timeout: step.timeoutMs ?? 120_000,
    env: process.env,
  });
  const ok = result.status === 0;
  return {
    id: step.id,
    label: step.label,
    requiredForBeta: step.requiredForBeta,
    command: `${step.command} ${step.args.join(" ")}`,
    status: ok ? "PASS" : step.requiredForBeta ? "BLOCKED" : "WARN",
    ok,
    exitCode: result.status,
    stdout: redact(result.stdout),
    stderr: redact(result.stderr || result.error?.message || ""),
    nextAction: ok ? "" : step.nextAction,
  };
}

function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderHtml(report) {
  const rows = report.steps.map((step) => `
        <tr>
          <td>${htmlEscape(step.label)}</td>
          <td><span class="badge ${step.status.toLowerCase()}">${htmlEscape(step.status)}</span></td>
          <td>${step.requiredForBeta ? "Yes" : "No"}</td>
          <td><code>${htmlEscape(step.command)}</code></td>
          <td>${htmlEscape(step.nextAction || "Done")}</td>
        </tr>`).join("");

  const blockers = report.blockers.length > 0
    ? report.blockers.map((item) => `<li>${htmlEscape(item.label)}: ${htmlEscape(item.nextAction)}</li>`).join("")
    : "<li>No blocking items.</li>";

  return `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ClawDesk Beta Readiness Report</title>
    <style>
      body { margin: 0; background: #f7f9fb; color: #1b2430; font-family: "Segoe UI", "Noto Sans TC", sans-serif; line-height: 1.55; }
      main { width: min(1120px, calc(100% - 32px)); margin: 0 auto; padding: 36px 0; }
      h1 { margin: 0 0 8px; font-size: 34px; letter-spacing: 0; }
      .summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 24px 0; }
      .card { background: white; border: 1px solid #d9e0e8; border-radius: 8px; padding: 16px; }
      .metric { display: block; font-size: 26px; font-weight: 700; }
      table { width: 100%; border-collapse: collapse; background: white; border: 1px solid #d9e0e8; border-radius: 8px; overflow: hidden; }
      th, td { padding: 10px 12px; border-bottom: 1px solid #d9e0e8; text-align: left; vertical-align: top; font-size: 14px; }
      th { background: #edf3f8; }
      code { overflow-wrap: anywhere; }
      .badge { display: inline-block; min-width: 76px; padding: 3px 8px; border-radius: 999px; text-align: center; font-weight: 700; font-size: 12px; }
      .pass { background: #dcfce7; color: #166534; }
      .blocked { background: #fee2e2; color: #991b1b; }
      .warn { background: #fef3c7; color: #92400e; }
      ul { background: white; border: 1px solid #d9e0e8; border-radius: 8px; padding: 16px 24px; }
      @media (max-width: 820px) { .summary { grid-template-columns: 1fr; } table { display: block; overflow-x: auto; } }
    </style>
  </head>
  <body>
    <main>
      <h1>ClawDesk Windows Direct Beta Readiness</h1>
      <p>Created at ${htmlEscape(report.createdAt)}. This report redacts secrets and does not run Microsoft Store gates.</p>
      <section class="summary">
        <div class="card"><span class="metric">${htmlEscape(report.result)}</span>Overall</div>
        <div class="card"><span class="metric">${report.summary.passed}</span>Passed</div>
        <div class="card"><span class="metric">${report.summary.blocked}</span>Blocked</div>
        <div class="card"><span class="metric">${report.summary.warned}</span>Warnings</div>
      </section>
      <h2>Blocking Items</h2>
      <ul>${blockers}</ul>
      <h2>Gate Results</h2>
      <table>
        <thead><tr><th>Gate</th><th>Status</th><th>Required</th><th>Command</th><th>Next Action</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </main>
  </body>
</html>
`;
}

const loadedEnvFiles = [
  [".env.production", loadDotEnv(path.join(cwd, ".env.production"))],
  [".env", loadDotEnv(path.join(cwd, ".env"))],
].filter(([, loaded]) => loaded).map(([name]) => name);

if (!process.env.CLAWDESK_RELEASE_CHANNEL) process.env.CLAWDESK_RELEASE_CHANNEL = "beta-direct";

const steps = [
  {
    id: "env",
    label: "Direct Beta environment",
    command: "npm",
    args: ["run", "beta:env:doctor"],
    requiredForBeta: true,
    nextAction: "Fill missing .env.production keys for Gateway, Lemon, signing, installer, and SBOM.",
  },
  {
    id: "gateway",
    label: "Production Gateway endpoint",
    command: "npm",
    args: ["run", "gateway:doctor"],
    requiredForBeta: true,
    nextAction: "Point CLAWDESK_GATEWAY_BASE_URL to an HTTPS API host such as https://api.clawdesk.example.",
  },
  {
    id: "gateway-compose",
    label: "Production Gateway compose",
    command: "npm",
    args: ["run", "verify:production-gateway:compose"],
    requiredForBeta: true,
    nextAction: "Install/start Docker or fix docker-compose.production-gateway.yml.",
  },
  {
    id: "lemon-contract",
    label: "Lemon production contract",
    command: "npm",
    args: ["run", "verify:lemon:production"],
    requiredForBeta: true,
    nextAction: "Fix Lemon webhook signature or refund/cancel downgrade contract.",
  },
  {
    id: "signing-doctor",
    label: "Windows signing environment",
    command: "npm",
    args: ["run", "sign:win:doctor"],
    requiredForBeta: true,
    nextAction: "Configure WINDOWS_SIGNING_* or AZURE_TRUSTED_SIGNING_*.",
  },
  {
    id: "metadata",
    label: "Installer metadata and SHA256",
    command: "npm",
    args: ["run", "release:metadata:win:check"],
    requiredForBeta: true,
    nextAction: "Run npm run release:metadata:win after building/signing installer.",
  },
  {
    id: "metadata-signature",
    label: "Installer signature metadata",
    command: "npm",
    args: ["run", "release:metadata:win:check", "--", "--require-signature"],
    requiredForBeta: true,
    nextAction: "Sign the NSIS installer, then regenerate release metadata.",
  },
  {
    id: "release-guard-beta",
    label: "Beta release guard",
    command: "npm",
    args: ["run", "release:guard:beta"],
    requiredForBeta: true,
    nextAction: "Close all release guard blockers before public paid Beta.",
  },
  {
    id: "preflight",
    label: "Repo preflight",
    command: "npm",
    args: ["run", "preflight"],
    requiredForBeta: true,
    nextAction: "Fix stale legal/i18n/release config preflight failures.",
  },
];

const results = steps.map(runStep);
const blockers = results.filter((step) => step.requiredForBeta && step.status === "BLOCKED");
const warned = results.filter((step) => step.status === "WARN");
const report = {
  createdAt,
  releaseTarget: "windows-direct-download-beta",
  microsoftStoreGate: false,
  loadedEnvFiles,
  result: blockers.length === 0 ? "READY" : "BLOCKED",
  summary: {
    total: results.length,
    passed: results.filter((step) => step.status === "PASS").length,
    blocked: blockers.length,
    warned: warned.length,
  },
  blockers: blockers.map((step) => ({
    id: step.id,
    label: step.label,
    command: step.command,
    nextAction: step.nextAction,
  })),
  steps: results,
};

await fsp.mkdir(reportDir, { recursive: true });
const jsonPath = path.join(reportDir, `${baseName}-beta-readiness.json`);
const htmlPath = path.join(reportDir, `${baseName}-beta-readiness.html`);
await fsp.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await fsp.writeFile(htmlPath, renderHtml(report), "utf8");

console.log(`Beta readiness JSON: ${jsonPath}`);
console.log(`Beta readiness HTML: ${htmlPath}`);
console.log(`Result: ${report.result}`);
if (report.blockers.length > 0) {
  console.log("Blockers:");
  for (const blocker of report.blockers) console.log(`- ${blocker.label}: ${blocker.nextAction}`);
}

if (failOnBlocked && report.result !== "READY") process.exitCode = 1;


