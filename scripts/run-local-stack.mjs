import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const backendPort = Number(process.env.CLAWDESK_BACKEND_PORT ?? 19090);
const gatewayPort = Number(process.env.OPENCLAW_MOCK_PORT ?? 18890);
const checkMode = process.argv.includes("--check");
const heartbeatMs = Number(process.env.CLAWDESK_LOCAL_STACK_HEARTBEAT_MS ?? "10000");
const root = process.cwd();
const stateDir = path.join(root, ".clawdesk-local-stack");
const backendStateFile = path.join(stateDir, "backend-state.json");
const gatewayStateFile = path.join(stateDir, "gateway-state.json");

const processes = new Set();

async function ensureStateDir() {
  await fs.mkdir(stateDir, { recursive: true });
}

async function waitForHealth(url, timeoutMs = 10000) {
  const started = Date.now();
  let lastError;

  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const body = await response.json();
        return body;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(150);
  }

  throw new Error(`health check timeout: ${url}${lastError ? ` (${String(lastError)})` : ""}`);
}

function spawnCommand(command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[${path.basename(command)}] ${chunk}`);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[${path.basename(command)}][err] ${chunk}`);
  });
  processes.add(child);

  child.once("exit", (code, signal) => {
    processes.delete(child);
    if (!isShuttingDown) {
      console.error(`${command} 已離線：code=${code ?? "n/a"}, signal=${signal ?? "n/a"}`);
      void shutdown("service exited");
    }
  });

  return child;
}

let isShuttingDown = false;

async function shutdown(reason = "manual") {
  if (isShuttingDown) return;
  isShuttingDown = true;

  if (process.env.CLAWDESK_LOCAL_STACK_REASON) {
    console.log(`停止堆疊（${process.env.CLAWDESK_LOCAL_STACK_REASON}）：${reason}`);
  }

  for (const child of Array.from(processes)) {
    child.kill("SIGTERM");
  }

  await delay(300);
  for (const child of Array.from(processes)) {
    child.kill("SIGKILL");
  }
}

async function start() {
  await ensureStateDir();

  const backend = spawnCommand(process.execPath, ["backend/server.mjs"], {
    CLAWDESK_BACKEND_PORT: String(backendPort),
    CLAWDESK_BACKEND_STATE_FILE: backendStateFile,
    CLAWDESK_LICENSE_HMAC_KEY: "dev-keygen-hmac-key",
    NODE_ENV: "production",
    NODE_OPTIONS: "--max-old-space-size=128",
  });

  const gateway = spawnCommand(process.execPath, ["sidecars/mock-gateway/server.mjs"], {
    OPENCLAW_MOCK_PORT: String(gatewayPort),
    CLAWDESK_IDENTITY_BACKEND_URL: `http://127.0.0.1:${backendPort}`,
    CLAWDESK_MOCK_STATE_FILE: gatewayStateFile,
    NODE_ENV: "production",
    NODE_OPTIONS: "--max-old-space-size=128",
  });

  console.log(`啟動本機 stack：backend=${backend.pid}, gateway=${gateway.pid}`);

  const backendHealth = await waitForHealth(`http://127.0.0.1:${backendPort}/health`, 15000);
  const gatewayHealth = await waitForHealth(`http://127.0.0.1:${gatewayPort}/health`, 15000);
  console.log(`後端健康檢查：${JSON.stringify(backendHealth)}`);
  console.log(`Gateway 健康檢查：${JSON.stringify(gatewayHealth)}`);

  if (checkMode) {
    await delay(500);
    console.log("stack:local:check 完成。");
    await shutdown("check finished");
    return;
  }

  console.log("本機 stack 已就緒：");
  console.log(`- backend: http://127.0.0.1:${backendPort}`);
  console.log(`- mock-gateway: http://127.0.0.1:${gatewayPort}`);
  console.log("按 Ctrl+C 停止服務。");
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  while (!isShuttingDown) {
    if (processes.size === 0) break;
    await delay(heartbeatMs);
  }
}

try {
  await start();
  process.exitCode = 0;
} catch (error) {
  console.error(`stack:local 啟動失敗：${error instanceof Error ? error.message : String(error)}`);
  await shutdown("startup failure");
  process.exitCode = 1;
}
