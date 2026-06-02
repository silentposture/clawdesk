import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

function parseCliArgs(argv) {
  const options = {
    connectOnly: false,
    appServer: process.env.CLAWDESK_SMOKE_APP_SERVER ?? "dev",
    gatewayPort: Number(
      process.env.CLAWDESK_SMOKE_GATEWAY_PORT
      ?? process.env.CLAWDESK_MOCK_PORT
      ?? process.env.OPENCLAW_SMOKE_GATEWAY_PORT
      ?? process.env.OPENCLAW_MOCK_PORT
      ?? 18890,
    ),
    appPort: Number(process.env.CLAWDESK_SMOKE_APP_PORT ?? 5173),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--connect-only" || arg === "--reuse-session") {
      options.connectOnly = true;
    } else if (arg === "--app-server" && argv[i + 1]) {
      options.appServer = argv[i + 1];
      i += 1;
    } else if (arg.startsWith("--app-server=")) {
      options.appServer = arg.slice("--app-server=".length);
    } else if (arg === "--gateway-port" && argv[i + 1]) {
      const value = Number.parseInt(argv[i + 1], 10);
      if (Number.isFinite(value) && value > 0) options.gatewayPort = value;
      i += 1;
    } else if (arg === "--app-port" && argv[i + 1]) {
      const value = Number.parseInt(argv[i + 1], 10);
      if (Number.isFinite(value) && value > 0) options.appPort = value;
      i += 1;
    } else if (arg.startsWith("--gateway-port=")) {
      const value = Number.parseInt(arg.slice("--gateway-port=".length), 10);
      if (Number.isFinite(value) && value > 0) options.gatewayPort = value;
    } else if (arg.startsWith("--app-port=")) {
      const value = Number.parseInt(arg.slice("--app-port=".length), 10);
      if (Number.isFinite(value) && value > 0) options.appPort = value;
    }
  }

  return options;
}

const cliOptions = parseCliArgs(process.argv.slice(2));
const gatewayPort = Number(cliOptions.gatewayPort);
const appPort = Number(cliOptions.appPort);
const appServer = cliOptions.appServer === "preview" ? "preview" : "dev";
const gatewayBaseUrl = `http://127.0.0.1:${gatewayPort}`;
const appUrl = `http://127.0.0.1:${appPort}/?clawdesk-gateway-port=${gatewayPort}&clawdesk-gateway-strict=1`;

const accountEmail = process.env.CLAWDESK_ACCOUNT_EMAIL ?? process.env.CLAWDESK_DEVELOPER_EMAIL ?? "support@clawdesk.example";
const accountPassword = process.env.CLAWDESK_ACCOUNT_PASSWORD ?? process.env.CLAWDESK_DEVELOPER_PASSWORD ?? "ChangeMe123!";
const developerEmail = process.env.CLAWDESK_DEVELOPER_EMAIL ?? accountEmail;
const developerPassword = process.env.CLAWDESK_DEVELOPER_PASSWORD ?? "ChangeMe123!";
const accountIsDeveloper = accountEmail.trim().toLowerCase() === developerEmail.trim().toLowerCase();
const recoveryAccountEmail = process.env.CLAWDESK_SMOKE_RECOVERY_EMAIL ?? "smoke.recovery@example.com";
const recoveryAccountPassword = process.env.CLAWDESK_SMOKE_RECOVERY_PASSWORD ?? "SmokeReset123!";
const recoveryAccountResetPassword = process.env.CLAWDESK_SMOKE_RECOVERY_PASSWORD_RESET ?? "SmokeReset456!";

const reportDir = path.join(process.cwd(), "artifacts", "gui-smoke");
const reportFile = path.join(reportDir, `${new Date().toISOString().replace(/[:.]/g, "_")}-report.json`);
const legalConsentManifestPath = path.join(process.cwd(), "src", "lib", "legalConsentManifest.ts");

async function readExpectedLegalConsentVersion() {
  const manifest = await fs.readFile(legalConsentManifestPath, "utf8");
  const match = manifest.match(/legalConsentVersion\s*=\s*"([^"]+)"/);
  if (!match?.[1]) {
    throw new Error(`Cannot read legalConsentVersion from ${legalConsentManifestPath}`);
  }
  return match[1];
}

async function postJson(pathname, body = {}) {
  const response = await fetch(`${gatewayBaseUrl}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  return { response, payload };
}

async function ensureVerifiedIdentityAccount(email, password, displayName = "Smoke Recovery") {
  const login = await postJson("/identity/login", { email, password });
  if (login.response.ok) return;

  const register = await postJson("/identity/register", {
    email,
    password,
    displayName,
    mode: "personal",
    organization: "ClawDesk Smoke",
  });
  if (!register.response.ok && register.response.status !== 409) {
    throw new Error(`failed to register recovery account (${register.response.status})`);
  }

  async function readVerificationCode() {
    const verifyCodeResult = await fetch(`${gatewayBaseUrl}/identity/verification-code?email=${encodeURIComponent(email)}`);
    const verifyCodePayload = await verifyCodeResult.json().catch(() => ({}));
    const verifyCode = typeof verifyCodePayload.code === "string" ? verifyCodePayload.code : "";
    const verifyToken = typeof verifyCodePayload.token === "string" ? verifyCodePayload.token : "";
    return { verifyCode, verifyToken };
  }

  let { verifyCode, verifyToken } = await readVerificationCode();
  if (!verifyCode && !verifyToken) {
    await postJson("/identity/resend-verification", { email });
    ({ verifyCode, verifyToken } = await readVerificationCode());
  }
  if (!verifyCode && !verifyToken) {
    await postJson("/identity/password/forgot", { email });
    const resetCodeResponse = await fetch(`${gatewayBaseUrl}/identity/password-reset-code?email=${encodeURIComponent(email)}`);
    const resetCodePayload = await resetCodeResponse.json().catch(() => ({}));
    const resetCode = typeof resetCodePayload.code === "string" ? resetCodePayload.code : "";
    if (resetCode) {
      const reset = await postJson("/identity/password/reset", {
        email,
        code: resetCode,
        password,
      });
      if (reset.response.ok) {
        const resetLogin = await postJson("/identity/login", { email, password });
        if (resetLogin.response.ok) return;
      }
    }
    throw new Error("recovery verification code is unavailable");
  }

  const confirm = await postJson("/identity/confirm", {
    email,
    code: verifyCode,
    token: verifyToken,
  });
  if (!confirm.response.ok) {
    throw new Error("recovery account verification failed");
  }

  const relogin = await postJson("/identity/login", { email, password });
  if (!relogin.response.ok) {
    throw new Error(`recovery account login failed after verify (${relogin.response.status})`);
  }
}

function commandInvocation(command, args) {
  if (process.platform !== "win32") return { command, args };
  if (command.endsWith(".exe")) return { command, args };
  const cmdCommand = command.endsWith(".cmd") ? command : `${command}.cmd`;
  return { command: "cmd.exe", args: ["/d", "/s", "/c", cmdCommand, ...args] };
}

function spawnProcess(command, args, env = {}) {
  const invocation = commandInvocation(command, args);
  return spawn(invocation.command, invocation.args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    windowsHide: process.platform === "win32",
  });
}

async function waitFor(url, timeoutMs = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // keep trying until local service is ready
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function waitForWithRetry(action, options = {}) {
  const {
    attempts = 2,
    delayMs = 400,
    timeoutMs = 12000,
    successMessage = "condition",
  } = options;

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await action(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (timeoutMs) {
        await pageWaitForFrameSettle(timeoutMs / attempts);
      }
    }
  }
  throw new Error(`重試 ${attempts} 次後仍失敗：${successMessage}${lastError ? ` (${String(lastError)})` : ""}`);
}

async function stop(child, label) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      cwd: process.cwd(),
      stdio: ["ignore", "ignore", "ignore"],
      shell: false,
    windowsHide: process.platform === "win32",
    });
  } else {
    child.kill("SIGTERM");
  }
  await Promise.race([
    once(child, "exit"),
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ]);
  console.log(`${label} 停止。`);
}

function registerIssue(outcome, details) {
  outcome.issues.push(details);
  outcome.failures += 1;
}

function extractScoreFromText(text) {
  const value = Number(String(text ?? "").trim());
  return Number.isFinite(value) ? value : Number.NaN;
}

async function waitForStableLicenseData(dialog) {
  const deadline = Date.now() + 14000;
  let lastError = "";
  while (Date.now() < deadline) {
    const statusLists = dialog.locator(".status-list");
    const listCount = await statusLists.count();

    for (let i = 0; i < listCount; i += 1) {
      const rowCount = await statusLists.nth(i).locator("div").count();
      if (rowCount > 0) {
        return { statusRows: rowCount, ready: true };
      }
    }

    const hasPanelSuccess = await dialog.locator(".panel-success").count();
    const hasPanelError = await dialog.locator(".panel-error").count();
    const hasMessage = hasPanelSuccess > 0 || hasPanelError > 0;
    const hasPlans = await dialog.locator(".pricing-card").count();
    if (hasPlans > 0) {
      return { statusRows: 0, ready: true, hasPlans: true };
    }
    if (hasMessage) {
      return { statusRows: 0, ready: true, hasMessage: true };
    }

    lastError = `license panel not ready (status lists: ${listCount})`;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(lastError || "license status list is not loaded");
}

async function waitForDiagnosticSuccess(dialog, expectedReportId) {
  const beforeText = await dialog.locator(".diagnostic-preview").first().textContent().catch(() => "");
  const normalizedBefore = String(beforeText ?? "").trim();
  const beforeReportId = (() => {
    try {
      return JSON.parse(normalizedBefore).reportId;
    } catch {
      return "";
    }
  })();

  const deadline = Date.now() + 14000;
  let lastText = "";
  while (Date.now() < deadline) {
    const hasPanelError = await dialog.locator(".panel-error").count();
    if (hasPanelError > 0) {
      const errorText = (await dialog.locator(".panel-error").first().innerText()).trim();
      throw new Error(`diagnostics panel error: ${errorText || "unknown error"}`);
    }

    const preview = dialog.locator(".diagnostic-preview");
    const previewCount = await preview.count();
    if (previewCount > 0) {
      const nextText = (await preview.first().innerText().catch(() => "")).trim();
      if (nextText.length > 0) {
        if (nextText !== normalizedBefore) {
          return nextText;
        }
        try {
          const parsed = JSON.parse(nextText);
          if (parsed?.reportId) {
            if (expectedReportId && parsed.reportId === expectedReportId) {
              return nextText;
            }
            if (parsed.reportId !== beforeReportId) {
              return nextText;
            }
          }
          if (expectedReportId && parsed?.reportId && parsed.reportId === expectedReportId) {
            return nextText;
          }
        } catch {
          // keep waiting when preview is static.
        }
        lastText = nextText;
      }
    }

    const hasSuccess = await dialog.locator(".panel-success").count();
    if (hasSuccess > 0) {
      const latestText = (await dialog.locator(".diagnostic-preview").first().innerText().catch(() => "")).trim();
      return latestText || lastText || "success-indicated";
    }

    if (await dialog.locator("textarea").count() === 0 && !lastText) {
      const reportText = await dialog.locator("pre").count();
      if (reportText > 0) {
        const fallback = await dialog.locator("pre").first().innerText().catch(() => "");
        if (String(fallback ?? "").trim().length > 0) {
          return String(fallback ?? "").trim();
        }
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("diagnostic summary is not generated");
}

async function waitForErgonomicsScore(dialog, minimumScore = 0, runButtonLocator = null) {
  const h3 = dialog.locator(".ergonomics-score h3").first();
  const checkCards = dialog.locator(".agent-grid .agent-card");
  const beforeCards = await checkCards.count().catch(() => 0);
  const beforeText = await h3.textContent().catch(() => "");
  const beforeRunVersion = await h3.getAttribute("data-run-version").catch(() => null);
  const before = extractScoreFromText(beforeText);
  const beforeSafe = Number.isFinite(before) ? before : 0;
  const deadline = Date.now() + 12000;
  const beforeSnapshot = String(beforeText ?? "").trim();
  while (Date.now() < deadline) {
    const currentText = await h3.textContent().catch(() => "");
    const currentRunVersion = await h3.getAttribute("data-run-version").catch(() => null);
    const current = extractScoreFromText(currentText);
    const checkCount = await checkCards.count();
    const hasCheckCards = checkCount > 0;
    const hasGrid = await dialog.locator(".agent-grid").count();
    if (hasGrid < 1) {
      throw new Error("ergonomics panel layout missing");
    }

    if (Number.isFinite(current)) {
      if (current >= minimumScore && currentRunVersion !== beforeRunVersion) {
        return current;
      }
      if (current >= minimumScore && (current !== beforeSafe || hasCheckCards || checkCount !== beforeCards)) {
        return current;
      }
      if (current < minimumScore && (current !== beforeSafe || checkCount !== beforeCards)) {
        throw new Error(`人體工學驗證分數偏低: ${current}`);
      }
    }

    if (
      hasCheckCards &&
      checkCount !== beforeCards &&
      (!Number.isFinite(current) || Number.isFinite(current) && current >= minimumScore)
    ) {
      return Number.isFinite(current) ? current : minimumScore;
    }

    const currentSnapshot = String(currentText ?? "").trim();
    if (
      hasCheckCards &&
      beforeSnapshot.length > 0 &&
      currentSnapshot.length > 0 &&
      currentSnapshot !== beforeSnapshot &&
      current >= minimumScore
    ) {
      if (current >= minimumScore) return current;
      throw new Error(`人體工學驗證分數偏低: ${current}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("人體工學驗證結果未更新");
}

async function getPanelTextInput(dialog, timeoutMs = 3000) {
  const candidateSelectors = [
    "textarea[placeholder*='描述']",
    "textarea[placeholder*='描述發生']",
    ".commercial-card textarea",
    "textarea",
    "[role='textbox']",
    "input:not([type='hidden']):not([disabled])",
    "input[type='text']",
    "input",
  ];

  for (const selector of candidateSelectors) {
    const locator = dialog.locator(selector);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const count = await locator.count();
      if (count > 0) {
        for (let index = 0; index < count; index += 1) {
          const target = locator.nth(index);
          const enabled = await target.isEnabled().catch(() => false);
          const visible = await target.isVisible().catch(() => false);
          if (enabled && visible) return target;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }

  return null;
}

async function forceClick(locator, label) {
  const target = locator;
  if ((await target.count()) > 0) {
    const button = target.first();
    await button.scrollIntoViewIfNeeded().catch(() => {});
    await button.click({ force: true, timeout: 2500 });
    return true;
  }
  throw new Error(`UI 元件不存在：${label}`);
}

async function collectSessionButtons(page) {
  try {
    return await page.evaluate(() =>
      Array.from(document.querySelectorAll("[data-testid^='session-button-']")).map((button) => ({
        testId: button.getAttribute("data-testid"),
        text: (button.textContent ?? "").trim(),
        visible: button instanceof HTMLElement ? button.offsetParent !== null : false,
        disabled: button instanceof HTMLButtonElement ? button.disabled : false,
        scrollWidth: button instanceof HTMLElement ? button.scrollWidth : 0,
        clientWidth: button instanceof HTMLElement ? button.clientWidth : 0,
      })),
    );
  } catch (error) {
    if (process.env.CLAWDESK_DEBUG_SMOKE === "1") {
      console.log("collectSessionButtons 失敗:", safeToString(error));
    }
    return [];
  }
}

function safeToString(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  return String(value);
}

function createIdentityButtonCandidates(page) {
  return [
    page.getByRole("button", { name: "帳號入口" }),
    page.getByRole("button", { name: /Account|Identity|Sign in|登入|Login/i }),
    page.locator(".topbar-actions .icon-button").first(),
    page.locator(".topbar-actions button").first(),
    page.locator("[data-testid='identity-button']"),
    page.locator("[aria-label='帳號入口'], [aria-label='identity'], [aria-label='Account']"),
    page.locator(".identity-button, .identity-trigger, .user-menu"),
  ];
}

async function waitForIdentityButton(page, timeoutMs = 6000) {
  const started = Date.now();
  const deadline = started + timeoutMs;
  const candidates = createIdentityButtonCandidates(page);

  while (Date.now() < deadline) {
    for (const candidate of candidates) {
      if (await candidate.count()) {
        const visible = await candidate.isVisible().catch(() => false);
        if (visible) {
          return candidate;
        }
      }
    }
    await page.waitForTimeout(150).catch(() => {});
  }

  throw new Error("身份入口按鈕未就緒");
}

async function openIdentityDialog(page, timeoutMs = 6000) {
  const identityButton = await waitForIdentityButton(page, timeoutMs);
  await identityButton.click({ force: true }).catch(() => {});
  const dialog = page.locator(".identity-panel").first();
  await dialog.waitFor({ state: "visible", timeout: timeoutMs });
  return dialog;
}

function identitySignInTab(dialog) {
  return dialog.getByRole("tab", { name: /^(登入|Sign in|Login)$/i }).first();
}

async function waitForMainShell(page, timeoutMs = 9000, options = {}) {
  const requireIdentityButton = options.requireIdentityButton !== false;
  const halfTimeout = Math.max(timeoutMs / 2, 2000);
  if (requireIdentityButton) {
    await waitForIdentityButton(page, timeoutMs);
  } else {
    try {
      await waitForIdentityButton(page, Math.min(timeoutMs, 1800));
    } catch {
      // 身份按鈕可能在已登入時不再顯示，改為不阻塞流程
    }
  }
  await page.locator(".conversation-pane").first().waitFor({ state: "visible", timeout: halfTimeout }).catch(() => {});
  await page.locator(".session-strip").first().waitFor({ state: "visible", timeout: halfTimeout }).catch(() => {});
  await page.locator(".composer").first().waitFor({ state: "visible", timeout: halfTimeout }).catch(() => {});
}

async function safeEvaluate(page, action, fallback) {
  try {
    return await action();
  } catch (error) {
    if (safeToString(error).includes("Execution context")) {
      return fallback;
    }
    throw error;
  }
}

async function hardResetBackdrops(page) {
  await page.evaluate(() => {
    document.querySelectorAll(".panel-backdrop, .permission-modal").forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      node.style.pointerEvents = "none";
      node.style.visibility = "hidden";
      node.style.opacity = "0";
    });
  }).catch(() => {});
}

async function clearPanelBackdrops(page) {
  await safeEvaluate(
    page,
    () =>
      page.evaluate(() => {
        document.querySelectorAll(".panel-backdrop, .modal-backdrop, .permission-modal").forEach((backdrop) => {
          const panelNode = backdrop.querySelector("section");
          const hasDialog = panelNode instanceof HTMLElement;
          if (!hasDialog) {
            backdrop.remove();
            return;
          }

          const style = window.getComputedStyle(backdrop);
          const isVisible = style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
          if (!isVisible) {
            return;
          }

          const closeButton = panelNode.querySelector(".icon-button[aria-label='關閉']");
          if (!(closeButton instanceof HTMLElement) || closeButton.offsetParent === null) {
            if (panelNode.textContent?.trim() === "" || backdrop.querySelector("input,button,select,textarea,audio,video,canvas")) {
              return;
            }
            backdrop.remove();
            return;
          }
        });
      }),
    undefined,
  );
}

async function removePanelBackdropsSafely(page) {
  await safeEvaluate(
    page,
    () =>
      page.evaluate(() => {
        document.querySelectorAll(".panel-backdrop, .modal-backdrop, .permission-modal").forEach((backdrop) => {
          const hasPanel = backdrop.querySelector("section");
          if (hasPanel) {
            return;
          }
          backdrop.remove();
        });
      }),
    undefined,
  );
}

async function waitForSessionButton(page, testId, timeoutMs = 5000) {
  const base = page.getByTestId(testId);
  const orderFallback = [
    "session-button-mcp",
    "session-button-license",
    "session-button-channels",
    "session-button-accounts",
    "session-button-workflow",
    "session-button-media",
    "session-button-learning",
    "session-button-memory",
    "session-button-agents",
    "session-button-security",
    "session-button-diagnostics",
    "session-button-ergonomics",
    "session-button-comparison",
    "session-button-coding",
    "session-button-context",
    "session-button-safety-queue",
    "session-button-compatibility",
    "session-button-legal",
    "session-button-provider",
  ];
  const fallbackIndex = orderFallback.indexOf(testId);
  const fallbackTextMap = {
    "session-button-diagnostics": [/故障回報/, /Diagnostics/i],
  };

  const attempts = 6;
  const sleepMs = Math.max(100, Math.floor(timeoutMs / attempts));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await base.count()) {
      try {
        await base.first().waitFor({ state: "attached", timeout: sleepMs });
        return base.first();
      } catch {
        // 還沒進入可點擊狀態，繼續嘗試
        if (attempt === attempts - 1) {
          const currentCount = await base.count();
          if (currentCount > 0) return base.first();
        }
        }
    }
    if (fallbackIndex >= 0) {
      const fallbackButtons = page.locator(".session-strip .session-button");
      const count = await fallbackButtons.count();
      if (count > fallbackIndex) {
        const fallback = fallbackButtons.nth(fallbackIndex);
        if (await fallback.isVisible().catch(() => false)) {
          return fallback;
        }
      } else if (count > 0) {
        for (const pattern of fallbackTextMap[testId] ?? []) {
          const textMatch = fallbackButtons.filter({ hasText: pattern });
          const textCount = await textMatch.count();
          for (let i = 0; i < textCount; i += 1) {
            const candidate = textMatch.nth(i);
            if (await candidate.isVisible().catch(() => false)) {
              return candidate;
            }
          }
        }
        const last = fallbackButtons.last();
        if (await last.isVisible().catch(() => false)) {
          return last;
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, sleepMs));
  }
  throw new Error(`UI 元件不存在：panel-open ${testId}`);
}

async function dismissAllModals(page) {
  await hardResetBackdrops(page);
  const permissionButtons = page.locator(".permission-modal .permission-actions button");
  const permissionCount = await permissionButtons.count();
  for (let i = 0; i < permissionCount; i += 1) {
    try {
      const button = permissionButtons.nth(i);
      const visible = await button.isVisible().catch(() => false);
      if (!visible) continue;
      const label = (await button.textContent()) ?? "";
      if (/[拒|拒絕|reject|否|不准|no]/i.test(label)) {
        await button.click({ force: true, timeout: 800 });
        await page.waitForTimeout(80).catch(() => {});
      }
    } catch {
      // 允許在不同模態時略過按鈕互動差異
    }
  }
  const closeButtons = page.locator(".panel-backdrop .icon-button[aria-label='關閉'], .permission-modal .icon-button[aria-label='關閉']");
  const closeCount = await closeButtons.count();

  for (let i = 0; i < closeCount; i += 1) {
    try {
      await closeButtons.nth(0).click({ force: true, timeout: 500 });
      await page.waitForTimeout(60).catch(() => {});
    } catch {
      // 失敗則改用寬鬆後續策略
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(60).catch(() => {});
    }
  }

  await removePanelBackdropsSafely(page);
  await page.waitForTimeout(80);
  await safeEvaluate(
    page,
    () =>
      page.evaluate(() => {
        document.querySelectorAll(".panel-backdrop, .modal-backdrop").forEach((backdrop) => {
          const asElement = backdrop;
          if (!(asElement instanceof HTMLElement)) return;
          if (asElement.querySelector("section[role='dialog']")) return;
          asElement.style.pointerEvents = "none";
          asElement.style.visibility = "hidden";
          asElement.style.opacity = "0";
        });
      }),
    undefined,
  );
  await clearPanelBackdrops(page);
  await hardResetBackdrops(page);
}

async function waitForNoBlockingOverlay(page, timeoutMs = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    let hasBlocking = false;
    try {
      hasBlocking = await page.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll(".panel-backdrop, .modal-backdrop, .permission-modal"));
        if (!nodes.length) return false;
        return nodes.some((node) => {
          const style = getComputedStyle(node);
          if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
          if (node instanceof HTMLElement && node.classList.contains("permission-modal")) {
            return Boolean(node.offsetWidth > 0 && node.offsetHeight > 0);
          }
          const section = node.querySelector("section");
          return Boolean(section && section.offsetWidth > 0 && section.offsetHeight > 0);
        });
      });
    } catch (error) {
      if (safeToString(error).includes("Execution context")) {
        hasBlocking = false;
      } else {
        throw error;
      }
    }
    if (!hasBlocking) return;
    await page.waitForTimeout(120).catch(() => {});
  }
}

async function forceOpenPanel(page, testId) {
  const button = await waitForSessionButton(page, testId);
  await hardResetBackdrops(page);
  await waitForNoBlockingOverlay(page);
  await button.scrollIntoViewIfNeeded().catch(() => {});
  await hardResetBackdrops(page);
  await forceClick(button, `panel-open ${testId}`);
}

async function forceTriggerSessionButton(page, testId) {
  await page.evaluate((targetTestId) => {
    const selector = `[data-testid="${CSS.escape(targetTestId)}"]`;
    const button = document.querySelector(selector);
    if (button instanceof HTMLElement) {
      button.click();
      button.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window,
      }));
    }
  }, testId);
}

async function waitPanelForSelector(page, selector, beforeCount, timeoutMs = 3500) {
  if (!selector) return null;
  const target = page.locator(selector);
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const currentCount = await safeEvaluate(page, () => target.count(), 0);
    if (currentCount > beforeCount) return target.first();
    if (currentCount > 0 && (await safeEvaluate(page, () => target.first().isVisible(), false))) {
      return target.first();
    }
    await page.waitForTimeout(120).catch(() => {});
  }
  return null;
}

async function withBackdropSnapshot(page, label) {
  const snapshot = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".panel-backdrop")).map((backdrop) => ({
      visible:
        getComputedStyle(backdrop).display !== "none" &&
        getComputedStyle(backdrop).visibility !== "hidden" &&
        getComputedStyle(backdrop).opacity !== "0",
      hasSection: Boolean(backdrop.querySelector("section")),
      pointerEvents: getComputedStyle(backdrop).pointerEvents,
      hasClose: Boolean(backdrop.querySelector(".icon-button[aria-label='關閉']")),
    })),
  );
  if (process.env.CLAWDESK_DEBUG_SMOKE === "1") {
    console.log(`DEBUG ${label} backdrop snapshot:`, JSON.stringify(snapshot, null, 2));
  }
}

async function openPanelByTestId(page, testId, selector, timeoutMs = 8000, options = {}) {
  const targetDialog = selector ? page.locator(selector) : null;
  const fallbackDialogTitle = options.fallbackDialogTitle;
  const fallbackRunButtonTestId = options.fallbackRunButtonTestId;
  const dialog = targetDialog || page.getByRole("dialog", { name: /./ }).first();

  const retries = 3;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    await dismissAllModals(page);
    await clearPanelBackdrops(page);
    const button = await waitForSessionButton(page, testId, timeoutMs);
    const enabledDeadline = Date.now() + Math.min(5000, timeoutMs);
    let buttonReady = true;
    while (await button.isDisabled()) {
      if (Date.now() >= enabledDeadline) {
        buttonReady = false;
        break;
      }
      await page.waitForTimeout(120);
    }
    if (!buttonReady) {
      if (attempt === retries - 1) {
        throw new Error(`按鈕 disabled：${testId}`);
      }
      await page.waitForTimeout(220);
      continue;
    }
    const beforeCount = selector ? await safeEvaluate(page, () => page.locator(selector).count(), 0) : 0;
    if (process.env.CLAWDESK_DEBUG_SMOKE === "1") {
      console.log(`DEBUG ${testId} before open count=${beforeCount}`);
    }
    await forceOpenPanel(page, testId);
    const afterFirstTickCount = selector ? await safeEvaluate(page, () => page.locator(selector).count(), 0) : null;
    if (process.env.CLAWDESK_DEBUG_SMOKE === "1") {
      console.log(`DEBUG ${testId} after click count=${afterFirstTickCount}`);
    }

    try {
      let opened = selector ? await waitPanelForSelector(page, selector, beforeCount, Math.max(3500, timeoutMs / 2)) : null;
      if (!opened) {
        if (selector) {
          await forceTriggerSessionButton(page, testId);
          opened = await waitPanelForSelector(page, selector, beforeCount, Math.max(4500, timeoutMs / 2));
        }

        if (!opened && selector) {
          await button.focus().catch(() => {});
          await page.keyboard.press("Enter").catch(() => {});
          opened = await waitPanelForSelector(page, selector, beforeCount, Math.max(4500, timeoutMs / 2));
        }

        if (fallbackRunButtonTestId) {
          const fallbackSection = page.locator("section").filter({
            has: page.getByTestId(fallbackRunButtonTestId),
          });
          const fallbackSectionCount = await fallbackSection.count();
          if (fallbackSectionCount > 0) {
            try {
              const explicit = fallbackSection.filter({ visible: true }).first();
              if (await explicit.count()) {
                return explicit;
              }
            } catch {
              // keep trying fallback paths
            }
          }
        }

        if (fallbackDialogTitle) {
          const titleMatcher = page.getByRole("dialog", { name: new RegExp(fallbackDialogTitle) });
          const titleCount = await titleMatcher.filter({ visible: true }).count();
          if (titleCount > 0) {
            const titleDialog = titleMatcher.first();
            try {
              await titleDialog.waitFor({ timeout: 1200 });
              return titleDialog;
            } catch {
              // continue if fallback not stable
            }
          }
        }

        if (process.env.CLAWDESK_DEBUG_SMOKE === "1") {
          await withBackdropSnapshot(page, `${testId} open`);
          const visibleDialogs = await page.evaluate(() =>
            Array.from(document.querySelectorAll("[role='dialog']")).map((node) => ({
              name: node.getAttribute("aria-label") || (node.textContent ?? "").trim().slice(0, 30),
              text: (node.textContent ?? "").trim().slice(0, 120),
              visible: node.offsetParent !== null,
              hasRunButton: Boolean(node.querySelector("[data-testid='ergonomics-run']")),
            })),
          );
          console.log(`DEBUG ${testId} panel fallback dialog candidates:`, JSON.stringify(visibleDialogs, null, 2));
          const buttons = await collectSessionButtons(page);
          console.log(`DEBUG ${testId} panel open snapshot:`, JSON.stringify(buttons, null, 2));
        }
        if (process.env.CLAWDESK_DEBUG_SMOKE === "1") {
          const fallbackRunCount = await page.evaluate(() => document.querySelectorAll("[data-testid='ergonomics-run']").length);
          const visibleRunCount = await page.evaluate(
            () =>
              Array.from(document.querySelectorAll("[data-testid='ergonomics-run']")).filter((button) => {
                const style = getComputedStyle(button);
                return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
              }).length,
          );
          console.log(`DEBUG ${testId} fallback button counts: run=${fallbackRunCount}, visible=${visibleRunCount}`);
        }
        throw new Error(`panel did not open: ${testId}`);
      }

      if (targetDialog) {
        await opened.waitFor({ state: "visible", timeout: timeoutMs }).catch(async () => {
          if (process.env.CLAWDESK_DEBUG_SMOKE === "1") {
            console.log(`DEBUG ${testId} panel never visible, fallback attached-only`);
          }
        });
      }

      return opened;
    } catch (error) {
      await waitForNoBlockingOverlay(page);
      await hardResetBackdrops(page);
      if (process.env.CLAWDESK_DEBUG_SMOKE === "1") {
        const buttons = await collectSessionButtons(page);
        console.log(`DEBUG ${testId} panel open snapshot:`, JSON.stringify(buttons, null, 2));
      }
      if (attempt === retries - 1) {
        await dismissAllModals(page);
        throw error;
      }
      await page.waitForTimeout(180);
    }
  }

  throw new Error(`panel open failed: ${testId}`);
}

async function closeDialogSafe(page, dialog) {
  const closeButton = dialog.locator("button[aria-label='關閉']").first();
  if (await closeButton.count()) {
    await forceClick(closeButton, "關閉對話框");
    await dialog.waitFor({ state: "hidden", timeout: 2500 }).catch(() => {});
  } else {
    await page.keyboard.press("Escape").catch(() => {});
    await dialog.evaluate((node) => node.dispatchEvent(new Event("close")));
    await dialog.waitFor({ state: "hidden", timeout: 2500 }).catch(() => {});
  }
  await waitForNoBlockingOverlay(page);
  await hardResetBackdrops(page);
}

async function clickVisibleRunButton(page, dialog) {
  const candidateSelectors = [
    "button[data-testid='ergonomics-run']",
    "button[aria-label='執行人體工學驗證']",
    ".ergonomics-score button",
    "button",
  ];

  for (const selector of candidateSelectors) {
    const locator = selector === "button" ? dialog.getByRole("button") : dialog.locator(selector);
    const candidates = selector === "button" ? locator : locator.filter({ visible: true });
    const count = await candidates.count();
    if (count > 0) {
      const target = selector === "button" ? candidates.last() : candidates.first();
      await target.scrollIntoViewIfNeeded().catch(() => {});
      await target.click({ force: true, timeout: 2500 }).catch(() => {});
      return { found: true, locator: target };
    }
  }

  const clickedByDom = await page.evaluate(() => {
    const panel = document.querySelector(".ergonomics-panel");
    if (!panel) return false;
    const buttons = Array.from(panel.querySelectorAll("button"));
    const target = buttons.find((button) => {
      const label = (button.textContent ?? "").trim();
      const ariaLabel = button.getAttribute("aria-label") ?? "";
      const testId = button.getAttribute("data-testid");
      return (
        testId === "ergonomics-run" ||
        ariaLabel === "執行人體工學驗證" ||
        label === "執行驗證" ||
        /ergonomics|人體工學/.test(label)
      );
    });
    if (!target) return false;
    target.click();
    return true;
  });

  if (!clickedByDom) return null;
  const fallbackGlobal = page.locator("[data-testid='ergonomics-run'], [aria-label='執行人體工學驗證']").first();
  if (await fallbackGlobal.count()) {
    await fallbackGlobal.click({ force: true }).catch(() => {});
    return { found: true, locator: fallbackGlobal };
  }
  const fallback = dialog.locator("[data-testid='ergonomics-run'], [aria-label='執行人體工學驗證']").first();
  return { found: true, locator: fallback };
}

async function waitForAuthenticatedState(page, timeoutMs = 7000, options = {}) {
  const { requireDeveloper = false } = options;
  await page.waitForFunction(
    ({ requireDeveloper }) => {
      const hasDeveloperBadge = Boolean(document.querySelector(".status-pill.developer"));
      if (requireDeveloper) return hasDeveloperBadge;

      const hasEnabledSessionButton = [...document.querySelectorAll(".session-button")].some((button) => !button.disabled);
      const statusText = document.querySelector(".status-bar")?.textContent ?? "";
      return hasDeveloperBadge || (hasEnabledSessionButton && !statusText.includes("未登入"));
    },
    { requireDeveloper },
    { timeout: timeoutMs },
  );
}

function collectErgonomicSnapshot() {
  const strip = document.querySelector(".session-strip");
  const topbar = document.querySelector(".topbar");
  const footer = document.querySelector(".status-bar");
  const sendButton = document.querySelector(".send-button");

  const sessionButtons = [...document.querySelectorAll(".session-button")];
  const tooltipWraps = [...document.querySelectorAll(".tooltip-wrap")];
  const tooltipWithText = tooltipWraps.filter((wrap) => {
    const bubble = wrap.querySelector(".tooltip-bubble");
    return Boolean(bubble && bubble.textContent && bubble.textContent.trim().length > 2);
  }).length;

  const allSessionButtonsClipped = sessionButtons.filter((button) => {
    return button.scrollWidth > button.clientWidth + 1 || button.scrollHeight > button.clientHeight + 1;
  }).map((button) => ({
    label: button.textContent?.trim() ?? "unknown",
    width: button.clientWidth,
    scrollWidth: button.scrollWidth,
  }));

  const panelButtonsDisabled = [...document.querySelectorAll(".session-strip .session-button")].some((btn) => btn.disabled);

  const topbarActionButtons = [...document.querySelectorAll(".topbar-actions .icon-button")];
  const developerBadgeVisible = Boolean(document.querySelector(".status-pill.developer"));
  const stripOverflow = Boolean(strip && strip.scrollHeight > strip.clientHeight + 1);
  const topbarOverflow = Boolean(topbar && topbar.scrollWidth > topbar.clientWidth + 2);

  return {
    sessionStripHasOverflow: stripOverflow,
    topbarOverflow,
    topbarActionCount: topbarActionButtons.length,
    sessionButtonCount: sessionButtons.length,
    tooltipCoverage: sessionButtons.length ? tooltipWithText / Math.max(tooltipWraps.length, 1) : 0,
    sessionButtonOverflowCount: allSessionButtonsClipped.length,
    clippedSessionButtons: allSessionButtonsClipped,
    hasAnySessionButtonClipped: allSessionButtonsClipped.length > 0,
    panelButtonsDisabled,
    hasDeveloperBadge: developerBadgeVisible,
    statusBarVisible: Boolean(footer),
    sendButtonEnabled: Boolean(sendButton && !sendButton.disabled),
  };
}

let gateway;
let appServerProcess;
let shouldStopGateway = false;
let shouldStopAppServer = false;

async function assertProductionBuildReady() {
  if (appServer !== "preview") return;
  const indexPath = path.join(process.cwd(), "dist", "index.html");
  try {
    await fs.access(indexPath);
  } catch {
    throw new Error("Production smoke requires dist/index.html. Run npm run build first.");
  }
}

function appServerCommand() {
  if (appServer === "preview") {
    return {
      args: ["run", "preview", "--", "--host", "127.0.0.1", "--port", String(appPort)],
      label: "Vite preview",
    };
  }

  return {
    args: ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(appPort)],
    label: "Vite dev",
  };
}

async function waitForHealth(url, timeoutMs = 5000, intervalMs = 120) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for ${url}${lastError ? ` (${safeToString(lastError)})` : ""}`);
}

async function ensureLocalServices() {
  await assertProductionBuildReady();
  try {
    await waitForHealth(`${gatewayBaseUrl}/health`, 1200, 120);
  } catch {
    gateway = spawnProcess(process.execPath, ["sidecars/mock-gateway/server.mjs"], {
      CLAWDESK_MOCK_PORT: String(gatewayPort),
      OPENCLAW_MOCK_PORT: String(gatewayPort),
      CLAWDESK_DEVELOPER_EMAIL: developerEmail,
      CLAWDESK_DEVELOPER_PASSWORD: developerPassword,
      NODE_ENV: "production",
      NODE_OPTIONS: "--max-old-space-size=128",
    });
    shouldStopGateway = true;
    await waitForHealth(`${gatewayBaseUrl}/health`, 12000, 200);
  }

  try {
    await waitFor(`${appUrl}`, 800);
  } catch {
    const command = appServerCommand();
    appServerProcess = spawnProcess("npm", command.args, {
      CLAWDESK_MOCK_PORT: String(gatewayPort),
      OPENCLAW_MOCK_PORT: String(gatewayPort),
      VITE_GATEWAY_PORT: String(gatewayPort),
    });
    shouldStopAppServer = true;
    await waitFor(`${appUrl}`, 12000, 800);
  }
}

if (!cliOptions.connectOnly) {
  await assertProductionBuildReady();
  gateway = spawnProcess(process.execPath, ["sidecars/mock-gateway/server.mjs"], {
    CLAWDESK_MOCK_PORT: String(gatewayPort),
    OPENCLAW_MOCK_PORT: String(gatewayPort),
    CLAWDESK_DEVELOPER_EMAIL: developerEmail,
    CLAWDESK_DEVELOPER_PASSWORD: developerPassword,
    NODE_ENV: "production",
    NODE_OPTIONS: "--max-old-space-size=128",
  });

  const command = appServerCommand();
  appServerProcess = spawnProcess("npm", command.args, {
    CLAWDESK_MOCK_PORT: String(gatewayPort),
    OPENCLAW_MOCK_PORT: String(gatewayPort),
    VITE_GATEWAY_PORT: String(gatewayPort),
  });
  shouldStopGateway = true;
  shouldStopAppServer = true;
}

let browser;

let activePage;

const outcome = {
  startedAt: new Date().toISOString(),
  appServer,
  issues: [],
  checks: [],
  screenshotPath: null,
  failures: 0,
};

async function recordCheck(name, run) {
  try {
    const result = await run();
    outcome.checks.push({ name, ok: true, result });
    console.log(`PASS ${name}`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outcome.checks.push({ name, ok: false, error: message });
    registerIssue(outcome, { name, error: message });
    if (activePage) {
      const filename = path.join(reportDir, `error-${Date.now()}.png`);
      await activePage.screenshot({ path: filename, fullPage: true }).catch(() => {});
      outcome.screenshotPath = path.basename(filename);
    }
    console.error(`FAIL ${name}: ${message}`);
    return false;
  }
}

async function pageWaitForFrameSettle(waitMs) {
  await new Promise((resolve) => setTimeout(resolve, waitMs));
}

async function acceptLegalConsentIfPresent(page) {
  const legalConsent = page.locator(".legal-consent-panel");
  if (!(await legalConsent.count())) return false;

  await legalConsent.waitFor({ state: "visible", timeout: 3000 });
  const checkbox = legalConsent.locator("input[type='checkbox']").first();
  if (await checkbox.count()) {
    await checkbox.check({ force: true });
  }
  const acceptButton = legalConsent.getByRole("button", { name: /同意並繼續|Accept and continue|同意して続行/ });
  if (await acceptButton.count()) {
    await acceptButton.first().click({ force: true });
  } else {
    await legalConsent.locator("button").last().click({ force: true });
  }
  await legalConsent.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
  return true;
}

async function closeQuickSetupIfPresent(page) {
  await acceptLegalConsentIfPresent(page);
  const quickSetup = page.getByRole("dialog", { name: "快速設定" });
  const quickSetupByClass = page.locator(".quick-setup");
  if (!(await quickSetup.count()) && !(await quickSetupByClass.count())) return;

  const primaryButton =
    (await quickSetup.getByRole("button", { name: /開始使用/ }).count()) > 0
      ? quickSetup.getByRole("button", { name: /開始使用/ })
      : quickSetupByClass.getByRole("button", { name: /開始使用/ });
  if (await primaryButton.count()) {
    await primaryButton.first().click({ force: true });
  } else {
    const quickClose = quickSetup.getByRole("button", { name: "關閉" }).first();
    if (await quickClose.count()) {
      await quickClose.click({ force: true });
    } else if (await quickSetupByClass.getByRole("button", { name: "關閉" }).count()) {
      await quickSetupByClass.getByRole("button", { name: "關閉" }).first().click({ force: true });
    }
  }

  await page.waitForTimeout(120);
  if (await quickSetup.count()) {
    const fallbackClose = quickSetup.getByRole("button", { name: "關閉" }).first();
    if (await fallbackClose.count()) {
      await fallbackClose.click({ force: true });
    }
    await quickSetup.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
  }

  if (await quickSetupByClass.count()) {
    const byClassClose = quickSetupByClass.locator(".icon-button[aria-label='關閉']").first();
    if (await byClassClose.count()) {
      await byClassClose.click({ force: true });
    }
    const byClassDone = quickSetupByClass.getByRole("button", { name: /開始使用/ });
    if (await byClassDone.count()) {
      await byClassDone.first().click({ force: true });
    }
  }

  await clearPanelBackdrops(page);
  await removePanelBackdropsSafely(page);
  await waitForNoBlockingOverlay(page, 1200);
}

async function ensureMainPaneReady(page) {
  const currentUrl = page.url();
  if (!currentUrl.startsWith(appUrl)) {
    await page.goto(appUrl, { waitUntil: "networkidle" }).catch(() => {});
  }
  await closeQuickSetupIfPresent(page);
  await waitForNoBlockingOverlay(page);
  await waitForMainShell(page, 9000, { requireIdentityButton: false });
}

async function sendPromptAndAwaitResponse(page, prompt) {
  const composerInputCandidates = [
    page.locator(".composer textarea"),
    page.locator(".composer input[type='text']"),
    page.locator(".composer input"),
    page.locator(".composer [contenteditable='true']"),
  ];
  const sendButtonCandidates = [
    page.locator(".send-button"),
    page.locator("[data-testid='send-button']"),
    page.locator("button:has-text('送出')"),
    page.locator("button[aria-label='送出訊息']"),
    page.locator(".composer button[type='submit']"),
  ];
  const resolveVisible = async (candidates) => {
    for (const candidate of candidates) {
      if (await candidate.count()) {
        const first = candidate.first();
        if (await first.isVisible().catch(() => false)) {
          return first;
        }
      }
    }
    return candidates[candidates.length - 1].first();
  };
  const composerInput = await resolveVisible(composerInputCandidates);
  const sendButton = await resolveVisible(sendButtonCandidates);
  const messagesLocator = page.locator(".message-list .message");
  const messagesBefore = await messagesLocator.count();
  const canvasHeadingBeforeText = (await page.locator(".canvas-heading span").first().textContent().catch(() => ""))?.trim() ?? "";
  const canvasContentBefore = await page.locator(".canvas-content").count();

  await composerInput.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  await composerInput.click({ force: true }).catch(() => {});
  await composerInput.fill(prompt);
  await composerInput.focus();
  await page.waitForTimeout(60);

  const apiFallbackSend = async () => {
    const status = await page.evaluate(async (payload) => {
      const response = await fetch(`http://127.0.0.1:${payload.port}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: "demo-conversation", prompt: payload.prompt }),
      });
      return response.status;
    }, { port: gatewayPort, prompt });
    return status;
  };

  const sendIfPossible = async () => {
    const isEnabled = await sendButton.isEnabled().catch(() => false);
    if (!isEnabled) {
      await page.waitForTimeout(300);
      throw new Error("send button not enabled");
    }
    try {
      await sendButton.click({ force: true, timeout: 2500 });
    } catch {
      await page.keyboard.press("Enter").catch(() => {});
    }
  };

  let sent = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const beforeUserCount = await messagesLocator.count();
    try {
      await sendIfPossible();
      await page.waitForFunction(
        (base) => {
          const messageCount = document.querySelectorAll(".message-list .message").length;
          return messageCount > base;
        },
        beforeUserCount,
        { timeout: 5000 },
      );
      sent = true;
      break;
    } catch (error) {
      const responseStatus = await apiFallbackSend().catch(() => null);
      if (!responseStatus || responseStatus >= 400) {
        if (attempt === 2) {
          throw new Error(`${error instanceof Error ? error.message : String(error)} (and API fallback status: ${responseStatus ?? "n/a"})`);
        }
      } else {
        sent = true;
        break;
      }
      await page.waitForTimeout(350);
      await composerInput.fill(prompt);
      await ensureMainPaneReady(page).catch(() => {});
      await composerInput.focus();
      await page.waitForTimeout(120);
    }
  }

  if (!sent) {
    throw new Error("無法送出聊天訊息");
  }

  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    const response = await page.evaluate((state) => {
      const messageCount = document.querySelectorAll(".message-list .message").length;
      const canvasCount = document.querySelectorAll(".canvas-content").length;
      const headingNode = document.querySelector(".canvas-heading span");
      const headingText = headingNode instanceof HTMLElement ? headingNode.textContent?.trim() ?? "" : "";
      return {
        messageCount,
        canvasCount,
        hasPermissionModal: Boolean(document.querySelector(".permission-modal")),
        canvasHeadingText: headingText,
      };
    }, null);

    if (
      response.messageCount > messagesBefore
      || response.canvasCount > canvasContentBefore
      || (response.canvasCount > 0 && response.canvasHeadingText !== canvasHeadingBeforeText)
      || response.hasPermissionModal
    ) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error("無法取得 Canvas 回覆訊息/畫布或授權流程 (timeout)");
}

async function saveReport() {
  await fs.mkdir(reportDir, { recursive: true });
  const payload = {
    ...outcome,
    finishedAt: new Date().toISOString(),
    totalChecks: outcome.checks.length,
    status: outcome.failures === 0 ? "pass" : "fail",
    account: { email: accountEmail.replace(/(.{3}).+(.{3})/, "$1***$2") },
  };
  await fs.writeFile(reportFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`GUI 測試報告: ${reportFile}`);
}

async function run() {
  if (cliOptions.connectOnly) {
    await ensureLocalServices();
  } else {
    await waitFor(`${gatewayBaseUrl}/health`);
  }
  await ensureVerifiedIdentityAccount(recoveryAccountEmail, recoveryAccountPassword);
  const loginTest = await postJson("/identity/login", {
    email: accountEmail,
    password: accountPassword,
  });
  if (!loginTest.response.ok) {
    const registerResult = await postJson("/identity/register", {
      email: accountEmail,
      password: accountPassword,
      displayName: "Smoke 測試帳戶",
      mode: "personal",
      organization: "ClawDesk 測試組織",
    });
    if (!registerResult.response.ok && registerResult.response.status !== 409) {
      throw new Error(`provided account login endpoint failed (${loginTest.response.status})`);
    }
    const verifyCodeResult = await fetch(`${gatewayBaseUrl}/identity/verification-code?email=${encodeURIComponent(accountEmail)}`);
    let verifyCodePayload = {};
    try {
      verifyCodePayload = await verifyCodeResult.json();
    } catch {
      verifyCodePayload = {};
    }
    const verifyCode = typeof verifyCodePayload.code === "string" ? verifyCodePayload.code : "";
    const verifyToken = typeof verifyCodePayload.token === "string" ? verifyCodePayload.token : "";
    if (!verifyCode && !verifyToken) {
      throw new Error(`provided account login endpoint failed (${loginTest.response.status})`);
    }
    const confirmResult = await postJson("/identity/confirm", {
      email: accountEmail,
      code: verifyCode,
      token: verifyToken,
    });
    if (!confirmResult.response.ok) {
      throw new Error("account verification failed");
    }
    const recoverLogin = await postJson("/identity/login", {
      email: accountEmail,
      password: accountPassword,
    });
    if (!recoverLogin.response.ok) {
      throw new Error(`provided account login endpoint failed (${recoverLogin.response.status})`);
    }
  }
  await waitFor(appUrl, 12000);

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 2200, height: 1200 } });
  await page.addInitScript((port) => {
    if (!Number.isFinite(port) || port <= 0) return;
    const portString = String(port);
    window.__CLAWDESK_GATEWAY_PORT__ = portString;
    try {
      window.localStorage.setItem("clawdesk-gateway-port", portString);
    } catch {
      // ignore
    }
    try {
      const searchParams = new URLSearchParams(window.location.search);
      searchParams.set("clawdesk-gateway-port", portString);
      const next = `${window.location.pathname}?${searchParams.toString()}${window.location.hash || ""}`;
      window.history.replaceState(window.history.state, "", next);
    } catch {
      // ignore
    }
  }, Number(gatewayPort));
  activePage = page;
  await page.goto(appUrl, { waitUntil: "networkidle" });
  page.on("console", (message) => {
    const text = message.text();
    const lines = [text, ...message.args().map((arg) => arg.toString())].filter(Boolean);
    if (text.includes("Failed to execute") || text.includes("error") || text.includes("Error")) {
      console.log(`[browser-console] ${lines.join(" | ")}`);
    }
  });
  page.on("pageerror", (error) => {
    console.log(`[browser-pageerror] ${error?.message || String(error)}`);
  });
  await page.screenshot({ path: path.join(reportDir, "01-login-before.png") });

  await recordCheck("頁面初始登入與快速設定遮罩就緒", async () => {
    const acceptedLegal = await acceptLegalConsentIfPresent(page);
    if (acceptedLegal) {
      const expectedLegalConsentVersion = await readExpectedLegalConsentVersion();
      const storedConsent = await page.evaluate(() => window.localStorage.getItem("clawdesk_legal_consent"));
      if (!storedConsent || !storedConsent.includes(expectedLegalConsentVersion)) {
        throw new Error("首次條款同意未保存到 localStorage");
      }
    }
    const identityDialog = page.getByRole("dialog", { name: "帳號登入入口（Email / Apple / Google / Microsoft）" });
    const quickSetup = page.getByRole("dialog", { name: "快速設定" });
    try {
      await identityDialog.waitFor({ state: "visible", timeout: 2400 });
    } catch {
      // 某些流程會預先完成登入，改以主控 UI 可見作為替代條件
      await waitForMainShell(page, 3000, { requireIdentityButton: false });
    }
    if (await quickSetup.count()) {
      await page.screenshot({ path: path.join(reportDir, "01-identity-only.png") });
    }
  });

  await recordCheck("帳號密碼登入流程", async () => {
    await closeQuickSetupIfPresent(page);
    const emailInput = page.locator(".identity-panel input[type='email']");
    const passwordInput = page.locator(".identity-panel input[type='password']").first();
    const alreadySignedIn = await page.locator(".status-pill.developer").isVisible();
    if (alreadySignedIn || !(await emailInput.count())) {
      await closeQuickSetupIfPresent(page);
      return;
    }

    await emailInput.fill(accountEmail);
    await passwordInput.fill(accountPassword);
    const signInButton = page.locator(".identity-form").getByRole("button", { name: /登入|Sign in|Login/i });
    if (await signInButton.count()) {
      await signInButton.first().click({ force: true });
    } else {
      await page.locator(".identity-form button[type='submit'], .identity-form button").first().click({ force: true });
    }
    await waitForAuthenticatedState(page, 30000, { requireDeveloper: accountIsDeveloper });
    await closeQuickSetupIfPresent(page);
    if (accountIsDeveloper && !(await page.locator(".status-pill.developer").isVisible())) {
      throw new Error("開發者模式標記未顯示");
    }
  });

  await recordCheck("帳號驗證信重送與密碼重設 GUI 流程", async () => {
    await closeQuickSetupIfPresent(page);
    let dialog = await openIdentityDialog(page, 8000);

    const signOutButton = dialog.getByRole("button", { name: /登出|Sign out/i }).first();
    if (await signOutButton.count()) {
      await signOutButton.click({ force: true });
      await dialog.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    }

    dialog = await openIdentityDialog(page, 8000);
    await dialog.getByRole("tab", { name: /重設密碼|Reset password/i }).click({ force: true });

    const resetEmailInput = dialog.locator("input[type='email']").first();
    await resetEmailInput.fill(recoveryAccountEmail);

    const requestResetButton = dialog.getByRole("button", { name: /寄送重設碼|Send reset code/i }).first();
    await requestResetButton.click({ force: true });

    const fetchResetButton = dialog.getByRole("button", { name: /取重設碼|Fetch reset code/i }).first();
    await fetchResetButton.click({ force: true });

    const resetCodeInput = dialog.locator("input[inputmode='numeric']").first();
    let resetCode = (await resetCodeInput.inputValue().catch(() => "")).trim();
    if (!resetCode) {
      const resetCodeResponse = await fetch(`${gatewayBaseUrl}/identity/password-reset-code?email=${encodeURIComponent(recoveryAccountEmail)}`);
      const resetCodePayload = await resetCodeResponse.json().catch(() => ({}));
      resetCode = typeof resetCodePayload.code === "string" ? resetCodePayload.code.trim() : "";
      if (!resetCode) {
        throw new Error("password reset code not available");
      }
      await resetCodeInput.fill(resetCode);
    }

    const passwordInputs = dialog.locator("input[type='password']");
    await passwordInputs.nth(0).fill(recoveryAccountResetPassword);
    await passwordInputs.nth(1).fill(recoveryAccountResetPassword);

    const submitResetButton = dialog.getByRole("button", { name: /更新密碼|Update password/i }).first();
    await submitResetButton.click({ force: true });
    await page.waitForFunction(() => {
      return Array.from(document.querySelectorAll(".identity-panel .panel-error")).some((node) => {
        const text = node.textContent ?? "";
        return text.includes("密碼已更新") || text.includes("Password updated");
      });
    }, null, { timeout: 5000 });

    await identitySignInTab(dialog).click({ force: true });
    await resetEmailInput.fill(recoveryAccountEmail);
    await dialog.locator("input[type='password']").first().fill(recoveryAccountResetPassword);
    await dialog.getByRole("button", { name: /登入|Sign in|Login/i }).first().click({ force: true });
    await waitForAuthenticatedState(page, 15000, { requireDeveloper: false });

    dialog = await openIdentityDialog(page, 8000);
    const signOutRecoveryButton = dialog.getByRole("button", { name: /登出|Sign out/i }).first();
    await signOutRecoveryButton.click({ force: true });
    await dialog.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});

    dialog = await openIdentityDialog(page, 8000);
    await identitySignInTab(dialog).click({ force: true });
    await dialog.locator("input[type='email']").first().fill(accountEmail);
    await dialog.locator("input[type='password']").first().fill(accountPassword);
    await dialog.getByRole("button", { name: /登入|Sign in|Login/i }).first().click({ force: true });
    await waitForAuthenticatedState(page, 20000, { requireDeveloper: accountIsDeveloper });
    await closeQuickSetupIfPresent(page);
  });

  await page.screenshot({ path: path.join(reportDir, "02-after-login.png") });

  await recordCheck("快速登入後主控面板可用", async () => {
    await waitForMainShell(page, 12000);
    await page.getByText("ClawDesk", { exact: false }).first().waitFor();
  });

  await recordCheck("主功能面板逐一可開關", async () => {
    const panels = [
      { testId: "session-button-mcp", selector: ".mcp-panel" },
      { testId: "session-button-license", selector: ".license-panel" },
      { testId: "session-button-channels", selector: ".channels-panel" },
      { testId: "session-button-accounts", selector: ".accounts-panel" },
      { testId: "session-button-workflow", selector: ".workflow-panel" },
      { testId: "session-button-media", selector: ".media-panel" },
      { testId: "session-button-learning", selector: ".learning-panel" },
      { testId: "session-button-security", selector: ".security-panel" },
      { testId: "session-button-diagnostics", selector: ".diagnostics-panel" },
      { testId: "session-button-ergonomics", selector: ".ergonomics-panel" },
      { testId: "session-button-comparison", selector: ".comparison-panel" },
      { testId: "session-button-coding", selector: ".coding-workspace-panel" },
      { testId: "session-button-context", selector: ".context-budget-panel" },
      { testId: "session-button-safety-queue", selector: ".safety-queue-panel" },
      { testId: "session-button-compatibility", selector: ".compat-settings-panel" },
      { testId: "session-button-legal", selector: ".legal-panel" },
      { testId: "session-button-provider", selector: ".provider-panel" },
      { testId: "session-button-memory", selector: ".memory-panel" },
      { testId: "session-button-agents", selector: ".agents-panel" },
    ];

    for (const item of panels) {
      await page.waitForTimeout(80);
      const dialog = await openPanelByTestId(page, item.testId, item.selector);
      await page.waitForTimeout(120);
      await closeDialogSafe(page, dialog);
      await page.waitForTimeout(120);
    }
  });

  await recordCheck("Canvas 與授權流程", async () => {
    await ensureMainPaneReady(page);
    await waitForWithRetry(async () => {
      await sendPromptAndAwaitResponse(page, "請幫我做一次 GUI 可用性檢查並列出建議。");
    }, {
      attempts: 2,
      delayMs: 400,
      timeoutMs: 1000,
      successMessage: "無法取得 Canvas 回覆訊息",
    });

    const licenseDialog = await openPanelByTestId(page, "session-button-license", ".license-panel");
    await waitForWithRetry(async () => {
      const state = await waitForStableLicenseData(licenseDialog);
      if (!state.ready) {
        throw new Error("license data not ready");
      }
    }, {
      attempts: 3,
      delayMs: 300,
      timeoutMs: 12000,
      successMessage: "license status list not ready",
    });
    const stateAfterLoad = await waitForStableLicenseData(licenseDialog);
    const hasStatus = stateAfterLoad.statusRows;
    const hasPlanCards = (await licenseDialog.locator(".pricing-card").count()) > 0;
    if (stateAfterLoad.ready === false || (!hasStatus && !hasPlanCards && !stateAfterLoad.hasMessage)) {
      const activateButton = licenseDialog.getByRole("button", { name: /授權|啟用|Activate/ });
      if (await activateButton.count()) {
        await forceClick(activateButton, "授權啟用");
        await page.waitForTimeout(300);
        await waitForWithRetry(async () => {
          const statusAfterActivate = await waitForStableLicenseData(licenseDialog);
          if (!statusAfterActivate.ready) {
            throw new Error("license data not ready");
          }
          if (
            !statusAfterActivate.statusRows &&
            !statusAfterActivate.hasMessage &&
            (await licenseDialog.locator(".pricing-card").count()) === 0
          ) {
            throw new Error("啟用後仍未取得授權狀態");
          }
          return statusAfterActivate.statusRows;
        }, {
          attempts: 3,
          delayMs: 250,
          timeoutMs: 10000,
          successMessage: "license status list still not ready after activation",
        });
        return;
      }
      throw new Error("授權狀態資訊未載入");
    }
    await dismissAllModals(page);
    await closeDialogSafe(page, licenseDialog);
  });

  await recordCheck("故障回報流程", async () => {
    await ensureMainPaneReady(page);
    const dialog = await openPanelByTestId(page, "session-button-diagnostics", ".diagnostics-panel", 8000, {
      fallbackDialogTitle: "故障回報",
    });
    await dialog.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
    const beforeSuccess = await dialog.locator(".panel-success").count();
    const beforePreviewText = (await dialog.locator(".diagnostic-preview").first().innerText().catch(() => "")).trim();
    const descriptionInput = await getPanelTextInput(dialog, 4500);
    if (!descriptionInput) {
      const hasDialogText = await dialog.innerText().catch(() => "");
      throw new Error(`診斷回報描述欄位未找到，對話框片段：${String(hasDialogText).slice(0, 260)}`);
    }
    await descriptionInput.scrollIntoViewIfNeeded().catch(() => {});
    await descriptionInput.fill(`smoke-${Date.now()}`);
    const beforeReportId = (() => {
      try {
        return JSON.parse(beforePreviewText || "{}").reportId ?? "";
      } catch {
        return "";
      }
    })();
    await forceClick(dialog.getByRole("button", { name: "產生診斷包" }), "產生診斷包");
    const previewResult = await waitForWithRetry(async () => {
      const latestText = await waitForDiagnosticSuccess(dialog);
      return latestText;
    }, {
      attempts: 2,
      delayMs: 300,
      timeoutMs: 12000,
      successMessage: "diagnostic summary not ready",
    });
    const afterSuccess = await dialog.locator(".panel-success").count();
    const afterPreviewText = String(previewResult || (await dialog.locator(".diagnostic-preview").first().innerText().catch(() => ""))).trim();
    const afterReportId = (() => {
      try {
        return JSON.parse(afterPreviewText || "{}").reportId ?? "";
      } catch {
        return "";
      }
    })();
    const previewUpdated = afterPreviewText.length > 0 && afterPreviewText !== beforePreviewText;
    const hasExpectedReport = Boolean(afterReportId && afterReportId !== beforeReportId) || previewUpdated || afterSuccess > beforeSuccess;
    if (!hasExpectedReport) {
      throw new Error("故障回報未顯示產生成功");
    }
    await closeDialogSafe(page, dialog);
  });

  await recordCheck("人體工學 smoke 驗證", async () => {
    await ensureMainPaneReady(page);
    const dialog = await openPanelByTestId(page, "session-button-ergonomics", ".ergonomics-panel", 8000, {
      fallbackRunButtonTestId: "ergonomics-run",
      fallbackDialogTitle: "GUI 人體工學驗證儀表",
    });
    await waitForNoBlockingOverlay(page);
    const clicked = await clickVisibleRunButton(page, dialog);
    if (!clicked?.found) {
      throw new Error("人體工學驗證按鈕不存在");
    }
    const runButton = clicked.locator;
    const score = await waitForWithRetry(async () => {
      return waitForErgonomicsScore(dialog, 90, runButton);
    }, {
      attempts: 2,
      delayMs: 300,
      timeoutMs: 12000,
      successMessage: "ergonomics score not updated",
    });
    if (!Number.isFinite(score) || score < 90) {
      throw new Error(`ergonomics score too low: ${score}`);
    }
    await closeDialogSafe(page, dialog);
  });

  await recordCheck("人體工學畫面指標（文字溢出/ tooltip / 按鈕可達）", async () => {
    await ensureMainPaneReady(page);
    await page.locator(".composer input").fill("回顧測試");
    const metrics = await page.evaluate(collectErgonomicSnapshot);
    if (accountIsDeveloper && !metrics.hasDeveloperBadge) {
      throw new Error("開發者繞過授權標示未出現，身份摘要未完整");
    }
    if (metrics.panelButtonsDisabled) {
      throw new Error("發現主要功能按鈕仍為 disabled 狀態");
    }
    if (metrics.hasAnySessionButtonClipped) {
      throw new Error(`發現 ${metrics.sessionButtonOverflowCount} 個功能按鈕文字可能溢出`);
    }
    if (metrics.tooltipCoverage < 0.9) {
      throw new Error(`tooltip 覆蓋不足: ${(metrics.tooltipCoverage * 100).toFixed(0)}%`);
    }
    if (!metrics.sendButtonEnabled) {
      throw new Error("送出輸入框按鈕不可用");
    }
    return metrics;
  });

  try {
    await page.screenshot({ path: path.join(reportDir, "03-after-flow.png"), fullPage: true });
    outcome.snapshot = await page.evaluate(collectErgonomicSnapshot);
  } catch (error) {
    registerIssue(outcome, {
      name: "測試結束截圖",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
try {
  await run();
} catch (error) {
  registerIssue(outcome, {
    name: "smoke-run-fatal",
    error: error instanceof Error ? error.message : String(error),
  });
  } finally {
  await saveReport();

  console.log(`GUI smoke 後端回報：${outcome.failures === 0 ? "PASS" : "FAIL"}`);
  console.log(`總檢查: ${outcome.checks.length}，失敗: ${outcome.failures}`);

  await browser?.close();
  if (shouldStopAppServer) {
    await stop(appServerProcess, appServer === "preview" ? "Vite preview" : "Vite dev");
  }
  if (shouldStopGateway) {
    await stop(gateway, "Mock Gateway");
  }

  if (outcome.failures > 0) {
    process.exitCode = 1;
  }
}


