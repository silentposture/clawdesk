import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import os from "node:os";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "clawdesk-host-agent-config-"));
const stateFile = path.join(stateDir, "state.json");
const configFile = path.join(stateDir, "host-agent.json");

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

async function runBridge(baseUrl, extraArgs = []) {
  const bridgeRun = spawn(process.execPath, [
    "src/bridge/host-bridge-agent.mjs",
    "--gateway",
    baseUrl,
    "--target-id",
    "host-agent-config-demo",
    "--target-name",
    "HostAgentConfigDemo",
    "--kind",
    "remote-desktop",
    "--host-name",
    "Host Agent Config Demo",
    "--config",
    configFile,
    ...extraArgs,
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  let output = "";
  bridgeRun.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  bridgeRun.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  const exitCode = await new Promise((resolve) => bridgeRun.on("close", resolve));
  if (exitCode !== 0) {
    throw new Error(`bridge host exited with code ${exitCode}\n${output}`);
  }

  return output;
}

function extractFirstJsonObject(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("bridge output did not contain a JSON object");
  }
  return JSON.parse(text.slice(start, end + 1));
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

  const firstRunOutput = await runBridge(baseUrl, ["--daemon", "--heartbeat-interval-ms", "250", "--max-heartbeats", "2"]);
  if (!firstRunOutput.includes("local-agent-bridge daemon")) {
    throw new Error("first bridge run did not include daemon heading");
  }

  const firstConfig = JSON.parse(await fs.readFile(configFile, "utf8"));
  if (!firstConfig.bridgeId) throw new Error("bridge config did not persist bridge id");
  if (!firstConfig.deviceId) throw new Error("bridge config did not persist device id");
  if (!firstConfig.installId) throw new Error("bridge config did not persist install id");
  if (firstConfig.configVersion !== 1) throw new Error("bridge config version mismatch");

  const secondRunOutput = await runBridge(baseUrl, ["--dry-run"]);
  if (!secondRunOutput.includes("local-agent-bridge dry run")) {
    throw new Error("second bridge run did not include dry run heading");
  }
  const secondPayload = extractFirstJsonObject(secondRunOutput);
  if (secondPayload.configPath !== configFile) throw new Error("dry run did not use the persisted config path");
  if (secondPayload.bridgeId !== firstConfig.bridgeId) throw new Error("bridge id did not persist across runs");
  if (secondPayload.deviceId !== firstConfig.deviceId) throw new Error("device id did not persist across runs");
  if (secondPayload.installId !== firstConfig.installId) throw new Error("install id did not persist across runs");

  const registry = await fetch(`${baseUrl}/targets`);
  const registryPayload = await registry.json();
  if (!registry.ok) throw new Error("target registry endpoint failed");
  const target = registryPayload.registry?.targets?.find((entry) => entry.id === "host-agent-config-demo");
  if (!target) throw new Error("host agent config target missing after bridge run");
  if (target.connection?.hostBridge?.state !== "registered") throw new Error("host agent config bridge was not registered");
  if (!target.connection?.hostBridge?.attestedAt) throw new Error("host agent config attestation timestamp missing");
  if (!target.connection?.hostBridge?.lastSeenAt) throw new Error("host agent config heartbeat timestamp missing");

  console.log("PASS host agent config persists bridge identity across runs.");
} finally {
  await stop(gateway);
  await cleanup();
  if (output.trim()) {
    console.log("=== gateway output ===");
    console.log(output.trimEnd());
    console.log("=== end gateway output ===");
  }
}
