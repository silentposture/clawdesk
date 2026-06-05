import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "clawdesk-host-agent-install-"));
const bundleDir = path.join(stateDir, "bundle");

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

function spawnLauncher(baseUrl, manifest) {
  return spawn(process.execPath, [
    "src/bridge/host-agent-launcher.mjs",
    "--status-file",
    manifest.statusPath,
    "--gateway",
    baseUrl,
    "--target-id",
    manifest.targetId,
    "--target-name",
    manifest.targetName,
    "--kind",
    manifest.kind,
    "--host-name",
    manifest.hostName,
    "--bridge-version",
    manifest.bridgeVersion,
    "--config",
    manifest.configPath,
    "--lock-file",
    manifest.lockPath,
    "--daemon",
    "--heartbeat-interval-ms",
    "250",
    "--max-heartbeats",
    "2",
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

  const manifest = JSON.parse(await fs.readFile(path.join(bundleDir, "host-agent-install.json"), "utf8"));
  if (manifest.runtimeEntryPoint !== "src/bridge/host-agent-launcher.mjs") throw new Error("manifest runtime entry point mismatch");
  if (manifest.runtimeInstallMode !== "service-friendly-launcher") throw new Error("manifest runtime install mode mismatch");
  if (!manifest.launcherCommand.includes("host-agent-launcher.mjs")) throw new Error("manifest launcher command missing launcher entry point");
  if (!manifest.launcherCommand.includes("--status-file")) throw new Error("manifest launcher command missing status file");

  const readme = await fs.readFile(path.join(bundleDir, "README.md"), "utf8");
  if (!readme.includes("Host Agent Install Bundle")) throw new Error("bundle readme missing title");
  if (!readme.includes("service-friendly handoff")) throw new Error("bundle readme missing service-friendly wording");

  const launchCmd = await fs.readFile(path.join(bundleDir, "launch-host-agent.cmd"), "utf8");
  if (!launchCmd.includes("CLAWDESK_HOST_AGENT_STATUS_FILE")) throw new Error("launch cmd missing status env");

  const launchPs1 = await fs.readFile(path.join(bundleDir, "launch-host-agent.ps1"), "utf8");
  if (!launchPs1.includes("CLAWDESK_HOST_AGENT_STATUS_FILE")) throw new Error("launch ps1 missing status env");

  const uninstallPs1 = await fs.readFile(path.join(bundleDir, "uninstall-host-agent.ps1"), "utf8");
  if (!uninstallPs1.includes("Removed host agent config, lock, and status files.")) throw new Error("uninstall script missing cleanup message");

  const launcherProcess = spawnLauncher(baseUrl, manifest);
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

  const statusPath = manifest.statusPath;
  const status = await waitForFile(statusPath);
  if (status.state !== "stopped") throw new Error(`unexpected launcher state: ${status.state}`);
  if (status.resultStatus !== "stopped") throw new Error(`unexpected launcher result status: ${status.resultStatus}`);
  if (!status.bridgeId) throw new Error("launcher did not persist bridge id");
  if (!status.configPath || status.configPath !== manifest.configPath) throw new Error("launcher status did not persist config path");

  const config = JSON.parse(await fs.readFile(manifest.configPath, "utf8"));
  if (config.bridgeId !== status.bridgeId) throw new Error("config and status bridge id mismatch");
  if (config.lockPath !== manifest.lockPath) throw new Error("config lock path mismatch");

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
