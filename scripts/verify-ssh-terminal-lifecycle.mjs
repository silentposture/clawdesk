import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "clawdesk-ssh-lifecycle-"));
const stateFile = path.join(stateDir, "state.json");
const launchStateFile = path.join(stateDir, "ssh-launch-state.json");
const listener = net.createServer();
await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
const probePort = listener.address().port;
const port = probePort + 1;
const baseUrl = `http://127.0.0.1:${port}`;
let gatewayOutput = "";

const fakeSshScript = path.join(stateDir, "fake-ssh.mjs");
await fs.writeFile(
  fakeSshScript,
  `import fs from "node:fs/promises";

const launchStateFile = process.env.CLAWDESK_FAKE_SSH_LAUNCH_FILE;
if (launchStateFile) {
  try {
    const current = await fs.readFile(launchStateFile, "utf8");
    const parsed = JSON.parse(current);
    const launchCount = Number.isFinite(parsed.launchCount) ? parsed.launchCount + 1 : 1;
    await fs.writeFile(launchStateFile, JSON.stringify({ launchCount, pid: process.pid }, null, 2) + "\\n", "utf8");
  } catch {
    await fs.writeFile(launchStateFile, JSON.stringify({ launchCount: 1, pid: process.pid }, null, 2) + "\\n", "utf8");
  }
}

let buffer = "";
let currentFrame = [];

function emitFrame(frame) {
  const beginLine = frame[0] ?? "";
  const commandLine = frame[1] ?? "";
  const tokenMatch = beginLine.match(/^printf '__CLAWDESK_BEGIN__(.+)\\\\n'$/);
  const commandMatch = commandLine.match(/^(.+)$/);
  const token = tokenMatch?.[1] ?? "unknown";
  const command = commandMatch?.[1]?.trim() ?? "";
  const output = command.startsWith("echo ") ? command.slice(5).trim() : \`executed: \${command}\`;
  process.stdout.write(\`__CLAWDESK_BEGIN__\${token}\\n\${output || "(no stdout)"}\\n__CLAWDESK_STATUS__\${token}:0\\n__CLAWDESK_END__\${token}\\n\`);
}

function consumeLine(rawLine) {
  const line = rawLine.replace(/\\r$/, "");
  if (!line.trim()) return;
  if (line.trim() === "exit") {
    process.exit(0);
    return;
  }
  currentFrame.push(line);
  if (currentFrame.length === 4) {
    emitFrame(currentFrame);
    currentFrame = [];
  }
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newlineIndex = buffer.indexOf("\\n");
  while (newlineIndex >= 0) {
    const line = buffer.slice(0, newlineIndex);
    buffer = buffer.slice(newlineIndex + 1);
    consumeLine(line);
    newlineIndex = buffer.indexOf("\\n");
  }
});

process.stdin.on("end", () => process.exit(0));
process.stdin.resume();
`,
  "utf8",
);

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
      CLAWDESK_SSH_EXECUTABLE: process.execPath,
      CLAWDESK_SSH_EXECUTABLE_ARGS_JSON: JSON.stringify([fakeSshScript]),
      CLAWDESK_SSH_REMOTE_SHELL_COMMAND: "sh -s",
      CLAWDESK_FAKE_SSH_LAUNCH_FILE: launchStateFile,
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

async function waitForLaunchSnapshot(timeoutMs = 8000, minLaunchCount = 1, previousPid = null) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const raw = await fs.readFile(launchStateFile, "utf8");
      const snapshot = JSON.parse(raw);
      if (
        Number.isFinite(snapshot.launchCount)
        && snapshot.launchCount >= minLaunchCount
        && (previousPid === null || snapshot.pid !== previousPid)
      ) {
        return snapshot;
      }
    } catch {
      await delay(100);
    }
    await delay(100);
  }
  throw new Error("fake ssh launcher did not record a pid");
}

const gateway = spawnGateway();

try {
  const health = await waitForHealth();
  if (health.name !== "clawdesk-mock-gateway") throw new Error("unexpected health identity");

  const registry = {
    defaultTargetId: "ssh-test",
    targetGroups: [],
    targets: [
      {
        id: "ssh-test",
        displayName: "SSH Test",
        kind: "ssh-terminal",
        state: "ready",
        paired: false,
        trustedWorkspaces: ["~/ClawDesk Projects/SSH"],
        connection: {
          username: "ops-user",
          port: probePort,
          credentialMode: "platform-managed",
          knownHostFingerprint: "ssh-ed25519 AAAA...clawdesk-ssh",
          sessionMode: "control",
        },
        adapters: [
          {
            kind: "ssh-terminal",
            endpoint: `ssh://127.0.0.1:${probePort}`,
            authenticated: true,
            hostKeyVerified: true,
            supportsTerminal: true,
            supportsScreen: false,
            supportsClipboard: false,
            supportsFileTransfer: false,
          },
        ],
      },
    ],
  };

  const save = await postJson("/targets", { registry });
  if (!save.response.ok) throw new Error(`target registry save failed: ${save.response.status}`);

  const pairingTicket = await postJson("/targets/pairing-ticket", {
    targetId: "ssh-test",
    targetName: "SSH Test",
    kind: "ssh-terminal",
    expiresInMinutes: 15,
  });
  if (!pairingTicket.response.ok || !pairingTicket.payload.allowed || !pairingTicket.payload.ticket?.code) {
    throw new Error(`pairing ticket issuance failed: ${pairingTicket.payload.reason || pairingTicket.response.status}`);
  }

  const pair = await postJson("/targets/connection", {
    targetId: "ssh-test",
    action: "pair",
    pairingCode: pairingTicket.payload.ticket.code,
  });
  if (!pair.response.ok || !pair.payload.allowed) throw new Error(`pair failed: ${pair.payload.reason || pair.response.status}`);
  if (!pair.payload.target?.paired) throw new Error("pair did not mark target as paired");

  const probe = await postJson("/targets/connection", { targetId: "ssh-test", action: "probe" });
  if (!probe.response.ok || !probe.payload.allowed) throw new Error(`probe failed: ${probe.payload.reason || probe.response.status}`);
  if (probe.payload.target?.connection?.lastProbeResult !== "reachable") throw new Error("probe did not mark target reachable");

  const verifyHostKey = await postJson("/targets/connection", { targetId: "ssh-test", action: "verify_host_key" });
  if (!verifyHostKey.response.ok || !verifyHostKey.payload.allowed) throw new Error(`verify_host_key failed: ${verifyHostKey.payload.reason || verifyHostKey.response.status}`);

  const readiness = await getJson("/targets/connection-readiness?targetId=ssh-test");
  if (!readiness.response.ok || !readiness.payload.report?.readyToConnect) throw new Error("target should be ready after probe and host key verification");
  if (readiness.payload.report.nextAction !== "connect") throw new Error(`unexpected next action: ${readiness.payload.report.nextAction}`);

  const open = await postJson("/targets/ssh-terminal/session", { targetId: "ssh-test", action: "open_session" });
  if (!open.response.ok || !open.payload.allowed) throw new Error(`open_session failed: ${open.payload.reason || open.response.status}`);
  if (open.payload.session?.state !== "connected") throw new Error(`open_session did not connect: ${open.payload.session?.state}`);

  const firstLaunch = await waitForLaunchSnapshot(8000, 1, null);
  if (firstLaunch.launchCount !== 1) throw new Error(`expected first launchCount 1, got ${firstLaunch.launchCount}`);
  if (typeof firstLaunch.pid !== "number" || firstLaunch.pid <= 0) throw new Error("fake ssh did not record a valid pid");
  const firstPid = firstLaunch.pid;

  const command = await postJson("/targets/ssh-terminal/session", { targetId: "ssh-test", action: "run_command", command: "git status --short" });
  if (!command.response.ok || !command.payload.allowed) throw new Error(`run_command failed: ${command.payload.reason || command.response.status}`);
  if (!String(command.payload.execution?.stdout ?? "").includes("executed: git status --short")) throw new Error("command output did not include expected marker");
  if (command.payload.execution?.exitCode !== 0) throw new Error(`unexpected exit code: ${command.payload.execution?.exitCode}`);

  const reconnect = await postJson("/targets/ssh-terminal/session", { targetId: "ssh-test", action: "reconnect" });
  if (!reconnect.response.ok || !reconnect.payload.allowed) throw new Error(`reconnect failed: ${reconnect.payload.reason || reconnect.response.status}`);
  const reconnectSnapshot = await waitForLaunchSnapshot(8000, 1, null);
  if (reconnectSnapshot.launchCount !== 1) throw new Error(`active reconnect should reuse runtime; launchCount changed to ${reconnectSnapshot.launchCount}`);
  if (reconnectSnapshot.pid !== firstPid) throw new Error("active reconnect did not reuse the existing runtime pid");

  const close = await postJson("/targets/ssh-terminal/session", { targetId: "ssh-test", action: "close_session" });
  if (!close.response.ok || !close.payload.allowed) throw new Error(`close_session failed: ${close.payload.reason || close.response.status}`);
  let terminated = false;
  for (let i = 0; i < 20; i += 1) {
    try {
      process.kill(firstPid, 0);
      await delay(100);
    } catch {
      terminated = true;
      break;
    }
  }
  if (!terminated) throw new Error("close_session did not terminate the SSH runtime");

  const relaunch = await postJson("/targets/ssh-terminal/session", { targetId: "ssh-test", action: "reconnect" });
  if (!relaunch.response.ok || !relaunch.payload.allowed) throw new Error(`relaunch reconnect failed: ${relaunch.payload.reason || relaunch.response.status}`);
  const secondLaunch = await waitForLaunchSnapshot(8000, 2, firstPid);
  if (secondLaunch.launchCount !== 2) throw new Error(`expected reconnect after close to relaunch runtime, got launchCount ${secondLaunch.launchCount}`);
  if (secondLaunch.pid === firstPid) throw new Error("reconnect after close reused the terminated pid");

  const secondClose = await postJson("/targets/ssh-terminal/session", { targetId: "ssh-test", action: "close_session" });
  if (!secondClose.response.ok || !secondClose.payload.allowed) throw new Error(`second close_session failed: ${secondClose.payload.reason || secondClose.response.status}`);
  let secondTerminated = false;
  for (let i = 0; i < 20; i += 1) {
    try {
      process.kill(secondLaunch.pid, 0);
      await delay(100);
    } catch {
      secondTerminated = true;
      break;
    }
  }
  if (!secondTerminated) throw new Error("second close_session did not terminate the relaunched SSH runtime");

  const audit = await getJson("/backend/audit?limit=100");
  if (!audit.response.ok) throw new Error("audit endpoint failed");
  const actions = audit.payload.events.map((event) => event.action);
  if (!actions.includes("targets.ssh-terminal.session.command")) throw new Error("missing SSH command audit event");
  if (!actions.includes("targets.ssh-terminal.session.reconnect")) throw new Error("missing SSH reconnect audit event");

  console.log("PASS SSH terminal launch, command, close, and reconnect lifecycle is managed by the gateway.");
} finally {
  listener.close();
  await stop(gateway);
  await cleanupTempFiles();
  if (gatewayOutput.trim()) {
    console.log("=== gateway output ===");
    console.log(gatewayOutput.trimEnd());
    console.log("=== end gateway output ===");
  }
}
