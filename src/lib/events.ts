export const gatewayEventTypes = [
  "agent.message.delta",
  "agent.message.done",
  "canvas.begin",
  "canvas.patch",
  "canvas.data",
  "permission.request",
  "permission.result",
  "gateway.status",
] as const;

export type GatewayEventType = (typeof gatewayEventTypes)[number];

export type RiskLevel = "low" | "medium" | "high";

export interface AgentMessageDeltaEvent {
  type: "agent.message.delta";
  conversationId: string;
  messageId: string;
  delta: string;
}

export interface AgentMessageDoneEvent {
  type: "agent.message.done";
  conversationId: string;
  messageId: string;
}

export interface CanvasBeginEvent {
  type: "canvas.begin";
  surfaceId: string;
  title: string;
}

export type CatalogComponentType =
  | "Text"
  | "Button"
  | "Table"
  | "Metric"
  | "List"
  | "Progress"
  | "Panel";

export interface CanvasComponent {
  id: string;
  type: CatalogComponentType;
  props: Record<string, unknown>;
  children?: string[];
}

export interface CanvasPatchEvent {
  type: "canvas.patch";
  surfaceId: string;
  components: CanvasComponent[];
  rootId: string;
}

export interface CanvasDataEvent {
  type: "canvas.data";
  surfaceId: string;
  data: Record<string, unknown>;
}

export interface PermissionRequestEvent {
  type: "permission.request";
  requestId: string;
  action: string;
  target: string;
  risk: RiskLevel;
  summary: string;
}

export interface PermissionResultEvent {
  type: "permission.result";
  requestId: string;
  allowed: boolean;
  reason?: string;
}

export interface GatewayStatusEvent {
  type: "gateway.status";
  status: "starting" | "ready" | "degraded" | "offline";
  baseUrl?: string;
  wsUrl?: string;
  detail?: string;
}

export type GatewayEvent =
  | AgentMessageDeltaEvent
  | AgentMessageDoneEvent
  | CanvasBeginEvent
  | CanvasPatchEvent
  | CanvasDataEvent
  | PermissionRequestEvent
  | PermissionResultEvent
  | GatewayStatusEvent;

export function parseGatewayEvent(raw: string): GatewayEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Gateway 事件不是有效的 JSON");
  }

  if (!parsed || typeof parsed !== "object" || !("type" in parsed)) {
    throw new Error("Gateway 事件缺少 type");
  }

  const event = parsed as { type: string };
  if (!gatewayEventTypes.includes(event.type as GatewayEventType)) {
    throw new Error(`不支援的 Gateway 事件類型：${event.type}`);
  }

  return parsed as GatewayEvent;
}

export function serializePermissionResult(
  requestId: string,
  allowed: boolean,
  reason?: string,
): PermissionResultEvent {
  return {
    type: "permission.result",
    requestId,
    allowed,
    reason,
  };
}
