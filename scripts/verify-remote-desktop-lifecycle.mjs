import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "clawdesk-rdp-lifecycle-"));
const stateFile = path.join(stateDir, "state.json");
const listener = net.createServer();
await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
const probePort = listener.address().port;
const port = probePort + 1;
const baseUrl = `http://127.0.0.1:${port}`;
let gatewayOutput = "";

function spawnGateway() {
  const child = spawn(process.execPath, ["sidecars/mock-gateway/server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CLAWDESK_MOCK_PORT: String(port),
      OPENCLAW_MOCK_PORT: String(port),
      CLAWDESK_MOCK_STATE_FILE: stateFile,
      CLAWDESK_REMOTE_DESKTOP_CLIENT_EXECUTABLE: process.execPath,
      CLAWDESK_REMOTE_DESKTOP_CLIENT_ARGS_JSON: JSON.stringify(["-e", "setInterval(() => {}, 100000)"]),
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

const gateway = spawnGateway();

try {
  const health = await waitForHealth();
  if (health.name !== "clawdesk-mock-gateway") throw new Error("unexpected health identity");

  const registry = {
    defaultTargetId: "rdp-test",
    targetGroups: [],
    targets: [
      {
        id: "rdp-test",
        displayName: "RDP Test",
        kind: "remote-desktop",
        state: "ready",
        paired: true,
        trustedWorkspaces: ["~/ClawDesk Projects/桌面 GUI"],
        connection: {
          username: "ops-user",
          port: probePort,
          credentialMode: "platform-managed",
          sessionMode: "control",
        },
        adapters: [
          {
            kind: "remote-desktop",
            endpoint: `rdp://127.0.0.1:${probePort}`,
            authenticated: true,
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

  const probe = await postJson("/targets/connection", { targetId: "rdp-test", action: "probe" });
  if (!probe.response.ok || !probe.payload.allowed) throw new Error(`probe failed: ${probe.payload.reason || probe.response.status}`);
  if (probe.payload.target?.connection?.lastProbeResult !== "reachable") throw new Error("probe did not mark target reachable");

  const readiness = await getJson("/targets/connection-readiness?targetId=rdp-test");
  if (!readiness.response.ok || !readiness.payload.report?.readyToConnect) throw new Error("target should be ready after probe");
  if (readiness.payload.report.nextAction !== "connect") throw new Error(`unexpected next action: ${readiness.payload.report.nextAction}`);

  const launch = await postJson("/targets/remote-desktop/session", { targetId: "rdp-test", action: "launch_client" });
  if (!launch.response.ok || !launch.payload.allowed) throw new Error(`launch failed: ${launch.payload.reason || launch.response.status}`);
  const pid = launch.payload.session?.clientLaunchPid ?? launch.payload.launch?.pid;
  if (typeof pid !== "number" || pid <= 0) throw new Error("launch did not return a pid");
  try {
    process.kill(pid, 0);
  } catch {
    throw new Error("launched client pid is not alive");
  }

  const disconnect = await postJson("/targets/remote-desktop/session", { targetId: "rdp-test", action: "disconnect" });
  if (!disconnect.response.ok || !disconnect.payload.allowed) throw new Error(`disconnect failed: ${disconnect.payload.reason || disconnect.response.status}`);
  if (disconnect.payload.session?.clientLaunchState !== "idle") throw new Error(`disconnect did not reset launch state: ${disconnect.payload.session?.clientLaunchState}`);

  let terminated = false;
  for (let i = 0; i < 20; i += 1) {
    try {
      process.kill(pid, 0);
      await delay(100);
    } catch {
      terminated = true;
      break;
    }
  }
  if (!terminated) throw new Error("disconnect did not terminate the launched client process");

  const audit = await getJson("/backend/audit?limit=50");
  if (!audit.response.ok) throw new Error("audit endpoint failed");
  const actions = audit.payload.events.map((event) => event.action);
  if (!actions.includes("targets.remote-desktop.client-disconnect")) throw new Error("missing disconnect audit event");

  console.log("PASS remote desktop launch and disconnect lifecycle is managed by the gateway.");
} finally {
  listener.close();
  await stop(gateway);
  if (gatewayOutput.trim()) {
    console.log("=== gateway output ===");
    console.log(gatewayOutput.trimEnd());
    console.log("=== end gateway output ===");
  }
}
