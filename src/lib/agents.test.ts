import { describe, expect, it } from "vitest";
import { canAgentReadKnowledge, defaultAgents } from "./agents";

describe("agent catalog", () => {
  it("provides the four default ClawDesk agents", () => {
    expect(defaultAgents.map((agent) => agent.name)).toEqual(["個人助理", "文書助理", "自動化助理", "研究助理"]);
  });

  it("keeps knowledge isolated unless shared or in shared scope", () => {
    const personal = defaultAgents[0];
    const docs = defaultAgents[1];
    const research = defaultAgents[3];
    const privateItem = { id: "k1", agentId: docs.id, title: "文件格式", shared: false };
    const sharedItem = { ...privateItem, shared: true };

    expect(canAgentReadKnowledge(personal, privateItem)).toBe(false);
    expect(canAgentReadKnowledge(personal, sharedItem)).toBe(true);
    expect(canAgentReadKnowledge(research, privateItem)).toBe(true);
  });
});
