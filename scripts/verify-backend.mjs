import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const port = Number(process.env.CLAWDESK_VERIFY_BACKEND_PORT ?? 18990);
const baseUrl = `http://127.0.0.1:${port}`;
const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "clawdesk-backend-"));
const stateFile = path.join(stateDir, "state.json");
const checks = [];

function pass(name) {
  checks.push({ name, ok: true });
  console.log(`PASS ${name}`);
}

function fail(name, error) {
  const message = error instanceof Error ? error.message : String(error);
  checks.push({ name, ok: false, error: message });
  console.error(`FAIL ${name}: ${message}`);
}

async function check(name, fn) {
  try {
    await fn();
    pass(name);
  } catch (error) {
    fail(name, error);
  }
}

function spawnGateway() {
  return spawn(process.execPath, ["sidecars/mock-gateway/server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      OPENCLAW_MOCK_PORT: String(port),
      CLAWDESK_MOCK_STATE_FILE: stateFile,
      NODE_ENV: "test",
      NODE_OPTIONS: "--max-old-space-size=128",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function waitForHealth(timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return response.json();
    } catch {
      // Retry until gateway is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("backend did not become healthy");
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 2000))]);
}

async function getJson(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`);
  const payload = await response.json();
  return { response, payload };
}

async function postJson(pathname, body = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  return { response, payload };
}

let gateway = spawnGateway();

try {
  await check("backend health and simulated deployment metadata", async () => {
    const health = await waitForHealth();
    if (!health.backend?.persistence?.enabled) throw new Error("persistence must be enabled for backend verification");
    if (!["lemon-squeezy-mock", "paddle-mock"].includes(health.backend.providers.payment)) throw new Error("payment provider metadata missing");
    const plan = await getJson("/backend/deployment-plan");
    if (!plan.response.ok) throw new Error("deployment plan endpoint failed");
    for (const moduleName of ["Lemon Squeezy webhook service for direct beta", "Paddle webhook service", "Keygen license adapter", "MCP connector proxy service"]) {
      if (!plan.payload.productionModules.includes(moduleName)) throw new Error(`missing production module: ${moduleName}`);
    }
  });

  await check("backend state mutation writes audit trail", async () => {
    const registered = await postJson("/identity/register", {
      email: "backend-user@example.com",
      displayName: "Backend User",
      password: "Passw0rd123",
      mode: "enterprise",
      organization: "Backend Test Org",
    });
    if (!registered.response.ok) throw new Error("register failed");

    const source = await postJson("/knowledge/sources", {
      type: "database",
      name: "Backend persistence DB",
      provider: "PostgreSQL mock",
      tags: ["backend", "persistence"],
    });
    if (!source.response.ok) throw new Error("knowledge source create failed");

    const workflow = await postJson("/workflows", {
      name: "Backend persistence workflow",
      scheduleKind: "daily",
      steps: [{ id: "audit", title: "Audit backend state", requiresApproval: false }],
    });
    if (!workflow.response.ok) throw new Error("workflow create failed");

    const saved = await postJson("/backend/save-state", {});
    if (!saved.response.ok || !saved.payload.saved) throw new Error("state save failed");

    const audit = await getJson("/backend/audit?limit=100");
    if (!audit.response.ok || audit.payload.events.length < 3) throw new Error("audit events missing");
    const serialized = JSON.stringify(audit.payload);
    for (const forbidden of ["backend-user@example.com", "sk-test1234567890", "/Users/private/path"]) {
      if (serialized.includes(forbidden)) throw new Error(`audit leaked forbidden value: ${forbidden}`);
    }
  });

  await stop(gateway);
  gateway = spawnGateway();

  await check("backend state survives gateway restart", async () => {
    await waitForHealth();
    const status = await getJson("/backend/status");
    if (!status.response.ok) throw new Error("backend status failed after restart");
    if (status.payload.counts.users < 2) throw new Error("persisted users not restored");
    if (status.payload.counts.workflows < 1) throw new Error("persisted workflow not restored");
    if (status.payload.counts.auditEvents < 3) throw new Error("persisted audit events not restored");

    const stateText = await fs.readFile(stateFile, "utf8");
    if (!stateText.includes("Backend persistence workflow")) throw new Error("state file did not include workflow");
    if (stateText.includes("@Ndu993909")) throw new Error("state file must not include developer plaintext password");
  });
} finally {
  await stop(gateway);
}

const failures = checks.filter((item) => !item.ok);
if (failures.length > 0) {
  console.error(`${failures.length} backend verification checks failed.`);
  process.exit(1);
}

console.log(`${checks.length} backend verification checks passed.`);
