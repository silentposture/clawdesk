import { describe, expect, it } from "vitest";
import { createDiagnosticReport, isFaultCode, reportContainsPrivateData } from "./diagnostics";

describe("diagnostics privacy", () => {
  it("uses ClawDesk fault code format", () => {
    expect(isFaultCode("CLWD-LIC-1001")).toBe(true);
    expect(isFaultCode("LIC-1001")).toBe(false);
  });

  it("redacts emails, full paths, API keys, Paddle ids, and full license keys", () => {
    const report = createDiagnosticReport({
      faultCode: "CLWD-GW-2001",
      recentErrors: [
        "user a@example.com opened C:\\Users\\demo\\Documents\\secret.txt",
        "key sk-test1234567890 CLWD-PRO12-DEMO1-DEMO2-DEMO3 paddle_customer_abc123",
      ],
      userDescription: "看起來像 C:\\Users\\demo\\Desktop\\private.docx 壞掉",
      now: "2026-05-12T00:00:00.000Z",
    });

    expect(report.redactionStatus).toBe("redacted");
    expect(reportContainsPrivateData(report)).toBe(false);
    expect(JSON.stringify(report)).not.toContain("a@example.com");
    expect(JSON.stringify(report)).not.toContain("CLWD-PRO12-DEMO1-DEMO2-DEMO3");
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
});
