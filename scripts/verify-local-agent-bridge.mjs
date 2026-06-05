import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import os from "node:os";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "clawdesk-local-bridge-"));
const stateFile = path.join(stateDir, "state.json");

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

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
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

  const bridgeRun = spawn(process.execPath, [
    "examples/local-agent-bridge/bridge-agent.mjs",
    "--gateway",
    baseUrl,
    "--target-id",
    "local-host-bridge",
    "--target-name",
    "Local Host Bridge",
    "--kind",
    "remote-desktop",
    "--host-name",
    "Local Host Bridge",
    "--daemon",
    "--heartbeat-interval-ms",
    "250",
    "--max-heartbeats",
    "3",
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let bridgeOutput = "";
  bridgeRun.stdout.on("data", (chunk) => {
    bridgeOutput += chunk.toString();
  });
  bridgeRun.stderr.on("data", (chunk) => {
    bridgeOutput += chunk.toString();
  });

  const exitCode = await new Promise((resolve) => bridgeRun.on("close", resolve));
  if (exitCode !== 0) {
    throw new Error(`bridge agent exited with code ${exitCode}\n${bridgeOutput}`);
  }

  if (!bridgeOutput.includes("local-agent-bridge daemon")) {
    throw new Error("bridge output did not include the expected daemon heading");
  }

  const audit = await fetch(`${baseUrl}/backend/audit?limit=50`);
  const auditPayload = await audit.json();
  if (!audit.ok) throw new Error("audit endpoint failed");
  const actions = auditPayload.events.map((event) => event.action);
  if (!actions.includes("targets.host-enrollment-ticket.issued")) throw new Error("missing host enrollment ticket issue audit event");
  if (!actions.includes("targets.host-enrollment-ticket.redeemed")) throw new Error("missing host enrollment ticket redeem audit event");
  if (!actions.includes("targets.host-enrollment")) throw new Error("missing host enrollment audit event");
  if (!actions.includes("targets.host-bridge.attest")) throw new Error("missing host bridge attestation audit event");
  if (!actions.includes("targets.host-bridge.heartbeat")) throw new Error("missing host bridge heartbeat audit event");
  const heartbeatEvents = auditPayload.events.filter((event) => event.action === "targets.host-bridge.heartbeat");
  if (heartbeatEvents.length < 2) throw new Error("expected the daemon bridge to emit more than one heartbeat");

  const registry = await fetch(`${baseUrl}/targets`);
  const registryPayload = await registry.json();
  if (!registry.ok) throw new Error("target registry endpoint failed");
  const target = registryPayload.registry?.targets?.find((entry) => entry.id === "local-host-bridge");
  if (!target) throw new Error("local host bridge target missing after bridge run");
  if (target.connection?.hostBridge?.state !== "registered") throw new Error("host bridge was not registered");
  if (!target.connection?.hostBridge?.attestedAt) throw new Error("host bridge attestation timestamp missing");
  if (!target.connection?.hostBridge?.lastSeenAt) throw new Error("host bridge heartbeat timestamp missing");

  console.log("PASS local host bridge example enrolled, attested, and heartbeated against the gateway.");
} finally {
  await stop(gateway);
  await cleanup();
  if (output.trim()) {
    console.log("=== gateway output ===");
    console.log(output.trimEnd());
    console.log("=== end gateway output ===");
  }
}
