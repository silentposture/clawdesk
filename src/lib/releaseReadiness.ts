export type ReleaseReadinessStatus = "ready" | "warning" | "blocked";

export interface ReleaseReadinessItem {
  id: string;
  category: "product" | "payment" | "licensing" | "identity" | "windows" | "macos" | "store-readiness" | "packaging" | "legal";
  label: string;
  status: ReleaseReadinessStatus;
  current: string;
  required: string;
  nextAction: string;
}

export interface ReleaseReadinessSummary {
  ready: number;
  warning: number;
  blocked: number;
  overall: "mock-candidate-ready" | "production-blocked" | "production-ready";
}

export interface ReleaseReadinessInput {
  legalManifestCurrent: boolean;
  hasProductionGateway: boolean;
  hasPaddleCredentials: boolean;
  hasKeygenCredentials: boolean;
  hasSsoCredentials: boolean;
  hasWindowsSigningEnv: boolean;
  hasTrustedSigningEnv: boolean;
  hasStoreConfig: boolean;
  hasMacosConfig: boolean;
  hasSbomArtifacts: boolean;
  thirdPartyNoticesCurrent: boolean;
  hasGuardedProductionScripts: boolean;
  hasMockResourcesInProduction: boolean;
  hasInstallerArtifact: boolean;
  strictProduction?: boolean;
  storeReadiness?: boolean;
  macosReadiness?: boolean;
}

export const defaultMockCandidateReadiness: ReleaseReadinessInput = {
  legalManifestCurrent: true,
  hasProductionGateway: false,
  hasPaddleCredentials: false,
  hasKeygenCredentials: false,
  hasSsoCredentials: false,
  hasWindowsSigningEnv: false,
  hasTrustedSigningEnv: false,
  hasStoreConfig: true,
  hasMacosConfig: true,
  hasSbomArtifacts: true,
  thirdPartyNoticesCurrent: true,
  hasGuardedProductionScripts: true,
  hasMockResourcesInProduction: true,
  hasInstallerArtifact: true,
  strictProduction: false,
};

function blockedWhenStrict(input: ReleaseReadinessInput, condition: boolean): ReleaseReadinessStatus {
  if (condition) return "ready";
  return input.strictProduction ? "blocked" : "warning";
}

function blockedForTarget(enabled: boolean | undefined, condition: boolean): ReleaseReadinessStatus {
  if (condition) return "ready";
  return enabled ? "blocked" : "warning";
}

export function buildReleaseReadinessMatrix(input: ReleaseReadinessInput): ReleaseReadinessItem[] {
  return [
    {
      id: "legal-manifest",
      category: "legal",
      label: "安裝條款與 NOTICE manifest",
      status: input.legalManifestCurrent ? "ready" : "blocked",
      current: input.legalManifestCurrent ? "已同步" : "已過期",
      required: "每次 build 前 legal manifest 必須與 docs/legal 文件一致。",
      nextAction: "執行 npm run legal:manifest 並重新驗證。",
    },
    {
      id: "production-gateway",
      category: "packaging",
      label: "Production Gateway",
      status: blockedWhenStrict(input, input.hasProductionGateway),
      current: input.hasProductionGateway ? "已設定 production gateway endpoint" : "目前使用本機 mock Gateway",
      required: "正式版需 CLAWDESK_GATEWAY_BASE_URL 指向受控 production Gateway。",
      nextAction: "建立 production Gateway / backend connector，替換 mock sidecar 合約。",
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
      status: blockedForTarget(input.strictProduction || input.storeReadiness, input.hasSbomArtifacts),
      current: input.hasSbomArtifacts ? "npm / Rust SBOM artifacts 已存在" : "尚未產生 SBOM artifacts",
      required: "正式發佈需隨 release 產出 npm 與 Rust SBOM。",
      nextAction: "執行 npm run sbom。",
    },
    {
      id: "paddle",
      category: "payment",
      label: "Paddle 金流環境",
      status: blockedWhenStrict(input, input.hasPaddleCredentials),
      current: input.hasPaddleCredentials ? "已設定 production credentials" : "目前僅 mock",
      required: "正式版需 PADDLE_API_KEY 與 PADDLE_WEBHOOK_SECRET。",
      nextAction: "在正式後端環境設定 Paddle credential，桌面端不得保存信用卡資料。",
    },
    {
      id: "keygen",
      category: "licensing",
      label: "Keygen 授權環境",
      status: blockedWhenStrict(input, input.hasKeygenCredentials),
      current: input.hasKeygenCredentials ? "已設定 Keygen account/product/signing" : "目前僅 mock",
      required: "正式版需 KEYGEN_ACCOUNT_ID、KEYGEN_PRODUCT_ID、KEYGEN_SIGNING_PUBLIC_KEY。",
      nextAction: "建立 Keygen product/policy，接上 license validation 與 offline ticket。",
    },
    {
      id: "sso",
      category: "identity",
      label: "SSO / 帳號入口",
      status: blockedWhenStrict(input, input.hasSsoCredentials),
      current: input.hasSsoCredentials ? "已設定 issuer/client" : "目前僅本機 mock 登入",
      required: "個人版與企業版都需 CLAWDESK_SSO_ISSUER_URL 與 CLAWDESK_SSO_CLIENT_ID。",
      nextAction: "接上 Google / Microsoft / Email 驗證與回信確認流程。",
    },
    {
      id: "windows-signing-env",
      category: "windows",
      label: "Windows 簽章環境",
      status: blockedForTarget(input.strictProduction || input.storeReadiness, input.hasWindowsSigningEnv || input.hasTrustedSigningEnv),
      current: input.hasTrustedSigningEnv ? "已設定 Trusted Signing env" : input.hasWindowsSigningEnv ? "已設定 Windows signing credential" : "尚未設定",
      required: "正式 Windows installer / Microsoft Store candidate 需要受信任簽章。",
      nextAction: "設定 WINDOWS_SIGNING_* 或 AZURE_TRUSTED_SIGNING_*。",
    },
    {
      id: "store-config",
      category: "store-readiness",
      label: "Microsoft Store installer config",
      status: blockedForTarget(input.storeReadiness, input.hasStoreConfig),
      current: input.hasStoreConfig ? "Store config 已通過 offline WebView2 / publisher / legal resources 檢查" : "尚未通過 Store config 檢查",
      required: "Store candidate 需使用獨立 config、offline WebView2、publisher 與 legal resources。",
      nextAction: "執行 npm run release:configs:check -- --store。",
    },
    {
      id: "macos-config",
      category: "macos",
      label: "macOS app/dmg config",
      status: blockedForTarget(input.macosReadiness, input.hasMacosConfig),
      current: input.hasMacosConfig ? "macOS config 已通過 app/dmg/legal resources 檢查" : "尚未通過 macOS config 檢查",
      required: "macOS re-entry 需獨立 config，不污染 Windows config。",
      nextAction: "執行 npm run release:configs:check -- --macos。",
    },
    {
      id: "guarded-prod-scripts",
      category: "packaging",
      label: "正式打包入口保護",
      status: input.hasGuardedProductionScripts ? "ready" : "blocked",
      current: input.hasGuardedProductionScripts ? "prod build scripts 受 strict guard 保護" : "缺少受保護 prod build scripts",
      required: "正式 Windows build 必須先執行 release:guard:strict。",
      nextAction: "補上 tauri:build:prod:win。",
    },
    {
      id: "mock-resources",
      category: "packaging",
      label: "Mock resource 隔離",
      status: input.hasMockResourcesInProduction ? (input.strictProduction ? "blocked" : "warning") : "ready",
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

export function summarizeReleaseReadiness(items: ReleaseReadinessItem[]): ReleaseReadinessSummary {
  const ready = items.filter((item) => item.status === "ready").length;
  const warning = items.filter((item) => item.status === "warning").length;
  const blocked = items.filter((item) => item.status === "blocked").length;
  return {
    ready,
    warning,
    blocked,
    overall: blocked > 0 ? "production-blocked" : warning > 0 ? "mock-candidate-ready" : "production-ready",
  };
}
