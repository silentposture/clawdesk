import crypto from "node:crypto";
import os from "node:os";

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

async function main() {
  const options = parseArgs(process.argv);
  const gatewayBaseUrl = normalizeBaseUrl(
    options.gatewayBaseUrl || process.env.CLAWDESK_GATEWAY_URL || process.env.OPENCLAW_GATEWAY_URL || "http://127.0.0.1:18890",
  );
  if (!gatewayBaseUrl) {
    throw new Error("Gateway base URL is required.");
  }

  const targetId = options.targetId.trim();
  if (!targetId) {
    throw new Error("Target id is required.");
  }

  const targetName = options.targetName.trim() || targetId;
  const kind = options.kind.trim() || "remote-desktop";
  const hostName = options.hostName.trim() || defaultHostName();
  const bridgeVersion = options.bridgeVersion.trim() || "local-example-bridge";
  const bridgeId = options.bridgeId.trim() || defaultBridgeId(targetId);
  const deviceId = options.deviceId.trim() || defaultDeviceId(targetId);
  const installId = options.installId.trim() || defaultInstallId(targetId);
  const platform = options.platform.trim() || os.platform();

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
  };

  if (options.dryRun) {
    printResult("local-agent-bridge dry run", {
      ...state,
      steps: options.heartbeatOnly ? ["heartbeat"] : options.daemon ? ["seed-registry", "host-enrollment-ticket", "host-enrollment", "attest", "heartbeat-loop"] : ["seed-registry", "host-enrollment-ticket", "host-enrollment", "attest", "heartbeat"],
    });
    return;
  }

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
    process.exit(0);
    return;
  }

  printResult("local-agent-bridge result", {
    ...state,
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
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
