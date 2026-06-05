import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const port = Number(process.env.CLAWDESK_VERIFY_SESSION_EXPORT_PORT ?? 18991);
const baseUrl = `http://127.0.0.1:${port}`;
const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "clawdesk-session-export-"));
const stateFile = path.join(stateDir, "state.json");
let gatewayOutput = "";

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
    windowsHide: process.platform === "win32",
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
      // Keep waiting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("gateway did not become healthy");
}

async function getJson(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`);
  const payload = await response.json();
  return { response, payload };
}

let gateway = spawnGateway();

try {
  const health = await waitForHealth();
  if (health.name !== "clawdesk-mock-gateway") throw new Error("unexpected health identity");

  const sshExport = await getJson("/targets/ssh-terminal/session-export?targetId=builder-ssh");
  if (!sshExport.response.ok) throw new Error(`ssh export failed with ${sshExport.response.status}`);
  if (typeof sshExport.payload.text !== "string" || !sshExport.payload.text.includes("# Target Session Export")) {
    throw new Error("ssh export markdown missing title");
  }
  if (!sshExport.payload.text.includes("## SSH Session")) throw new Error("ssh export missing ssh session section");
  if (sshExport.payload.text.includes("privateKey") || sshExport.payload.text.includes("BEGIN OPENSSH PRIVATE KEY")) {
    throw new Error("ssh export leaked secret material");
  }

  const rdpExport = await getJson("/targets/remote-desktop/session-export?targetId=ops-rdp");
  if (!rdpExport.response.ok) throw new Error(`remote desktop export failed with ${rdpExport.response.status}`);
  if (typeof rdpExport.payload.text !== "string" || !rdpExport.payload.text.includes("# Target Session Export")) {
    throw new Error("remote desktop export markdown missing title");
  }
  if (!rdpExport.payload.text.includes("## Remote Desktop Session")) {
    throw new Error("remote desktop export missing session section");
  }
  if (rdpExport.payload.text.includes("password") || rdpExport.payload.text.includes("credentialRef")) {
    throw new Error("remote desktop export leaked sensitive fields");
  }

  const audit = await getJson("/backend/audit?limit=50");
  if (!audit.response.ok) throw new Error("audit endpoint failed");
  const actions = audit.payload.events.map((event) => event.action);
  if (!actions.includes("targets.ssh-terminal.session.export")) {
    throw new Error("missing ssh session export audit event");
  }
  if (!actions.includes("targets.remote-desktop.session.export")) {
    throw new Error("missing remote desktop session export audit event");
  }

  console.log("PASS session export routes returned redacted markdown and audited the export events.");
} finally {
  await stop(gateway);
  if (gatewayOutput.trim()) {
    console.log("=== gateway output ===");
    console.log(gatewayOutput.trimEnd());
    console.log("=== end gateway output ===");
  }
}
