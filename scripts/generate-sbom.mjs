import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const cwd = process.cwd();
const outputDir = path.join(cwd, "artifacts", "sbom");
const checkOnly = process.argv.includes("--check");

function commandInvocation(command, args) {
  if (process.platform !== "win32") return { command, args };
  if (command.endsWith(".exe")) return { command, args };
  if (command === "cargo" || command === "node") return { command: `${command}.exe`, args };
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
  });
}

async function writeJson(fileName, payload) {
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, fileName), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function assertExists(fileName) {
  await fs.access(path.join(outputDir, fileName));
}

async function main() {
  if (checkOnly) {
    await assertExists("npm-sbom.json");
    await assertExists("cargo-sbom.json");
    console.log("SBOM artifacts are present.");
    return;
  }

  await fs.mkdir(outputDir, { recursive: true });

  const npmResult = run("npm", ["sbom", "--sbom-format", "cyclonedx", "--sbom-type", "application"]);
  if (npmResult.status === 0 && npmResult.stdout.trim()) {
    await fs.writeFile(path.join(outputDir, "npm-sbom.json"), npmResult.stdout, "utf8");
  } else {
    const packageLock = JSON.parse(await fs.readFile(path.join(cwd, "package-lock.json"), "utf8"));
    await writeJson("npm-sbom.json", {
      bomFormat: "CycloneDX",
      specVersion: "1.5",
      metadata: { component: { name: packageLock.name, version: packageLock.version } },
      components: Object.entries(packageLock.packages ?? {})
        .filter(([name]) => name.startsWith("node_modules/"))
        .map(([name, value]) => ({ type: "library", name: name.replace("node_modules/", ""), version: value.version ?? "unknown" })),
      generationWarning: "npm sbom was unavailable; generated from package-lock.json.",
    });
  }

  const cargoLock = await fs.readFile(path.join(cwd, "src-tauri", "Cargo.lock"), "utf8");
  const packages = [];
  let current = null;
  for (const line of cargoLock.split(/\r?\n/)) {
    if (line.trim() === "[[package]]") {
      if (current?.name) packages.push(current);
      current = {};
      continue;
    }
    if (!current) continue;
    const name = line.match(/^name = "(.+)"$/);
    const version = line.match(/^version = "(.+)"$/);
    if (name) current.name = name[1];
    if (version) current.version = version[1];
  }
  if (current?.name) packages.push(current);
  await writeJson("cargo-sbom.json", {
    bomFormat: "CycloneDX-compatible",
    specVersion: "1.5",
    metadata: { component: { name: "openclaw-desktop", version: "0.1.0" } },
    components: packages.map((pkg) => ({ type: "library", name: pkg.name, version: pkg.version ?? "unknown" })),
    generationWarning: "cargo-cyclonedx is not required locally; this artifact is generated from Cargo.lock.",
  });

  console.log(`generated ${path.relative(cwd, outputDir)}\\npm-sbom.json`);
  console.log(`generated ${path.relative(cwd, outputDir)}\\cargo-sbom.json`);
}

await main();
