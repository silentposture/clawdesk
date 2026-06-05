import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import os from "node:os";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "clawdesk-host-agent-launcher-"));
const stateFile = path.join(stateDir, "state.json");
const statusFile = path.join(stateDir, "status.json");
const configFile = path.join(stateDir, "host-agent.json");
const lockFile = path.join(stateDir, "host-agent.lock");

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const reserved = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return reserved;
}

async function cleanup() {
  await fs.rm(stateDir, { recursive: true, force: true });
}

async function waitForHealth(baseUrl, timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return response.json();
    } catch {
      // keep waiting
    }
    await delay(100);
  }
  throw new Error("gateway did not become healthy");
}

function spawnGateway(port) {
  return spawn(process.execPath, ["sidecars/mock-gateway/server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CLAWDESK_MOCK_PORT: String(port),
      OPENCLAW_MOCK_PORT: String(port),
      CLAWDESK_MOCK_STATE_FILE: stateFile,
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

function spawnLauncher(baseUrl, extraArgs = []) {
  return spawn(process.execPath, [
    "src/bridge/host-agent-launcher.mjs",
    "--status-file",
    statusFile,
    "--gateway",
    baseUrl,
    "--target-id",
    "host-agent-launcher-demo",
    "--target-name",
    "HostAgentLauncherDemo",
    "--kind",
    "remote-desktop",
    "--host-name",
    "HostAgentLauncherDemo",
    "--config",
    configFile,
    "--lock-file",
    lockFile,
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

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function waitForFile(filePath, timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      return await readJson(filePath);
    } catch {
      await delay(100);
    }
  }
  throw new Error(`timed out waiting for ${filePath}`);
}

const port = await reservePort();
const baseUrl = `http://127.0.0.1:${port}`;
const gateway = spawnGateway(port);
let output = "";
gateway.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
gateway.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

try {
  const health = await waitForHealth(baseUrl);
  if (health.name !== "clawdesk-mock-gateway") throw new Error("unexpected health identity");

  const launcher = spawnLauncher(baseUrl, ["--daemon", "--heartbeat-interval-ms", "250", "--max-heartbeats", "2"]);
  let launcherOutput = "";
  launcher.stdout.on("data", (chunk) => {
    launcherOutput += chunk.toString();
  });
  launcher.stderr.on("data", (chunk) => {
    launcherOutput += chunk.toString();
  });

  const exited = await new Promise((resolve) => launcher.on("close", resolve));
  if (exited !== 0) {
    throw new Error(`launcher exited with code ${exited}\n${launcherOutput}`);
  }

  const status = await waitForFile(statusFile);
  if (status.state !== "stopped") throw new Error(`unexpected launcher status state: ${status.state}`);
  if (!status.configPath || status.configPath !== configFile) throw new Error("launcher status did not persist config path");
  if (!status.lockPath || status.lockPath !== lockFile) throw new Error("launcher status did not persist lock path");
  if (status.resultStatus !== "stopped") throw new Error(`unexpected launcher result status: ${status.resultStatus}`);
  if (!status.bridgeId) throw new Error("launcher status did not persist bridge id");

  const config = await readJson(configFile);
  if (config.lockPath !== lockFile) throw new Error("launcher config did not persist lock path");
  if (config.bridgeId !== status.bridgeId) throw new Error("launcher config and status bridge id mismatch");

  const registry = await fetch(`${baseUrl}/targets`);
  const registryPayload = await registry.json();
  if (!registry.ok) throw new Error("target registry endpoint failed");
  const target = registryPayload.registry?.targets?.find((entry) => entry.id === "host-agent-launcher-demo");
  if (!target) throw new Error("launcher target missing after run");
  if (target.connection?.hostBridge?.state !== "registered") throw new Error("launcher bridge was not registered");
  if (!target.connection?.hostBridge?.attestedAt) throw new Error("launcher attestation timestamp missing");
  if (!target.connection?.hostBridge?.lastSeenAt) throw new Error("launcher heartbeat timestamp missing");

  console.log("PASS host agent launcher writes lifecycle status and preserves config state.");
} finally {
  await stop(gateway);
  await cleanup();
  if (output.trim()) {
    console.log("=== gateway output ===");
    console.log(output.trimEnd());
    console.log("=== end gateway output ===");
  }
}
