import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const cwd = process.cwd();
const bundleDir = path.join(cwd, "src-tauri", "target", "release", "bundle", "nsis");
const reportDir = path.join(cwd, "artifacts", "store-installer-smoke");
const reportFile = path.join(reportDir, `${new Date().toISOString().replace(/[:.]/g, "_")}-report.json`);

function parseArgs(argv) {
  return { build: !argv.includes("--no-build"), requireSignature: argv.includes("--require-signature") };
}

function commandInvocation(command, args) {
  if (process.platform !== "win32") return { command, args };
  if (command.endsWith(".exe")) return { command, args };
  if (command === "node" || command === "cargo") return { command: `${command}.exe`, args };
  const cmdCommand = command.endsWith(".cmd") ? command : `${command}.cmd`;
  return { command: "cmd.exe", args: ["/d", "/s", "/c", cmdCommand, ...args] };
}

function run(command, args, options = {}) {
  const invocation = commandInvocation(command, args);
  return spawnSync(invocation.command, invocation.args, {
    cwd,
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
    shell: false,
    windowsHide: process.platform === "win32",
  });
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

async function main() {
  if (process.platform !== "win32") throw new Error("store installer smoke must run on Windows.");
  const options = parseArgs(process.argv.slice(2));
  const checks = [];
  const check = async (name, fn) => {
    try {
      const details = await fn();
      checks.push({ name, ok: true, details });
      console.log(`PASS ${name}`);
      return details;
    } catch (error) {
      checks.push({ name, ok: false, error: error instanceof Error ? error.message : String(error) });
      console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  };

  let status = "fail";
  try {
    await check("store config readiness", async () => {
      const result = run("node", ["scripts/validate-release-configs.mjs", "--store"]);
      if (result.status !== 0) throw new Error(result.stderr || result.stdout || `status ${result.status}`);
      return JSON.parse(result.stdout);
    });
    await check("build Microsoft Store candidate installer", async () => {
      if (options.build) {
        const result = run("npm", ["run", "tauri:build:store:win"], { stdio: "inherit" });
        if (result.status !== 0) throw new Error(`store build failed with status ${result.status}`);
      }
      return newestInstaller();
    });
    await check("store installer artifact shape", async () => {
      const installer = await newestInstaller();
      if (!/ClawDesk/i.test(installer.name)) throw new Error(`Installer name does not include ClawDesk: ${installer.name}`);
      if (installer.bytes < 1024 * 1024) throw new Error(`Installer is unexpectedly small: ${installer.bytes}`);
      return installer;
    });
    await check("Windows signing check", async () => {
      const installer = await newestInstaller();
      const result = run("node", ["scripts/verify-windows-signing.mjs", installer.filePath]);
      const payload = JSON.parse(result.stdout || "{}");
      if (options.requireSignature && payload.result !== "PASS") throw new Error(payload.reason ?? payload.stderr ?? "signature verification failed");
      return {
        ...payload,
        required: options.requireSignature,
        allowedForMockCandidate: !options.requireSignature && payload.result !== "PASS",
      };
    });
    status = "pass";
  } finally {
    await fs.mkdir(reportDir, { recursive: true });
    await fs.writeFile(reportFile, `${JSON.stringify({ status, checks, finishedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
    console.log(`Store installer smoke report: ${reportFile}`);
    if (status !== "pass") process.exitCode = 1;
  }
}

await main();


