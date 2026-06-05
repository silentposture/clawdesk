import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

function parseArgs(argv) {
  const options = {
    gatewayBaseUrl: "",
    targetId: "",
    targetName: "",
    kind: "",
    hostName: "",
    bridgeVersion: "local-example-bridge",
    deviceId: "",
    installId: "",
    platform: os.platform(),
    dryRun: false,
    heartbeatOnly: false,
    daemon: false,
    heartbeatIntervalMs: 10_000,
    maxHeartbeats: 0,
    bridgeId: "",
    configPath: "",
    lockPath: "",
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--gateway" && next) {
      options.gatewayBaseUrl = next;
      i += 1;
    } else if (arg === "--target-id" && next) {
      options.targetId = next;
      i += 1;
    } else if (arg === "--target-name" && next) {
      options.targetName = next;
      i += 1;
    } else if (arg === "--kind" && next) {
      options.kind = next;
      i += 1;
    } else if (arg === "--host-name" && next) {
      options.hostName = next;
      i += 1;
    } else if (arg === "--bridge-version" && next) {
      options.bridgeVersion = next;
      i += 1;
    } else if (arg === "--device-id" && next) {
      options.deviceId = next;
      i += 1;
    } else if (arg === "--install-id" && next) {
      options.installId = next;
      i += 1;
    } else if (arg === "--platform" && next) {
      options.platform = next;
      i += 1;
    } else if (arg === "--bridge-id" && next) {
      options.bridgeId = next;
      i += 1;
    } else if (arg === "--config" && next) {
      options.configPath = next;
      i += 1;
    } else if (arg === "--lock-file" && next) {
      options.lockPath = next;
      i += 1;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--heartbeat-only") {
      options.heartbeatOnly = true;
    } else if (arg === "--daemon") {
      options.daemon = true;
    } else if (arg === "--heartbeat-interval-ms" && next) {
      const parsed = Number.parseInt(next, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        options.heartbeatIntervalMs = parsed;
      }
      i += 1;
    } else if (arg === "--max-heartbeats" && next) {
      const parsed = Number.parseInt(next, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        options.maxHeartbeats = parsed;
      }
      i += 1;
    }
  }

  return options;
}

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function defaultHostName() {
  return os.hostname() || "Host Bridge";
}

function defaultBridgeId(targetId) {
  return `${targetId || "host"}-bridge`;
}

function defaultDeviceId(targetId) {
  return `${targetId || "host"}-device-${crypto.randomUUID().slice(0, 8)}`;
}

function defaultInstallId(targetId) {
  return `${targetId || "host"}-install-${crypto.randomUUID().slice(0, 8)}`;
}

function resolveConfigPath(value) {
  const raw = String(value || "").trim();
  if (raw) return path.resolve(raw);
  return path.join(os.homedir(), ".clawdesk", "host-agent.json");
}

async function readJsonFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeJsonFile(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function resolveLockPath(value) {
  const raw = String(value || "").trim();
  if (raw) return path.resolve(raw);
  return path.join(os.homedir(), ".clawdesk", "host-agent.lock");
}

async function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function acquireLock(lockPath) {
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  try {
    const handle = await fs.open(lockPath, "wx");
    await handle.writeFile(JSON.stringify({
      pid: process.pid,
      startedAt: new Date().toISOString(),
    }, null, 2));
    await handle.close();
    return {
      lockPath,
      async release() {
        await fs.rm(lockPath, { force: true });
      },
    };
  } catch (error) {
    if (!(error && typeof error === "object" && error.code === "EEXIST")) {
      throw error;
    }

    const existing = await readJsonFile(lockPath);
    if (existing?.pid && await processIsAlive(existing.pid)) {
      throw new Error(`Host agent is already running (pid ${existing.pid}).`);
    }

    await fs.rm(lockPath, { force: true });
    return acquireLock(lockPath);
  }
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  return { response, payload };
}

function printResult(title, payload) {
  console.log(`# ${title}`);
  console.log(JSON.stringify(payload, null, 2));
}

async function seedTargetRegistryIfNeeded(gatewayBaseUrl, targetId, targetName, kind) {
  const registry = {
    defaultTargetId: targetId,
    targetGroups: [],
    targets: [
      {
        id: targetId,
        displayName: targetName,
        kind,
        state: "offline",
        paired: false,
        trustedWorkspaces: ["~/ClawDesk Projects/host-bridge"],
        connection: {
          username: "host-bridge",
          port: kind === "ssh-terminal" ? 22 : 3389,
          credentialMode: "platform-managed",
          sessionMode: kind === "ssh-terminal" ? "control" : "observe",
        },
        adapters: [
          {
            kind,
            endpoint: kind === "ssh-terminal" ? `ssh://127.0.0.1` : `rdp://127.0.0.1`,
            authenticated: false,
            hostKeyVerified: false,
            supportsTerminal: kind === "ssh-terminal",
            supportsScreen: kind === "remote-desktop",
            supportsClipboard: kind === "remote-desktop",
            supportsFileTransfer: kind === "ssh-terminal",
          },
        ],
      },
    ],
  };

  const response = await postJson(`${gatewayBaseUrl}/targets`, { registry });
  if (!response.response.ok) {
    throw new Error(response.payload.reason || `target registry seed failed: ${response.response.status}`);
  }
}

async function runHostBridgeAgent(argv, runtime = {}) {
  const options = parseArgs(argv);
  const configPath = resolveConfigPath(options.configPath || runtime.configPath || process.env.CLAWDESK_HOST_AGENT_CONFIG || "");
  const lockPath = resolveLockPath(options.lockPath || runtime.lockPath || process.env.CLAWDESK_HOST_AGENT_LOCK || "");
  const gatewayBaseUrl = normalizeBaseUrl(
    options.gatewayBaseUrl || runtime.gatewayBaseUrl || process.env.CLAWDESK_GATEWAY_URL || process.env.OPENCLAW_GATEWAY_URL || "http://127.0.0.1:18890",
  );
  if (!gatewayBaseUrl) {
    throw new Error("Gateway base URL is required.");
  }

  const targetId = options.targetId.trim();
  if (!targetId) {
    throw new Error("Target id is required.");
  }

  const persistedConfig = await readJsonFile(configPath);
  const targetName = options.targetName.trim() || persistedConfig?.targetName?.trim() || targetId;
  const kind = options.kind.trim() || persistedConfig?.kind?.trim() || "remote-desktop";
  const hostName = options.hostName.trim() || persistedConfig?.hostName?.trim() || defaultHostName();
  const bridgeVersion = options.bridgeVersion.trim() || persistedConfig?.bridgeVersion?.trim() || "local-example-bridge";
  const bridgeId = options.bridgeId.trim() || persistedConfig?.bridgeId?.trim() || defaultBridgeId(targetId);
  const deviceId = options.deviceId.trim() || persistedConfig?.deviceId?.trim() || defaultDeviceId(targetId);
  const installId = options.installId.trim() || persistedConfig?.installId?.trim() || defaultInstallId(targetId);
  const platform = options.platform.trim() || persistedConfig?.platform?.trim() || os.platform();

  const state = {
    gatewayBaseUrl,
    targetId,
    targetName,
    kind,
    hostName,
    bridgeVersion,
    bridgeId,
    deviceId,
    installId,
    platform,
    dryRun: options.dryRun,
    heartbeatOnly: options.heartbeatOnly,
    maxHeartbeats: options.maxHeartbeats,
    configPath,
    lockPath,
  };

  if (options.dryRun) {
    printResult("local-agent-bridge dry run", {
      ...state,
      configPath,
      steps: options.heartbeatOnly
        ? ["heartbeat"]
        : options.daemon
          ? ["seed-registry", "host-enrollment-ticket", "host-enrollment", "attest", "heartbeat-loop"]
          : ["seed-registry", "host-enrollment-ticket", "host-enrollment", "attest", "heartbeat"],
    });
    return { status: "dry-run", state };
  }

  const lock = await acquireLock(lockPath);
  let lockReleased = false;
  const releaseLock = async () => {
    if (lockReleased) return;
    lockReleased = true;
    await lock.release();
  };
  const handleSignal = async (signal) => {
    try {
      await releaseLock();
    } finally {
      process.exitCode = process.exitCode ?? 0;
      process.kill(process.pid, signal);
    }
  };
  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);

  try {
    await writeJsonFile(configPath, {
      configVersion: 1,
      gatewayBaseUrl,
      targetId,
      targetName,
      kind,
      hostName,
      bridgeVersion,
      bridgeId,
      deviceId,
      installId,
      platform,
      lockPath,
    });

    await seedTargetRegistryIfNeeded(gatewayBaseUrl, targetId, targetName, kind);

    if (!options.heartbeatOnly) {
      const ticket = await postJson(`${gatewayBaseUrl}/targets/host-enrollment-ticket`, {
        targetId,
        targetName,
        kind,
        hostName,
        bridgeVersion,
      });
      if (!ticket.response.ok || !ticket.payload.allowed || !ticket.payload.ticket?.code) {
        throw new Error(ticket.payload.reason || `host enrollment ticket request failed: ${ticket.response.status}`);
      }

      const enroll = await postJson(`${gatewayBaseUrl}/targets/host-enrollment`, {
        targetId,
        enrollmentCode: ticket.payload.ticket.code,
        hostName,
        bridgeVersion,
      });
      if (!enroll.response.ok || !enroll.payload.allowed) {
        throw new Error(enroll.payload.reason || `host enrollment failed: ${enroll.response.status}`);
      }

      state.bridgeId = enroll.payload.target?.connection?.hostBridge?.bridgeId || bridgeId;
    }

    const attest = await postJson(`${gatewayBaseUrl}/targets/host-bridge/attest`, {
      targetId,
      bridgeId: state.bridgeId,
      hostName,
      bridgeVersion,
      deviceId,
      installId,
      platform,
    });
    if (!attest.response.ok || !attest.payload.allowed) {
      throw new Error(attest.payload.reason || `host bridge attestation failed: ${attest.response.status}`);
    }

    const heartbeat = await postJson(`${gatewayBaseUrl}/targets/host-bridge/heartbeat`, {
      targetId,
      bridgeId: state.bridgeId,
      hostName,
      bridgeVersion,
    });
    if (!heartbeat.response.ok || !heartbeat.payload.allowed) {
      throw new Error(heartbeat.payload.reason || `host bridge heartbeat failed: ${heartbeat.response.status}`);
    }

    if (options.daemon) {
      let heartbeatCount = 1;
      console.log(`# local-agent-bridge daemon`);
      console.log(JSON.stringify({
        ...state,
        configPath,
        attestation: {
          allowed: attest.payload.allowed,
          reason: attest.payload.reason,
          targetState: attest.payload.target?.connection?.hostBridge?.state,
          attestedAt: attest.payload.target?.connection?.hostBridge?.attestedAt,
        },
        heartbeat: {
          allowed: heartbeat.payload.allowed,
          reason: heartbeat.payload.reason,
          targetState: heartbeat.payload.target?.connection?.hostBridge?.state,
          lastSeenAt: heartbeat.payload.target?.connection?.hostBridge?.lastSeenAt,
        },
        heartbeatIntervalMs: options.heartbeatIntervalMs,
        maxHeartbeats: options.maxHeartbeats || undefined,
        status: "running",
      }, null, 2));
      try {
        while (true) {
          await new Promise((resolve) => setTimeout(resolve, options.heartbeatIntervalMs));
          const nextHeartbeat = await postJson(`${gatewayBaseUrl}/targets/host-bridge/heartbeat`, {
            targetId,
            bridgeId: state.bridgeId,
            hostName,
            bridgeVersion,
          });
          if (!nextHeartbeat.response.ok || !nextHeartbeat.payload.allowed) {
            throw new Error(nextHeartbeat.payload.reason || `host bridge heartbeat failed: ${nextHeartbeat.response.status}`);
          }
          heartbeatCount += 1;
          console.log(JSON.stringify({
            type: "heartbeat",
            count: heartbeatCount,
            lastSeenAt: nextHeartbeat.payload.target?.connection?.hostBridge?.lastSeenAt,
            targetState: nextHeartbeat.payload.target?.connection?.hostBridge?.state,
          }));
          if (options.maxHeartbeats > 0 && heartbeatCount >= options.maxHeartbeats) {
            break;
          }
        }

        console.log(JSON.stringify({
          type: "stopped",
          heartbeatCount,
          bridgeId: state.bridgeId,
          targetId,
        }));
        return { status: "stopped", state, attestation: attest.payload, heartbeat: heartbeat.payload };
      } finally {
        await releaseLock();
      }
    }

    printResult("local-agent-bridge result", {
      ...state,
      configPath,
      attestation: {
        allowed: attest.payload.allowed,
        reason: attest.payload.reason,
        targetState: attest.payload.target?.connection?.hostBridge?.state,
        attestedAt: attest.payload.target?.connection?.hostBridge?.attestedAt,
      },
      heartbeat: {
        allowed: heartbeat.payload.allowed,
        reason: heartbeat.payload.reason,
        targetState: heartbeat.payload.target?.connection?.hostBridge?.state,
        lastSeenAt: heartbeat.payload.target?.connection?.hostBridge?.lastSeenAt,
      },
      nextStep: "probe-or-connect",
    });

    return { status: "completed", state, attestation: attest.payload, heartbeat: heartbeat.payload };
  } finally {
    await releaseLock();
  }
}

export {
  defaultBridgeId,
  defaultDeviceId,
  defaultHostName,
  defaultInstallId,
  normalizeBaseUrl,
  parseArgs,
  postJson,
  printResult,
  runHostBridgeAgent,
  seedTargetRegistryIfNeeded,
};

async function main() {
  await runHostBridgeAgent(process.argv);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  });
}
