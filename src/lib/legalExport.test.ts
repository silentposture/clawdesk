import { describe, expect, it } from "vitest";
import { createLegalConsentRecord } from "./legalConsent";
import { buildLegalExportPackage } from "./legalExport";

describe("legal export package", () => {
  it("exports only non-personal legal metadata", () => {
    const legalConsent = createLegalConsentRecord(new Date("2026-05-13T00:00:00.000Z"));
    const exported = buildLegalExportPackage({
      legalConsent,
      documents: [{ id: "installer-terms", title: "安裝條款", summary: "使用前需同意。" }],
      notices: [{ package: "OpenClaw", license: "MIT", purpose: "相容聲明" }],
      now: "2026-05-13T00:01:00.000Z",
    });

    expect(exported.legalConsent?.documentHash).toBe(legalConsent.documentHash);
    expect(exported.privacy.containsPersonalData).toBe(false);
    expect(exported.privacy.containsSecrets).toBe(false);
    expect(JSON.stringify(exported)).not.toContain("@");
    expect(JSON.stringify(exported)).not.toContain("sk-");
  });
});
