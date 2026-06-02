import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (!(key in process.env) && value) process.env[key] = value;
  }
}

function runStep(name, command, args) {
  console.log(`\n=== ${name} ===`);
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: false,
    windowsHide: process.platform === "win32",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`${name} failed with exit code ${result.status ?? 1}`);
  }
}

function requireAnyEnv(groupName, keys) {
  const hasAny = keys.some((key) => Boolean(process.env[key]));
  if (!hasAny) {
    throw new Error(`${groupName} missing: ${keys.join(" or ")}`);
  }
}

function requireAllEnv(groupName, keys) {
  const missing = keys.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`${groupName} missing: ${missing.join(", ")}`);
  }
}

try {
  loadDotEnv(path.join(cwd, ".env.production"));
  loadDotEnv(path.join(cwd, ".env"));

  if (!process.env.CLAWDESK_RELEASE_CHANNEL) process.env.CLAWDESK_RELEASE_CHANNEL = "beta-direct";

  requireAllEnv("Gateway/Lemon", [
    "CLAWDESK_GATEWAY_BASE_URL",
    "LEMON_SQUEEZY_WEBHOOK_SECRET",
    "LEMON_SQUEEZY_STORE_ID",
    "LEMON_SQUEEZY_PRODUCT_ID",
    "LEMON_SQUEEZY_VARIANT_ID_PRO_YEARLY",
    "LEMON_SQUEEZY_VARIANT_ID_LIFETIME",
  ]);
  if (!process.env.CLAWDESK_SSO_ISSUER_URL || !process.env.CLAWDESK_SSO_CLIENT_ID) {
    console.log("Gateway SSO env not set; Windows direct-download Beta treats SSO as optional.");
  }
  requireAnyEnv("Windows signing", [
    "WINDOWS_SIGNING_CERTIFICATE",
    "WINDOWS_SIGNING_CERTIFICATE_SUBJECT",
    "AZURE_TRUSTED_SIGNING_ACCOUNT_NAME",
  ]);
  requireAnyEnv("Support contact", ["CLAWDESK_SUPPORT_EMAIL", "CLAWDESK_SUPPORT_URL"]);

  runStep("Build Windows installer", "npm.cmd", ["run", "tauri:build:win"]);
  runStep("Sign doctor", "npm.cmd", ["run", "sign:win:doctor"]);

  if (process.env.WINDOWS_SIGNING_CERTIFICATE || process.env.WINDOWS_SIGNING_CERTIFICATE_SUBJECT) {
    runStep("Sign installer", "npm.cmd", ["run", "sign:win-installer"]);
  } else {
    console.log("\n=== Sign installer ===");
    console.log("Skip local signing: Azure Trusted Signing env detected, expected CI signing path.");
  }

  runStep("Beta release guard", "npm.cmd", ["run", "release:guard:beta"]);
  runStep("Beta QA (app+installer)", "npm.cmd", ["run", "qa:beta-direct:win"]);
  console.log("\nAuto beta release pipeline: PASS");
} catch (error) {
  console.error(`\nAuto beta release pipeline: BLOCKED - ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}


