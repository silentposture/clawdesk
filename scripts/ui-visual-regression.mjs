import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const cwd = process.cwd();
const smokeDir = path.join(cwd, "artifacts", "gui-smoke");
const baselineDir = path.join(cwd, "artifacts", "gui-baseline");

function run(command, args) {
  return spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: false,
    windowsHide: process.platform === "win32",
    env: process.env,
  });
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function statSize(filePath) {
  const stat = await fs.stat(filePath);
  return stat.size;
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function main() {
  let smoke = run(process.execPath, ["scripts/smoke-gui.mjs", "--app-server=preview"]);
  if (smoke.status !== 0) {
    smoke = run(process.execPath, ["scripts/smoke-gui.mjs", "--app-server=preview"]);
  }
  if (smoke.status !== 0) {
    throw new Error(`smoke:gui:prod failed after retry with exit code ${smoke.status ?? 1}`);
  }

  await ensureDir(baselineDir);
  const files = ["01-login-before.png", "02-after-login.png", "03-after-flow.png"];
  const results = [];

  for (const name of files) {
    const src = path.join(smokeDir, name);
    if (!(await fileExists(src))) {
      throw new Error(`Missing smoke screenshot: ${src}`);
    }
    const dst = path.join(baselineDir, name);
    const previousExists = await fileExists(dst);
    const currentSize = await statSize(src);
    const previousSize = previousExists ? await statSize(dst) : 0;
    const deltaRatio = previousExists && previousSize > 0
      ? Math.abs(currentSize - previousSize) / previousSize
      : 0;

    if (previousExists && deltaRatio > 0.65) {
      throw new Error(`Visual drift too large for ${name}: ${(deltaRatio * 100).toFixed(1)}%`);
    }

    await fs.copyFile(src, dst);
    results.push({
      file: name,
      baselineUpdated: true,
      previousSize,
      currentSize,
      deltaRatio,
    });
  }

  const summary = {
    createdAt: new Date().toISOString(),
    result: "PASS",
    baselineDir,
    checks: results,
  };
  const reportPath = path.join(baselineDir, `${new Date().toISOString().replace(/[:.]/g, "_")}-visual-regression.json`);
  await fs.writeFile(reportPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));
  console.log(`UI visual regression report: ${reportPath}`);
}

main().catch((error) => {
  console.error(`UI visual regression failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});


