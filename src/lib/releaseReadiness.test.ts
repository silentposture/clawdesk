import { describe, expect, it } from "vitest";
import {
  buildReleaseReadinessMatrix,
  defaultMockCandidateReadiness,
  summarizeReleaseReadiness,
} from "./releaseReadiness";

describe("release readiness matrix", () => {
  it("marks mock candidate as usable but not production ready", () => {
    const matrix = buildReleaseReadinessMatrix(defaultMockCandidateReadiness);
    const summary = summarizeReleaseReadiness(matrix);

    expect(summary.overall).toBe("mock-candidate-ready");
    expect(summary.warning).toBeGreaterThan(0);
    expect(matrix.find((item) => item.id === "mock-resources")?.status).toBe("warning");
    expect(matrix.find((item) => item.id === "installer-artifact")?.status).toBe("ready");
    expect(matrix.find((item) => item.id === "store-config")?.status).toBe("ready");
    expect(matrix.find((item) => item.id === "sbom-artifacts")?.status).toBe("ready");
  });

  it("blocks strict production when credentials and signing are missing", () => {
    const matrix = buildReleaseReadinessMatrix({
      ...defaultMockCandidateReadiness,
      strictProduction: true,
    });
    const blockedIds = matrix.filter((item) => item.status === "blocked").map((item) => item.id);

    expect(blockedIds).toContain("paddle");
    expect(blockedIds).toContain("production-gateway");
    expect(blockedIds).toContain("keygen");
    expect(blockedIds).toContain("sso");
    expect(blockedIds).toContain("windows-signing-env");
    expect(blockedIds).toContain("mock-resources");
    expect(summarizeReleaseReadiness(matrix).overall).toBe("production-blocked");
  });

  it("reports production ready when all hard requirements are satisfied", () => {
    const matrix = buildReleaseReadinessMatrix({
      legalManifestCurrent: true,
      hasProductionGateway: true,
      hasPaddleCredentials: true,
      hasKeygenCredentials: true,
      hasSsoCredentials: true,
      hasWindowsSigningEnv: true,
      hasTrustedSigningEnv: false,
      hasStoreConfig: true,
      hasMacosConfig: true,
      hasSbomArtifacts: true,
      thirdPartyNoticesCurrent: true,
      hasGuardedProductionScripts: true,
      hasMockResourcesInProduction: false,
      hasInstallerArtifact: true,
      strictProduction: true,
    });

    expect(summarizeReleaseReadiness(matrix)).toMatchObject({
      blocked: 0,
      warning: 0,
      overall: "production-ready",
    });
  });

  it("blocks Store readiness when signing or Store config are missing", () => {
    const matrix = buildReleaseReadinessMatrix({
      ...defaultMockCandidateReadiness,
      hasWindowsSigningEnv: false,
      hasTrustedSigningEnv: false,
      hasStoreConfig: false,
      storeReadiness: true,
    });
    const blockedIds = matrix.filter((item) => item.status === "blocked").map((item) => item.id);

    expect(blockedIds).toContain("windows-signing-env");
    expect(blockedIds).toContain("store-config");
  });
});
