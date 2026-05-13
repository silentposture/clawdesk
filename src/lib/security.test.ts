import { describe, expect, it } from "vitest";
import { decideChange, defaultSandboxPolicy, isInsideProject } from "./security";

describe("sandbox policy", () => {
  it("detects paths inside the project folder", () => {
    expect(isInsideProject("~/ClawDesk Projects/桌面 GUI/report.docx", "~/ClawDesk Projects/桌面 GUI")).toBe(true);
    expect(isInsideProject("~/Desktop/report.docx", "~/ClawDesk Projects/桌面 GUI")).toBe(false);
  });

  it("requires approval outside the project folder", () => {
    const decision = decideChange(defaultSandboxPolicy, { kind: "write", target: "~/Desktop/report.docx" });
    expect(decision.requiresApproval).toBe(true);
    expect(decision.allowed).toBe(false);
  });

  it("requires backup before project writes", () => {
    const decision = decideChange(defaultSandboxPolicy, {
      kind: "write",
      target: "~/ClawDesk Projects/桌面 GUI/report.docx",
    });
    expect(decision.allowed).toBe(true);
    expect(decision.requiresBackup).toBe(true);
  });

  it("never allows automatic delete", () => {
    const decision = decideChange(defaultSandboxPolicy, {
      kind: "delete",
      target: "~/ClawDesk Projects/桌面 GUI/report.docx",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.requiresApproval).toBe(true);
  });

  it("requires explicit screen vision permission", () => {
    const decision = decideChange(defaultSandboxPolicy, {
      kind: "screen-vision",
      target: "screen://main-display",
    });
    expect(decision.requiresApproval).toBe(true);
  });
});
