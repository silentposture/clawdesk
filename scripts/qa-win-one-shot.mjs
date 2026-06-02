import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";

const cwd = process.cwd();

const DEFAULT_REPORT_DIR = path.join(cwd, "artifacts", "qa-win-full");

function parseArgs(argv) {
  const args = {
    requireSignature: argv.includes("--require-signature"),
    requireArtifactBuild: argv.includes("--build") || argv.includes("--require-build"),
    runStoreSmoke: argv.includes("--store-smoke") || argv.includes("--run-store-smoke"),
    skipInstallers: false,
    skipHeavyBuild: argv.includes("--skip-heavy-build"),
    reportDir: path.join(DEFAULT_REPORT_DIR, new Date().toISOString().replace(/[:.]/g, "_")),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--report-dir" && argv[i + 1]) {
      args.reportDir = argv[i + 1];
      i += 1;
    } else if (arg.startsWith("--report-dir=")) {
      args.reportDir = arg.slice("--report-dir=".length);
    } else if (arg === "--skip-installers" || arg === "--skip-installer-smoke") {
      args.skipInstallers = true;
    }
  }

  return args;
}

function commandInvocation(command, args) {
  if (process.platform !== "win32") return { command, args };
  if (command.endsWith(".exe")) return { command, args };
  if (command === "cargo" || command === "node") return { command: `${command}.exe`, args };
  const cmdCommand = command.endsWith(".cmd") ? command : `${command}.cmd`;
  return { command: "cmd.exe", args: ["/d", "/s", "/c", cmdCommand, ...args] };
}

function runCommand(command, args, options = {}) {
  const invocation = commandInvocation(command, args);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
    shell: false,
    windowsHide: process.platform === "win32",
    timeout: options.timeoutMs,
  });

  const commandLine = `${command} ${args.join(" ")}`;
  return {
    command: commandLine,
    status: result.status,
    stdout: result.stdout?.toString() ?? "",
    stderr: result.stderr?.toString() ?? "",
    ok: result.status === 0,
    error: result.error ? result.error.message : null,
  };
}

const guardedPorts = [18890, 18790, 5173, 19120, 19130];

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
            cwd,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
            shell: false,
            windowsHide: process.platform === "win32",
          },
        )
      : spawnSync("bash", ["-lc", `lsof -ti tcp:${port}`], {
          cwd,
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
          cwd,
          stdio: ["ignore", "ignore", "ignore"],
          shell: false,
    windowsHide: process.platform === "win32",
        });
      } else {
        spawnSync("kill", ["-9", pid], {
          cwd,
          stdio: ["ignore", "ignore", "ignore"],
          windowsHide: process.platform === "win32",
        });
      }
    }
  }
}

function runCommandWithRetry(command, args, options = {}, retries = 0) {
  let attempt = 0;
  let last = null;
  while (attempt <= retries) {
    if (attempt > 0 && String(options.name ?? "").includes("GUI smoke")) {
      cleanupPorts();
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1200);
    }
    last = runCommand(command, args, options);
    if (last.ok) {
      return { ...last, attempts: attempt + 1 };
    }
    attempt += 1;
  }
  return { ...(last ?? { ok: false, status: 1, stdout: "", stderr: "", error: "unknown failure", command: `${command} ${args.join(" ")}` }), attempts: retries + 1 };
}

function windowsSignedEnvPresent() {
  const hasTraditionalSigningByPath = Boolean(process.env.WINDOWS_SIGNING_CERTIFICATE && process.env.WINDOWS_SIGNING_CERTIFICATE_PASSWORD);
  const hasTraditionalSigningBySubject = Boolean(process.env.WINDOWS_SIGNING_CERTIFICATE_SUBJECT);
  const windowsTraditional = hasTraditionalSigningByPath || hasTraditionalSigningBySubject;
  const windowsTrusted = Boolean(
    process.env.AZURE_TRUSTED_SIGNING_ACCOUNT_NAME &&
      process.env.AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME &&
      process.env.AZURE_TRUSTED_SIGNING_ENDPOINT,
  );
  return windowsTraditional || windowsTrusted;
}

function windowsSignedEnvMissingNames() {
  const missingTraditional = [];
  const missingTrusted = [];
  if (!process.env.WINDOWS_SIGNING_CERTIFICATE && !process.env.WINDOWS_SIGNING_CERTIFICATE_SUBJECT) {
    missingTraditional.push("WINDOWS_SIGNING_CERTIFICATE");
    missingTraditional.push("WINDOWS_SIGNING_CERTIFICATE_PASSWORD");
  } else if (!process.env.WINDOWS_SIGNING_CERTIFICATE_SUBJECT) {
    if (!process.env.WINDOWS_SIGNING_CERTIFICATE_PASSWORD) missingTraditional.push("WINDOWS_SIGNING_CERTIFICATE_PASSWORD");
  }

  if (!process.env.AZURE_TRUSTED_SIGNING_ACCOUNT_NAME) missingTrusted.push("AZURE_TRUSTED_SIGNING_ACCOUNT_NAME");
  if (!process.env.AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME) missingTrusted.push("AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME");
  if (!process.env.AZURE_TRUSTED_SIGNING_ENDPOINT) missingTrusted.push("AZURE_TRUSTED_SIGNING_ENDPOINT");

  return {
    traditionalMissing: missingTraditional,
    trustedMissing: missingTrusted,
    traditionalSet: missingTraditional.length === 0,
    trustedSet: missingTrusted.length === 0,
  };
}

async function readSupportContactFromDoc() {
  const candidatePaths = [path.join(cwd, "docs", "support", "CONTACT.md")];
  for (const docPath of candidatePaths) {
    try {
      const content = await fs.readFile(docPath, "utf8");
      const emailMatch = content.match(/Support email:\s*([^\r\n]+)/i);
      const urlMatch = content.match(/Support URL:\s*([^\r\n]+)/i);
      return {
        email: emailMatch?.[1]?.trim() ?? "",
        url: urlMatch?.[1]?.trim() ?? "",
      };
    } catch {
      // keep doc optional
    }
  }
  return { email: "", url: "" };
}

function lemonGatewayEnvMissingNames() {
  const required = [
    ["CLAWDESK_GATEWAY_BASE_URL", "Production Gateway endpoint"],
    ["LEMON_SQUEEZY_WEBHOOK_SECRET", "Lemon webhook secret"],
    ["LEMON_SQUEEZY_STORE_ID", "Lemon store id"],
    ["LEMON_SQUEEZY_PRODUCT_ID", "Lemon product id"],
    ["LEMON_SQUEEZY_VARIANT_ID_PRO_YEARLY", "Lemon yearly variant id"],
    ["LEMON_SQUEEZY_VARIANT_ID_LIFETIME", "Lemon lifetime variant id"],
  ];

  return required.filter(([name]) => !process.env[name]).map(([name, label]) => ({ name, label }));
}

function lemonEnvPresent() {
  const required = [
    "LEMON_SQUEEZY_WEBHOOK_SECRET",
    "LEMON_SQUEEZY_STORE_ID",
    "LEMON_SQUEEZY_PRODUCT_ID",
    "LEMON_SQUEEZY_VARIANT_ID_PRO_YEARLY",
    "LEMON_SQUEEZY_VARIANT_ID_LIFETIME",
    "CLAWDESK_GATEWAY_BASE_URL",
  ];
  return required.every((name) => Boolean(process.env[name]));
}

async function hasNsisInstallerArtifact() {
  try {
    const bundleDir = path.join(cwd, "src-tauri", "target", "release", "bundle", "nsis");
    if (!existsSync(bundleDir)) return false;
    const entries = await fs.readdir(bundleDir, { withFileTypes: true });
    return entries.some((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".exe"));
  } catch {
    return false;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const checks = [];
  let overallOk = true;

  const commandPlan = [
    { name: "preflight", command: "npm", args: ["run", "preflight"], mustPass: true, timeoutMs: 60_000 },
    { name: "hidden-window policy", command: "npm", args: ["run", "policy:hidden-window"], mustPass: true, timeoutMs: 60_000 },
    { name: "release config check", command: "npm", args: ["run", "release:configs:check"], mustPass: true, timeoutMs: 60_000 },
    {
      name: "release guard (baseline)",
      command: "npm",
      args: ["run", "release:guard"],
      mustPass: true,
      timeoutMs: 60_000,
    },
    {
      name: "unit tests",
      command: "npm",
      args: ["test"],
      mustPass: true,
      timeoutMs: 180_000,
    },
    {
      name: "web build",
      command: "npm",
      args: ["run", "build"],
      mustPass: true,
      timeoutMs: 180_000,
      skipIf: () => args.skipHeavyBuild,
    },
    { name: "verify mvp", command: "npm", args: ["run", "verify:mvp"], mustPass: true, timeoutMs: 180_000 },
    { name: "verify backend", command: "npm", args: ["run", "verify:backend"], mustPass: true, timeoutMs: 120_000 },
    {
      name: "verify backend sim",
      command: "npm",
      args: ["run", "verify:backend:sim"],
      mustPass: true,
      timeoutMs: 120_000,
      skipIf: () => args.skipHeavyBuild,
    },
    {
      name: "verify production gateway sim",
      command: "npm",
      args: ["run", "verify:production-gateway:sim"],
      mustPass: true,
      timeoutMs: 120_000,
    },
    {
      name: "verify Lemon production contract",
      command: "npm",
      args: ["run", "verify:lemon:production"],
      mustPass: true,
      timeoutMs: 120_000,
    },
    {
      name: "cargo test",
      command: "cargo",
      args: ["test", "--manifest-path", "src-tauri/Cargo.toml"],
      mustPass: true,
      timeoutMs: 180_000,
    },
    {
      name: "tauri windows release build",
      command: "npm",
      args: ["run", "tauri:build:win"],
      mustPass: true,
      timeoutMs: 600_000,
      skipIf: async () => {
        if (args.requireArtifactBuild) return false;
        return await hasNsisInstallerArtifact();
      },
    },
    { name: "GUI smoke (prod)", command: "npm", args: ["run", "smoke:gui:prod"], mustPass: true, timeoutMs: 180_000, retries: 1 },
    { name: "windows app smoke", command: "npm", args: ["run", "smoke:win-app", "--", "--no-build"], mustPass: false, timeoutMs: 300_000 },
    { name: "windows installer smoke", command: "npm", args: ["run", "smoke:win-installer", "--", "--no-build"], mustPass: false, timeoutMs: 420_000, skipIf: () => args.skipInstallers },
    {
      name: "store-installer smoke",
      command: "npm",
      args: ["run", "smoke:store-installer:win", "--", "--no-build", ...(args.requireSignature ? ["--require-signature"] : [])],
      mustPass: false,
      timeoutMs: 420_000,
      skipIf: () => !args.runStoreSmoke || args.skipInstallers,
    },
    {
      name: "beta-direct release guard",
      command: "npm",
      args: ["run", "release:guard:beta"],
      mustPass: false,
      timeoutMs: 60_000,
      note:
        "正式 Beta 會卡在 gateway/Lemon/signing 環境，缺值時不視為全系統失敗，但會記錄在 report。",
      skipIf: () => false,
    },
    {
      name: "windows release metadata",
      command: "npm",
      args: ["run", "release:metadata:win:check", "--", ...(args.requireSignature ? ["--require-signature"] : [])],
      mustPass: false,
      timeoutMs: 60_000,
      note: "直售 Beta 需要 installer SHA256 / signature metadata；缺簽章時會以 report 記錄。",
    },
    {
      name: "visual UI regression",
      command: "npm",
      args: ["run", "verify:ui:visual"],
      mustPass: false,
      timeoutMs: 180_000,
    },
  ];

  for (const item of commandPlan) {
    const shouldSkip = typeof item.skipIf === "function" ? await item.skipIf() : false;
    if (shouldSkip) {
      checks.push({ name: item.name, status: "SKIP", ok: true, command: `${item.command} ${item.args.join(" ")}`, reason: "Skipped by arg policy" });
      continue;
    }

    const outcome = runCommandWithRetry(item.command, item.args, { timeoutMs: item.timeoutMs, stdio: "inherit", name: item.name }, Number(item.retries ?? 0));
    checks.push({
      name: item.name,
      status: outcome.ok ? "PASS" : item.mustPass ? "FAIL" : "WARN",
      ok: outcome.ok,
      command: outcome.command,
      attempts: outcome.attempts,
      note: outcome.ok ? null : (item.note || "optional path blocked or failed"),
      stdout: outcome.stdout ? outcome.stdout.slice(0, 4000) : "",
      stderr: outcome.stderr ? outcome.stderr.slice(0, 4000) : "",
      exitCode: outcome.status ?? null,
      error: outcome.error,
    });

    if (!outcome.ok && item.mustPass) {
      overallOk = false;
      break;
    }
  }

  const supportContactDoc = await readSupportContactFromDoc();
  const readinessGates = {
    channel: process.env.CLAWDESK_RELEASE_CHANNEL || "mock-candidate",
    windowsSigningEnv: windowsSignedEnvPresent(),
    lemonGatewayEnv: lemonEnvPresent(),
    supportContact: Boolean(process.env.CLAWDESK_SUPPORT_EMAIL || process.env.CLAWDESK_SUPPORT_URL || supportContactDoc.email || supportContactDoc.url),
    missingSigningEnv: windowsSignedEnvMissingNames(),
    missingBetaEnv: lemonGatewayEnvMissingNames(),
  };

  const blockedItems = checks.filter((check) => check.status === "FAIL" || check.status === "WARN");

  const report = {
    createdAt: new Date().toISOString(),
    mode: {
      requireSignature: args.requireSignature,
      runStoreSmoke: args.runStoreSmoke,
      skipHeavyBuild: args.skipHeavyBuild,
      skipInstallers: args.skipInstallers,
      requireArtifactBuild: args.requireArtifactBuild,
    },
    command: "npm run qa:full:win",
    summary: {
      overallOk,
      totalChecks: checks.length,
      passed: checks.filter((check) => check.status === "PASS").length,
      skipped: checks.filter((check) => check.status === "SKIP").length,
      warned: checks.filter((check) => check.status === "WARN").length,
      failedCritical: checks.filter((check) => check.status === "FAIL").length,
      blockersForBetaDirect: blockedItems
        .filter((item) => item.name.includes("release guard") || item.name.includes("windows installer smoke") || item.name.includes("store-installer smoke"))
        .map((item) => item.name),
    },
    readinessGates,
    readyForBetaDirect: readinessGates.lemonGatewayEnv && readinessGates.windowsSigningEnv && readinessGates.supportContact,
    checks,
    notes: {
      blockers: [
        ...readinessGates.missingBetaEnv.map((entry) => `beta-direct: missing ${entry.name} (${entry.label})`),
        ...(readinessGates.windowsSigningEnv ? [] : ["beta-direct: missing WINDOWS_SIGNING_* 或 AZURE_TRUSTED_SIGNING_*"]),
      ],
      supportContactMissing: !readinessGates.supportContact,
      channel: readinessGates.channel,
    },
    result: overallOk ? "PASS" : "FAIL",
  };

  await fs.mkdir(args.reportDir, { recursive: true });
  const reportPath = path.join(args.reportDir, `${new Date().toISOString().replace(/[:.]/g, "_")}-qa-win-full.json`);
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(`\nOne-shot Windows verification report: ${reportPath}`);
  console.log(`Overall: ${report.result}`);
  console.log(`Beta-direct readiness: ${readinessGates.lemonGatewayEnv && readinessGates.windowsSigningEnv ? "env-complete" : "env-missing"}`);
  if (!overallOk) {
    console.log("\n失敗或警示的關鍵步驟：");
    for (const item of blockedItems) {
      if (item.name === "release guard (baseline)") continue;
      console.log(`- ${item.name}: ${item.status}${item.note ? ` | ${item.note}` : ""}`);
    }
  }
  process.exitCode = overallOk ? 0 : 1;
}

await main();


