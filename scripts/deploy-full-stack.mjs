import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

function hasDocker() {
  const result = spawnSync("bash", ["-lc", "command -v docker >/dev/null 2>&1 && echo ok"], {
    encoding: "utf8",
    windowsHide: process.platform === "win32",
  });
  return result.status === 0;
}

function runCommand(label, command, args) {
  console.log(`執行 ${label}...`);
  const child = spawnSync(command, args, {
    stdio: "inherit",
    cwd: process.cwd(),
    env: process.env,
    windowsHide: process.platform === "win32",
  });
  if (child.status !== 0) {
    process.exitCode = child.status ?? 1;
    throw new Error(`${label} 失敗，退出碼: ${child.status ?? "unknown"}`);
  }
}

async function waitForHealth(url, timeoutMs = 6000, mustExist = false) {
  const started = Date.now();
  let lastError;

  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { method: "GET" });
      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status}`);
      } else if (url.endsWith("/health")) {
        await response.json();
      } else {
        await response.text();
      }
      return true;
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }

  if (mustExist) throw new Error(`${url} 健康檢查失敗（timeout）：${String(lastError ?? "unknown")}`);
  return false;
}

async function checkEndpoints({ throwOnFailure = true } = {}) {
  const required = [
    { name: "mock-gateway", url: "http://127.0.0.1:18890/health", required: true },
    { name: "backend-auth", url: "http://127.0.0.1:19090/health", required: true },
  ];
  const optional = [
    { name: "reverse-proxy", url: "http://127.0.0.1:18889/health", required: false },
    { name: "mock-mail", url: "http://127.0.0.1:8025", required: false },
  ];

  let failed = false;

  for (const check of [...required, ...optional]) {
    const ok = await waitForHealth(check.url, 3000, false);
    if (!ok && check.required) failed = true;

    if (ok) {
      console.log(`PASS ${check.name}: ${check.url}`);
    } else {
      const message = `WARN ${check.name} 尚未就緒: ${check.url}`;
      if (check.required && throwOnFailure) throw new Error(message);
      if (check.required) {
        console.log(message);
      } else {
        console.log(message);
      }
    }
  }

  return !failed;
}

async function killLocalPorts(ports = []) {
  for (const port of ports) {
    const pids = spawnSync("bash", ["-lc", `lsof -ti tcp:${port} || true`], {
      encoding: "utf8",
      windowsHide: process.platform === "win32",
    }).stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    for (const pid of pids) {
      console.log(`關閉端口服務: ${port} -> pid ${pid}`);
      spawnSync("kill", ["-TERM", pid], { stdio: "ignore", windowsHide: process.platform === "win32" });
    }
  }
  if (ports.length > 0) {
    await delay(300);
  }
}

async function isPortInUse(port) {
  const pids = spawnSync("bash", ["-lc", `lsof -ti tcp:${port} || true`], {
    encoding: "utf8",
    windowsHide: process.platform === "win32",
  }).stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return pids.length > 0;
}

async function run() {
  const mode = process.argv[2] ?? "up";
  const hasDockerRuntime = hasDocker();
  const stackCommand = [
    "docker",
    "compose",
    "-f",
    "docker-compose.mock-gateway.full.yml",
    "-f",
    "docker-compose.backend-sim.yml",
  ];

  if (mode === "down") {
    if (hasDockerRuntime) {
      runCommand("deploy:full:stack down", "docker", [
        ...stackCommand.slice(1),
        "down",
      ]);
    } else {
      console.log("未偵測到 docker，改用本機模擬堆疊關閉流程。");
      await killLocalPorts([18890, 19090]);
      console.log("本機堆疊已請求關閉。");
    }
    return;
  }

  if (mode === "check") {
    if (hasDockerRuntime) {
      await checkEndpoints({ throwOnFailure: true });
      console.log("deploy:full:stack 健康檢查完成（docker 模式）。");
      return;
    }

    const existing = await checkEndpoints({ throwOnFailure: false });
    if (existing) {
      console.log("偵測到既有 stack 健康端點，無需啟動檢查副本。");
      return;
    }

    const occupied = (await Promise.all([18890, 19090].map(isPortInUse))).some(Boolean);
    if (occupied) {
      console.log("發現相關本機服務端口仍被佔用，先行關閉以避免 EADDRINUSE。");
      await killLocalPorts([18890, 19090]);
    }

    console.log("未偵測到可用本機堆疊，改用本機 stack check 模式（含啟停）。");
    const child = spawn(process.execPath, ["scripts/run-local-stack.mjs", "--check"], {
      cwd: process.cwd(),
      stdio: "inherit",
      windowsHide: process.platform === "win32",
    });
    child.on("exit", (code, signal) => {
      process.exitCode = code ?? (signal ? 1 : 0);
    });
    await new Promise((resolve) => {
      child.once("exit", resolve);
    });
    return;
  }

  if (mode === "logs") {
    if (hasDockerRuntime) {
      runCommand("deploy:full:stack logs", "docker", [
        ...stackCommand.slice(1),
        "logs",
        "-f",
      ]);
    } else {
      console.log("未偵測到 docker，log 改為直接觀察本機啟動終端輸出。");
      console.log("請改用 `npm run stack:local` 取得本機堆疊日誌。");
    }
    return;
  }

  if (mode === "up" || mode === "start") {
    if (hasDockerRuntime) {
      runCommand("deploy:full:stack up", "docker", [
        ...stackCommand.slice(1),
        "up",
        "-d",
      ]);
    } else {
      console.log("未偵測到 docker，改用本機 Node 模式啟動。");
      const child = spawn(process.execPath, ["scripts/run-local-stack.mjs"], {
        cwd: process.cwd(),
        stdio: "inherit",
        windowsHide: process.platform === "win32",
      });
      child.on("exit", (code, signal) => {
        process.exitCode = code ?? (signal ? 1 : 0);
      });
      await new Promise((resolve) => {
        child.once("exit", resolve);
      });
    }
    return;
  }

  console.log(`未知參數: ${mode}`);
  console.log("使用方式: node scripts/deploy-full-stack.mjs [up|down|logs|check]");
  process.exitCode = 1;
}

await run();
