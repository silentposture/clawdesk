import { describe, expect, it } from "vitest";
import {
  openClawRuntimeContract,
  resolveRuntimeAuthPlan,
  runtimeReadinessSummary,
} from "./openclawRuntime";

describe("OpenClaw Windows runtime adapter contract", () => {
  it("tracks executable runtime surfaces against the upstream commit", () => {
    expect(openClawRuntimeContract.upstream.commit).toHaveLength(40);
    expect(openClawRuntimeContract.target).toContain("Windows");
    expect(openClawRuntimeContract.eventTypes).toContain("permission.request");
    expect(openClawRuntimeContract.surfaces.length).toBeGreaterThanOrEqual(8);
  });

  it("summarizes contract-compatible, mock-backed, and deferred surfaces", () => {
    const summary = runtimeReadinessSummary();
    expect(summary["contract-compatible"]).toBeGreaterThan(0);
    expect(summary["mock-backed"]).toBeGreaterThan(0);
    expect(summary.deferred).toBeGreaterThan(0);
  });

  it("maps OpenAI API key and account login to Windows Gateway endpoints", () => {
    expect(resolveRuntimeAuthPlan("openai-api")).toMatchObject({
      authMode: "api-key",
      endpoint: "/auth/openai-api-key",
      credentialPolicy: "masked-in-memory",
      canUseNow: true,
    });
    expect(resolveRuntimeAuthPlan("openai-codex")).toMatchObject({
      authMode: "oauth",
      endpoint: "/auth/openai-codex/oauth-login",
      credentialPolicy: "account-token-stub",
      canUseNow: true,
    });
  });
});
