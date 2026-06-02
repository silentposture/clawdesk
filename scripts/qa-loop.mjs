import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const options = {
    cycles: 1,
    continueOnFailure: false,
    quick: false,
    smokeConnectOnly: false,
    skipUnit: false,
    skipBuild: false,
    skipVerifyMvp: false,
    skipVerifyBackend: false,
    skipVerifyBackendSim: false,
    skipVerifyProductionGatewaySim: false,
    skipCargoTest: false,
    skipPreflight: false,
    skipReleaseGuard: false,
    includeTauriAppSmoke: false,
    includeWindowsInstallerSmoke: false,
    includeStoreInstallerSmoke: false,
    includeMacDmgSmoke: false,
    productionSmoke: false,
    gatewayPort: Number(process.env.CLAWDESK_MOCK_PORT ?? process.env.OPENCLAW_MOCK_PORT ?? 18890),
    appPort: 5173,
    reportDir: path.join(process.cwd(), "artifacts", "qa-loop"),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--cycles" && argv[i + 1]) {
      const value = Number.parseInt(argv[i + 1], 10);
      if (Number.isFinite(value) && value > 0) {
        options.cycles = value;
      }
      i += 1;
    } else if (arg === "--quick") {
      options.quick = true;
      options.skipUnit = true;
      options.skipBuild = true;
      options.skipCargoTest = true;
    } else if (arg === "--smoke-connect-only") {
      options.smokeConnectOnly = true;
    } else if (arg === "--production-smoke" || arg === "--prod-smoke") {
      options.productionSmoke = true;
    } else if (arg === "--tauri-app-smoke") {
      options.includeTauriAppSmoke = true;
    } else if (arg === "--windows-installer-smoke") {
      options.includeWindowsInstallerSmoke = true;
    } else if (arg === "--store-installer-smoke") {
      options.includeStoreInstallerSmoke = true;
    } else if (arg === "--mac-dmg-smoke") {
      options.includeMacDmgSmoke = true;
    } else if (arg === "--gateway-port" && argv[i + 1]) {
      const value = Number.parseInt(argv[i + 1], 10);
      if (Number.isFinite(value) && value > 0) options.gatewayPort = value;
      i += 1;
    } else if (arg === "--app-port" && argv[i + 1]) {
      const value = Number.parseInt(argv[i + 1], 10);
      if (Number.isFinite(value) && value > 0) options.appPort = value;
      i += 1;
    } else if (arg.startsWith("--gateway-port=")) {
      const value = Number.parseInt(arg.slice("--gateway-port=".length), 10);
      if (Number.isFinite(value) && value > 0) options.gatewayPort = value;
    } else if (arg.startsWith("--app-port=")) {
      const value = Number.parseInt(arg.slice("--app-port=".length), 10);
      if (Number.isFinite(value) && value > 0) options.appPort = value;
    } else if (arg === "--continue-on-failure" || arg === "--continue") {
      options.continueOnFailure = true;
    } else if (arg === "--skip-unit") {
      options.skipUnit = true;
    } else if (arg === "--skip-build") {
      options.skipBuild = true;
    } else if (arg === "--skip-verify-mvp") {
      options.skipVerifyMvp = true;
    } else if (arg === "--skip-verify-backend") {
      options.skipVerifyBackend = true;
    } else if (arg === "--skip-verify-backend-sim") {
      options.skipVerifyBackendSim = true;
    } else if (arg === "--skip-verify-production-gateway-sim") {
      options.skipVerifyProductionGatewaySim = true;
    } else if (arg === "--skip-cargo-test") {
      options.skipCargoTest = true;
    } else if (arg === "--skip-preflight") {
      options.skipPreflight = true;
    } else if (arg === "--skip-release-guard") {
      options.skipReleaseGuard = true;
    } else if (arg.startsWith("--report-dir=")) {
      options.reportDir = arg.slice("--report-dir=".length);
    } else if (arg === "--report-dir" && argv[i + 1]) {
      options.reportDir = argv[i + 1];
      i += 1;
    }
  }

  return options;
}

function buildCommandPlan(options) {
  const smokeArgs = ["run", "smoke:gui"];
  if (options.productionSmoke) {
    smokeArgs[1] = "smoke:gui:prod";
  }
  if (options.smokeConnectOnly) {
    smokeArgs.push("--", "--connect-only");
    if (Number.isFinite(options.gatewayPort) && options.gatewayPort > 0) {
      smokeArgs.push(`--gateway-port=${options.gatewayPort}`);
    }
    if (Number.isFinite(options.appPort) && options.appPort > 0) {
      smokeArgs.push(`--app-port=${options.appPort}`);
    }
  }

  const includeReleaseGuard =
    !options.skipReleaseGuard &&
    (options.productionSmoke || options.includeTauriAppSmoke || options.includeWindowsInstallerSmoke);
  const includeReleaseGuardForExtendedTargets =
    includeReleaseGuard || options.includeStoreInstallerSmoke || options.includeMacDmgSmoke;

  return [
    { name: "preflight", cmd: "npm", args: ["run", "preflight"], timeoutMs: 60000, enabled: !options.skipPreflight },
    { name: "hidden-window-policy", cmd: "npm", args: ["run", "policy:hidden-window"], timeoutMs: 60000, enabled: !options.skipPreflight },
    { name: "release-configs", cmd: "npm", args: ["run", "release:configs:check"], timeoutMs: 60000, enabled: includeReleaseGuardForExtendedTargets },
    { name: "release-guard", cmd: "npm", args: ["run", "release:guard"], timeoutMs: 60000, enabled: includeReleaseGuardForExtendedTargets },
    { name: "unit-tests", cmd: "npm", args: ["test"], timeoutMs: 120000, enabled: !options.skipUnit },
    { name: "build", cmd: "npm", args: ["run", "build"], timeoutMs: 120000, enabled: !options.skipBuild },
    { name: "verify-mvp", cmd: "npm", args: ["run", "verify:mvp"], timeoutMs: 120000, enabled: !options.skipVerifyMvp },
    { name: "verify-backend", cmd: "npm", args: ["run", "verify:backend"], timeoutMs: 120000, enabled: !options.skipVerifyBackend },
    { name: "verify-backend-sim", cmd: "npm", args: ["run", "verify:backend:sim"], timeoutMs: 120000, enabled: !options.skipVerifyBackendSim },
    {
      name: "verify-production-gateway-sim",
      cmd: "npm",
      args: ["run", "verify:production-gateway:sim"],
      timeoutMs: 120000,
      enabled: !options.skipVerifyProductionGatewaySim && (options.productionSmoke || options.includeTauriAppSmoke || options.includeWindowsInstallerSmoke),
      cleanupPorts: true,
    },
    {
      name: "verify-reports-check",
      cmd: "npm",
      args: ["run", "verify:reports:check"],
      timeoutMs: 60000,
      enabled: !options.skipVerifyProductionGatewaySim && (options.productionSmoke || options.includeTauriAppSmoke || options.includeWindowsInstallerSmoke),
    },
    {
      name: options.productionSmoke ? "smoke-gui-prod" : "smoke-gui",
      cmd: "npm",
      args: smokeArgs,
      timeoutMs: 180000,
      cleanupPorts: !options.smokeConnectOnly,
    },
    {
      name: "cargo-test-tauri",
      cmd: "cargo",
      args: ["test", "--manifest-path", "src-tauri/Cargo.toml"],
      timeoutMs: 180000,
      enabled: !options.skipCargoTest,
    },
    {
      name: "tauri-app-smoke",
      cmd: "npm",
      args: ["run", "tauri:app-smoke"],
      timeoutMs: 300000,
      enabled: options.includeTauriAppSmoke,
      cleanupPorts: true,
    },
    {
      name: "windows-installer-smoke",
      cmd: "npm",
      args: ["run", "smoke:win-installer"],
      timeoutMs: 420000,
      enabled: options.includeWindowsInstallerSmoke,
      cleanupPorts: true,
    },
    {
      name: "store-installer-smoke",
      cmd: "npm",
      args: ["run", "smoke:store-installer:win"],
      timeoutMs: 720000,
      enabled: options.includeStoreInstallerSmoke,
      cleanupPorts: true,
    },
    {
      name: "mac-dmg-smoke",
      cmd: "npm",
      args: ["run", "smoke:mac-dmg"],
      timeoutMs: 300000,
      enabled: options.includeMacDmgSmoke && process.platform === "darwin",
      cleanupPorts: true,
    },
    {
      name: "mac-dmg-smoke-skip",
      cmd: process.execPath,
      args: ["-e", "console.log('SKIP mac-dmg-smoke: requires macOS host')"],
      timeoutMs: 5000,
      enabled: options.includeMacDmgSmoke && process.platform !== "darwin",
      cleanupPorts: false,
    },
  ].filter((command) => command.enabled ?? true);
}

const guardedPorts = [18890, 18790, 5173, 19120, 19130];

function commandInvocation(command, args) {
  if (process.platform !== "win32") return { command, args };
  if (command.endsWith(".exe")) return { command, args };
  if (command === "cargo" || command === "node") return { command: `${command}.exe`, args };
  const cmdCommand = command.endsWith(".cmd") ? command : `${command}.cmd`;
  return { command: "cmd.exe", args: ["/d", "/s", "/c", cmdCommand, ...args] };
}

function cleanupPorts() {
  for (const port of guardedPorts) {
    const finder = process.platform === "win32"
      ? spawnSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-Command",
            `Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique`,
          ],
          {
            cwd: process.cwd(),
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
            shell: false,
            windowsHide: process.platform === "win32",
          },
        )
      : spawnSync("bash", ["-lc", `lsof -ti tcp:${port}`], {
          cwd: process.cwd(),
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          windowsHide: process.platform === "win32",
        });
    const pids = (finder.stdout || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (pids.length === 0) continue;

    for (const pid of pids) {
      if (process.platform === "win32") {
        spawnSync("powershell.exe", ["-NoProfile", "-Command", `Stop-Process -Id ${Number(pid)} -Force -ErrorAction SilentlyContinue`], {
          cwd: process.cwd(),
          stdio: ["ignore", "ignore", "ignore"],
          shell: false,
    windowsHide: process.platform === "win32",
        });
      } else {
        spawnSync("kill", ["-9", pid], {
          cwd: process.cwd(),
          stdio: ["ignore", "ignore", "ignore"],
          windowsHide: process.platform === "win32",
        });
      }
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runOne(command, options) {
  const maxRetryOnSigkill = command.name === "smoke-gui" ? 2 : 1;
  let result;
  let start;
  let startedMs;

  for (let attempt = 1; attempt <= maxRetryOnSigkill + 1; attempt += 1) {
    if (command.cleanupPorts !== false && !options.smokeConnectOnly) {
      cleanupPorts();
    }
    start = new Date().toISOString();
    startedMs = Date.now();
    const invocation = commandInvocation(command.cmd, command.args);
    result = spawnSync(invocation.command, invocation.args, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: "inherit",
      timeout: command.timeoutMs,
      shell: false,
    windowsHide: process.platform === "win32",
    });

    if (result.status === 0) break;
    if (result.signal === "SIGKILL" && attempt <= maxRetryOnSigkill) {
      await sleep(700);
      continue;
    }
    break;
  }

  return {
    name: command.name,
    command: `${command.cmd} ${command.args.join(" ")}`,
    startedAt: start,
    endedAt: new Date().toISOString(),
    durationMs: typeof startedMs === "number" ? Date.now() - startedMs : null,
    ok: result.status === 0,
    status: result.status ?? null,
    signal: result.signal ?? null,
  };
}

function safeFileName(value) {
  return value.replace(/[^a-zA-Z0-9.-]/g, "-");
}

function summarize(rounds) {
  const checks = rounds.flatMap((round) => round.checks);
  const failedChecks = checks.filter((check) => !check.ok);
  const slowestChecks = [...checks]
    .filter((check) => Number.isFinite(check.durationMs))
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, 5)
    .map((check) => ({
      name: check.name,
      command: check.command,
      durationMs: check.durationMs,
      ok: check.ok,
    }));

  return {
    totalRounds: rounds.length,
    passedRounds: rounds.filter((round) => round.ok).length,
    failedRounds: rounds.filter((round) => !round.ok).length,
    totalChecks: checks.length,
    passedChecks: checks.filter((check) => check.ok).length,
    failedChecks: failedChecks.length,
    failedCheckNames: [...new Set(failedChecks.map((check) => check.name))],
    slowestChecks,
  };
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  await fs.mkdir(options.reportDir, { recursive: true });

  const rounds = [];
  let overallOk = true;

  for (let cycle = 1; cycle <= options.cycles; cycle += 1) {
    const checks = [];
    let cycleOk = true;
    const commandPlan = buildCommandPlan(options);

    for (const command of commandPlan) {
      const outcome = await runOne(command, options);
      checks.push(outcome);
      if (!outcome.ok) {
        cycleOk = false;
        overallOk = false;
        if (!options.continueOnFailure) break;
      }
    }

    rounds.push({
      cycle,
      startedAt: checks[0]?.startedAt,
      endedAt: checks[checks.length - 1]?.endedAt,
      ok: cycleOk,
      checks,
    });

    if (!overallOk && !options.continueOnFailure) break;
  }

  const report = {
    createdAt: new Date().toISOString(),
    cycles: options.cycles,
    continueOnFailure: options.continueOnFailure,
    reportDir: options.reportDir,
    mode: {
      productionSmoke: options.productionSmoke,
      smokeConnectOnly: options.smokeConnectOnly,
      includeTauriAppSmoke: options.includeTauriAppSmoke,
      includeWindowsInstallerSmoke: options.includeWindowsInstallerSmoke,
      includeStoreInstallerSmoke: options.includeStoreInstallerSmoke,
      includeMacDmgSmoke: options.includeMacDmgSmoke,
      includeReleaseGuard:
        !options.skipReleaseGuard &&
        (options.productionSmoke || options.includeTauriAppSmoke || options.includeWindowsInstallerSmoke || options.includeStoreInstallerSmoke || options.includeMacDmgSmoke),
      includeProductionGatewaySim:
        !options.skipVerifyProductionGatewaySim &&
        (options.productionSmoke || options.includeTauriAppSmoke || options.includeWindowsInstallerSmoke),
      quick: options.quick,
    },
    summary: summarize(rounds),
    rounds,
    result: overallOk ? "PASS" : "FAIL",
  };

  const file = path.join(
    options.reportDir,
    `${new Date().toISOString().replace(/[:.]/g, "_")}-qa-cycle-${safeFileName(`cycles-${options.cycles}`)}.json`,
  );
  await fs.writeFile(file, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(`QA cycle report: ${file}`);
  console.log(`Result: ${report.result}`);
  if (!overallOk) process.exitCode = 1;
}

await run();


