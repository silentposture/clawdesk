import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const cwd = process.cwd();
const appName = "ClawDesk";
const gatewayPort = Number(process.env.CLAWDESK_MOCK_PORT ?? process.env.OPENCLAW_MOCK_PORT ?? 18890);
const gatewayHealthUrl = `http://127.0.0.1:${gatewayPort}/health`;
const appExecutableName = "clawdesk-desktop.exe";
const legacyAppExecutableName = "openclaw-desktop.exe";
const appExecutable = path.join(cwd, "src-tauri", "target", "release", appExecutableName);
const reportDir = path.join(cwd, "artifacts", "win-app-smoke");
const reportFile = path.join(reportDir, `${new Date().toISOString().replace(/[:.]/g, "_")}-report.json`);

function parseArgs(argv) {
  const options = { build: true, timeoutMs: 30000 };
  for (const arg of argv) {
    if (arg === "--no-build") options.build = false;
    if (arg.startsWith("--timeout-ms=")) {
      const parsed = Number.parseInt(arg.slice("--timeout-ms=".length), 10);
      if (Number.isFinite(parsed) && parsed > 0) options.timeoutMs = parsed;
    }
  }
  return options;
}

function run(command, args, options = {}) {
  const invocation = commandInvocation(command, args);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd,
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
    shell: false,
    windowsHide: process.platform === "win32",
    env: { ...process.env, ...(options.env ?? {}) },
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function commandInvocation(command, args) {
  if (process.platform !== "win32") return { command, args };
  if (command.endsWith(".exe")) return { command, args };
  const cmdCommand = command.endsWith(".cmd") ? command : `${command}.cmd`;
  return { command: "cmd.exe", args: ["/d", "/s", "/c", cmdCommand, ...args] };
}

function processIdsForCommandLine(pattern) {
  const escaped = pattern.replace(/'/g, "''");
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match '${escaped}' } | Select-Object -ExpandProperty ProcessId`,
  ].join("; ");
  const result = run("powershell.exe", ["-NoProfile", "-Command", script]);
  if (!result.ok) return [];
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function terminateProcessIds(ids) {
  for (const id of ids) {
    run("powershell.exe", ["-NoProfile", "-Command", `Stop-Process -Id ${Number(id)} -Force -ErrorAction SilentlyContinue`]);
  }
}

function terminateProcessTree(pid) {
  if (!pid) return;
  run("taskkill.exe", ["/PID", String(pid), "/T", "/F"]);
}

function gatewayProcessIds() {
  return processIdsForCommandLine("mock-gateway.*server\\.mjs");
}

async function isGatewayHealthy() {
  try {
    const response = await fetch(gatewayHealthUrl, { cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForCondition(label, predicate, timeoutMs, intervalMs = 250) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function writeReport(report) {
  await fs.mkdir(reportDir, { recursive: true });
  await fs.writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Windows app smoke report: ${reportFile}`);
}

async function main() {
  if (process.platform !== "win32") {
    throw new Error("smoke-win-app must run on Windows.");
  }

  const options = parseArgs(process.argv.slice(2));
  const report = {
    startedAt: new Date().toISOString(),
    appExecutable,
    gatewayHealthUrl,
    gatewayLogFile: path.join(reportDir, "latest-gateway.log"),
    checks: [],
    issues: [],
    status: "fail",
  };

  const check = async (name, action) => {
    try {
      const details = await action();
      report.checks.push({ name, ok: true, details });
      console.log(`PASS ${name}`);
      return details;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      report.checks.push({ name, ok: false, error: message });
      report.issues.push({ name, error: message });
      console.log(`FAIL ${name}: ${message}`);
      throw error;
    }
  };

  let appProcess;
  try {
    await check("cleanup pre-existing local app/gateway", async () => {
      await fs.rm(report.gatewayLogFile, { force: true }).catch(() => undefined);
      const appPids = [
        ...processIdsForCommandLine(appExecutableName),
        ...processIdsForCommandLine(legacyAppExecutableName),
      ];
      const gatewayPids = gatewayProcessIds();
      terminateProcessIds([...appPids, ...gatewayPids]);
      await waitForCondition("pre-existing process cleanup", async () => {
        return processIdsForCommandLine(appExecutableName).length === 0 &&
          processIdsForCommandLine(legacyAppExecutableName).length === 0 &&
          gatewayProcessIds().length === 0;
      }, 5000, 250).catch(() => undefined);
      return { appPidsStopped: appPids, gatewayPidsStopped: gatewayPids, gatewayPort };
    });

    await check("build Windows app bundle", async () => {
      if (options.build) {
        const result = run("npm", ["run", "tauri:build:win"], { stdio: "inherit" });
        if (!result.ok) throw new Error(`npm run tauri:build:win failed with status ${result.status}`);
      }
      await fs.access(appExecutable);
      return { appExecutable };
    });

    await check("launch Windows executable", async () => {
      appProcess = spawn(appExecutable, [], {
        cwd,
        detached: false,
        stdio: ["ignore", "ignore", "ignore"],
        windowsHide: true,
        env: {
          ...process.env,
          CLAWDESK_SMOKE_BOOT_GATEWAY: "1",
          CLAWDESK_SMOKE_GATEWAY_LOG: report.gatewayLogFile,
          CLAWDESK_MOCK_PORT: String(gatewayPort),
          OPENCLAW_MOCK_PORT: String(gatewayPort),
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (appProcess.exitCode !== null) {
        throw new Error(`app exited early with code ${appProcess.exitCode}`);
      }
      return { pid: appProcess.pid };
    });

    await check("Gateway health is available after app launch", async () => {
      await waitForCondition("Gateway health", isGatewayHealthy, options.timeoutMs, 300);
      const response = await fetch(gatewayHealthUrl);
      return await response.json();
    });

    await check("quit app and cleanup sidecar", async () => {
      if (appProcess && appProcess.exitCode === null) {
        terminateProcessTree(appProcess.pid);
      }
      terminateProcessIds(gatewayProcessIds());
      await waitForCondition("Gateway shutdown", async () => !(await isGatewayHealthy()), options.timeoutMs, 300);
      return { gatewayPort };
    });

    report.status = "pass";
  } finally {
    if (appProcess && appProcess.exitCode === null) {
      terminateProcessTree(appProcess.pid);
    }
    if (report.status !== "pass") {
      report.gatewayLog = await fs.readFile(report.gatewayLogFile, "utf8").catch(() => "");
      terminateProcessIds(gatewayProcessIds());
    }
    report.finishedAt = new Date().toISOString();
    await writeReport(report);
    if (report.status !== "pass") process.exitCode = 1;
  }
}

await main();


