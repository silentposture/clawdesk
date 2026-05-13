import { describe, expect, it } from "vitest";
import { buildChannelDraft, channelGuideCompletion, channelPreview, channelRequiresApproval, defaultChannels } from "./channels";

describe("communication channels", () => {
  it("includes common messaging platforms", () => {
    const ids = defaultChannels.map((channel) => channel.id);
    expect(ids).toContain("telegram");
    expect(ids).toContain("discord");
    expect(ids).toContain("whatsapp");
    expect(ids).toContain("slack");
    expect(ids).toContain("teams");
    expect(ids).toContain("line");
    expect(ids).toContain("matrix");
    expect(ids).not.toContain("imessage");
  });

  it("parses allowlists from comma-separated text", () => {
    const draft = buildChannelDraft(defaultChannels[0], "@boss, @team");
    expect(draft.allowlist).toEqual(["@boss", "@team"]);
  });

  it("requires approval before enabling risky channels", () => {
    const whatsapp = defaultChannels.find((channel) => channel.id === "whatsapp");
    expect(whatsapp && channelRequiresApproval(whatsapp)).toBe(true);
  });

  it("creates a safe setup preview", () => {
    const channel = defaultChannels[0];
    const preview = channelPreview(channel, buildChannelDraft(channel, "@demo"));
    expect(preview.title).toBe("Telegram 溝通頻道");
    expect(preview.requiresApproval).toBe(true);
  });

  it("tracks guided setup completion", () => {
    const telegram = defaultChannels[0];
    expect(channelGuideCompletion(telegram, [])).toBe(0);
    expect(channelGuideCompletion(telegram, telegram.guideSteps.map((step) => step.id))).toBe(100);
  });
});
