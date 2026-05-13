export type UploadKind = "document" | "spreadsheet" | "presentation" | "image" | "audio" | "video" | "archive" | "other";

export interface UploadItem {
  id: string;
  name: string;
  kind: UploadKind;
  sourcePath: string;
  sandboxPath: string;
  sizeLabel: string;
}

const extensionMap: Record<string, UploadKind> = {
  doc: "document",
  docx: "document",
  pdf: "document",
  txt: "document",
  md: "document",
  csv: "spreadsheet",
  xls: "spreadsheet",
  xlsx: "spreadsheet",
  ppt: "presentation",
  pptx: "presentation",
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
  heic: "image",
  mp3: "audio",
  wav: "audio",
  m4a: "audio",
  mp4: "video",
  mov: "video",
  zip: "archive",
};

export function classifyUpload(name: string): UploadKind {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  return extensionMap[extension] ?? "other";
}

export function sandboxUploadPath(projectFolder: string, fileName: string): string {
  const safeName = fileName.replace(/[/:]/g, "_");
  return `${projectFolder.replace(/\/+$/, "")}/uploads/${safeName}`;
}

export function createUploadItem(projectFolder: string, sourcePath: string, sizeLabel = "待複製"): UploadItem {
  const name = sourcePath.split("/").pop() || sourcePath;
  return {
    id: `${Date.now()}-${name}`,
    name,
    kind: classifyUpload(name),
    sourcePath,
    sandboxPath: sandboxUploadPath(projectFolder, name),
    sizeLabel,
  };
}
