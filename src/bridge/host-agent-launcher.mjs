import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { runHostBridgeAgent } from "./host-bridge-agent.mjs";

function parseLauncherArgs(argv) {
  const options = {
    statusPath: "",
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--status-file" && next) {
      options.statusPath = next;
      i += 1;
    }
  }

  return options;
}

function resolveStatusPath(value) {
  const raw = String(value || "").trim();
  if (raw) return path.resolve(raw);
  return path.join(os.homedir(), ".clawdesk", "host-agent-status.json");
}

async function writeJsonFile(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeStatus(statusPath, value) {
  await writeJsonFile(statusPath, value);
}

async function runHostAgentLauncher(argv) {
  const launcherArgs = parseLauncherArgs(argv);
  const statusPath = resolveStatusPath(launcherArgs.statusPath || process.env.CLAWDESK_HOST_AGENT_STATUS_FILE || "");
  const startedAt = new Date().toISOString();

  await writeStatus(statusPath, {
    state: "starting",
    startedAt,
    pid: process.pid,
  });

  try {
    const result = await runHostBridgeAgent(argv);
    await writeStatus(statusPath, {
      state: "stopped",
      startedAt,
      stoppedAt: new Date().toISOString(),
      pid: process.pid,
      resultStatus: result?.status ?? "completed",
      configPath: result?.state?.configPath,
      lockPath: result?.state?.lockPath,
      bridgeId: result?.state?.bridgeId,
      targetId: result?.state?.targetId,
      deviceId: result?.state?.deviceId,
      installId: result?.state?.installId,
      heartbeatOnly: result?.state?.heartbeatOnly ?? false,
      daemon: Boolean(argv.includes("--daemon")),
    });
    return result;
  } catch (error) {
    await writeStatus(statusPath, {
      state: "failed",
      startedAt,
      failedAt: new Date().toISOString(),
      pid: process.pid,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function main() {
  await runHostAgentLauncher(process.argv);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  });
}

export { parseLauncherArgs, resolveStatusPath, runHostAgentLauncher };
