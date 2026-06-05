import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "clawdesk-host-enrollment-"));
const stateFile = path.join(stateDir, "state.json");
async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const reserved = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return reserved;
}

const probePort = await reservePort();
let port = await reservePort();
while (port === probePort) {
  port = await reservePort();
}
const baseUrl = `http://127.0.0.1:${port}`;
let gatewayOutput = "";
const listener = net.createServer();
await new Promise((resolve) => listener.listen(probePort, "127.0.0.1", resolve));

async function cleanupTempFiles() {
  await fs.rm(stateDir, { recursive: true, force: true });
}

function spawnGateway() {
  const child = spawn(process.execPath, ["sidecars/mock-gateway/server.mjs"], {
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
  child.stdout.on("data", (chunk) => {
    gatewayOutput += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    gatewayOutput += chunk.toString();
  });
  return child;
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 2000))]);
}

async function waitForHealth(timeoutMs = 8000) {
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

async function postJson(pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  return { response, payload };
}

async function getJson(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`);
  const payload = await response.json();
  return { response, payload };
}

async function waitForStateFile(timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const raw = await fs.readFile(stateFile, "utf8");
      const snapshot = JSON.parse(raw);
      if (snapshot && snapshot.targetRegistry?.targets?.length) {
        return snapshot;
      }
    } catch {
      await delay(100);
    }
    await delay(100);
  }
  throw new Error("gateway state file was not written");
}

const gateway = spawnGateway();

try {
  const health = await waitForHealth();
  if (health.name !== "clawdesk-mock-gateway") throw new Error("unexpected health identity");

  const registry = {
    defaultTargetId: "rdp-host",
    targetGroups: [],
    targets: [
      {
        id: "rdp-host",
        displayName: "RDP Host",
        kind: "remote-desktop",
        state: "offline",
        paired: false,
        trustedWorkspaces: ["~/ClawDesk Projects/RDP"],
        connection: {
          username: "ops-user",
          port: probePort,
          credentialMode: "platform-managed",
          sessionMode: "observe",
        },
        adapters: [
          {
            kind: "remote-desktop",
            endpoint: `rdp://127.0.0.1:${probePort}`,
            authenticated: false,
            hostKeyVerified: false,
            supportsTerminal: false,
            supportsScreen: true,
            supportsClipboard: false,
            supportsFileTransfer: false,
          },
        ],
      },
    ],
  };

  const save = await postJson("/targets", { registry });
  if (!save.response.ok) throw new Error(`target registry save failed: ${save.response.status}`);

  const ticket = await postJson("/targets/host-enrollment-ticket", {
    targetId: "rdp-host",
    targetName: "RDP Host",
    kind: "remote-desktop",
    hostName: "Ops Host Bridge",
    bridgeVersion: "1.0.0-test",
    expiresInMinutes: 15,
  });
  if (!ticket.response.ok || !ticket.payload.allowed || !ticket.payload.ticket?.code) {
    throw new Error(`host enrollment ticket issuance failed: ${ticket.payload.reason || ticket.response.status}`);
  }

  const enroll = await postJson("/targets/host-enrollment", {
    targetId: "rdp-host",
    enrollmentCode: ticket.payload.ticket.code,
    hostName: "Ops Host Bridge",
    bridgeVersion: "1.0.0-test",
  });
  if (!enroll.response.ok || !enroll.payload.allowed) throw new Error(`host enrollment failed: ${enroll.payload.reason || enroll.response.status}`);
  if (!enroll.payload.target?.paired) throw new Error("host enrollment did not mark target as paired");
  if (enroll.payload.target?.connection?.hostBridge?.state !== "registered") throw new Error("host enrollment did not register host bridge");

  await waitForStateFile();

  const heartbeat = await postJson("/targets/host-bridge/heartbeat", {
    targetId: "rdp-host",
    bridgeId: enroll.payload.target?.connection?.hostBridge?.bridgeId,
    hostName: "Ops Host Bridge",
    bridgeVersion: "1.0.0-test",
  });
  if (!heartbeat.response.ok || !heartbeat.payload.allowed) throw new Error(`host bridge heartbeat failed: ${heartbeat.payload.reason || heartbeat.response.status}`);
  if (heartbeat.payload.target?.connection?.hostBridge?.state !== "registered") throw new Error("host bridge heartbeat did not keep bridge registered");

  await waitForStateFile();

  const attest = await postJson("/targets/host-bridge/attest", {
    targetId: "rdp-host",
    bridgeId: heartbeat.payload.target?.connection?.hostBridge?.bridgeId,
    hostName: "Ops Host Bridge",
    bridgeVersion: "1.0.0-test",
    deviceId: "rdp-host-device",
    installId: "rdp-host-install",
    platform: "windows-11",
  });
  if (!attest.response.ok || !attest.payload.allowed) throw new Error(`host bridge attestation failed: ${attest.payload.reason || attest.response.status}`);
  if (attest.payload.target?.connection?.hostBridge?.attestedAt === undefined) throw new Error("host bridge attestation timestamp was not recorded");
  if (attest.payload.target?.connection?.hostBridge?.deviceId !== "rdp-host-device") throw new Error("host bridge device id was not recorded");
  if (attest.payload.target?.connection?.hostBridge?.installId !== "rdp-host-install") throw new Error("host bridge install id was not recorded");

  await waitForStateFile();

  const probe = await postJson("/targets/connection", { targetId: "rdp-host", action: "probe" });
  if (!probe.response.ok || !probe.payload.allowed) throw new Error(`probe failed: ${probe.payload.reason || probe.response.status}`);
  if (probe.payload.target?.connection?.lastProbeResult !== "reachable") throw new Error("probe did not mark target reachable");

  const readiness = await getJson("/targets/connection-readiness?targetId=rdp-host");
  if (!readiness.response.ok || !readiness.payload.report?.readyToConnect) throw new Error("target should be ready after host enrollment and probe");
  if (readiness.payload.report.nextAction !== "connect") throw new Error(`unexpected next action: ${readiness.payload.report.nextAction}`);
  const hostBridgeCheck = readiness.payload.report.checks.find((check) => check.key === "host-bridge");
  if (!hostBridgeCheck || hostBridgeCheck.status !== "pass") throw new Error("host bridge readiness check did not pass");
  const hostAttestationCheck = readiness.payload.report.checks.find((check) => check.key === "attestation");
  if (!hostAttestationCheck || hostAttestationCheck.status !== "pass") throw new Error("host bridge attestation readiness check did not pass");

  const audit = await getJson("/backend/audit?limit=50");
  if (!audit.response.ok) throw new Error("audit endpoint failed");
  const actions = audit.payload.events.map((event) => event.action);
  if (!actions.includes("targets.host-enrollment-ticket.issued")) throw new Error("missing host enrollment ticket issue audit event");
  if (!actions.includes("targets.host-enrollment-ticket.redeemed")) throw new Error("missing host enrollment ticket redeem audit event");
  if (!actions.includes("targets.host-enrollment")) throw new Error("missing host enrollment audit event");
  if (!actions.includes("targets.host-bridge.attest")) throw new Error("missing host bridge attestation audit event");
  if (!actions.includes("targets.host-bridge.heartbeat")) throw new Error("missing host bridge heartbeat audit event");

  await waitForStateFile();

  await stop(gateway);
  const restartedGateway = spawnGateway();
  try {
    await waitForHealth();
    const registryAfterRestart = await getJson("/targets");
    const targetAfterRestart = registryAfterRestart.payload.registry?.targets?.find((entry) => entry.id === "rdp-host");
    if (!targetAfterRestart) throw new Error("target disappeared after restart");
    if (targetAfterRestart.connection?.hostBridge?.state !== "registered") throw new Error("host bridge state did not persist after restart");
    if (!targetAfterRestart.connection?.hostBridge?.lastSeenAt) throw new Error("host bridge heartbeat timestamp did not persist after restart");
    if (!targetAfterRestart.connection?.hostBridge?.attestedAt) throw new Error("host bridge attestation timestamp did not persist after restart");
    if (targetAfterRestart.connection?.hostBridge?.deviceId !== "rdp-host-device") throw new Error("host bridge device id did not persist after restart");
    if (!targetAfterRestart.paired) throw new Error("paired state did not persist after restart");
    console.log("PASS host enrollment code issuance, attestation, redemption, and persistence are managed by the gateway.");
  } finally {
    await stop(restartedGateway);
  }
} finally {
  listener.close();
  await cleanupTempFiles();
  if (gatewayOutput.trim()) {
    console.log("=== gateway output ===");
    console.log(gatewayOutput.trimEnd());
    console.log("=== end gateway output ===");
  }
}
