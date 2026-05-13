export type MediaCapabilityKind = "video" | "audio" | "image" | "text-log";

export interface MediaCapability {
  id: string;
  kind: MediaCapabilityKind;
  name: string;
  formats: string[];
  engine: string;
  localOnly: boolean;
  hardwareAcceleration: boolean;
  maxInputLabel: string;
  notes: string;
}

export interface MediaPolicy {
  keepLocalOnly: boolean;
  preferHardwareAcceleration: boolean;
  maxVideoMinutes: number;
  maxAudioMinutes: number;
  maxTextLogMb: number;
}

export const defaultMediaPolicy: MediaPolicy = {
  keepLocalOnly: true,
  preferHardwareAcceleration: true,
  maxVideoMinutes: 180,
  maxAudioMinutes: 240,
  maxTextLogMb: 2048,
};

export const defaultMediaCapabilities: MediaCapability[] = [
  {
    id: "video-media-foundation",
    kind: "video",
    name: "影片編碼/解碼",
    formats: ["mp4", "mov", "m4v", "hevc", "h264"],
    engine: "Windows Media Foundation / DirectX Video Acceleration",
    localOnly: true,
    hardwareAcceleration: true,
    maxInputLabel: "單檔 3 小時內",
    notes: "優先使用 Windows 硬體加速；正式外掛 ffmpeg sidecar 時仍維持同一個合約。",
  },
  {
    id: "audio-wasapi",
    kind: "audio",
    name: "音訊讀取/轉碼",
    formats: ["mp3", "wav", "m4a", "aac", "flac"],
    engine: "Windows WASAPI / Media Foundation",
    localOnly: true,
    hardwareAcceleration: true,
    maxInputLabel: "單檔 4 小時內",
    notes: "可用於語音逐字稿、會議摘要與音訊切片；MVP 先建立本機能力邊界。",
  },
  {
    id: "image-wic",
    kind: "image",
    name: "圖片解析/縮圖",
    formats: ["png", "jpg", "jpeg", "webp", "heic", "tiff"],
    engine: "Windows Imaging Component / Direct2D",
    localOnly: true,
    hardwareAcceleration: true,
    maxInputLabel: "超高解析圖片自動產生預覽副本",
    notes: "所有圖片先複製到專案 uploads，再做縮圖、OCR 或視覺辨識。",
  },
  {
    id: "text-log-index",
    kind: "text-log",
    name: "文字記錄與索引",
    formats: ["txt", "md", "jsonl", "log", "csv"],
    engine: "Rust 本機索引器",
    localOnly: true,
    hardwareAcceleration: false,
    maxInputLabel: "單專案 2 GB 文字記錄",
    notes: "聊天紀錄、操作記錄與工具輸出只保存可序列化文字，不執行模型產生的程式碼。",
  },
];

export function mediaKindLabel(kind: MediaCapabilityKind): string {
  if (kind === "video") return "影片";
  if (kind === "audio") return "音訊";
  if (kind === "image") return "圖片";
  return "文字記錄";
}

export function mediaCapabilitySummary(capability: MediaCapability): string {
  const local = capability.localOnly ? "本機處理" : "可外部處理";
  const acceleration = capability.hardwareAcceleration ? "硬體加速" : "CPU/索引器";
  return `${local} · ${acceleration} · ${capability.formats.join(", ")}`;
}

export function isMediaWithinPolicy(kind: MediaCapabilityKind, amount: number, policy: MediaPolicy): boolean {
  if (kind === "video") return amount <= policy.maxVideoMinutes;
  if (kind === "audio") return amount <= policy.maxAudioMinutes;
  if (kind === "text-log") return amount <= policy.maxTextLogMb;
  return true;
}
