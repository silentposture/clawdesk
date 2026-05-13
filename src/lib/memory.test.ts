import { describe, expect, it } from "vitest";
import { compressContext, createMemoryItem } from "./memory";

describe("memory and context", () => {
  it("creates readable markdown-backed memory items", () => {
    const item = createMemoryItem({
      agentId: "assistant",
      title: "偏好",
      body: "使用繁體中文。",
      pinned: true,
      shared: false,
    }, "2026-05-12T00:00:00.000Z");

    expect(item.source).toBe("markdown");
    expect(item.id).toBe("mem-1778544000000");
  });

  it("compresses context while preserving pinned facts", () => {
    const compressed = compressContext({
      modelContextLimit: 128000,
      estimatedTokens: 20000,
      rollingSummary: "目前正在開發 ClawDesk。",
      pinnedFacts: ["品牌名稱 ClawDesk"],
      compressionRatio: 1,
    }, "2026-05-12T00:00:00.000Z");

    expect(compressed.estimatedTokens).toBeLessThan(10000);
    expect(compressed.pinnedFacts).toEqual(["品牌名稱 ClawDesk"]);
    expect(compressed.lastCompressedAt).toBe("2026-05-12T00:00:00.000Z");
  });
});
