import { describe, expect, it } from "vitest";
import { parseGatewayEvent, serializePermissionResult } from "./events";

describe("gateway event parser", () => {
  it("parses supported events", () => {
    const event = parseGatewayEvent(
      JSON.stringify({
        type: "agent.message.delta",
        conversationId: "c1",
        messageId: "m1",
        delta: "hello",
      }),
    );

    expect(event.type).toBe("agent.message.delta");
  });

  it("rejects invalid JSON", () => {
    expect(() => parseGatewayEvent("{")).toThrow("不是有效的 JSON");
  });

  it("rejects unknown event types", () => {
    expect(() => parseGatewayEvent(JSON.stringify({ type: "unknown" }))).toThrow("不支援的 Gateway 事件類型");
  });

  it("serializes permission results", () => {
    expect(serializePermissionResult("r1", false, "已拒絕")).toEqual({
      type: "permission.result",
      requestId: "r1",
      allowed: false,
      reason: "已拒絕",
    });
  });
});
