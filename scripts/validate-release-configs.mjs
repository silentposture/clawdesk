import fs from "node:fs/promises";
import path from "node:path";

const cwd = process.cwd();

function parseArgs(argv) {
  return {
    store: argv.includes("--store"),
    macos: argv.includes("--macos"),
  };
}

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.join(cwd, relativePath), "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function resourceKeys(config) {
  const resources = config.bundle?.resources ?? {};
  return typeof resources === "object" && !Array.isArray(resources) ? Object.keys(resources) : [];
}

async function validateStoreConfig() {
  const config = await readJson("src-tauri/tauri.microsoftstore.conf.json");
  const resources = resourceKeys(config);
  assert(config.productName === "ClawDesk", "Store config productName must be ClawDesk.");
  assert(config.bundle?.publisher === "ClawDesk Contributors", "Store config bundle.publisher must be ClawDesk Contributors.");
  assert(config.bundle?.targets?.includes("nsis"), "Store config must target nsis for Microsoft Store offline installer submission.");
  assert(config.bundle?.windows?.webviewInstallMode?.type === "offlineInstaller", "Store config must embed WebView2 offlineInstaller.");
  assert(config.bundle?.windows?.digestAlgorithm?.toLowerCase() === "sha256", "Store config must use SHA-256 digest.");
  assert(config.bundle?.windows?.timestampUrl, "Store config must define a timestamp URL for code signing.");
  assert(!resources.includes("../sidecars/mock-gateway/server.mjs"), "Store config must not bundle mock Gateway.");
  for (const required of [
    "../docs/legal/INSTALLER_TERMS.md",
    "../docs/legal/DEVELOPER_DISCLOSURE.md",
    "../docs/legal/OPENCLAW_MIT_NOTICE.md",
    "../docs/legal/THIRD_PARTY_NOTICES.md",
    "../docs/support/CONTACT.md",
  ]) {
    assert(resources.includes(required), `Store config must bundle ${required}.`);
  }
  return { target: "store-win", publisher: config.bundle.publisher, webviewInstallMode: config.bundle.windows.webviewInstallMode };
}

async function validateMacosConfig() {
  const config = await readJson("src-tauri/tauri.macos.conf.json");
  const resources = resourceKeys(config);
  assert(config.productName === "ClawDesk", "macOS config productName must be ClawDesk.");
  assert(config.bundle?.publisher === "ClawDesk Contributors", "macOS config bundle.publisher must be ClawDesk Contributors.");
  assert(config.bundle?.targets?.includes("app"), "macOS config must target app.");
  assert(config.bundle?.targets?.includes("dmg"), "macOS config must target dmg.");
  assert(config.bundle?.macOS?.dmg, "macOS config must define dmg layout.");
  assert(!resources.includes("../sidecars/mock-gateway/server.mjs"), "macOS release config must not bundle mock Gateway.");
  for (const required of [
    "../docs/legal/INSTALLER_TERMS.md",
    "../docs/legal/DEVELOPER_DISCLOSURE.md",
    "../docs/legal/OPENCLAW_MIT_NOTICE.md",
    "../docs/legal/THIRD_PARTY_NOTICES.md",
    "../docs/support/CONTACT.md",
  ]) {
    assert(resources.includes(required), `macOS config must bundle ${required}.`);
  }
  return { target: "macos", targets: config.bundle.targets };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const checks = [];
  if (options.store || (!options.store && !options.macos)) checks.push(await validateStoreConfig());
  if (options.macos || (!options.store && !options.macos)) checks.push(await validateMacosConfig());
  console.log(JSON.stringify({ result: "PASS", checks }, null, 2));
}

await main();
