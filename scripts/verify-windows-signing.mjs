import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const cwd = process.cwd();

function commandInvocation(command, args) {
  if (process.platform !== "win32") return { command, args };
  if (command.endsWith(".exe")) return { command, args };
  const cmdCommand = command.endsWith(".cmd") ? command : `${command}.cmd`;
  return { command: "cmd.exe", args: ["/d", "/s", "/c", cmdCommand, ...args] };
}

function run(command, args) {
  const invocation = commandInvocation(command, args);
  return spawnSync(invocation.command, invocation.args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
}

async function windowsKitSignTool() {
  if (process.platform !== "win32") return null;
  const roots = [
    process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"], "Windows Kits", "10", "bin") : null,
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "Windows Kits", "10", "bin") : null,
  ].filter(Boolean);

  const candidates = [];
  for (const root of roots) {
    const versions = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    for (const version of versions) {
      if (!version.isDirectory()) continue;
      const filePath = path.join(root, version.name, "x64", "signtool.exe");
      const stat = await fs.stat(filePath).catch(() => null);
      if (stat?.isFile()) candidates.push({ filePath, mtimeMs: stat.mtimeMs, version: version.name });
    }
  }

  candidates.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }) || b.mtimeMs - a.mtimeMs);
  return candidates[0]?.filePath ?? null;
}

async function newestInstaller() {
  const dir = path.join(cwd, "src-tauri", "target", "release", "bundle", "nsis");
  const files = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const installers = [];
  for (const file of files) {
    if (!file.isFile() || !file.name.endsWith(".exe")) continue;
    const filePath = path.join(dir, file.name);
    const stat = await fs.stat(filePath);
    installers.push({ filePath, mtimeMs: stat.mtimeMs });
  }
  installers.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return installers[0]?.filePath ?? null;
}

const installer = process.argv.slice(2).find((arg) => arg.toLowerCase().endsWith(".exe")) ?? await newestInstaller();
if (!installer) throw new Error("No Windows installer artifact found.");

const signtool = run("where.exe", ["signtool.exe"]);
const signtoolPath = signtool.status === 0
  ? signtool.stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => line.toLowerCase().endsWith("signtool.exe"))
  : await windowsKitSignTool();
if (!signtoolPath) {
  console.log(JSON.stringify({ result: "SKIP", reason: "signtool.exe not found", installer }, null, 2));
  process.exit(0);
}

const verify = run(signtoolPath, ["verify", "/pa", "/v", installer]);
const result = {
  result: verify.status === 0 ? "PASS" : "FAIL",
  installer,
  signtool: signtoolPath,
  stdout: verify.stdout,
  stderr: verify.stderr,
};
console.log(JSON.stringify(result, null, 2));
if (verify.status !== 0) process.exitCode = 1;
