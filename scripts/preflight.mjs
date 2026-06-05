import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";

const reportDir = path.join(process.cwd(), "artifacts", "preflight");
const requiredPaths = [
  "package.json",
  "package-lock.json",
  "src/App.tsx",
  "src/lib/tauri.ts",
  "scripts/qa-loop.mjs",
  "scripts/generate-legal-consent.mjs",
  "scripts/generate-third-party-notices.mjs",
  "scripts/generate-sbom.mjs",
  "scripts/generate-windows-release-metadata.mjs",
  "scripts/audit-i18n-literals.mjs",
  "scripts/enforce-hidden-window-policy.mjs",
  "scripts/beta-readiness-report.mjs",
  "scripts/beta-direct-env-doctor.mjs",
  "scripts/prepare-beta-handoff.mjs",
  "scripts/prepare-gateway-deploy-package.mjs",
  "scripts/gateway-public-doctor.mjs",
  "scripts/production-gateway-doctor.mjs",
  "scripts/verify-production-gateway-compose.mjs",
  "scripts/verify-lemon-production.mjs",
  "scripts/prepare-website-release.mjs",
  "scripts/sign-win-installer.mjs",
  "scripts/validate-release-configs.mjs",
  "scripts/verify-target-session-exports.mjs",
  "scripts/verify-host-enrollment.mjs",
  "scripts/verify-ssh-terminal-lifecycle.mjs",
  "scripts/verify-host-agent-install-bundle.mjs",
  "scripts/verify-remote-desktop-lifecycle.mjs",
  "scripts/smoke-gui.mjs",
  "scripts/smoke-store-installer-win.mjs",
  "scripts/smoke-mac-dmg.mjs",
  "src/lib/legalConsentManifest.ts",
  "sidecars/mock-gateway/server.mjs",
  "src-tauri/Cargo.toml",
  "src-tauri/tauri.conf.json",
  "src-tauri/tauri.prod.conf.json",
  "src-tauri/tauri.microsoftstore.conf.json",
  "src-tauri/tauri.macos.conf.json",
  "docs/legal/INSTALLER_TERMS.md",
  "docs/legal/EULA.md",
  "docs/legal/PRIVACY.md",
  "docs/legal/REFUND_POLICY.md",
  "docs/legal/DIGITAL_CONTENT_WAIVER.md",
  "docs/legal/AI_AGENT_RISK_NOTICE.md",
  "docs/legal/OPENCLAW_MIT_NOTICE.md",
  "docs/legal/OPENCLAW_UPSTREAM_LICENSE.md",
  "docs/legal/THIRD_PARTY_NOTICES.md",
  "docs/payments/LEMON_SQUEEZY_SETUP.md",
  "docs/upstream/OPENCLAW_IMPORT.md",
  "docs/upstream/OPENCLAW_FEATURE_PARITY.md",
  "docs/upstream/OPENCLAW_RUNTIME_ADAPTER.md",
  "docs/upstream/openclaw-feature-parity.json",
  "docs/windows/WINDOWS_CERTIFICATION_PLAN.md",
  "docs/windows/WINDOWS_SIGNING_SETUP.md",
  "docs/deploy/PRODUCTION_GATEWAY_DIRECT_BETA.md",
  "docker-compose.production-gateway.yml",
  "docker-compose.production-gateway.proxy.yml",
  "infra/nginx.production-gateway.conf",
];
const commands = ["node", "npm", "cargo"];
const ports = [18890, 18790, 5173];

function run(command, args) {
  return spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    windowsHide: process.platform === "win32",
  });
}

function commandInvocation(command, args) {
  if (process.platform !== "win32") return { command, args };
  if (command.endsWith(".exe")) return { command, args };
  const cmdCommand = command.endsWith(".cmd") ? command : `${command}.cmd`;
  const quoted = cmdCommand.includes(" ") ? `"${cmdCommand}"` : cmdCommand;
  return { command: "cmd.exe", args: ["/d", "/s", "/c", quoted, ...args] };
}

function commandVersion(command) {
  const locator = process.platform === "win32"
    ? run("where.exe", [command])
    : run("bash", ["-lc", `command -v ${command}`]);
  if (locator.status !== 0) {
    return { command, ok: false, path: null, version: null };
  }

  const resolvedPaths = locator.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const resolvedPath = process.platform === "win32"
    ? resolvedPaths.find((item) => item.endsWith(".exe") || item.endsWith(".cmd")) ?? resolvedPaths[0] ?? null
    : resolvedPaths[0] ?? null;
  const invocation = process.platform === "win32" && resolvedPath?.endsWith(".cmd")
    ? commandInvocation(command, ["--version"])
    : commandInvocation(resolvedPath ?? command, ["--version"]);
  const version = run(invocation.command, invocation.args);
  return {
    command,
    ok: version.status === 0,
    path: resolvedPath,
    version: version.stdout.trim() || version.stderr.trim() || null,
  };
}

async function pathStatus(relativePath) {
  const absolutePath = path.join(process.cwd(), relativePath);
  try {
    const stat = await fs.stat(absolutePath);
    return { path: relativePath, ok: true, type: stat.isDirectory() ? "directory" : "file" };
  } catch {
    return { path: relativePath, ok: false, type: null };
  }
}

async function portStatus(port) {
  if (process.platform === "win32") {
    return new Promise((resolve) => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      const finish = (listening) => {
        socket.destroy();
        resolve({
          port,
          listening,
          processes: listening ? [{ command: "windows-listener", pid: "unknown" }] : [],
        });
      };
      socket.setTimeout(750);
      socket.once("connect", () => finish(true));
      socket.once("timeout", () => finish(false));
      socket.once("error", () => finish(false));
    });
  }

  const result = run("bash", ["-lc", `lsof -nP -iTCP:${port} -sTCP:LISTEN | tail -n +2`]);
  const lines = (result.stdout || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    port,
    listening: lines.length > 0,
    processes: lines.map((line) => {
      const [command, pid] = line.split(/\s+/);
      return { command, pid };
    }),
  };
}

async function main() {
  await fs.mkdir(reportDir, { recursive: true });

  const commandChecks = commands.map(commandVersion);
  const fileChecks = await Promise.all(requiredPaths.map(pathStatus));
  const portChecks = await Promise.all(ports.map(portStatus));
  const legalManifestCheck = run("node", ["scripts/generate-legal-consent.mjs", "--check"]);
  const thirdPartyNoticesCheck = run("node", ["scripts/generate-third-party-notices.mjs", "--check"]);
  const i18nAuditCheck = run("node", ["scripts/audit-i18n-literals.mjs", "--strict"]);
  const hiddenWindowPolicyCheck = run("node", ["scripts/enforce-hidden-window-policy.mjs"]);
  const releaseConfigCheck = run("node", ["scripts/validate-release-configs.mjs"]);
  const targetSessionExportCheck = run("node", ["scripts/verify-target-session-exports.mjs"]);
  const hostEnrollmentCheck = run("node", ["scripts/verify-host-enrollment.mjs"]);
  const sshTerminalLifecycleCheck = run("node", ["scripts/verify-ssh-terminal-lifecycle.mjs"]);
  const hostAgentInstallBundleCheck = run("node", ["scripts/verify-host-agent-install-bundle.mjs"]);
  const remoteDesktopLifecycleCheck = run("node", ["scripts/verify-remote-desktop-lifecycle.mjs"]);
  const hiddenTaskAuditCheck = process.platform === "win32"
    ? run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/audit-scheduled-tasks.ps1"])
    : { status: 0, stdout: "skipped: non-windows", stderr: "" };

  const failures = [
    ...commandChecks.filter((item) => !item.ok).map((item) => `missing-command:${item.command}`),
    ...fileChecks.filter((item) => !item.ok).map((item) => `missing-path:${item.path}`),
    ...(legalManifestCheck.status === 0 ? [] : ["stale-legal-consent-manifest"]),
    ...(thirdPartyNoticesCheck.status === 0 ? [] : ["stale-third-party-notices"]),
    ...(i18nAuditCheck.status === 0 ? [] : ["hardcoded-ui-literals"]),
    ...(hiddenWindowPolicyCheck.status === 0 ? [] : ["hidden-window-policy-violation"]),
    ...(releaseConfigCheck.status === 0 ? [] : ["invalid-release-configs"]),
    ...(targetSessionExportCheck.status === 0 ? [] : ["stale-target-session-exports"]),
    ...(hostEnrollmentCheck.status === 0 ? [] : ["stale-host-enrollment"]),
    ...(sshTerminalLifecycleCheck.status === 0 ? [] : ["stale-ssh-terminal-lifecycle"]),
    ...(hostAgentInstallBundleCheck.status === 0 ? [] : ["stale-host-agent-install-bundle"]),
    ...(remoteDesktopLifecycleCheck.status === 0 ? [] : ["stale-remote-desktop-lifecycle"]),
    ...(hiddenTaskAuditCheck.status === 0 ? [] : ["hidden-task-window-rule-violation"]),
  ];

  const report = {
    createdAt: new Date().toISOString(),
    cwd: process.cwd(),
    result: failures.length === 0 ? "PASS" : "FAIL",
    commands: commandChecks,
    files: fileChecks,
    legalManifest: {
      ok: legalManifestCheck.status === 0,
      stderr: legalManifestCheck.stderr.trim(),
    },
    thirdPartyNotices: {
      ok: thirdPartyNoticesCheck.status === 0,
      stderr: thirdPartyNoticesCheck.stderr.trim(),
    },
    i18nAudit: {
      ok: i18nAuditCheck.status === 0,
      stdout: i18nAuditCheck.stdout.trim(),
      stderr: i18nAuditCheck.stderr.trim(),
    },
    hiddenWindowPolicy: {
      ok: hiddenWindowPolicyCheck.status === 0,
      stdout: hiddenWindowPolicyCheck.stdout.trim(),
      stderr: hiddenWindowPolicyCheck.stderr.trim(),
    },
    releaseConfigs: {
      ok: releaseConfigCheck.status === 0,
      stdout: releaseConfigCheck.stdout.trim(),
      stderr: releaseConfigCheck.stderr.trim(),
    },
    targetSessionExports: {
      ok: targetSessionExportCheck.status === 0,
      stdout: targetSessionExportCheck.stdout.trim(),
      stderr: targetSessionExportCheck.stderr.trim(),
    },
    hostEnrollment: {
      ok: hostEnrollmentCheck.status === 0,
      stdout: hostEnrollmentCheck.stdout.trim(),
      stderr: hostEnrollmentCheck.stderr.trim(),
    },
    sshTerminalLifecycle: {
      ok: sshTerminalLifecycleCheck.status === 0,
      stdout: sshTerminalLifecycleCheck.stdout.trim(),
      stderr: sshTerminalLifecycleCheck.stderr.trim(),
    },
    hostAgentInstallBundle: {
      ok: hostAgentInstallBundleCheck.status === 0,
      stdout: hostAgentInstallBundleCheck.stdout.trim(),
      stderr: hostAgentInstallBundleCheck.stderr.trim(),
    },
    remoteDesktopLifecycle: {
      ok: remoteDesktopLifecycleCheck.status === 0,
      stdout: remoteDesktopLifecycleCheck.stdout.trim(),
      stderr: remoteDesktopLifecycleCheck.stderr.trim(),
    },
    hiddenTaskAudit: {
      ok: hiddenTaskAuditCheck.status === 0,
      stdout: hiddenTaskAuditCheck.stdout.trim(),
      stderr: hiddenTaskAuditCheck.stderr.trim(),
    },
    ports: portChecks,
    warnings: portChecks
      .filter((item) => item.listening)
      .map((item) => `port-in-use:${item.port}`),
    failures,
  };

  const file = path.join(reportDir, `${new Date().toISOString().replace(/[:.]/g, "_")}-preflight.json`);
  await fs.writeFile(file, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(`Preflight report: ${file}`);
  console.log(`Result: ${report.result}`);
  if (report.warnings.length > 0) {
    console.log(`Warnings: ${report.warnings.join(", ")}`);
  }
  if (failures.length > 0) {
    console.error(`Failures: ${failures.join(", ")}`);
    process.exitCode = 1;
  }
}

await main();


