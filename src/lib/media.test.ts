import { describe, expect, it } from "vitest";
import { defaultMediaCapabilities, defaultMediaPolicy, isMediaWithinPolicy, mediaCapabilitySummary } from "./media";

describe("media capabilities", () => {
  it("includes local video, audio, image and text log handling", () => {
    expect(defaultMediaCapabilities.map((capability) => capability.kind)).toEqual([
      "video",
      "audio",
      "image",
      "text-log",
    ]);
    expect(defaultMediaCapabilities.every((capability) => capability.localOnly)).toBe(true);
  });

  it("summarizes codecs without exposing executable behavior", () => {
    expect(mediaCapabilitySummary(defaultMediaCapabilities[0])).toContain("硬體加速");
    expect(mediaCapabilitySummary(defaultMediaCapabilities[0])).toContain("mp4");
  });

  it("enforces large local media limits", () => {
    expect(isMediaWithinPolicy("video", 120, defaultMediaPolicy)).toBe(true);
    expect(isMediaWithinPolicy("video", 240, defaultMediaPolicy)).toBe(false);
    expect(isMediaWithinPolicy("text-log", 3000, defaultMediaPolicy)).toBe(false);
  });
});
