import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const cwd = process.cwd();
const bundleDir = path.join(cwd, "src-tauri", "target", "release", "bundle", "dmg");

function run(command, args) {
  return spawnSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: false });
}

if (process.platform !== "darwin") {
  throw new Error("macOS DMG smoke must run on macOS.");
}

const entries = await fs.readdir(bundleDir, { withFileTypes: true });
const dmg = entries.find((entry) => entry.isFile() && entry.name.endsWith(".dmg"));
if (!dmg) throw new Error(`No DMG found under ${bundleDir}`);
const dmgPath = path.join(bundleDir, dmg.name);
const spctl = run("spctl", ["-a", "-t", "open", "--context", "context:primary-signature", "-v", dmgPath]);
console.log(spctl.stdout || spctl.stderr);
if (spctl.status !== 0) process.exitCode = 1;
