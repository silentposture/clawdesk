import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import os from "node:os";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "clawdesk-host-agent-lock-"));
const stateFile = path.join(stateDir, "state.json");
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

function spawnBridge(baseUrl, extraArgs = []) {
  return spawn(process.execPath, [
    "src/bridge/host-bridge-agent.mjs",
    "--gateway",
    baseUrl,
    "--target-id",
    "host-agent-lock-demo",
    "--target-name",
    "HostAgentLockDemo",
    "--kind",
    "remote-desktop",
    "--host-name",
    "HostAgentLockDemo",
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

async function collectOutput(child) {
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  return output;
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

  const firstBridge = spawnBridge(baseUrl, ["--daemon", "--heartbeat-interval-ms", "500", "--max-heartbeats", "5"]);
  let firstOutput = "";
  firstBridge.stdout.on("data", (chunk) => {
    firstOutput += chunk.toString();
  });
  firstBridge.stderr.on("data", (chunk) => {
    firstOutput += chunk.toString();
  });

  const startedAt = Date.now();
  while (!firstOutput.includes("local-agent-bridge daemon") && Date.now() - startedAt < 4000) {
    await delay(50);
  }
  if (!firstOutput.includes("local-agent-bridge daemon")) {
    throw new Error("first bridge did not start daemon mode");
  }
  if (firstBridge.exitCode !== null) {
    throw new Error("first bridge exited before the lock test could run");
  }

  const secondBridge = spawnBridge(baseUrl);
  let secondOutput = "";
  secondBridge.stdout.on("data", (chunk) => {
    secondOutput += chunk.toString();
  });
  secondBridge.stderr.on("data", (chunk) => {
    secondOutput += chunk.toString();
  });
  const secondExit = await new Promise((resolve) => secondBridge.on("close", resolve));
  if (secondExit === 0) {
    throw new Error("second bridge unexpectedly succeeded while lock was held");
  }
  if (!/already running|lock/i.test(secondOutput)) {
    throw new Error(`second bridge did not report a lock conflict:\n${secondOutput}`);
  }

  const firstExit = await new Promise((resolve) => firstBridge.on("close", resolve));
  if (firstExit !== 0) {
    throw new Error(`first bridge exited with code ${firstExit}\n${firstOutput}`);
  }

  const config = JSON.parse(await fs.readFile(configFile, "utf8"));
  if (config.lockPath !== lockFile) throw new Error("host agent config did not persist lock path");

  console.log("PASS host agent lock prevents concurrent instances and persists lock metadata.");
} finally {
  await stop(gateway);
  await cleanup();
  if (output.trim()) {
    console.log("=== gateway output ===");
    console.log(output.trimEnd());
    console.log("=== end gateway output ===");
  }
}
