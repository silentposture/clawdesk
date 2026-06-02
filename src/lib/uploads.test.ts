import { describe, expect, it } from "vitest";
import { classifyUpload, createUploadItem, sandboxUploadPath } from "./uploads";

describe("multimodal uploads", () => {
  it("classifies common office and media files", () => {
    expect(classifyUpload("report.docx")).toBe("document");
    expect(classifyUpload("budget.xlsx")).toBe("spreadsheet");
    expect(classifyUpload("demo.mov")).toBe("video");
    expect(classifyUpload("screen.png")).toBe("image");
  });

  it("copies incoming files into the project uploads folder", () => {
    expect(sandboxUploadPath("~/ClawDesk Project", "report.docx")).toBe("~/ClawDesk Project/uploads/report.docx");
  });

  it("creates upload records without mutating the source path", () => {
    const item = createUploadItem("~/ClawDesk Project", "/Users/demo/Desktop/photo.png", "2.1 MB");
    expect(item.sourcePath).toBe("/Users/demo/Desktop/photo.png");
    expect(item.sandboxPath).toBe("~/ClawDesk Project/uploads/photo.png");
    expect(item.kind).toBe("image");
  });
});
