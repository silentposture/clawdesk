import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const cwd = process.cwd();

function parseArgs(argv) {
  return {
    strictProduction: argv.includes("--strict-production"),
    betaDirect: argv.includes("--beta-direct") || process.env.CLAWDESK_RELEASE_CHANNEL === "beta-direct",
    requireSigning: argv.includes("--require-signing"),
    requireArtifacts: argv.includes("--require-artifacts"),
    storeReadiness: argv.includes("--store-readiness") || process.env.CLAWDESK_RELEASE_TARGET === "microsoft-store",
    macosReadiness: argv.includes("--macos-readiness"),
    reportDir: valueArg(argv, "--report-dir") ?? path.join(cwd, "artifacts", "release-guard"),
  };
}

function valueArg(argv, name) {
  const equals = argv.find((item) => item.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : null;
}

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.join(cwd, relativePath), "utf8"));
}

async function pathExists(relativePath) {
  try {
    await fs.access(path.join(cwd, relativePath));
    return true;
  } catch {
    return false;
  }
}

function commandInvocation(command, args) {
  if (process.platform !== "win32") return { command, args };
  if (command.endsWith(".exe")) return { command, args };
  if (command === "node" || command === "cargo") return { command: `${command}.exe`, args };
  const cmdCommand = command.endsWith(".cmd") ? command : `${command}.cmd`;
  return { command: "cmd.exe", args: ["/d", "/s", "/c", cmdCommand, ...args] };
}

function run(command, args) {
  const invocation = commandInvocation(command, args);
  return spawnSync(invocation.command, invocation.args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
}

function envPresence(names) {
  return names.map((name) => ({ name, present: Boolean(process.env[name]) }));
}

function missingEnv(names) {
  return names.filter((name) => !process.env[name]);
}

function hashValue(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function newestFile(dirRelativePath, extension) {
  const dir = path.join(cwd, dirRelativePath);
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      if (!entry.name.toLowerCase().endsWith(extension.toLowerCase()) || !entry.isFile()) continue;
      const filePath = path.join(dir, entry.name);
      const stat = await fs.stat(filePath);
      files.push({ name: entry.name, relativePath: path.relative(cwd, filePath), mtimeMs: stat.mtimeMs, bytes: stat.size });
    }
    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return files[0] ?? null;
  } catch {
    return null;
  }
}

function readinessStatus(strict, condition) {
  if (condition) return "ready";
  return strict ? "blocked" : "warning";
}

function buildReadinessMatrix(input) {
  return [
    {
      id: "legal-manifest",
      category: "legal",
      label: "安裝條款 manifest",
      status: input.legalManifestCurrent ? "ready" : "blocked",
      current: input.legalManifestCurrent ? "已同步" : "已過期",
      required: "每次 build 前 legal manifest 必須與 docs/legal 文件一致。",
      nextAction: "執行 npm run legal:manifest。",
    },
    {
      id: "third-party-notices",
      category: "legal",
      label: "Third-party notices",
      status: input.thirdPartyNoticesCurrent ? "ready" : "blocked",
      current: input.thirdPartyNoticesCurrent ? "已同步" : "已過期或缺少",
      required: "installer / app resources 需包含第三方與 OpenClaw MIT 聲明。",
      nextAction: "執行 npm run legal:notices。",
    },
    {
      id: "sbom-artifacts",
      category: "legal",
      label: "SBOM artifacts",
      status: readinessStatus(input.strictModeEnabled || input.storeReadiness, input.hasSbomArtifacts),
      current: input.hasSbomArtifacts ? "npm / Rust SBOM artifacts 已存在" : "尚未產生 SBOM artifacts",
      required: "正式發佈需隨 release 產出 npm 與 Rust SBOM。",
      nextAction: "執行 npm run sbom。",
    },
    {
      id: "production-gateway",
      category: "packaging",
      label: "Production Gateway",
      status: readinessStatus(input.strictModeEnabled, input.hasProductionGateway),
      current: input.hasProductionGateway ? "已設定 production gateway endpoint" : "目前使用本機 mock Gateway",
      required: "正式版需 CLAWDESK_GATEWAY_BASE_URL 指向受控 production Gateway。",
      nextAction: "建立 production Gateway / backend connector，替換 mock sidecar 合約。",
    },
    {
      id: "paddle",
      category: "payment",
      label: "Paddle 金流環境",
      status: readinessStatus(input.strictModeEnabled, input.hasPaddleCredentials),
      current: input.hasPaddleCredentials ? "已設定 production credentials" : "目前僅 mock",
      required: "正式版需 Paddle API、webhook secret 與 price/product id。",
      nextAction: "設定 Paddle production credentials；桌面端不得保存信用卡資料。",
    },
    {
      id: "lemon-squeezy",
      category: "payment",
      label: "Lemon Squeezy Beta 金流/授權",
      status: readinessStatus(input.betaDirect || input.strictModeEnabled, input.hasLemonCredentials),
      current: input.hasLemonCredentials ? "已設定 Lemon direct beta env" : "尚未設定 Lemon env",
      required: "Windows 直售 Beta 需 Lemon webhook secret、store id 與 product id。",
      nextAction: "完成 Lemon Squeezy seller onboarding，設定 LEMON_SQUEEZY_*。",
    },
    {
      id: "keygen",
      category: "licensing",
      label: "Keygen 授權環境",
      status: readinessStatus(input.strictModeEnabled, input.hasKeygenCredentials),
      current: input.hasKeygenCredentials ? "已設定 Keygen account/product/signing" : "目前僅 mock",
      required: "正式版需 Keygen account、product、policy 與 signing public key。",
      nextAction: "建立 Keygen product/policy，接上 license validation 與 offline ticket。",
    },
    {
      id: "sso",
      category: "identity",
      label: "SSO / 帳號入口",
      status: readinessStatus(input.strictModeEnabled, input.hasSsoCredentials),
      current: input.hasSsoCredentials ? "已設定 issuer/client" : "目前僅本機 mock 登入",
      required: "個人版與企業版都需 CLAWDESK_SSO_ISSUER_URL 與 CLAWDESK_SSO_CLIENT_ID。",
      nextAction: "接上 Google / Microsoft / Email 驗證與回信確認流程。",
    },
    {
      id: "windows-signing-env",
      category: "windows",
      label: "Windows 簽章環境",
      status: readinessStatus(input.strictModeEnabled || input.storeReadiness, input.hasWindowsSigningEnv || input.hasTrustedSigningEnv),
      current: input.hasTrustedSigningEnv ? "已設定 Trusted Signing env" : input.hasWindowsSigningEnv ? "已設定傳統憑證簽章 env" : "尚未設定",
      required: "正式 Windows installer / Microsoft Store candidate 需要受信任簽章。",
      nextAction: "設定 WINDOWS_SIGNING_* 或 AZURE_TRUSTED_SIGNING_*。",
    },
    {
      id: "store-config",
      category: "store-readiness",
      label: "Microsoft Store installer config",
      status: readinessStatus(input.storeReadiness, input.hasStoreConfig),
      current: input.hasStoreConfig ? "Store config 已通過 offline WebView2 / publisher / legal resources 檢查" : "尚未通過 Store config 檢查",
      required: "Store candidate 需使用獨立 config、offline WebView2、publisher 與 legal resources。",
      nextAction: "執行 npm run release:configs:check -- --store。",
    },
    {
      id: "macos-config",
      category: "macos",
      label: "macOS app/dmg config",
      status: readinessStatus(input.macosReadiness, input.hasMacosConfig),
      current: input.hasMacosConfig ? "macOS config 已通過 app/dmg/legal resources 檢查" : "尚未通過 macOS config 檢查",
      required: "macOS re-entry 需獨立 config，不污染 Windows config。",
      nextAction: "執行 npm run release:configs:check -- --macos。",
    },
    {
      id: "guarded-prod-scripts",
      category: "packaging",
      label: "正式打包入口保護",
      status: input.hasGuardedProductionScripts ? "ready" : "blocked",
      current: input.hasGuardedProductionScripts ? "prod build script 受 strict guard 保護" : "缺少受保護 prod build script",
      required: "正式 Windows build 必須先執行 release:guard:strict。",
      nextAction: "補上 tauri:build:prod:win。",
    },
    {
      id: "mock-resources",
      category: "packaging",
      label: "Mock resource 隔離",
      status: input.hasMockResourcesInProduction ? (input.strictModeEnabled ? "blocked" : "warning") : "ready",
      current: input.hasMockResourcesInProduction ? "候選版仍打包 mock Gateway" : "production bundle 未包含 mock resource",
      required: "正式版不得打包 mock Gateway 或 mock credential flow。",
      nextAction: "把 mock sidecar 替換為簽章後 production gateway 或受控 backend connector。",
    },
    {
      id: "installer-artifact",
      category: "windows",
      label: "Windows NSIS installer artifact",
      status: input.hasInstallerArtifact ? "ready" : "blocked",
      current: input.hasInstallerArtifact ? "已產生 NSIS installer" : "尚未產生 Windows installer",
      required: "release candidate 需產生 NSIS installer，並通過 Windows installer smoke。",
      nextAction: "執行 npm run qa:release:win。",
    },
  ];
}

function summarizeReadiness(matrix) {
  const ready = matrix.filter((item) => item.status === "ready").length;
  const warning = matrix.filter((item) => item.status === "warning").length;
  const blocked = matrix.filter((item) => item.status === "blocked").length;
  return { ready, warning, blocked, overall: blocked > 0 ? "production-blocked" : warning > 0 ? "mock-candidate-ready" : "production-ready" };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const failures = [];
  const warnings = [];
  const packageJson = await readJson("package.json");
  const channel = process.env.CLAWDESK_RELEASE_CHANNEL || "mock-candidate";
  const betaDirect = options.betaDirect;
  const strictModeEnabled = options.strictProduction || channel === "production";
  const tauriConfigPath = strictModeEnabled ? "src-tauri/tauri.prod.conf.json" : "src-tauri/tauri.conf.json";
  const tauriConfig = await readJson(tauriConfigPath);
  const defaultTauriConfig = await readJson("src-tauri/tauri.conf.json");

  if (packageJson.private !== true) failures.push("package.json 必須保留 private=true，避免 mock 候選版被誤發佈到 npm。");
  if (tauriConfig.productName !== "ClawDesk") failures.push(`Tauri productName 必須是 ClawDesk，目前是 ${tauriConfig.productName ?? "(未設定)"}`);
  if (tauriConfig.version !== packageJson.version) failures.push(`Tauri version (${tauriConfig.version}) 必須與 package.json version (${packageJson.version}) 一致。`);
  if (!tauriConfig.bundle?.targets?.includes("nsis")) failures.push(`${tauriConfigPath} bundle targets 必須包含 nsis。`);

  const requiredFiles = [
    "src/lib/legalConsentManifest.ts",
    "docs/legal/INSTALLER_TERMS.md",
    "docs/legal/EULA.md",
    "docs/legal/PRIVACY.md",
    "docs/legal/REFUND_POLICY.md",
    "docs/legal/DIGITAL_CONTENT_WAIVER.md",
    "docs/legal/AI_AGENT_RISK_NOTICE.md",
    "docs/legal/OPENCLAW_MIT_NOTICE.md",
    "docs/legal/OPENCLAW_UPSTREAM_LICENSE.md",
    "docs/legal/THIRD_PARTY_NOTICES.md",
    "docs/upstream/OPENCLAW_IMPORT.md",
    "docs/upstream/OPENCLAW_FEATURE_PARITY.md",
    "docs/upstream/OPENCLAW_RUNTIME_ADAPTER.md",
    "docs/upstream/openclaw-feature-parity.json",
    "docs/windows/WINDOWS_CERTIFICATION_PLAN.md",
    "docs/download/beta-windows.html",
    "docs/download/FAQ.md",
    "sidecars/mock-gateway/server.mjs",
    ".env.mock.example",
    ".env.production.example",
    "src-tauri/tauri.prod.conf.json",
    "src-tauri/tauri.microsoftstore.conf.json",
    "src-tauri/tauri.macos.conf.json",
    "scripts/smoke-win-app.mjs",
    "scripts/smoke-win-installer.mjs",
    "scripts/smoke-store-installer-win.mjs",
    "scripts/smoke-mac-dmg.mjs",
  ];
  for (const file of requiredFiles) {
    if (!(await pathExists(file))) failures.push(`缺少必要檔案：${file}`);
  }

  const legalCheck = run(process.execPath, ["scripts/generate-legal-consent.mjs", "--check"]);
  if (legalCheck.status !== 0) failures.push("legalConsentManifest.ts 已過期，請執行 npm run legal:manifest。");
  const noticesCheck = run(process.execPath, ["scripts/generate-third-party-notices.mjs", "--check"]);
  if (noticesCheck.status !== 0) failures.push("THIRD_PARTY_NOTICES.md 已過期，請執行 npm run legal:notices。");
  const configsCheck = run(process.execPath, ["scripts/validate-release-configs.mjs"]);
  if (configsCheck.status !== 0) failures.push("Store/macOS release config 檢查失敗，請執行 npm run release:configs:check。");

  const resources = tauriConfig.bundle?.resources ?? {};
  const bundledResources = typeof resources === "object" && !Array.isArray(resources) ? Object.keys(resources) : [];
  const defaultResources = defaultTauriConfig.bundle?.resources ?? {};
  const defaultBundledResources = typeof defaultResources === "object" && !Array.isArray(defaultResources) ? Object.keys(defaultResources) : [];
  const mockResourceMarkers = ["../sidecars/mock-gateway/server.mjs"];
  for (const expected of mockResourceMarkers) {
    if (!defaultBundledResources.includes(expected)) failures.push(`mock 候選版 Tauri bundle resources 未包含 ${expected}`);
  }
  for (const expected of ["../docs/legal/INSTALLER_TERMS.md", "../docs/legal/OPENCLAW_MIT_NOTICE.md"]) {
    if (!bundledResources.includes(expected)) failures.push(`${tauriConfigPath} bundle resources 未包含 ${expected}`);
  }

  const productionEnvNames = [
    "CLAWDESK_GATEWAY_BASE_URL",
    "PADDLE_API_KEY",
    "PADDLE_WEBHOOK_SECRET",
    "PADDLE_PRODUCT_ID",
    "PADDLE_PRICE_ID_PRO_MONTHLY",
    "PADDLE_PRICE_ID_PRO_YEARLY",
    "KEYGEN_ACCOUNT_ID",
    "KEYGEN_PRODUCT_ID",
    "KEYGEN_POLICY_ID",
    "KEYGEN_SIGNING_PUBLIC_KEY",
    "CLAWDESK_SSO_ISSUER_URL",
    "CLAWDESK_SSO_CLIENT_ID",
  ];
  const betaDirectEnvNames = [
    "CLAWDESK_GATEWAY_BASE_URL",
    "LEMON_SQUEEZY_WEBHOOK_SECRET",
    "LEMON_SQUEEZY_STORE_ID",
    "LEMON_SQUEEZY_PRODUCT_ID",
    "LEMON_SQUEEZY_VARIANT_ID_PRO_YEARLY",
    "LEMON_SQUEEZY_VARIANT_ID_LIFETIME",
  ];
  const windowsSigningEnvNames = ["WINDOWS_SIGNING_CERTIFICATE", "WINDOWS_SIGNING_CERTIFICATE_PASSWORD"];
  const trustedSigningEnvNames = ["AZURE_TRUSTED_SIGNING_ACCOUNT_NAME", "AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME", "AZURE_TRUSTED_SIGNING_ENDPOINT"];
  const missingProductionEnv = missingEnv(productionEnvNames);
  const missingBetaDirectEnv = missingEnv(betaDirectEnvNames);
  const missingWindowsSigningEnv = missingEnv(windowsSigningEnvNames);
  const missingTrustedSigningEnv = missingEnv(trustedSigningEnvNames);
  const hasAnyWindowsSigning = missingWindowsSigningEnv.length === 0 || missingTrustedSigningEnv.length === 0;

  if (!strictModeEnabled && !betaDirect) {
    warnings.push("目前是 mock candidate 檢查：允許本機 mock Gateway 與 mock Paddle/Keygen，但不得視為正式商業發佈。");
    if (missingProductionEnv.length > 0) warnings.push(`正式 production 尚缺環境變數：${missingProductionEnv.join(", ")}`);
    if (!hasAnyWindowsSigning) warnings.push("正式 Windows / Microsoft Store 發佈尚未完成程式碼簽章環境。");
  }

  if (strictModeEnabled) {
    if (channel !== "production") failures.push("strict production 發佈必須設定 CLAWDESK_RELEASE_CHANNEL=production。");
    if (process.env.CLAWDESK_ALLOW_MOCK_RELEASE === "true") failures.push("strict production 不允許 CLAWDESK_ALLOW_MOCK_RELEASE=true。");
    for (const marker of mockResourceMarkers) {
      if (bundledResources.includes(marker)) failures.push(`strict production 不允許打包 mock resource：${marker}`);
    }
    const prodScript = packageJson.scripts?.["tauri:build:prod:win"] ?? "";
    if (!prodScript.includes("build-windows.mjs --production")) failures.push("package.json 缺少由 release:guard:strict 保護的 tauri:build:prod:win。");
    const productionCsp = String(tauriConfig.app?.security?.csp ?? "");
    if (productionCsp.includes("127.0.0.1") || productionCsp.includes("localhost")) failures.push("src-tauri/tauri.prod.conf.json CSP 不應允許 localhost / 127.0.0.1 mock Gateway。");
    for (const name of missingProductionEnv) failures.push(`strict production 缺少必要環境變數：${name}`);
  }

  const installerArtifact = await newestFile("src-tauri/target/release/bundle/nsis", ".exe");
  const dmgArtifact = await newestFile("src-tauri/target/release/bundle/dmg", ".dmg");
  const hasSbomArtifacts = (await pathExists("artifacts/sbom/npm-sbom.json")) && (await pathExists("artifacts/sbom/cargo-sbom.json"));
  if (options.requireArtifacts && !installerArtifact) failures.push("找不到 Windows NSIS installer artifact，請先執行 npm run tauri:build:win。");

  if (betaDirect) {
    if (channel !== "beta-direct") warnings.push("建議設定 CLAWDESK_RELEASE_CHANNEL=beta-direct，以便報表明確標示 Windows 直售 Beta。");
    if (!installerArtifact && options.requireArtifacts) failures.push("beta-direct 找不到 Windows NSIS installer artifact，請先執行 npm run tauri:build:win。");
    if (!hasSbomArtifacts) failures.push("beta-direct 需要 SBOM artifacts：請執行 npm run sbom。");
    if (!hasAnyWindowsSigning) failures.push("beta-direct 需要 Windows 簽章環境：WINDOWS_SIGNING_* 或 AZURE_TRUSTED_SIGNING_*。");
    for (const name of missingBetaDirectEnv) warnings.push(`beta-direct 尚缺 Lemon/Gateway 環境變數：${name}`);
  }

  if ((options.requireSigning || strictModeEnabled || options.storeReadiness || betaDirect) && !hasAnyWindowsSigning) {
    failures.push("Windows 簽章缺少必要環境變數：需 WINDOWS_SIGNING_* 或 AZURE_TRUSTED_SIGNING_*。");
  }
  if ((options.requireSigning || strictModeEnabled || betaDirect) && installerArtifact) {
    const signingCheck = run(process.execPath, ["scripts/verify-windows-signing.mjs", path.join(cwd, installerArtifact.relativePath)]);
    if (signingCheck.status !== 0) failures.push("Windows installer 簽章驗證失敗，請執行 npm run sign:win-installer 後重試。");
  }

  const hasGuardedProductionScripts = (packageJson.scripts?.["tauri:build:prod:win"] ?? "").includes("build-windows.mjs --production");
  const readinessMatrix = buildReadinessMatrix({
    strictModeEnabled,
    storeReadiness: options.storeReadiness,
    betaDirect,
    macosReadiness: options.macosReadiness,
    legalManifestCurrent: legalCheck.status === 0,
    thirdPartyNoticesCurrent: noticesCheck.status === 0,
    hasSbomArtifacts,
    hasProductionGateway: Boolean(process.env.CLAWDESK_GATEWAY_BASE_URL),
    hasPaddleCredentials: missingEnv(["PADDLE_API_KEY", "PADDLE_WEBHOOK_SECRET", "PADDLE_PRODUCT_ID"]).length === 0,
    hasLemonCredentials: missingEnv(["LEMON_SQUEEZY_WEBHOOK_SECRET", "LEMON_SQUEEZY_STORE_ID", "LEMON_SQUEEZY_PRODUCT_ID"]).length === 0,
    hasKeygenCredentials: missingEnv(["KEYGEN_ACCOUNT_ID", "KEYGEN_PRODUCT_ID", "KEYGEN_POLICY_ID", "KEYGEN_SIGNING_PUBLIC_KEY"]).length === 0,
    hasSsoCredentials: missingEnv(["CLAWDESK_SSO_ISSUER_URL", "CLAWDESK_SSO_CLIENT_ID"]).length === 0,
    hasWindowsSigningEnv: missingWindowsSigningEnv.length === 0,
    hasTrustedSigningEnv: missingTrustedSigningEnv.length === 0,
    hasStoreConfig: configsCheck.status === 0,
    hasMacosConfig: configsCheck.status === 0,
    hasGuardedProductionScripts,
    hasMockResourcesInProduction: bundledResources.some((resource) => mockResourceMarkers.includes(resource)),
    hasInstallerArtifact: Boolean(installerArtifact),
  });
  const readinessSummary = summarizeReadiness(readinessMatrix);

  const report = {
    createdAt: new Date().toISOString(),
    result: failures.length === 0 ? "PASS" : "FAIL",
    releaseType: strictModeEnabled ? "strict-production" : betaDirect ? "beta-direct" : "mock-candidate",
    channel,
    options: { betaDirect, storeReadiness: options.storeReadiness, macosReadiness: options.macosReadiness },
    package: { name: packageJson.name, version: packageJson.version, private: packageJson.private === true },
    tauri: {
      configPath: tauriConfigPath,
      productName: tauriConfig.productName,
      version: tauriConfig.version,
      identifierHash: hashValue(String(tauriConfig.identifier ?? "")),
      targets: tauriConfig.bundle?.targets ?? [],
      bundledResources,
      mockResources: bundledResources.filter((resource) => mockResourceMarkers.includes(resource)),
      defaultConfigMockResources: defaultBundledResources.filter((resource) => mockResourceMarkers.includes(resource)),
    },
    legalManifestCurrent: legalCheck.status === 0,
    thirdPartyNoticesCurrent: noticesCheck.status === 0,
    productionEnv: envPresence(productionEnvNames),
    betaDirectEnv: envPresence(betaDirectEnvNames),
    signing: { env: envPresence(windowsSigningEnvNames), trustedSigningEnv: envPresence(trustedSigningEnvNames) },
    artifacts: {
      installer: installerArtifact,
      dmg: dmgArtifact,
      sbom: { npm: await pathExists("artifacts/sbom/npm-sbom.json"), cargo: await pathExists("artifacts/sbom/cargo-sbom.json") },
    },
    readiness: { summary: readinessSummary, matrix: readinessMatrix },
    warnings,
    failures,
  };

  await fs.mkdir(options.reportDir, { recursive: true });
  const reportPath = path.join(options.reportDir, `${new Date().toISOString().replace(/[:.]/g, "_")}-${report.releaseType}-pid-${process.pid}-release-guard.json`);
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Release guard report: ${reportPath}`);
  console.log(`Release type: ${report.releaseType}`);
  console.log(`Readiness: ${readinessSummary.overall} (${readinessSummary.ready} ready, ${readinessSummary.warning} warning, ${readinessSummary.blocked} blocked)`);
  for (const warning of warnings) console.warn(`WARNING: ${warning}`);
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  console.log(`Result: ${report.result}`);
  if (failures.length > 0) process.exitCode = 1;
}

await main();
