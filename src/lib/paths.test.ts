import { describe, expect, it } from "vitest";
import { resolveGovernedPath } from "./paths";

const options = {
  homeDir: "/Users/demo",
  projectRoot: "/Users/demo/ClawDesk Projects/desktop-mvp",
};

describe("path governance", () => {
  it("resolves relative and namespaced paths into the project sandbox", () => {
    expect(resolveGovernedPath("report.md", options, true)).toMatchObject({
      absolutePath: "/Users/demo/ClawDesk Projects/desktop-mvp/report.md",
      insideProject: true,
      requiresBackup: true,
    });
    expect(resolveGovernedPath("uploads:invoice.pdf", options)).toMatchObject({
      kind: "uploads",
      absolutePath: "/Users/demo/ClawDesk Projects/desktop-mvp/uploads/invoice.pdf",
    });
  });

  it("requires approval for absolute paths outside the sandbox", () => {
    expect(resolveGovernedPath("~/Desktop/report.md", options, true)).toMatchObject({
      absolutePath: "/Users/demo/Desktop/report.md",
      insideProject: false,
      requiresApproval: true,
      canDeleteAutomatically: false,
    });
  });
});
