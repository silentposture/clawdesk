import fs from "node:fs/promises";
import path from "node:path";
import { validateSurface } from "./lib/verify-report.mjs";

const root = process.cwd();
const targets = [
  path.join(root, "artifacts", "backend-sim"),
  path.join(root, "artifacts", "production-gateway-sim"),
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function latestJsonFile(dir) {
  const files = await fs.readdir(dir, { withFileTypes: true });
  const candidates = files.filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
  if (candidates.length === 0) return null;
  const withStats = await Promise.all(
    candidates.map(async (entry) => ({
      name: entry.name,
      stat: await fs.stat(path.join(dir, entry.name)),
    })),
  );
  withStats.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  return path.join(dir, withStats[0].name);
}

async function validateReport(file) {
  const raw = await fs.readFile(file, "utf8");
  const report = JSON.parse(raw);
  assert(Array.isArray(report.checks), `${file}: checks must be array`);
  assert(report.counts && Number.isFinite(report.counts.total), `${file}: counts.total missing`);
  assert(report.counts && Number.isFinite(report.counts.failed), `${file}: counts.failed missing`);
  assert(report.surfaces && typeof report.surfaces === "object", `${file}: surfaces missing`);
  for (const key of ["canonical", "legacy", "mixed"]) {
    assert(report.surfaces[key], `${file}: surfaces.${key} missing`);
    assert(Number.isFinite(report.surfaces[key].total), `${file}: surfaces.${key}.total missing`);
    assert(Number.isFinite(report.surfaces[key].failed), `${file}: surfaces.${key}.failed missing`);
  }
  for (const item of report.checks) {
    validateSurface(item.contractSurface ?? "mixed");
  }
  const totalBySurface = report.surfaces.canonical.total + report.surfaces.legacy.total + report.surfaces.mixed.total;
  assert(totalBySurface === report.counts.total, `${file}: surfaces total mismatch counts.total`);
}

async function run() {
  const failures = [];
  for (const dir of targets) {
    try {
      const file = await latestJsonFile(dir);
      if (!file) {
        failures.push(`${dir}: no json report found`);
        continue;
      }
      await validateReport(file);
      console.log(`PASS ${file}`);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (failures.length > 0) {
    for (const failure of failures) console.error(`FAIL ${failure}`);
    process.exitCode = 1;
  }
}

await run();
