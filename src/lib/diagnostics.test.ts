import { describe, expect, it } from "vitest";
import { createDiagnosticReport, isFaultCode, reportContainsPrivateData } from "./diagnostics";

describe("diagnostics privacy", () => {
  it("uses ClawDesk fault code format", () => {
    expect(isFaultCode("CLWD-LIC-1001")).toBe(true);
    expect(isFaultCode("LIC-1001")).toBe(false);
  });

  it("redacts emails, full paths, API keys, Lemon ids, and full license keys", () => {
    const report = createDiagnosticReport({
      faultCode: "CLWD-GW-2001",
      recentErrors: [
        "user a@example.com opened C:\\Users\\demo\\Documents\\secret.txt",
        "key sk-test1234567890 CLWD-BETA-PRO1-2026 lemon_customer_abc123",
      ],
      userDescription: "看起來像 C:\\Users\\demo\\Desktop\\private.docx 壞掉",
      now: "2026-05-12T00:00:00.000Z",
    });

    expect(report.redactionStatus).toBe("redacted");
    expect(reportContainsPrivateData(report)).toBe(false);
    expect(JSON.stringify(report)).not.toContain("a@example.com");
    expect(JSON.stringify(report)).not.toContain("CLWD-BETA-PRO1-2026");
    expect(JSON.stringify(report)).not.toContain("lemon_customer_abc123");
  });

  it("can include non-personal legal consent metadata", () => {
    const report = createDiagnosticReport({
      faultCode: "CLWD-UI-4001",
      recentErrors: [],
      legalConsentSummary: {
        version: "2026-05-13.install-terms.v1",
        acceptedAt: "2026-05-13T00:00:00.000Z",
        documentHash: "sha256-demo",
        documents: ["docs/legal/INSTALLER_TERMS.md"],
      },
      now: "2026-05-13T00:00:00.000Z",
    });

    expect(report.legalConsentSummary?.version).toBe("2026-05-13.install-terms.v1");
    expect(reportContainsPrivateData(report)).toBe(false);
  });

  it("redacts common provider API key prefixes before support export", () => {
    const report = createDiagnosticReport({
      faultCode: "CLWD-GW-2001",
      recentErrors: [
        "anthropic sk-ant-test123456789 openrouter sk-or-v1-test123456789",
        "gemini AIzaTest123456789 groq gsk_test123456789 xai xai-test123456789",
      ],
      now: "2026-05-15T00:00:00.000Z",
    });

    const serialized = JSON.stringify(report);
    expect(report.redactionStatus).toBe("redacted");
    for (const forbidden of [
      "sk-ant-test123456789",
      "sk-or-v1-test123456789",
      "AIzaTest123456789",
      "gsk_test123456789",
      "xai-test123456789",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
