import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "clawdesk-host-agent-install-"));
const bundleDir = path.join(stateDir, "bundle");
const installedDir = path.join(stateDir, "installed-bundle");

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function cleanup() {
  await fs.rm(stateDir, { recursive: true, force: true });
}

async function waitForFile(filePath, timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      return JSON.parse(await fs.readFile(filePath, "utf8"));
    } catch {
      await delay(100);
    }
  }
  throw new Error(`timed out waiting for ${filePath}`);
}

function spawnGateway(port) {
  return spawn(process.execPath, ["sidecars/mock-gateway/server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CLAWDESK_MOCK_PORT: String(port),
      OPENCLAW_MOCK_PORT: String(port),
      NODE_ENV: "test",
      NODE_OPTIONS: "--max-old-space-size=128",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 2000))]);
}

function spawnBundleScript(baseUrl, extraArgs = []) {
  return spawn(process.execPath, [
    "scripts/prepare-host-agent-install-bundle.mjs",
    "--output",
    bundleDir,
    "--gateway",
    baseUrl,
    "--target-id",
    "host-agent-install-demo",
    "--target-name",
    "HostAgentInstallDemo",
    "--kind",
    "remote-desktop",
    "--host-name",
    "HostAgentInstallDemo",
    ...extraArgs,
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

function spawnPowerShellScript(scriptPath, args = []) {
  return spawn("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    ...args,
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

const port = await reservePort();
const baseUrl = `http://127.0.0.1:${port}`;
const gateway = spawnGateway(port);
let gatewayOutput = "";
gateway.stdout.on("data", (chunk) => {
  gatewayOutput += chunk.toString();
});
gateway.stderr.on("data", (chunk) => {
  gatewayOutput += chunk.toString();
});

try {
  const bundleProcess = spawnBundleScript(baseUrl, ["--bridge-version", "bundle-demo", "--heartbeat-interval-ms", "250"]);
  let launcherOutput = "";
  bundleProcess.stdout.on("data", (chunk) => {
    launcherOutput += chunk.toString();
  });
  bundleProcess.stderr.on("data", (chunk) => {
    launcherOutput += chunk.toString();
  });

  const exitCode = await new Promise((resolve) => bundleProcess.on("close", resolve));
  if (exitCode !== 0) {
    throw new Error(`prepare-host-agent-install-bundle exited with ${exitCode}\n${launcherOutput}`);
  }

  await fs.cp(bundleDir, installedDir, { recursive: true });

  const manifest = JSON.parse(await fs.readFile(path.join(installedDir, "host-agent-install.json"), "utf8"));
  if (manifest.runtimeEntryPoint !== "src/bridge/host-agent-launcher.mjs") throw new Error("manifest runtime entry point mismatch");
  if (manifest.runtimeBridgeEntryPoint !== "src/bridge/host-bridge-agent.mjs") throw new Error("manifest runtime bridge entry point mismatch");
  if (manifest.runtimeInstallMode !== "service-friendly-launcher") throw new Error("manifest runtime install mode mismatch");
  if (!manifest.bundlePortable) throw new Error("manifest missing portable flag");
  if (path.isAbsolute(manifest.configPath) || manifest.configPath !== "host-agent.json") throw new Error("manifest config path should be relative");
  if (path.isAbsolute(manifest.lockPath) || manifest.lockPath !== "host-agent.lock") throw new Error("manifest lock path should be relative");
  if (path.isAbsolute(manifest.statusPath) || manifest.statusPath !== "host-agent-status.json") throw new Error("manifest status path should be relative");
  if (!manifest.launcherCommand.includes("src/bridge/host-agent-launcher.mjs")) throw new Error("manifest launcher command missing launcher entry point");
  if (!manifest.launcherCommand.includes("--status-file")) throw new Error("manifest launcher command missing status file");
  if (!manifest.taskName || !manifest.taskName.startsWith("ClawDeskHostAgent-")) throw new Error("manifest missing task name");

  const readme = await fs.readFile(path.join(installedDir, "README.md"), "utf8");
  if (!readme.includes("Host Agent Install Bundle")) throw new Error("bundle readme missing title");
  if (!readme.includes("service-friendly handoff")) throw new Error("bundle readme missing service-friendly wording");
  if (!readme.includes("Install")) throw new Error("bundle readme missing install section");
  if (!readme.includes("Remove")) throw new Error("bundle readme missing remove section");
  if (!readme.includes("Scheduled Task")) throw new Error("bundle readme missing scheduled task section");

  const runtimeLauncherPath = path.join(installedDir, "src", "bridge", "host-agent-launcher.mjs");
  const runtimeBridgePath = path.join(installedDir, "src", "bridge", "host-bridge-agent.mjs");
  if (!(await fs.stat(runtimeLauncherPath)).isFile()) throw new Error("bundle missing copied launcher runtime");
  if (!(await fs.stat(runtimeBridgePath)).isFile()) throw new Error("bundle missing copied bridge runtime");

  const launchCmd = await fs.readFile(path.join(installedDir, "launch-host-agent.cmd"), "utf8");
  if (!launchCmd.includes("host-agent-status.json")) throw new Error("launch cmd missing bundle-relative status file");
  if (!launchCmd.includes("pushd \"%~dp0\"")) throw new Error("launch cmd missing bundle root handoff");

  const launchPs1 = await fs.readFile(path.join(installedDir, "launch-host-agent.ps1"), "utf8");
  if (!launchPs1.includes("Push-Location $bundleRoot")) throw new Error("launch ps1 missing bundle root handoff");
  if (!launchPs1.includes("Join-Path $bundleRoot")) throw new Error("launch ps1 missing bundle-relative paths");
  if (!launchPs1.includes("host-agent-launcher.mjs")) throw new Error("launch ps1 missing runtime entry point");

  const installPs1 = await fs.readFile(path.join(installedDir, "install-host-agent.ps1"), "utf8");
  if (!installPs1.includes("register-host-agent.ps1")) throw new Error("install ps1 missing register script");
  if (!installPs1.includes("-Preview")) throw new Error("install ps1 missing preview flag");

  const removePs1 = await fs.readFile(path.join(installedDir, "remove-host-agent.ps1"), "utf8");
  if (!removePs1.includes("unregister-host-agent.ps1")) throw new Error("remove ps1 missing unregister script");
  if (!removePs1.includes("-Preview")) throw new Error("remove ps1 missing preview flag");

  const registerPs1 = await fs.readFile(path.join(installedDir, "register-host-agent.ps1"), "utf8");
  if (!registerPs1.includes("Register-ScheduledTask")) throw new Error("register ps1 missing scheduled task registration");
  if (!registerPs1.includes("-WindowStyle Hidden")) throw new Error("register ps1 missing hidden window policy");
  if (!registerPs1.includes(manifest.taskName)) throw new Error("register ps1 missing task name");
  if (!registerPs1.includes("Join-Path $PSScriptRoot \"launch-host-agent.ps1\"")) throw new Error("register ps1 missing bundle-relative launch script");

  const unregisterPs1 = await fs.readFile(path.join(installedDir, "unregister-host-agent.ps1"), "utf8");
  if (!unregisterPs1.includes("Unregister-ScheduledTask")) throw new Error("unregister ps1 missing scheduled task removal");

  const registerPreview = spawnPowerShellScript(path.join(installedDir, "register-host-agent.ps1"), ["-Preview"]);
  let registerPreviewOutput = "";
  registerPreview.stdout.on("data", (chunk) => {
    registerPreviewOutput += chunk.toString();
  });
  registerPreview.stderr.on("data", (chunk) => {
    registerPreviewOutput += chunk.toString();
  });
  const registerPreviewExit = await new Promise((resolve) => registerPreview.on("close", resolve));
  if (registerPreviewExit !== 0) {
    throw new Error(`register preview exited with ${registerPreviewExit}\n${registerPreviewOutput}`);
  }
  const registerPreviewJson = JSON.parse(registerPreviewOutput.trim());
  if (registerPreviewJson.TaskName !== manifest.taskName) throw new Error("register preview task name mismatch");
  if (registerPreviewJson.HiddenWindow !== true) throw new Error("register preview hidden window mismatch");
  if (!String(registerPreviewJson.Arguments || "").includes("launch-host-agent.ps1")) throw new Error("register preview arguments missing launch script");

  const installPreview = spawnPowerShellScript(path.join(installedDir, "install-host-agent.ps1"), ["-Preview"]);
  let installPreviewOutput = "";
  installPreview.stdout.on("data", (chunk) => {
    installPreviewOutput += chunk.toString();
  });
  installPreview.stderr.on("data", (chunk) => {
    installPreviewOutput += chunk.toString();
  });
  const installPreviewExit = await new Promise((resolve) => installPreview.on("close", resolve));
  if (installPreviewExit !== 0) {
    throw new Error(`install preview exited with ${installPreviewExit}\n${installPreviewOutput}`);
  }
  const installPreviewJson = JSON.parse(installPreviewOutput.trim());
  if (installPreviewJson.TaskName !== manifest.taskName) throw new Error("install preview task name mismatch");

  const removePreview = spawnPowerShellScript(path.join(installedDir, "remove-host-agent.ps1"), ["-Preview"]);
  let removePreviewOutput = "";
  removePreview.stdout.on("data", (chunk) => {
    removePreviewOutput += chunk.toString();
  });
  removePreview.stderr.on("data", (chunk) => {
    removePreviewOutput += chunk.toString();
  });
  const removePreviewExit = await new Promise((resolve) => removePreview.on("close", resolve));
  if (removePreviewExit !== 0) {
    throw new Error(`remove preview exited with ${removePreviewExit}\n${removePreviewOutput}`);
  }
  const removePreviewJson = JSON.parse(removePreviewOutput.trim());
  if (removePreviewJson.TaskName !== manifest.taskName) throw new Error("remove preview task name mismatch");

  const unregisterPreview = spawnPowerShellScript(path.join(installedDir, "unregister-host-agent.ps1"), ["-Preview"]);
  let unregisterPreviewOutput = "";
  unregisterPreview.stdout.on("data", (chunk) => {
    unregisterPreviewOutput += chunk.toString();
  });
  unregisterPreview.stderr.on("data", (chunk) => {
    unregisterPreviewOutput += chunk.toString();
  });
  const unregisterPreviewExit = await new Promise((resolve) => unregisterPreview.on("close", resolve));
  if (unregisterPreviewExit !== 0) {
    throw new Error(`unregister preview exited with ${unregisterPreviewExit}\n${unregisterPreviewOutput}`);
  }
  const unregisterPreviewJson = JSON.parse(unregisterPreviewOutput.trim());
  if (unregisterPreviewJson.TaskName !== manifest.taskName) throw new Error("unregister preview task name mismatch");
  if (unregisterPreviewJson.Action !== "Unregister-ScheduledTask") throw new Error("unregister preview action mismatch");

  const uninstallPs1 = await fs.readFile(path.join(installedDir, "uninstall-host-agent.ps1"), "utf8");
  if (!uninstallPs1.includes("Removed host agent config, lock, and status files.")) throw new Error("uninstall script missing cleanup message");

  const launcherProcess = spawnPowerShellScript(path.join(installedDir, "launch-host-agent.ps1"), ["-MaxHeartbeats", "2"]);
  let launcherRunOutput = "";
  launcherProcess.stdout.on("data", (chunk) => {
    launcherRunOutput += chunk.toString();
  });
  launcherProcess.stderr.on("data", (chunk) => {
    launcherRunOutput += chunk.toString();
  });
  const launcherExit = await new Promise((resolve) => launcherProcess.on("close", resolve));
  if (launcherExit !== 0) {
    throw new Error(`launcher from bundle exited with ${launcherExit}\n${launcherRunOutput}`);
  }

  const statusPath = path.join(installedDir, manifest.statusPath);
  const status = await waitForFile(statusPath);
  if (status.state !== "stopped") throw new Error(`unexpected launcher state: ${status.state}`);
  if (status.resultStatus !== "stopped") throw new Error(`unexpected launcher result status: ${status.resultStatus}`);
  if (!status.bridgeId) throw new Error("launcher did not persist bridge id");
  if (!status.configPath || status.configPath !== path.join(installedDir, manifest.configPath)) throw new Error("launcher status did not persist config path");

  const config = JSON.parse(await fs.readFile(path.join(installedDir, manifest.configPath), "utf8"));
  if (config.bridgeId !== status.bridgeId) throw new Error("config and status bridge id mismatch");
  if (config.lockPath !== path.join(installedDir, manifest.lockPath)) throw new Error("config lock path mismatch");

  const registry = await fetch(`${baseUrl}/targets`);
  const registryPayload = await registry.json();
  if (!registry.ok) throw new Error("target registry endpoint failed");
  const target = registryPayload.registry?.targets?.find((entry) => entry.id === "host-agent-install-demo");
  if (!target) throw new Error("launcher target missing after bundle run");
  if (target.connection?.hostBridge?.state !== "registered") throw new Error("launcher bridge was not registered");
  if (!target.connection?.hostBridge?.attestedAt) throw new Error("launcher attestation missing");
  if (!target.connection?.hostBridge?.lastSeenAt) throw new Error("launcher heartbeat missing");

  console.log("PASS host agent install bundle writes launcher artifacts and preserves identity state.");
} finally {
  await stop(gateway);
  await cleanup();
  if (gatewayOutput.trim()) {
    console.log("=== gateway output ===");
    console.log(gatewayOutput.trimEnd());
    console.log("=== end gateway output ===");
  }
}
