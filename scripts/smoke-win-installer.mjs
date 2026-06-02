import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const cwd = process.cwd();
const bundleDir = path.join(cwd, "src-tauri", "target", "release", "bundle", "nsis");
const reportDir = path.join(cwd, "artifacts", "win-installer-smoke");
const reportFile = path.join(reportDir, `${new Date().toISOString().replace(/[:.]/g, "_")}-report.json`);

function parseArgs(argv) {
  return {
    build: !argv.includes("--no-build"),
    requireSignature: argv.includes("--require-signature"),
  };
}

function commandInvocation(command, args) {
  if (process.platform !== "win32") return { command, args };
  if (command.endsWith(".exe")) return { command, args };
  const cmdCommand = command.endsWith(".cmd") ? command : `${command}.cmd`;
  return { command: "cmd.exe", args: ["/d", "/s", "/c", cmdCommand, ...args] };
}

function run(command, args, options = {}) {
  const invocation = commandInvocation(command, args);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd,
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
    shell: false,
    windowsHide: process.platform === "win32",
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

async function newestInstaller() {
  const entries = await fs.readdir(bundleDir, { withFileTypes: true });
  const installers = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".exe")) continue;
    const filePath = path.join(bundleDir, entry.name);
    const stat = await fs.stat(filePath);
    installers.push({ name: entry.name, filePath, bytes: stat.size, mtimeMs: stat.mtimeMs });
  }
  installers.sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (!installers[0]) throw new Error(`No NSIS installer found under ${bundleDir}`);
  return installers[0];
}

async function sha256(filePath) {
  const buffer = await fs.readFile(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}

async function writeReport(report) {
  await fs.mkdir(reportDir, { recursive: true });
  await fs.writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Windows installer smoke report: ${reportFile}`);
}

async function main() {
  if (process.platform !== "win32") {
    throw new Error("smoke-win-installer must run on Windows.");
  }

  const options = parseArgs(process.argv.slice(2));
  const report = {
    startedAt: new Date().toISOString(),
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

  try {
    await check("build Windows NSIS installer", async () => {
      if (options.build) {
        const result = run("npm", ["run", "tauri:build:win"], { stdio: "inherit" });
        if (!result.ok) throw new Error(`npm run tauri:build:win failed with status ${result.status}`);
      }
      const installer = await newestInstaller();
      report.installerPath = installer.filePath;
      return installer;
    });

    await check("installer artifact shape", async () => {
      const installer = await newestInstaller();
      if (!/ClawDesk/i.test(installer.name)) throw new Error(`Installer name does not include ClawDesk: ${installer.name}`);
      if (!/0\.1\.0/.test(installer.name)) throw new Error(`Installer name does not include package version: ${installer.name}`);
      if (installer.bytes < 1024 * 1024) throw new Error(`Installer is unexpectedly small: ${installer.bytes} bytes`);
      return { ...installer, sha256: await sha256(installer.filePath) };
    });

    await check("release metadata is current", async () => {
      const result = run("npm", ["run", "release:metadata:win:check", "--", ...(options.requireSignature ? ["--require-signature"] : [])]);
      if (!result.ok) throw new Error(`release metadata check failed with status ${result.status}: ${result.stderr || result.stdout}`);
      return { requireSignature: options.requireSignature };
    });

    report.status = "pass";
  } finally {
    report.finishedAt = new Date().toISOString();
    await writeReport(report);
    if (report.status !== "pass") process.exitCode = 1;
  }
}

await main();


