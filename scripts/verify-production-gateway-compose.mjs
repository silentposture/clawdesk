import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const cwd = process.cwd();
const composeFile = "docker-compose.production-gateway.yml";
const reportDir = path.join(cwd, "artifacts", "production-gateway-compose");
const reportPath = path.join(reportDir, `${new Date().toISOString().replace(/[:.]/g, "_")}-report.json`);

function run(command, args) {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    windowsHide: process.platform === "win32",
  });
}

function dockerCompose(args) {
  const direct = run("docker", ["compose", ...args]);
  if (direct.status === 0 || !String(direct.stderr ?? "").includes("unknown command")) return direct;
  return run("docker-compose", args);
}

function redactOutput(value) {
  return String(value ?? "")
    .replace(/LEMON_SQUEEZY_[A-Z_]+=[^\s]+/g, "LEMON_SQUEEZY_[REDACTED]")
    .replace(/WINDOWS_SIGNING_[A-Z_]+=[^\s]+/g, "WINDOWS_SIGNING_[REDACTED]")
    .slice(0, 4000);
}

const checks = [];
function record(name, result, required = true) {
  const ok = result.status === 0;
  checks.push({
    name,
    required,
    ok,
    status: result.status,
    stdout: redactOutput(result.stdout),
    stderr: redactOutput(result.stderr),
  });
  return ok;
}

const dockerVersion = run("docker", ["--version"]);
record("docker-version", dockerVersion, false);

let composeConfigOk = false;
if (dockerVersion.status === 0) {
  composeConfigOk = record("compose-config", dockerCompose(["-f", composeFile, "config"]), true);
} else {
  checks.push({
    name: "compose-config",
    required: true,
    ok: false,
    status: null,
    stdout: "",
    stderr: "Docker CLI not found or Docker is not running.",
  });
}

const report = {
  createdAt: new Date().toISOString(),
  service: "verify-production-gateway-compose",
  composeFile,
  result: composeConfigOk ? "PASS" : "BLOCKED",
  checks,
  nextActions: composeConfigOk
    ? [
        "Deploy this compose file on the API host or VPS.",
        "Terminate TLS in a reverse proxy and point https://api.clawdesk.example to clawdesk-gateway:19130.",
        "Run npm run gateway:doctor after DNS/TLS is live.",
      ]
    : [
        "Install or start Docker Desktop, then rerun npm run verify:production-gateway:compose.",
        "If deploying on a remote Linux host, copy the repo plus .env.production and run docker compose -f docker-compose.production-gateway.yml config there.",
      ],
};

await fs.mkdir(reportDir, { recursive: true });
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(`Production Gateway compose report: ${reportPath}`);
console.log(`Result: ${report.result}`);
for (const check of checks) {
  console.log(`${check.ok ? "PASS" : check.required ? "BLOCKED" : "WARN"} ${check.name}`);
}

process.exitCode = composeConfigOk ? 0 : 1;


