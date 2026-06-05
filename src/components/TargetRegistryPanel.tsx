import { CircleAlert, CircleCheck, Plus, RefreshCw, Save, Send, Server, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  applyTargetConnectionAction,
  buildTargetConnectionReadinessReport,
  cloneTargetRegistry,
  createTargetDispatchRecord,
  createTargetProfile,
  defaultTargetRegistry,
  defaultTargetConnection,
  decideTargetDispatch,
  findTargetGroup,
  summarizeTargetProfile,
  summarizeTargetConnectionProfile,
  summarizeTargetRegistry,
  normalizeTargetGroupId,
  upsertTarget,
  upsertTargetGroup,
  type TargetConnectionReadinessCheck,
  type TargetConnectionReadinessReport,
  type TargetConnectionState,
  type TargetConnectionAction,
  type TargetCredentialMode,
  type TargetDispatchCategory,
  type TargetDispatchDecision,
  type TargetDispatchRecord,
  type TargetDispatchRequest,
  type TargetKind,
  type TargetSessionMode,
  type TargetProfile,
  type TargetRegistry,
  type TargetGroup,
} from "../lib/targets";
import { saveLegalExport } from "../lib/tauri";
import { useI18n } from "../lib/i18n";
import { targetRegistryCopy as copy } from "../lib/targetRegistryCopy";

interface TargetRegistryPanelProps {
  gatewayBaseUrl?: string;
  onClose: () => void;
}

interface TargetDraftState {
  id: string;
  displayName: string;
  kind: TargetKind;
  endpoint: string;
  state: TargetConnectionState;
  paired: boolean;
  authenticated: boolean;
  hostKeyVerified: boolean;
  username: string;
  port: string;
  credentialMode: TargetCredentialMode;
  credentialRef: string;
  knownHostFingerprint: string;
  sessionMode: TargetSessionMode;
  note: string;
  lastProbeAt: string;
  lastProbeResult: "reachable" | "unreachable" | "error" | "";
  lastProbeHost: string;
  lastProbePort: string;
  lastProbeLatencyMs: string;
  lastProbeError: string;
  trustedWorkspaces: string;
}

interface DispatchPreviewState {
  target: TargetProfile;
  request: TargetDispatchRequest;
  decision: TargetDispatchDecision;
  record: TargetDispatchRecord;
}

interface TargetExecutionState {
  mode: string;
  credentialSource?: string;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  startedAt: string;
  finishedAt: string;
  targetId: string;
  targetName: string;
}

interface TargetBatchExecutionResult {
  targetId: string;
  targetName?: string;
  allowed: boolean;
  reason: string;
  execution?: TargetExecutionState;
}

interface TargetConnectionReadinessState {
  report: TargetConnectionReadinessReport;
  source: "gateway" | "local";
}

interface CredentialBundlePreviewSummary {
  version: number;
  createdAt?: string | null;
  targetCount: number;
  groupCount?: number;
  secretCount: number;
  targetIds: string[];
  targetNames: string[];
  groupIds?: string[];
  groupNames?: string[];
  secretKinds: string[];
  secretLabels: string[];
  addedTargetIds: string[];
  addedTargetNames: string[];
  updatedTargetIds: string[];
  updatedTargetNames: string[];
  unchangedTargetIds: string[];
  addedGroupIds?: string[];
  addedGroupNames?: string[];
  updatedGroupIds?: string[];
  updatedGroupNames?: string[];
  unchangedGroupIds?: string[];
  secretTargetIds: string[];
  overwriteCount: number;
  groupOverwriteCount?: number;
  importCount: number;
}

interface TargetTimelineEntry {
  id: string;
  kind: "dispatch" | "session" | "audit";
  eventType: string;
  targetId: string;
  targetName: string;
  createdAt: string;
  summary: string;
  source: string;
  action?: string;
  category?: TargetDispatchCategory;
  command?: string;
  allowed?: boolean;
  decision?: string;
  state?: string;
  transport?: string;
  lastCommand?: string;
  lastExitCode?: number;
  clientLaunchState?: string;
  clientLaunchCommand?: string;
  activeWindow?: string;
  credentialSource?: string;
  credentialSeedState?: string;
  credentialTarget?: string;
  lastProbeAt?: string;
  lastProbeResult?: string;
  lastProbeHost?: string;
  lastProbePort?: number;
  lastProbeLatencyMs?: number;
  lastProbeError?: string;
}

interface TargetAuditReportState {
  text: string;
  source: "gateway" | "local";
}

interface SshTerminalTranscriptEntry {
  id: string;
  role: "system" | "command" | "output" | "error";
  text: string;
  createdAt: string;
}

interface SshTerminalSessionState {
  sessionId: string;
  targetId: string;
  targetName: string;
  endpoint: string;
  transport: string;
  state: "idle" | "connected" | "closed";
  mode: TargetSessionMode;
  prompt: string;
  currentDirectory: string;
  transcript: SshTerminalTranscriptEntry[];
  sessionSummary: string;
  commandHistory: string[];
  notes: string[];
  lastUpdatedAt: string;
  lastObservedAt?: string;
  lastCommand?: string;
  lastCommandAt?: string;
  lastExitCode?: number;
}

interface RemoteDesktopSessionState {
  sessionId: string;
  targetId: string;
  targetName: string;
  endpoint: string;
  transport: string;
  state: "idle" | "observing" | "control-pending" | "controlling" | "released";
  mode: TargetSessionMode;
  activeWindow: string;
  visibleWindows: string[];
  screenSummary: string;
  sessionSummary: string;
  notes: string[];
  lastUpdatedAt: string;
  lastObservedAt?: string;
  controlRequestId?: string;
  controlRequestedAt?: string;
  controlGrantedAt?: string;
  releasedAt?: string;
  permissionRequestId?: string;
  clientLaunchState?: "idle" | "dry-run" | "launched" | "failed";
  credentialSource?: string;
  credentialSeedState?: "idle" | "prepared" | "failed";
  credentialSeedAt?: string;
  credentialSeedError?: string;
  clientLaunchCommand?: string;
  clientLaunchAt?: string;
  clientLaunchPid?: number | null;
  clientLaunchError?: string;
  launchHistory?: Array<{
    launchedAt: string;
    transport: string;
    command: string;
    mode: TargetSessionMode;
    dryRun: boolean;
    pid?: number | null;
    error?: string;
  }>;
}

type RemoteDesktopSessionAction = "observe_screen" | "request_control" | "release_control" | "disconnect" | "refresh" | "launch_client" | "reconnect" | "seed_credentials";
type SshTerminalSessionAction = "open_session" | "run_command" | "close_session" | "reconnect" | "refresh";

const initialRegistry = defaultTargetRegistry();
const initialTarget = initialRegistry.targets[0];

const kindOptions: Array<{ value: TargetKind; label: string; endpoint: string; description: string }> = [
  {
    value: "local-shell",
    label: "本機 Shell",
    endpoint: "local://workspace",
    description: "同一台電腦上的本機工作區與 shell。",
  },
  {
    value: "ssh-terminal",
    label: "SSH 終端機",
    endpoint: "ssh://builder.example.internal",
    description: "遠端 Linux / Windows 主機的終端機連線。",
  },
  {
    value: "remote-desktop",
    label: "遠端桌面",
    endpoint: "rdp://ops.example.internal",
    description: "以螢幕 / session 控制為主的遠端桌面。",
  },
  {
    value: "mock",
    label: "Mock Target",
    endpoint: "mock://lab",
    description: "本機測試用 target，方便驗證 dispatch contract。",
  },
];

const stateOptions: Array<{ value: TargetConnectionState; label: string }> = [
  { value: "ready", label: "ready" },
  { value: "connecting", label: "connecting" },
  { value: "degraded", label: "degraded" },
  { value: "offline", label: "offline" },
];

const dispatchCategoryOptions: Array<{ value: TargetDispatchCategory; label: string; description: string }> = [
  { value: "observe", label: "觀察", description: "看螢幕、終端機輸出或 target 狀態。" },
  { value: "inspect", label: "檢查", description: "查 log、metadata、版本或設定摘要。" },
  { value: "debug", label: "除錯", description: "收集 redacted debug bundle 或診斷資訊。" },
  { value: "execute_safe", label: "安全執行", description: "只允許 allowlist 指令，且仍需人工審批。" },
  { value: "request_approval", label: "人工審批", description: "建立下一步的人工確認請求。" },
];

function defaultEndpointForKind(kind: TargetKind): string {
  return kindOptions.find((option) => option.value === kind)?.endpoint ?? "local://workspace";
}

function defaultDisplayNameForKind(kind: TargetKind): string {
  return kindOptions.find((option) => option.value === kind)?.label ?? "未命名目標";
}

function createDraftId(kind: TargetKind): string {
  return `target-${kind}-${Date.now().toString(36)}`;
}

function createDispatchId(): string {
  return `dispatch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function defaultTrustedWorkspaceList(): string {
  return ["~/ClawDesk Projects/桌面 GUI"].join("\n");
}

function createDraft(kind: TargetKind = "ssh-terminal"): TargetDraftState {
  const localLike = kind === "local-shell" || kind === "mock";
  const connection = defaultTargetConnection(kind);
  return {
    id: createDraftId(kind),
    displayName: defaultDisplayNameForKind(kind),
    kind,
    endpoint: defaultEndpointForKind(kind),
    state: localLike ? "ready" : "offline",
    paired: localLike,
    authenticated: localLike,
    hostKeyVerified: localLike,
    username: "",
    port: connection.port?.toString() ?? "",
    credentialMode: connection.credentialMode,
    credentialRef: "",
    knownHostFingerprint: "",
    sessionMode: connection.sessionMode,
    note: "",
    lastProbeAt: "",
    lastProbeResult: "",
    lastProbeHost: "",
    lastProbePort: "",
    lastProbeLatencyMs: "",
    lastProbeError: "",
    trustedWorkspaces: defaultTrustedWorkspaceList(),
  };
}

function draftFromTarget(target: TargetProfile): TargetDraftState {
  const adapter = target.adapters[0];
  const connection = target.connection ?? defaultTargetConnection(target.kind);
  return {
    id: target.id,
    displayName: target.displayName,
    kind: target.kind,
    endpoint: adapter?.endpoint ?? defaultEndpointForKind(target.kind),
    state: target.state,
    paired: target.paired,
    authenticated: adapter?.authenticated ?? false,
    hostKeyVerified: adapter?.hostKeyVerified ?? false,
    username: connection.username ?? "",
    port: connection.port?.toString() ?? "",
    credentialMode: connection.credentialMode,
    credentialRef: connection.credentialRef ?? "",
    knownHostFingerprint: connection.knownHostFingerprint ?? "",
    sessionMode: connection.sessionMode,
    note: connection.note ?? "",
    lastProbeAt: connection.lastProbeAt ?? "",
    lastProbeResult: connection.lastProbeResult ?? "",
    lastProbeHost: connection.lastProbeHost ?? "",
    lastProbePort: connection.lastProbePort?.toString() ?? "",
    lastProbeLatencyMs: connection.lastProbeLatencyMs?.toString() ?? "",
    lastProbeError: connection.lastProbeError ?? "",
    trustedWorkspaces: target.trustedWorkspaces.join("\n"),
  };
}

function parseTrustedWorkspaces(value: string): string[] {
  return value
    .split(/[\n,]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildTargetFromDraft(draft: TargetDraftState): TargetProfile {
  const portValue = draft.port.trim() ? Number.parseInt(draft.port, 10) : undefined;
  const parsedPort = Number.isFinite(portValue) ? portValue : undefined;
  const probePortValue = draft.lastProbePort.trim() ? Number.parseInt(draft.lastProbePort, 10) : undefined;
  const parsedProbePort = Number.isFinite(probePortValue) ? probePortValue : undefined;
  const probeLatencyValue = draft.lastProbeLatencyMs.trim() ? Number.parseInt(draft.lastProbeLatencyMs, 10) : undefined;
  const parsedProbeLatency = Number.isFinite(probeLatencyValue) ? probeLatencyValue : undefined;
  return createTargetProfile({
    id: draft.id.trim() || createDraftId(draft.kind),
    displayName: draft.displayName.trim() || defaultDisplayNameForKind(draft.kind),
    kind: draft.kind,
    endpoint: draft.endpoint.trim() || defaultEndpointForKind(draft.kind),
    state: draft.state,
    paired: draft.paired,
    trustedWorkspaces: parseTrustedWorkspaces(draft.trustedWorkspaces),
    connectionOverrides: {
      username: draft.username.trim() || undefined,
      port: parsedPort,
      credentialMode: draft.credentialMode,
      credentialRef: draft.credentialRef.trim() || undefined,
      knownHostFingerprint: draft.knownHostFingerprint.trim() || undefined,
      sessionMode: draft.sessionMode,
      note: draft.note.trim() || undefined,
      lastProbeAt: draft.lastProbeAt.trim() || undefined,
      lastProbeResult: draft.lastProbeResult || undefined,
      lastProbeHost: draft.lastProbeHost.trim() || undefined,
      lastProbePort: parsedProbePort,
      lastProbeLatencyMs: parsedProbeLatency,
      lastProbeError: draft.lastProbeError.trim() || undefined,
    },
    adapterOverrides: {
      authenticated: draft.authenticated,
      hostKeyVerified: draft.hostKeyVerified,
    },
  });
}

function dispatchStatusLabel(decision: TargetDispatchDecision): string {
  if (!decision.allowed) return "阻擋";
  return decision.requiresApproval ? "需審批" : "允許";
}

function dispatchStatusClass(decision: TargetDispatchDecision): string {
  if (!decision.allowed) return "risk-blocked";
  return decision.requiresApproval ? "risk-medium" : "risk-low";
}

function readinessBadgeClass(report: TargetConnectionReadinessReport): string {
  if (report.readyToConnect) return "readiness-ready";
  return `readiness-${report.nextAction}`;
}

function readinessActionLabel(report: TargetConnectionReadinessReport): string {
  if (report.readyToConnect) return "Connect";
  switch (report.nextAction) {
    case "pair":
      return "Pair";
    case "probe":
      return "Probe";
    case "verify_host_key":
      return "Verify host key";
    case "refresh":
      return "Refresh";
    default:
      return "Connect";
  }
}

function readinessIssueSummary(report: TargetConnectionReadinessReport): string {
  const failures = report.checks.filter((check) => check.status === "fail").slice(0, 2);
  if (failures.length === 0) {
    return "all checks passed";
  }
  return `needs ${failures.map((check) => check.label.toLowerCase()).join(" · ")}`;
}

function formatConnectionReadinessReport(report: TargetConnectionReadinessReport): string {
  const lines = [
    `Target: ${report.targetName} (${report.targetId})`,
    `Kind: ${report.kind}`,
    `State: ${report.state}`,
    `Ready to connect: ${report.readyToConnect ? "yes" : "no"}`,
    `Next action: ${report.nextAction}`,
  ];
  if (report.lastProbeResult) {
    lines.push(`Last probe: ${report.lastProbeResult}`);
  }
  lines.push("Checks:");
  for (const check of report.checks) {
    lines.push(`- ${check.label}: ${check.status} · ${check.detail}`);
  }
  return lines.join("\n");
}

function formatLastSeenAt(value?: string): string {
  if (!value) return "未記錄";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function extractTargetHostFromEndpoint(target: TargetProfile): string {
  const endpoint = target.adapters[0]?.endpoint ?? "";
  if (!endpoint) return target.displayName;

  try {
    return new URL(endpoint).hostname.trim() || target.displayName;
  } catch {
    return endpoint
      .replace(/^[a-z]+:\/\//i, "")
      .split(/[/:]/)[0]
      .trim() || target.displayName;
  }
}

function defaultRemoteDesktopVisibleWindows(target: TargetProfile): string[] {
  const host = extractTargetHostFromEndpoint(target);
  return [
    `${target.displayName} 主視窗`,
    `${target.displayName} 工作列`,
    `${host} · 遠端桌面 session`,
  ];
}

function defaultRemoteDesktopLaunchCommand(target: TargetProfile): string {
  const host = extractTargetHostFromEndpoint(target);
  const port = target.connection.port && target.connection.port > 0 ? `:${target.connection.port}` : "";
  if (typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("win")) {
    return `mstsc.exe /v:${host}${port}`;
  }
  return `xfreerdp /v:${host}${port}`;
}

function summarizeRemoteDesktopSession(target: TargetProfile, session: Partial<RemoteDesktopSessionState> = {}): string {
  const stateLabel =
    session.state === "controlling"
      ? "控制中"
      : session.state === "control-pending"
        ? "等待控制審批"
        : session.state === "released"
          ? "控制已釋放"
          : session.state === "observing"
            ? "觀察中"
            : "待就緒";
  const launchLabel =
    session.clientLaunchState && session.clientLaunchState !== "idle"
      ? `client ${session.clientLaunchState}`
      : "client idle";
  const visibleCount = Array.isArray(session.visibleWindows) ? session.visibleWindows.length : 0;
  const activeWindow = session.activeWindow ?? defaultRemoteDesktopVisibleWindows(target)[0];
  return [`${target.displayName} 遠端桌面 ${stateLabel}`, `視窗 ${visibleCount} 個`, `active ${activeWindow}`, launchLabel].join(" · ");
}

function summarizeSshTerminalSession(target: TargetProfile, session: Partial<SshTerminalSessionState> = {}): string {
  const stateLabel = session.state === "connected" ? "已連線" : session.state === "closed" ? "已關閉" : "待開啟";
  const lastCommand = session.lastCommand ? `last ${session.lastCommand}` : "last none";
  const lastExit = typeof session.lastExitCode === "number" ? `exit ${session.lastExitCode}` : "exit n/a";
  const prompt = session.prompt ?? `${target.connection.username?.trim() || "ssh"}@${target.adapters[0]?.endpoint ?? target.displayName}:~$`;
  return [`${target.displayName} SSH ${stateLabel}`, lastCommand, lastExit, prompt].join(" · ");
}

function createRemoteDesktopSessionPreview(target: TargetProfile, overrides: Partial<RemoteDesktopSessionState> = {}): RemoteDesktopSessionState {
  const visibleWindows = Array.isArray(overrides.visibleWindows) && overrides.visibleWindows.length > 0
    ? overrides.visibleWindows
    : defaultRemoteDesktopVisibleWindows(target);
  const now = overrides.lastUpdatedAt ?? new Date().toISOString();
  return {
    sessionId: overrides.sessionId ?? `rds_preview_${target.id}`,
    targetId: target.id,
    targetName: target.displayName,
    endpoint: overrides.endpoint ?? target.adapters[0]?.endpoint ?? target.displayName,
    transport: overrides.transport ?? "local-remote-desktop-preview",
    state: overrides.state ?? "idle",
    mode: overrides.mode ?? target.connection.sessionMode,
    activeWindow: overrides.activeWindow ?? visibleWindows[0],
    visibleWindows,
    screenSummary: overrides.screenSummary ?? `遠端桌面預覽已就緒：${target.displayName}。`,
    sessionSummary: overrides.sessionSummary ?? summarizeRemoteDesktopSession(target, overrides),
    notes: overrides.notes ?? ["等待 observe_screen 或 request_control。"],
    lastUpdatedAt: now,
    lastObservedAt: overrides.lastObservedAt,
    controlRequestId: overrides.controlRequestId,
    controlRequestedAt: overrides.controlRequestedAt,
    controlGrantedAt: overrides.controlGrantedAt,
    releasedAt: overrides.releasedAt,
    permissionRequestId: overrides.permissionRequestId,
    credentialSource: overrides.credentialSource ?? target.connection.credentialMode,
    credentialSeedState: overrides.credentialSeedState ?? "idle",
    credentialSeedAt: overrides.credentialSeedAt,
    credentialSeedError: overrides.credentialSeedError,
    clientLaunchState: overrides.clientLaunchState,
    clientLaunchCommand: overrides.clientLaunchCommand,
    clientLaunchAt: overrides.clientLaunchAt,
    clientLaunchPid: overrides.clientLaunchPid,
    clientLaunchError: overrides.clientLaunchError,
    launchHistory: Array.isArray(overrides.launchHistory) ? [...overrides.launchHistory] : [],
  };
}

function defaultSshTerminalTranscript(target: TargetProfile): SshTerminalTranscriptEntry[] {
  const host = target.adapters[0]?.endpoint ?? target.displayName;
  return [
    {
      id: `ssh-entry-${Math.random().toString(36).slice(2, 10)}`,
      role: "system",
      text: `SSH terminal session ready for ${target.displayName} at ${host}.`,
      createdAt: new Date().toISOString(),
    },
  ];
}

function createSshTerminalSessionPreview(
  target: TargetProfile,
  overrides: Partial<SshTerminalSessionState> = {},
): SshTerminalSessionState {
  const transcript = Array.isArray(overrides.transcript) && overrides.transcript.length > 0 ? [...overrides.transcript] : defaultSshTerminalTranscript(target);
  const notes = Array.isArray(overrides.notes) && overrides.notes.length > 0 ? [...overrides.notes] : ["Awaiting open_session or run_command."];
  const prompt = overrides.prompt ?? `${target.connection.username?.trim() || "ssh"}@${target.adapters[0]?.endpoint ?? target.displayName}:~$`;
  const now = overrides.lastUpdatedAt ?? new Date().toISOString();
  return {
    sessionId: overrides.sessionId ?? `ssh_preview_${target.id}`,
    targetId: target.id,
    targetName: target.displayName,
    endpoint: overrides.endpoint ?? target.adapters[0]?.endpoint ?? target.displayName,
    transport: overrides.transport ?? "local-ssh-terminal-preview",
    state: overrides.state ?? "idle",
    mode: overrides.mode ?? target.connection.sessionMode,
    prompt,
    currentDirectory: overrides.currentDirectory ?? "~",
    transcript,
    sessionSummary: overrides.sessionSummary ?? summarizeSshTerminalSession(target, overrides),
    commandHistory: Array.isArray(overrides.commandHistory) ? [...overrides.commandHistory] : [],
    notes,
    lastUpdatedAt: now,
    lastObservedAt: overrides.lastObservedAt,
    lastCommand: overrides.lastCommand,
    lastCommandAt: overrides.lastCommandAt,
    lastExitCode: overrides.lastExitCode,
  };
}

function normalizeSshTerminalSessionState(
  target: TargetProfile,
  session?: Partial<SshTerminalSessionState>,
): SshTerminalSessionState {
  const base = createSshTerminalSessionPreview(target, session ?? {});
  return {
    ...base,
    sessionId: session?.sessionId ?? base.sessionId,
    endpoint: session?.endpoint ?? base.endpoint,
    targetName: session?.targetName ?? base.targetName,
    transport: session?.transport ?? base.transport,
    state: session?.state ?? base.state,
    mode: session?.mode ?? base.mode,
    prompt: session?.prompt ?? base.prompt,
    currentDirectory: session?.currentDirectory ?? base.currentDirectory,
    transcript: Array.isArray(session?.transcript) && session.transcript.length > 0 ? [...session.transcript] : base.transcript,
    sessionSummary: session?.sessionSummary ?? base.sessionSummary,
    commandHistory: Array.isArray(session?.commandHistory) ? [...session.commandHistory] : base.commandHistory,
    notes: Array.isArray(session?.notes) && session.notes.length > 0 ? [...session.notes] : base.notes,
    lastUpdatedAt: session?.lastUpdatedAt ?? base.lastUpdatedAt,
    lastObservedAt: session?.lastObservedAt ?? base.lastObservedAt,
    lastCommand: session?.lastCommand ?? base.lastCommand,
    lastCommandAt: session?.lastCommandAt ?? base.lastCommandAt,
    lastExitCode: session?.lastExitCode ?? base.lastExitCode,
  };
}

function normalizeRemoteDesktopSessionState(
  target: TargetProfile,
  session?: Partial<RemoteDesktopSessionState>,
  permissionRequestId?: string,
): RemoteDesktopSessionState {
  const base = createRemoteDesktopSessionPreview(target, session ?? {});
  return {
    ...base,
    sessionId: session?.sessionId ?? base.sessionId,
    endpoint: session?.endpoint ?? base.endpoint,
    transport: session?.transport ?? base.transport,
    state: session?.state ?? base.state,
    mode: session?.mode ?? base.mode,
    activeWindow: session?.activeWindow ?? base.activeWindow,
    visibleWindows: Array.isArray(session?.visibleWindows) && session.visibleWindows.length > 0 ? [...session.visibleWindows] : base.visibleWindows,
    screenSummary: session?.screenSummary ?? base.screenSummary,
    sessionSummary: session?.sessionSummary ?? base.sessionSummary,
    notes: Array.isArray(session?.notes) && session.notes.length > 0 ? [...session.notes] : base.notes,
    lastUpdatedAt: session?.lastUpdatedAt ?? base.lastUpdatedAt,
    lastObservedAt: session?.lastObservedAt ?? base.lastObservedAt,
    controlRequestId: session?.controlRequestId ?? base.controlRequestId,
    controlRequestedAt: session?.controlRequestedAt ?? base.controlRequestedAt,
    controlGrantedAt: session?.controlGrantedAt ?? base.controlGrantedAt,
    releasedAt: session?.releasedAt ?? base.releasedAt,
    permissionRequestId: permissionRequestId ?? session?.permissionRequestId ?? session?.controlRequestId ?? base.permissionRequestId,
    credentialSource: session?.credentialSource ?? base.credentialSource,
    credentialSeedState: session?.credentialSeedState ?? base.credentialSeedState,
    credentialSeedAt: session?.credentialSeedAt ?? base.credentialSeedAt,
    credentialSeedError: session?.credentialSeedError ?? base.credentialSeedError,
    clientLaunchState: session?.clientLaunchState ?? base.clientLaunchState,
    clientLaunchCommand: session?.clientLaunchCommand ?? base.clientLaunchCommand,
    clientLaunchAt: session?.clientLaunchAt ?? base.clientLaunchAt,
    clientLaunchPid: session?.clientLaunchPid ?? base.clientLaunchPid,
    clientLaunchError: session?.clientLaunchError ?? base.clientLaunchError,
    launchHistory: Array.isArray(session?.launchHistory) ? [...session.launchHistory] : base.launchHistory,
  };
}

function redactTargetAuditReportText(value: string): string {
  return value
    .replace(/\b(?:ssh|rdp|https?):\/\/[^\s]+/gi, "[redacted-endpoint]")
    .replace(/\b[A-Za-z]:\\[^\s]+/g, "[redacted-path]")
    .replace(/\b\/[^\s]+/g, (match) => (match.includes("://") ? match : "[redacted-path]"))
    .replace(/\b[\w.+-]+@[\w.-]+\b/g, "[redacted-user]");
}

function buildLocalTargetAuditReportText(
  target: TargetProfile,
  readiness: TargetConnectionReadinessReport,
  timeline: TargetTimelineEntry[],
): string {
  const lines: string[] = [];
  lines.push(`# Target Audit Report`);
  lines.push(`generatedAt: ${new Date().toISOString()}`);
  lines.push(`targetId: ${target.id}`);
  lines.push(`kind: ${target.kind}`);
  lines.push(`state: ${target.state}`);
  lines.push(`paired: ${target.paired ? "yes" : "no"}`);
  lines.push(`readyToConnect: ${readiness.readyToConnect ? "yes" : "no"}`);
  lines.push(`nextAction: ${readiness.nextAction}`);
  lines.push(``);
  lines.push(`## Readiness Checks`);
  for (const check of readiness.checks) {
    lines.push(`- ${check.key} | ${check.label} | ${check.status} | ${redactTargetAuditReportText(String(check.detail ?? ""))}`);
  }
  lines.push(``);
  lines.push(`## Timeline`);
  if (timeline.length === 0) {
    lines.push(`- no timeline entries`);
  } else {
    for (const entry of timeline) {
      const parts = [
        entry.createdAt,
        entry.eventType,
        entry.kind,
        entry.source,
        redactTargetAuditReportText(entry.summary),
      ];
      if (entry.category) parts.push(`category=${entry.category}`);
      if (typeof entry.allowed === "boolean") parts.push(`allowed=${entry.allowed ? "yes" : "no"}`);
      if (entry.decision) parts.push(`decision=${redactTargetAuditReportText(entry.decision)}`);
      if (entry.state) parts.push(`state=${entry.state}`);
      if (entry.transport) parts.push(`transport=${entry.transport}`);
      if (entry.lastProbeResult) parts.push(`probe=${entry.lastProbeResult}`);
      if (typeof entry.lastExitCode === "number") parts.push(`exit=${entry.lastExitCode}`);
      if (entry.clientLaunchState) parts.push(`launch=${entry.clientLaunchState}`);
      if (entry.credentialSource) parts.push(`credentialSource=${entry.credentialSource}`);
      if (entry.credentialSeedState) parts.push(`credentialSeed=${entry.credentialSeedState}`);
      lines.push(`- ${parts.join(" | ")}`);
    }
  }
  return lines.join("\n");
}

export function TargetRegistryPanel({ gatewayBaseUrl, onClose }: TargetRegistryPanelProps): JSX.Element {
  const { t } = useI18n();
  const [registry, setRegistry] = useState<TargetRegistry>(() => cloneTargetRegistry(initialRegistry));
  const [dispatches, setDispatches] = useState<TargetDispatchRecord[]>([]);
  const [targetTimeline, setTargetTimeline] = useState<TargetTimelineEntry[]>([]);
  const [selectedTargetId, setSelectedTargetId] = useState(
    initialRegistry.defaultTargetId ?? initialRegistry.targets[0]?.id ?? "",
  );
  const [draft, setDraft] = useState<TargetDraftState>(() =>
    draftFromTarget(initialTarget ?? createTargetProfile({
      id: "ssh-default",
      displayName: "SSH 終端機",
      kind: "ssh-terminal",
      endpoint: "ssh://builder.example.internal",
    })),
  );
  const [dispatchCategory, setDispatchCategory] = useState<TargetDispatchCategory>("observe");
  const [dispatchSummary, setDispatchSummary] = useState("檢視指定 target 的目前狀態。");
  const [dispatchCommand, setDispatchCommand] = useState("git status");
  const [preview, setPreview] = useState<DispatchPreviewState>();
  const [execution, setExecution] = useState<TargetExecutionState>();
  const [batchExecutions, setBatchExecutions] = useState<TargetBatchExecutionResult[]>([]);
  const [timelineViewMode, setTimelineViewMode] = useState<"target" | "global">("target");
  const [connectionReadinessReport, setConnectionReadinessReport] = useState<TargetConnectionReadinessState>();
  const [remoteDesktopSession, setRemoteDesktopSession] = useState<RemoteDesktopSessionState>();
  const [remoteDesktopBusy, setRemoteDesktopBusy] = useState(false);
  const remoteDesktopSessionRequestTokenRef = useRef(0);
  const [sshTerminalSession, setSshTerminalSession] = useState<SshTerminalSessionState>();
  const [sshTerminalBusy, setSshTerminalBusy] = useState(false);
  const sshTerminalSessionRequestTokenRef = useRef(0);
  const [targetAuditReportText, setTargetAuditReportText] = useState<string>();
  const [sshPrivateKeyDraft, setSshPrivateKeyDraft] = useState("");
  const [sshTerminalCommandDraft, setSshTerminalCommandDraft] = useState("git status");
  const [credentialBundlePassphraseDraft, setCredentialBundlePassphraseDraft] = useState("");
  const [credentialBundleImportDraft, setCredentialBundleImportDraft] = useState("");
  const [credentialBundleTargetIds, setCredentialBundleTargetIds] = useState<string[]>(
    initialRegistry.targets.map((target) => target.id),
  );
  const [broadcastTargetIds, setBroadcastTargetIds] = useState<string[]>(
    initialRegistry.targets.filter((target) => target.kind === "local-shell" || target.kind === "ssh-terminal").map((target) => target.id),
  );
  const [credentialBundlePreview, setCredentialBundlePreview] = useState<CredentialBundlePreviewSummary>();
  const [selectedTargetGroupId, setSelectedTargetGroupId] = useState<string>(initialRegistry.targetGroups?.[0]?.id ?? "");
  const [targetGroupNameDraft, setTargetGroupNameDraft] = useState(initialRegistry.targetGroups?.[0]?.name ?? "");
  const [targetGroupDescriptionDraft, setTargetGroupDescriptionDraft] = useState(initialRegistry.targetGroups?.[0]?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  const summary = useMemo(() => summarizeTargetRegistry(registry), [registry]);
  const selectedTarget = useMemo(() => registry.targets.find((target) => target.id === selectedTargetId), [registry, selectedTargetId]);
  const draftTarget = useMemo(() => buildTargetFromDraft(draft), [draft]);
  const draftIsSaved = Boolean(selectedTarget && selectedTarget.id === draftTarget.id);
  const localConnectionReadinessReport = useMemo(() => buildTargetConnectionReadinessReport(draftTarget), [draftTarget]);
  const connectionReadiness = connectionReadinessReport?.report ?? localConnectionReadinessReport;
  const connectionIssues = connectionReadiness.checks.filter((check) => check.status === "fail").map((check) => check.detail);
  const remoteDesktopActionBlocked = draft.kind === "remote-desktop" && Boolean(gatewayBaseUrl) && !draftIsSaved;
  const remoteDesktopView = remoteDesktopSession ?? (draft.kind === "remote-desktop" ? createRemoteDesktopSessionPreview(draftTarget) : undefined);
  const remoteDesktopNotes = remoteDesktopView?.notes ?? [];
  const latestRemoteDesktopNote = remoteDesktopNotes[remoteDesktopNotes.length - 1];
  const sshTerminalActionBlocked = draft.kind === "ssh-terminal" && Boolean(gatewayBaseUrl) && !draftIsSaved;
  const sshTerminalView = sshTerminalSession ?? (draft.kind === "ssh-terminal" ? createSshTerminalSessionPreview(draftTarget) : undefined);
  const sshTerminalTranscript = sshTerminalView?.transcript ?? [];
  const sshTerminalNotes = sshTerminalView?.notes ?? [];
  const latestSshTerminalNote = sshTerminalNotes[sshTerminalNotes.length - 1];
  const trustedWorkspaceCount = draft.trustedWorkspaces
    .split(/[\n,]/g)
    .map((item) => item.trim())
    .filter(Boolean).length;
  const selectedCredentialBundleTargetIds = useMemo(() => {
    const registryTargetIds = registry.targets.map((target) => target.id);
    const selected = credentialBundleTargetIds.filter((targetId) => registryTargetIds.includes(targetId));
    return selected.length > 0 ? selected : registryTargetIds;
  }, [credentialBundleTargetIds, registry.targets]);
  const targetGroups = registry.targetGroups ?? [];
  const selectedTargetGroup = useMemo(
    () => (selectedTargetGroupId ? findTargetGroup(registry, selectedTargetGroupId) ?? targetGroups[0] : targetGroups[0]),
    [registry, selectedTargetGroupId, targetGroups],
  );
  const selectedBroadcastTargetIds = useMemo(() => {
    const registryTargetIds = registry.targets.map((target) => target.id);
    const selected = broadcastTargetIds.filter((targetId) => registryTargetIds.includes(targetId));
    return selected.length > 0 ? selected : [selectedTarget?.id ?? draftTarget.id].filter(Boolean);
  }, [broadcastTargetIds, draftTarget.id, selectedTarget?.id, registry.targets]);
  const visibleDispatchRecords =
    timelineViewMode === "target" && selectedTarget
      ? dispatches.filter((record) => record.targetId === selectedTarget.id).slice(0, 6)
      : dispatches.slice(0, 6);
  const localTargetAuditReportText = useMemo(
    () => buildLocalTargetAuditReportText(selectedTarget ?? draftTarget, connectionReadiness, targetTimeline),
    [connectionReadiness, draftTarget, selectedTarget, targetTimeline],
  );
  const targetAuditReport = targetAuditReportText ?? localTargetAuditReportText;

  useEffect(() => {
    const registryTargetIds = registry.targets.map((target) => target.id);
    setCredentialBundleTargetIds((current) => {
      const next = current.filter((targetId) => registryTargetIds.includes(targetId));
      return next.length > 0 ? next : registryTargetIds;
    });
    setBroadcastTargetIds((current) => {
      const next = current.filter((targetId) => registryTargetIds.includes(targetId));
      return next.length > 0 ? next : registry.targets.filter((target) => target.kind === "local-shell" || target.kind === "ssh-terminal").map((target) => target.id);
    });
  }, [registry.targets]);

  useEffect(() => {
    if (!targetGroups.length) {
      setSelectedTargetGroupId("");
      setTargetGroupNameDraft("");
      setTargetGroupDescriptionDraft("");
      return;
    }

    const activeGroup = selectedTargetGroup ?? targetGroups[0];
    if (!activeGroup) {
      setSelectedTargetGroupId("");
      setTargetGroupNameDraft("");
      setTargetGroupDescriptionDraft("");
      return;
    }

    if (activeGroup.id !== selectedTargetGroupId) {
      setSelectedTargetGroupId(activeGroup.id);
    }
    setTargetGroupNameDraft(activeGroup.name);
    setTargetGroupDescriptionDraft(activeGroup.description ?? "");
  }, [selectedTargetGroup, selectedTargetGroupId, targetGroups]);

  function clearSensitiveDraftState() {
    setSshPrivateKeyDraft("");
  }

  function clearManagedSessionState() {
    remoteDesktopSessionRequestTokenRef.current += 1;
    setRemoteDesktopBusy(false);
    setRemoteDesktopSession(undefined);
    sshTerminalSessionRequestTokenRef.current += 1;
    setSshTerminalBusy(false);
    setSshTerminalSession(undefined);
  }

  function previewManagedSessionForTarget(target?: TargetProfile) {
    if (!target) {
      clearManagedSessionState();
      return;
    }

    if (target.kind === "remote-desktop") {
      remoteDesktopSessionRequestTokenRef.current += 1;
      setRemoteDesktopBusy(false);
      setRemoteDesktopSession(createRemoteDesktopSessionPreview(target));
      sshTerminalSessionRequestTokenRef.current += 1;
      setSshTerminalBusy(false);
      setSshTerminalSession(undefined);
      return;
    }

    if (target.kind === "ssh-terminal") {
      sshTerminalSessionRequestTokenRef.current += 1;
      setSshTerminalBusy(false);
      setSshTerminalSession(createSshTerminalSessionPreview(target));
      setSshTerminalCommandDraft((current) => (current.trim() ? current : "git status"));
      remoteDesktopSessionRequestTokenRef.current += 1;
      setRemoteDesktopBusy(false);
      setRemoteDesktopSession(undefined);
      return;
    }

    clearManagedSessionState();
  }

  function syncManagedSessionForTarget(target?: TargetProfile) {
    if (!target) {
      clearManagedSessionState();
      return;
    }

    if (target.kind === "remote-desktop") {
      sshTerminalSessionRequestTokenRef.current += 1;
      setSshTerminalBusy(false);
      setSshTerminalSession(undefined);
      void loadRemoteDesktopSession(target);
      return;
    }

    if (target.kind === "ssh-terminal") {
      remoteDesktopSessionRequestTokenRef.current += 1;
      setRemoteDesktopBusy(false);
      setRemoteDesktopSession(undefined);
      void loadSshTerminalSession(target);
      return;
    }

    clearManagedSessionState();
  }

  useEffect(() => {
    void loadTargets();
  }, [gatewayBaseUrl]);

  async function loadTargets() {
    if (!gatewayBaseUrl) {
      setRegistry(cloneTargetRegistry(initialRegistry));
      setDispatches([]);
      setTargetTimeline([]);
      const nextTarget = initialRegistry.targets[0];
      if (nextTarget) {
        setSelectedTargetId(nextTarget.id);
        setDraft(draftFromTarget(nextTarget));
      }
      setPreview(undefined);
      setExecution(undefined);
      clearSensitiveDraftState();
      syncManagedSessionForTarget(nextTarget);
      setMessage(copy.targetRegistryRegistryLocalLoadedMessage);
      setError(undefined);
      return;
    }

    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch(`${gatewayBaseUrl}/targets`);
      if (!response.ok) throw new Error("bad response");
      const payload = (await response.json()) as { registry?: TargetRegistry; dispatches?: TargetDispatchRecord[] };
      const nextRegistry = payload.registry?.targets?.length ? payload.registry : cloneTargetRegistry(initialRegistry);
      const nextTargetId = nextRegistry.defaultTargetId ?? nextRegistry.targets[0]?.id ?? "";
      const nextTarget = nextRegistry.targets.find((target) => target.id === nextTargetId) ?? nextRegistry.targets[0];
      setRegistry(cloneTargetRegistry(nextRegistry));
      setDispatches(Array.isArray(payload.dispatches) ? payload.dispatches : []);
      if (nextTarget) {
        setSelectedTargetId(nextTarget.id);
        setDraft(draftFromTarget(nextTarget));
      } else {
        setSelectedTargetId("");
        setDraft(createDraft("ssh-terminal"));
      }
      setPreview(undefined);
      setExecution(undefined);
      clearSensitiveDraftState();
      syncManagedSessionForTarget(nextTarget);
      if (nextTarget) {
        await loadTargetTimeline(nextTarget);
      } else {
        setTargetTimeline([]);
      }
      setMessage(copy.targetRegistryRegistryGatewayLoadedMessage);
    } catch {
      setRegistry(cloneTargetRegistry(initialRegistry));
      setDispatches([]);
      setTargetTimeline([]);
      const nextTarget = initialRegistry.targets[0];
      if (nextTarget) {
        setSelectedTargetId(nextTarget.id);
        setDraft(draftFromTarget(nextTarget));
      }
      setPreview(undefined);
      setExecution(undefined);
      clearSensitiveDraftState();
      syncManagedSessionForTarget(nextTarget);
      setError(copy.targetRegistryRegistryGatewayFallbackMessage);
    } finally {
      setBusy(false);
    }
  }

  async function loadTargetTimeline(target?: TargetProfile) {
    const nextTarget = target ?? selectedTarget;
    if (!nextTarget) {
      setTargetTimeline([]);
      return;
    }

    if (!gatewayBaseUrl) {
      const localTimeline = dispatches
        .filter((record) => record.targetId === nextTarget.id)
        .slice(0, 6)
        .map((record) => ({
          id: record.id,
          kind: "dispatch" as const,
          eventType: "dispatch.record",
          targetId: record.targetId,
          targetName: record.targetName,
          createdAt: record.createdAt,
          summary: record.summary,
          source: "local-dispatch-log",
          action: record.category,
          category: record.category,
          command: record.command,
          allowed: record.decision.allowed,
          decision: record.decision.reason,
        }));
      setTargetTimeline(localTimeline);
      return;
    }

    try {
      const response = await fetch(`${gatewayBaseUrl}/targets/timeline?targetId=${encodeURIComponent(nextTarget.id)}`);
      if (!response.ok) throw new Error("bad response");
      const payload = (await response.json()) as { entries?: TargetTimelineEntry[] };
      setTargetTimeline(Array.isArray(payload.entries) ? payload.entries : []);
    } catch {
      setTargetTimeline([]);
    }
  }

  async function loadTargetAuditReport(target?: TargetProfile) {
    const nextTarget = target ?? selectedTarget ?? draftTarget;
    if (!nextTarget) {
      setTargetAuditReportText(undefined);
      return;
    }

    const readiness = connectionReadinessReport?.report ?? buildTargetConnectionReadinessReport(nextTarget);
    const localTimeline = targetTimeline.length > 0 ? targetTimeline : dispatches.filter((record) => record.targetId === nextTarget.id).slice(0, 6).map((record) => ({
      id: record.id,
      kind: "dispatch" as const,
      eventType: "dispatch.record",
      targetId: record.targetId,
      targetName: record.targetName,
      createdAt: record.createdAt,
      summary: record.summary,
      source: "local-dispatch-log",
      action: record.category,
      category: record.category,
      command: record.command,
      allowed: record.decision.allowed,
      decision: record.decision.reason,
    }));

    if (!gatewayBaseUrl || !draftIsSaved) {
      setTargetAuditReportText(buildLocalTargetAuditReportText(nextTarget, readiness, localTimeline));
      return;
    }

    try {
      const response = await fetch(`${gatewayBaseUrl}/targets/audit-report?targetId=${encodeURIComponent(nextTarget.id)}&limit=12`);
      if (!response.ok) throw new Error("bad response");
      const payload = (await response.json()) as { text?: string };
      setTargetAuditReportText(typeof payload.text === "string" && payload.text.trim() ? payload.text : buildLocalTargetAuditReportText(nextTarget, readiness, localTimeline));
    } catch {
      setTargetAuditReportText(buildLocalTargetAuditReportText(nextTarget, readiness, localTimeline));
    }
  }

  async function loadTargetConnectionReadiness(target?: TargetProfile) {
    const nextTarget = target ?? selectedTarget ?? draftTarget;
    if (!nextTarget) {
      setConnectionReadinessReport(undefined);
      return;
    }

    if (!gatewayBaseUrl || !draftIsSaved) {
      setConnectionReadinessReport({ report: buildTargetConnectionReadinessReport(nextTarget), source: "local" });
      return;
    }

    try {
      const response = await fetch(`${gatewayBaseUrl}/targets/connection-readiness?targetId=${encodeURIComponent(nextTarget.id)}`);
      if (!response.ok) throw new Error("bad response");
      const payload = (await response.json()) as { report?: TargetConnectionReadinessReport };
      if (payload.report) {
        setConnectionReadinessReport({ report: payload.report, source: "gateway" });
      } else {
        setConnectionReadinessReport({ report: buildTargetConnectionReadinessReport(nextTarget), source: "local" });
      }
    } catch {
      setConnectionReadinessReport({ report: buildTargetConnectionReadinessReport(nextTarget), source: "local" });
    }
  }

  async function copyConnectionReadinessReport(target?: TargetProfile) {
    const nextTarget = target ?? selectedTarget ?? draftTarget;
    if (!nextTarget) {
      setError(copy.targetRegistryReadinessCopyFailedMessage);
      return;
    }

    const report = connectionReadinessReport?.report ?? buildTargetConnectionReadinessReport(nextTarget);
    const text = formatConnectionReadinessReport(report);

    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else if (typeof document !== "undefined") {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "absolute";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand("copy");
        document.body.removeChild(textarea);
        if (!copied) {
          throw new Error("clipboard copy failed");
        }
      } else {
        throw new Error("clipboard not available");
      }
      setMessage(`已複製 ${nextTarget.displayName} 的 connection readiness report。`);
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "無法複製 readiness report。");
    }
  }

  async function copyTargetAuditReport(target?: TargetProfile) {
    const nextTarget = target ?? selectedTarget ?? draftTarget;
    if (!nextTarget) {
      setError(copy.targetRegistryTargetListAuditReportCopyFailed);
      return;
    }

    const text = targetAuditReport || buildLocalTargetAuditReportText(nextTarget, connectionReadinessReport?.report ?? buildTargetConnectionReadinessReport(nextTarget), targetTimeline);

    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else if (typeof document !== "undefined") {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "absolute";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand("copy");
        document.body.removeChild(textarea);
        if (!copied) {
          throw new Error("clipboard copy failed");
        }
      } else {
        throw new Error("clipboard not available");
      }
      setMessage(copy.targetRegistryTargetListAuditReportCopied);
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.targetRegistryTargetListAuditReportCopyFailed);
    }
  }

  function downloadMarkdownArtifact(filename: string, text: string) {
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  function buildTargetSessionExportText(target: TargetProfile, sshSession?: SshTerminalSessionState, remoteSession?: RemoteDesktopSessionState) {
    const lines = [
      `# Target Session Export`,
      `generatedAt: ${new Date().toISOString()}`,
      `targetId: ${target.id}`,
      `displayName: ${target.displayName}`,
      `kind: ${target.kind}`,
      `endpoint: ${target.adapters[0]?.endpoint ?? target.displayName}`,
      `state: ${target.state}`,
      `paired: ${target.paired ? "yes" : "no"}`,
      `summary: ${summarizeTargetProfile(target)}`,
      ``,
    ];

    if (target.kind === "ssh-terminal" && sshSession) {
      lines.push(`## SSH Session`);
      lines.push(`sessionId: ${sshSession.sessionId}`);
      lines.push(`state: ${sshSession.state}`);
      lines.push(`mode: ${sshSession.mode}`);
      lines.push(`transport: ${sshSession.transport}`);
      lines.push(`sessionSummary: ${redactTargetAuditReportText(sshSession.sessionSummary)}`);
      lines.push(`prompt: ${redactTargetAuditReportText(sshSession.prompt)}`);
      lines.push(`currentDirectory: ${redactTargetAuditReportText(sshSession.currentDirectory)}`);
      lines.push(`lastCommand: ${redactTargetAuditReportText(sshSession.lastCommand ?? "")}`);
      lines.push(`lastExitCode: ${typeof sshSession.lastExitCode === "number" ? sshSession.lastExitCode : "n/a"}`);
      lines.push(``);
      lines.push(`### Transcript`);
      const transcript = Array.isArray(sshSession.transcript) ? sshSession.transcript.slice(-20) : [];
      if (!transcript.length) {
        lines.push(`- no transcript entries`);
      } else {
        for (const entry of transcript) {
          lines.push(`- ${entry.createdAt} | ${entry.role} | ${redactTargetAuditReportText(entry.text)}`);
        }
      }
    }

    if (target.kind === "remote-desktop" && remoteSession) {
      lines.push(`## Remote Desktop Session`);
      lines.push(`sessionId: ${remoteSession.sessionId}`);
      lines.push(`state: ${remoteSession.state}`);
      lines.push(`mode: ${remoteSession.mode}`);
      lines.push(`transport: ${remoteSession.transport}`);
      lines.push(`sessionSummary: ${redactTargetAuditReportText(remoteSession.sessionSummary)}`);
      lines.push(`credentialSource: ${remoteSession.credentialSource ?? "none"}`);
      lines.push(`credentialSeedState: ${remoteSession.credentialSeedState ?? "idle"}`);
      lines.push(`activeWindow: ${redactTargetAuditReportText(remoteSession.activeWindow ?? "")}`);
      lines.push(`clientLaunchState: ${remoteSession.clientLaunchState ?? "idle"}`);
      lines.push(`clientLaunchCommand: ${redactTargetAuditReportText(remoteSession.clientLaunchCommand ?? "")}`);
      lines.push(`clientLaunchPid: ${typeof remoteSession.clientLaunchPid === "number" ? remoteSession.clientLaunchPid : "n/a"}`);
      lines.push(``);
      lines.push(`### Launch History`);
      const launchHistory = Array.isArray(remoteSession.launchHistory) ? remoteSession.launchHistory.slice(-10) : [];
      if (!launchHistory.length) {
        lines.push(`- no launch history`);
      } else {
        for (const entry of launchHistory) {
          const fields = [
            entry.launchedAt ?? "",
            entry.transport ?? "unknown",
            redactTargetAuditReportText(entry.command ?? ""),
          ];
          if (typeof entry.dryRun === "boolean") fields.push(`dryRun=${entry.dryRun ? "yes" : "no"}`);
          if (entry.mode) fields.push(`mode=${entry.mode}`);
          if (typeof entry.pid === "number") fields.push(`pid=${entry.pid}`);
          if (entry.error) fields.push(`error=${redactTargetAuditReportText(entry.error)}`);
          lines.push(`- ${fields.filter(Boolean).join(" | ")}`);
        }
      }
    }

    return lines.join("\n");
  }

  function downloadTargetAuditReport(target?: TargetProfile) {
    const nextTarget = target ?? selectedTarget ?? draftTarget;
    if (!nextTarget) {
      setError(copy.targetRegistryTargetListAuditReportCopyFailed);
      return;
    }

    const text = targetAuditReport || buildLocalTargetAuditReportText(nextTarget, connectionReadinessReport?.report ?? buildTargetConnectionReadinessReport(nextTarget), targetTimeline);
    const safeTargetId = nextTarget.id.replace(/[^a-zA-Z0-9_-]+/g, "-");
    downloadMarkdownArtifact(`${safeTargetId}-audit-report.md`, text);
    setMessage(copy.targetRegistryTargetListAuditReportDownloaded);
    setError(undefined);
  }

  async function downloadTargetSessionExport(target?: TargetProfile) {
    const nextTarget = target ?? selectedTarget ?? draftTarget;
    if (!nextTarget) {
      setError(copy.targetRegistryTargetListSessionExportFailed);
      return;
    }

    const safeTargetId = nextTarget.id.replace(/[^a-zA-Z0-9_-]+/g, "-");
    try {
      let text: string | undefined;
      if (gatewayBaseUrl && draftIsSaved && (nextTarget.kind === "ssh-terminal" || nextTarget.kind === "remote-desktop")) {
        const endpoint =
          nextTarget.kind === "ssh-terminal"
            ? `${gatewayBaseUrl}/targets/ssh-terminal/session-export?targetId=${encodeURIComponent(nextTarget.id)}`
            : `${gatewayBaseUrl}/targets/remote-desktop/session-export?targetId=${encodeURIComponent(nextTarget.id)}`;
        const response = await fetch(endpoint);
        const payload = (await response.json()) as { text?: string; error?: string };
        if (!response.ok) {
          throw new Error(payload.error || "bad response");
        }
        text = typeof payload.text === "string" && payload.text.trim() ? payload.text : undefined;
      }
      if (!text) {
        text = buildTargetSessionExportText(nextTarget, sshTerminalView, remoteDesktopView);
      }
      downloadMarkdownArtifact(`${safeTargetId}-session-export.md`, text);
      setMessage(copy.targetRegistryTargetListSessionExportDownloaded);
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.targetRegistryTargetListSessionExportFailed);
    }
  }

  useEffect(() => {
    void loadTargetConnectionReadiness(selectedTarget ?? draftTarget);
  }, [draftTarget, draftIsSaved, gatewayBaseUrl, selectedTarget, selectedTargetId]);

  useEffect(() => {
    void loadTargetAuditReport(selectedTarget ?? draftTarget);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftTarget, draftIsSaved, gatewayBaseUrl, selectedTarget, selectedTargetId, targetTimeline, connectionReadinessReport]);

  function selectExistingTarget(target: TargetProfile) {
    setSelectedTargetId(target.id);
    setDraft(draftFromTarget(target));
    setPreview(undefined);
    setExecution(undefined);
    clearSensitiveDraftState();
    syncManagedSessionForTarget(target);
    void loadTargetTimeline(target);
    setMessage(undefined);
    setError(undefined);
  }

  function startDraft(kind: TargetKind) {
    const nextDraft = createDraft(kind);
    setSelectedTargetId(nextDraft.id);
    setDraft(nextDraft);
    setPreview(undefined);
    setExecution(undefined);
    clearSensitiveDraftState();
    if (kind === "ssh-terminal") {
      setSshTerminalCommandDraft("git status");
    }
    previewManagedSessionForTarget(buildTargetFromDraft(nextDraft));
    void loadTargetTimeline(buildTargetFromDraft(nextDraft));
      setMessage(copy.targetRegistryDraftCreatedMessage(defaultDisplayNameForKind(kind)));
    setError(undefined);
  }

  async function persistRegistry(nextRegistry: TargetRegistry, statusMessage: string, sessionTarget?: TargetProfile) {
    setBusy(true);
    setError(undefined);
    try {
      if (gatewayBaseUrl) {
        const response = await fetch(`${gatewayBaseUrl}/targets`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ registry: nextRegistry }),
        });
        if (!response.ok) throw new Error("bad response");
        const payload = (await response.json()) as { registry?: TargetRegistry; dispatches?: TargetDispatchRecord[] };
        if (payload.registry?.targets?.length) {
          setRegistry(cloneTargetRegistry(payload.registry));
          if (Array.isArray(payload.dispatches)) {
            setDispatches(payload.dispatches);
          }
          void loadTargetTimeline(sessionTarget);
        } else {
          setRegistry(cloneTargetRegistry(nextRegistry));
        }
      } else {
        setRegistry(cloneTargetRegistry(nextRegistry));
      }
      setPreview(undefined);
      setExecution(undefined);
      clearSensitiveDraftState();
      syncManagedSessionForTarget(sessionTarget);
      void loadTargetTimeline(sessionTarget);
      setMessage(statusMessage);
    } catch {
      setRegistry(cloneTargetRegistry(nextRegistry));
      setPreview(undefined);
      setExecution(undefined);
      clearSensitiveDraftState();
      previewManagedSessionForTarget(sessionTarget);
      void loadTargetTimeline(sessionTarget);
      setMessage(copy.targetRegistryDraftSavedLocalFallbackMessage(statusMessage));
      setError(undefined);
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft(makeDefault = false) {
    const target = buildTargetFromDraft(draft);
    const nextRegistry = upsertTarget(registry, target);
    if (makeDefault) {
      nextRegistry.defaultTargetId = target.id;
    }
    setSelectedTargetId(target.id);
    setDraft(draftFromTarget(target));
    await persistRegistry(nextRegistry, makeDefault ? `已儲存 ${target.displayName} 並設為預設 target。` : `已儲存 ${target.displayName}。`, target);
  }

  async function saveTargetGroup() {
    const name = targetGroupNameDraft.trim();
    if (!name) {
      setError(copy.targetRegistryDraftGroupNameRequired);
      return;
    }

    const nextTargetIds = selectedBroadcastTargetIds.filter((targetId) => registry.targets.some((target) => target.id === targetId));
    if (!nextTargetIds.length) {
      setError(copy.targetRegistryDraftGroupSelectionRequired);
      return;
    }

    const group: TargetGroup = {
      id: selectedTargetGroup?.id?.trim() || normalizeTargetGroupId(name),
      name,
      description: targetGroupDescriptionDraft.trim() || undefined,
      targetIds: nextTargetIds,
    };
    const nextRegistry = upsertTargetGroup(registry, group);
    await persistRegistry(nextRegistry, copy.targetRegistryDraftGroupSavedMessage(group.name), selectedTarget ?? draftTarget);
    setSelectedTargetGroupId(group.id);
  }

  function applyTargetGroup(group?: TargetGroup) {
    if (!group) return;
    const registryTargetIds = registry.targets.map((target) => target.id);
    const targetIds = group.targetIds.filter((targetId) => registryTargetIds.includes(targetId));
    setBroadcastTargetIds(targetIds.length > 0 ? targetIds : registryTargetIds);
    setSelectedTargetGroupId(group.id);
    setTargetGroupNameDraft(group.name);
    setTargetGroupDescriptionDraft(group.description ?? "");
    setMessage(copy.targetRegistryDraftGroupAppliedMessage(group.name));
    setError(undefined);
  }

  async function removeTargetGroup(groupId: string) {
    const group = findTargetGroup(registry, groupId);
    if (!group) {
      return;
    }

    const nextGroups = (registry.targetGroups ?? []).filter((item) => item.id !== groupId);
    const nextRegistry = cloneTargetRegistry({ ...registry, targetGroups: nextGroups });
    await persistRegistry(nextRegistry, copy.targetRegistryDraftGroupDeletedMessage(group.name), selectedTarget ?? draftTarget);
    const fallbackGroup = nextGroups[0];
    setSelectedTargetGroupId(fallbackGroup?.id ?? "");
    setTargetGroupNameDraft(fallbackGroup?.name ?? "");
    setTargetGroupDescriptionDraft(fallbackGroup?.description ?? "");
  }

  function buildRequest(): TargetDispatchRequest {
    return {
      category: dispatchCategory,
      summary: dispatchSummary.trim(),
      command: dispatchCommand.trim() || undefined,
    };
  }

  function createPreviewSnapshot(target: TargetProfile): DispatchPreviewState {
    const request = buildRequest();
    const decision = decideTargetDispatch(target, request);
    const record = createTargetDispatchRecord(target, request, decision, createDispatchId());
    return { target, request, decision, record };
  }

  async function runConnectionAction(action: TargetConnectionAction, targetOverride?: TargetProfile) {
    const currentTarget = targetOverride ?? draftTarget;
    const result = applyTargetConnectionAction(currentTarget, action);
    if (!result.allowed) {
      setError(result.reason);
      setMessage(undefined);
      return;
    }

    if (gatewayBaseUrl) {
      setBusy(true);
      setError(undefined);
      try {
        const response = await fetch(`${gatewayBaseUrl}/targets/connection`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetId: currentTarget.id, action }),
        });
        if (!response.ok) throw new Error("bad response");
        const payload = (await response.json()) as { allowed?: boolean; reason?: string; target?: TargetProfile; registry?: TargetRegistry; dispatches?: TargetDispatchRecord[] };
        if (payload.allowed === false) {
          setError(payload.reason || result.reason);
          setMessage(undefined);
          return;
        }
        const nextTarget = payload.target ?? result.target;
        const nextRegistry = payload.registry ?? upsertTarget(registry, nextTarget);
        setRegistry(cloneTargetRegistry(nextRegistry));
        if (Array.isArray(payload.dispatches)) {
          setDispatches(payload.dispatches);
        }
        setSelectedTargetId(nextTarget.id);
        setDraft(draftFromTarget(nextTarget));
        setPreview(undefined);
        setExecution(undefined);
        clearSensitiveDraftState();
        syncManagedSessionForTarget(nextTarget);
        void loadTargetTimeline(nextTarget);
        setMessage(payload.reason || result.reason);
      } catch {
        const nextRegistry = upsertTarget(registry, result.target);
        setRegistry(cloneTargetRegistry(nextRegistry));
        setSelectedTargetId(result.target.id);
        setDraft(draftFromTarget(result.target));
        setPreview(undefined);
        setExecution(undefined);
        clearSensitiveDraftState();
        previewManagedSessionForTarget(result.target);
        setMessage(`${result.reason}（僅保留本機狀態，gateway 連線更新失敗）`);
      } finally {
        setBusy(false);
      }
      return;
    }

    const nextRegistry = upsertTarget(registry, result.target);
    setRegistry(cloneTargetRegistry(nextRegistry));
    setSelectedTargetId(result.target.id);
    setDraft(draftFromTarget(result.target));
    setPreview(undefined);
    setExecution(undefined);
    clearSensitiveDraftState();
    previewManagedSessionForTarget(result.target);
    setMessage(result.reason);
  }

  async function previewDispatch() {
    const snapshot = createPreviewSnapshot(draftTarget);
    setPreview(snapshot);
    setExecution(undefined);
    clearSensitiveDraftState();
      setMessage(copy.targetRegistryDispatchPreviewCreatedMessage(snapshot.target.displayName));
    setError(undefined);

    if (!gatewayBaseUrl) return;

    try {
      const response = await fetch(`${gatewayBaseUrl}/targets/dispatch-preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preview: snapshot }),
      });
      if (!response.ok) throw new Error("bad response");
    } catch {
      setError(copy.targetRegistryDispatchPreviewLocalError);
    }
  }

  async function queueDispatch() {
    const snapshot = createPreviewSnapshot(draftTarget);
    setPreview(snapshot);
    setExecution(undefined);
    clearSensitiveDraftState();

    if (gatewayBaseUrl) {
      try {
        const response = await fetch(`${gatewayBaseUrl}/targets/dispatch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ record: snapshot.record }),
        });
        if (!response.ok) throw new Error("bad response");
        const payload = (await response.json()) as { dispatches?: TargetDispatchRecord[] };
        if (Array.isArray(payload.dispatches)) {
          setDispatches(payload.dispatches);
        } else {
          setDispatches((current) => [snapshot.record, ...current].slice(0, 100));
        }
        setMessage(copy.targetRegistryDispatchRecordCreatedMessage(snapshot.record.targetName));
        setError(undefined);
        return;
      } catch {
        setMessage(copy.targetRegistryDispatchRecordCreatedLocalMessage);
      }
    }

    setDispatches((current) => [snapshot.record, ...current].slice(0, 100));
    setMessage(copy.targetRegistryDispatchRecordCreatedMessage(snapshot.record.targetName));
    setError(undefined);
  }

  async function executeSafeDispatch() {
    const snapshot = createPreviewSnapshot(draftTarget);
    setPreview(snapshot);
    setError(undefined);
    setBatchExecutions([]);
    clearSensitiveDraftState();

    if (snapshot.request.category !== "execute_safe") {
      setExecution(undefined);
      setError(copy.targetRegistryDispatchExecuteSafeOnly);
      return;
    }

    if (!snapshot.decision.allowed) {
      setExecution(undefined);
      setError(snapshot.decision.reason);
      return;
    }

    if (!gatewayBaseUrl) {
      setExecution(undefined);
      setError(copy.targetRegistryDispatchGatewayRequired);
      return;
    }

    const targetIds = selectedBroadcastTargetIds.length > 0 ? selectedBroadcastTargetIds : [snapshot.target.id];
    const isBatch = targetIds.length > 1;

    setBusy(true);
    try {
      const response = await fetch(`${gatewayBaseUrl}${isBatch ? "/targets/execute-batch" : "/targets/execute"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preview: snapshot,
          record: snapshot.record,
          targetIds: isBatch ? targetIds : undefined,
        }),
      });
      if (!response.ok) throw new Error("bad response");
      const payload = (await response.json()) as {
        allowed?: boolean;
        reason?: string;
        execution?: TargetExecutionState;
        record?: TargetDispatchRecord;
        results?: TargetBatchExecutionResult[];
        dispatches?: TargetDispatchRecord[];
        registry?: TargetRegistry;
        target?: TargetProfile;
      };
      if (!payload.allowed) {
        setExecution(undefined);
        setMessage(undefined);
        setError(payload.reason || "執行失敗。");
        return;
      }

      const nextTarget = payload.target ?? snapshot.target;
      const nextRegistry = payload.registry ?? upsertTarget(registry, nextTarget);
      setRegistry(cloneTargetRegistry(nextRegistry));
      if (Array.isArray(payload.dispatches)) {
        setDispatches(payload.dispatches);
      } else if (payload.record) {
        setDispatches((current) => [payload.record!, ...current.filter((item) => item.id !== payload.record!.id)].slice(0, 100));
      }
      if (isBatch) {
        setBatchExecutions(Array.isArray(payload.results) ? payload.results : []);
        setMessage(`${payload.reason ?? "批次命令已執行"} · ${selectedBroadcastTargetIds.length} targets`);
      } else {
        setSelectedTargetId(nextTarget.id);
        setDraft(draftFromTarget(nextTarget));
        setExecution(payload.execution);
        setMessage(`${payload.reason ?? "命令已執行"} · ${payload.execution?.mode ?? "unknown"}`);
      }
      clearSensitiveDraftState();
      void loadTargetTimeline(nextTarget);
    } catch {
      setExecution(undefined);
      setBatchExecutions([]);
      setError(copy.targetRegistryDispatchExecutionFailed);
    } finally {
      setBusy(false);
    }
  }

  async function issueTargetCredentialRef() {
    if (!gatewayBaseUrl) {
      setError(copy.targetRegistryCredentialRefGatewayRequired);
      return;
    }

    if (draft.kind !== "ssh-terminal" && draft.kind !== "remote-desktop") {
      setError(copy.targetRegistryCredentialRefOnlyRemote);
      return;
    }

    const privateKey = sshPrivateKeyDraft.trim();
    if (!privateKey) {
      setError(draft.kind === "ssh-terminal" ? copy.targetRegistryCredentialSecretSshRequired : copy.targetRegistryCredentialSecretRdpRequired);
      return;
    }

    setBusy(true);
    setError(undefined);
    try {
      const credentialKind = draft.kind === "ssh-terminal" ? "ssh-private-key" : "remote-desktop-secret";
      const response = await fetch(`${gatewayBaseUrl}/targets/credential-ref/issue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetId: draftTarget.id,
          kind: credentialKind,
          label: draft.displayName.trim() || defaultDisplayNameForKind(draft.kind),
          privateKey,
        }),
      });
      const payload = (await response.json()) as {
        credentialRef?: string;
        maskedSecret?: string;
        targetName?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "credential ref issuance failed");
      }
      if (!payload.credentialRef) {
        throw new Error("credential ref was not returned by the gateway.");
      }

      setDraft((current) => ({
        ...current,
        credentialMode: "secret-ref",
        credentialRef: payload.credentialRef ?? current.credentialRef,
      }));
      setSshPrivateKeyDraft("");
      setMessage(
        `${draft.kind === "ssh-terminal" ? "已發行 SSH credential ref" : "已發行遠端桌面 credential ref"} ${payload.credentialRef}${payload.maskedSecret ? ` · ${payload.maskedSecret}` : ""}`,
      );
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "credential ref issuance failed");
    } finally {
      setBusy(false);
    }
  }

  async function exportCredentialBundle() {
    if (!gatewayBaseUrl) {
      setError(copy.targetRegistryCredentialBundleGatewayRequiredExport);
      return;
    }

    const passphrase = credentialBundlePassphraseDraft.trim();
    if (!passphrase) {
      setError(copy.targetRegistryCredentialBundlePassphraseRequired);
      return;
    }

    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch(`${gatewayBaseUrl}/targets/credential-bundle/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          passphrase,
          targetIds: selectedCredentialBundleTargetIds,
        }),
      });
      const payload = (await response.json()) as {
        bundle?: Record<string, unknown>;
        bundleText?: string;
        targetCount?: number;
        secretCount?: number;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "credential bundle export failed");
      }
      if (!payload.bundleText) {
        throw new Error("credential bundle text was not returned by the gateway.");
      }

      const savedPath = await saveLegalExport("clawdesk-target-credential-bundle.json", payload.bundleText);
      setMessage(
        `已匯出 credential bundle · targets ${payload.targetCount ?? 0} · secrets ${payload.secretCount ?? 0}${savedPath ? ` · ${savedPath}` : ""}`,
      );
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "credential bundle export failed");
    } finally {
      setBusy(false);
    }
  }

  async function previewCredentialBundle() {
    if (!gatewayBaseUrl) {
      setError(copy.targetRegistryCredentialBundleGatewayRequiredPreview);
      return;
    }

    const passphrase = credentialBundlePassphraseDraft.trim();
    const bundleText = credentialBundleImportDraft.trim();
    if (!passphrase) {
      setError(copy.targetRegistryCredentialBundlePassphraseRequired);
      return;
    }
    if (!bundleText) {
      setError(copy.targetRegistryCredentialBundleJsonRequired);
      return;
    }

    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch(`${gatewayBaseUrl}/targets/credential-bundle/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase, bundleText }),
      });
      const payload = (await response.json()) as {
        allowed?: boolean;
        reason?: string;
        summary?: CredentialBundlePreviewSummary;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "credential bundle preview failed");
      }
      if (!payload.allowed || !payload.summary) {
        throw new Error(payload.reason || "credential bundle preview failed");
      }
      setCredentialBundlePreview(payload.summary);
      setMessage(
        `已預覽 credential bundle · targets ${payload.summary.targetCount} · secrets ${payload.summary.secretCount}`,
      );
      setError(undefined);
    } catch (caught) {
      setCredentialBundlePreview(undefined);
      setError(caught instanceof Error ? caught.message : "credential bundle preview failed");
    } finally {
      setBusy(false);
    }
  }

  async function importCredentialBundle() {
    if (!gatewayBaseUrl) {
      setError(copy.targetRegistryCredentialBundleGatewayRequiredImport);
      return;
    }

    const passphrase = credentialBundlePassphraseDraft.trim();
    const bundleText = credentialBundleImportDraft.trim();
    if (!passphrase) {
      setError(copy.targetRegistryCredentialBundlePassphraseRequired);
      return;
    }
    if (!bundleText) {
      setError(copy.targetRegistryCredentialBundleJsonRequired);
      return;
    }

    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch(`${gatewayBaseUrl}/targets/credential-bundle/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase, bundleText }),
      });
      const payload = (await response.json()) as {
        allowed?: boolean;
        reason?: string;
        registry?: TargetRegistry;
        targetCount?: number;
        secretCount?: number;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "credential bundle import failed");
      }
      if (!payload.allowed || !payload.registry) {
        throw new Error(payload.reason || "credential bundle import failed");
      }

      const nextRegistry = cloneTargetRegistry(payload.registry);
      const nextTarget =
        nextRegistry.targets.find((target) => target.id === nextRegistry.defaultTargetId) ??
        nextRegistry.targets[0] ??
        undefined;
      setRegistry(nextRegistry);
      if (nextTarget) {
        setSelectedTargetId(nextTarget.id);
        setDraft(draftFromTarget(nextTarget));
        previewManagedSessionForTarget(nextTarget);
        syncManagedSessionForTarget(nextTarget);
        void loadTargetTimeline(nextTarget);
      }
      setCredentialBundleImportDraft("");
      setCredentialBundlePreview(undefined);
      setSshPrivateKeyDraft("");
      setMessage(
        `已匯入 credential bundle · targets ${payload.targetCount ?? 0} · secrets ${payload.secretCount ?? 0}`,
      );
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "credential bundle import failed");
    } finally {
      setBusy(false);
    }
  }

  async function loadRemoteDesktopSession(target: TargetProfile) {
    if (target.kind !== "remote-desktop") {
      remoteDesktopSessionRequestTokenRef.current += 1;
      setRemoteDesktopBusy(false);
      setRemoteDesktopSession(undefined);
      return;
    }

    if (!gatewayBaseUrl) {
      remoteDesktopSessionRequestTokenRef.current += 1;
      setRemoteDesktopBusy(false);
      setRemoteDesktopSession(createRemoteDesktopSessionPreview(target));
      setError(undefined);
      return;
    }

    const requestToken = ++remoteDesktopSessionRequestTokenRef.current;
    setRemoteDesktopBusy(true);
    try {
      const response = await fetch(`${gatewayBaseUrl}/targets/remote-desktop/session?targetId=${encodeURIComponent(target.id)}`);
      const payload = (await response.json()) as {
        session?: Partial<RemoteDesktopSessionState>;
        target?: TargetProfile;
        error?: string;
      };

      if (!response.ok) {
        if (requestToken !== remoteDesktopSessionRequestTokenRef.current) {
          return;
        }
        setRemoteDesktopSession(createRemoteDesktopSessionPreview(target));
        if (response.status === 404 || response.status === 400) {
          setError(undefined);
          return;
        }
        throw new Error(payload.error || "bad response");
      }

      if (requestToken !== remoteDesktopSessionRequestTokenRef.current) {
        return;
      }
      const nextTarget = payload.target ?? target;
      setRemoteDesktopSession(normalizeRemoteDesktopSessionState(nextTarget, payload.session));
      setError(undefined);
    } catch (caught) {
      if (requestToken !== remoteDesktopSessionRequestTokenRef.current) {
        return;
      }
      setRemoteDesktopSession(createRemoteDesktopSessionPreview(target));
      setError(caught instanceof Error ? caught.message : "無法讀取遠端桌面 session。");
    } finally {
      if (requestToken === remoteDesktopSessionRequestTokenRef.current) {
        setRemoteDesktopBusy(false);
      }
    }
  }

  async function loadSshTerminalSession(target: TargetProfile) {
    if (target.kind !== "ssh-terminal") {
      sshTerminalSessionRequestTokenRef.current += 1;
      setSshTerminalBusy(false);
      setSshTerminalSession(undefined);
      return;
    }

    if (!gatewayBaseUrl) {
      sshTerminalSessionRequestTokenRef.current += 1;
      setSshTerminalBusy(false);
      setSshTerminalSession(createSshTerminalSessionPreview(target));
      setSshTerminalCommandDraft((current) => current.trim() ? current : "git status");
      setError(undefined);
      return;
    }

    const requestToken = ++sshTerminalSessionRequestTokenRef.current;
    setSshTerminalBusy(true);
    try {
      const response = await fetch(`${gatewayBaseUrl}/targets/ssh-terminal/session?targetId=${encodeURIComponent(target.id)}`);
      const payload = (await response.json()) as {
        session?: Partial<SshTerminalSessionState>;
        target?: TargetProfile;
        error?: string;
      };

      if (!response.ok) {
        if (requestToken !== sshTerminalSessionRequestTokenRef.current) {
          return;
        }
        setSshTerminalSession(createSshTerminalSessionPreview(target));
        if (response.status === 404 || response.status === 400) {
          setError(undefined);
          return;
        }
        throw new Error(payload.error || "bad response");
      }

      if (requestToken !== sshTerminalSessionRequestTokenRef.current) {
        return;
      }
      const nextTarget = payload.target ?? target;
      const nextSession = normalizeSshTerminalSessionState(nextTarget, payload.session);
      setSshTerminalSession(nextSession);
      setSshTerminalCommandDraft(nextSession.lastCommand ?? "git status");
      setError(undefined);
    } catch (caught) {
      if (requestToken !== sshTerminalSessionRequestTokenRef.current) {
        return;
      }
      setSshTerminalSession(createSshTerminalSessionPreview(target));
      setError(caught instanceof Error ? caught.message : "無法讀取 SSH terminal session。");
    } finally {
      if (requestToken === sshTerminalSessionRequestTokenRef.current) {
        setSshTerminalBusy(false);
      }
    }
  }

  async function mutateSshTerminalSession(action: SshTerminalSessionAction) {
    const currentTarget = draftTarget;
    if (currentTarget.kind !== "ssh-terminal") {
      setError(copy.targetRegistrySSHSessionBlocked);
      return;
    }

    if (gatewayBaseUrl && !draftIsSaved) {
      setError(copy.targetRegistrySSHSessionSaveRequired);
      return;
    }

    if (!gatewayBaseUrl) {
      const now = new Date().toISOString();
      const currentSession = sshTerminalSession ?? createSshTerminalSessionPreview(currentTarget);

      if (action === "run_command") {
        const command = sshTerminalCommandDraft.trim();
        if (!command) {
          setError(copy.targetRegistrySSHCommandRequired);
          return;
        }
        if (currentSession.state !== "connected") {
          setError(copy.targetRegistrySSHSessionOpenRequired);
          return;
        }

        const nextSession = normalizeSshTerminalSessionState(currentTarget, {
          ...currentSession,
          state: "connected",
          lastCommand: command,
          lastCommandAt: now,
          lastExitCode: 0,
          lastUpdatedAt: now,
          notes: [...currentSession.notes.slice(-4), `Preview command queued: ${command}`],
          commandHistory: [...currentSession.commandHistory.slice(-12), command],
          transcript: [
            ...currentSession.transcript.slice(-12),
            { id: `ssh-entry-${Math.random().toString(36).slice(2, 10)}`, role: "command", text: command, createdAt: now },
            {
              id: `ssh-entry-${Math.random().toString(36).slice(2, 10)}`,
              role: "output",
              text: "本機預覽模式：未執行實際 SSH 命令。",
              createdAt: now,
            },
          ],
        });
        setSshTerminalSession(nextSession);
        setMessage(`已在本機預覽中送出 ${command}。`);
        setError(undefined);
        return;
      }

      if (action === "open_session") {
        const nextSession = normalizeSshTerminalSessionState(currentTarget, {
          ...currentSession,
          state: "connected",
          lastObservedAt: now,
          lastUpdatedAt: now,
          notes: [...currentSession.notes.slice(-4), "SSH terminal preview session opened."],
          transcript: [
            ...currentSession.transcript.slice(-12),
            { id: `ssh-entry-${Math.random().toString(36).slice(2, 10)}`, role: "system", text: "Session opened.", createdAt: now },
          ],
        });
        setSshTerminalSession(nextSession);
        setMessage(copy.targetRegistrySSHSessionOpenMessage);
        setError(undefined);
        return;
      }

      if (action === "reconnect") {
        const nextSession = normalizeSshTerminalSessionState(currentTarget, {
          ...currentSession,
          state: "connected",
          lastObservedAt: now,
          lastUpdatedAt: now,
          notes: [...currentSession.notes.slice(-4), copy.targetRegistrySSHSessionReconnectNote],
          transcript: [
            ...currentSession.transcript.slice(-12),
            { id: `ssh-entry-${Math.random().toString(36).slice(2, 10)}`, role: "system", text: copy.targetRegistrySSHSessionReconnectTranscript, createdAt: now },
          ],
        });
        setSshTerminalSession(nextSession);
        setMessage(copy.targetRegistrySSHSessionReconnectMessage);
        setError(undefined);
        return;
      }

      if (action === "close_session") {
        const nextSession = normalizeSshTerminalSessionState(currentTarget, {
          ...currentSession,
          state: "closed",
          lastUpdatedAt: now,
          notes: [...currentSession.notes.slice(-4), "SSH terminal preview session closed."],
          transcript: [
            ...currentSession.transcript.slice(-12),
            { id: `ssh-entry-${Math.random().toString(36).slice(2, 10)}`, role: "system", text: "Session closed.", createdAt: now },
          ],
        });
        setSshTerminalSession(nextSession);
        setMessage(copy.targetRegistrySSHSessionCloseMessage);
        setError(undefined);
        return;
      }

      const refreshedSession = normalizeSshTerminalSessionState(currentTarget, {
        ...currentSession,
        lastObservedAt: now,
        lastUpdatedAt: now,
        notes: [...currentSession.notes.slice(-4), "SSH terminal preview snapshot refreshed."],
      });
      setSshTerminalSession(refreshedSession);
      setMessage(copy.targetRegistrySSHSessionRefreshMessage);
      setError(undefined);
      return;
    }

    const requestToken = ++sshTerminalSessionRequestTokenRef.current;
    setSshTerminalBusy(true);
    setError(undefined);
    try {
      const requestBody: { targetId: string; action: SshTerminalSessionAction; command?: string } = {
        targetId: currentTarget.id,
        action,
      };
      if (action === "run_command") {
        requestBody.command = sshTerminalCommandDraft;
      }

      const response = await fetch(`${gatewayBaseUrl}/targets/ssh-terminal/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const payload = (await response.json()) as {
        allowed?: boolean;
        reason?: string;
        session?: Partial<SshTerminalSessionState>;
        execution?: TargetExecutionState;
        record?: TargetDispatchRecord;
        target?: TargetProfile;
        registry?: TargetRegistry;
        dispatches?: TargetDispatchRecord[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || payload.reason || "bad response");
      }
      if (payload.allowed === false) {
        if (requestToken !== sshTerminalSessionRequestTokenRef.current) {
          return;
        }
        const nextTarget = payload.target ?? currentTarget;
        setSshTerminalSession(normalizeSshTerminalSessionState(nextTarget, payload.session));
        setError(payload.reason || "SSH terminal session 更新失敗。");
        return;
      }

      if (requestToken !== sshTerminalSessionRequestTokenRef.current) {
        return;
      }
      const nextTarget = payload.target ?? currentTarget;
      if (payload.registry?.targets?.length) {
        setRegistry(cloneTargetRegistry(payload.registry));
        if (Array.isArray(payload.dispatches)) {
          setDispatches(payload.dispatches);
        }
      }
      const nextSession = normalizeSshTerminalSessionState(nextTarget, payload.session);
      setSelectedTargetId(nextTarget.id);
      setDraft(draftFromTarget(nextTarget));
      setSshTerminalSession(nextSession);
      void loadTargetTimeline(nextTarget);
      if (payload.execution?.command) {
        setSshTerminalCommandDraft(payload.execution.command);
      } else if (nextSession.lastCommand) {
        setSshTerminalCommandDraft(nextSession.lastCommand);
      }
      setMessage(payload.reason || "SSH terminal session 已更新。");
      setError(undefined);
    } catch (caught) {
      if (requestToken !== sshTerminalSessionRequestTokenRef.current) {
        return;
      }
      setError(caught instanceof Error ? caught.message : "SSH terminal session 更新失敗。");
    } finally {
      if (requestToken === sshTerminalSessionRequestTokenRef.current) {
        setSshTerminalBusy(false);
      }
    }
  }

  async function mutateRemoteDesktopSession(action: RemoteDesktopSessionAction) {
    const currentTarget = draftTarget;
    if (currentTarget.kind !== "remote-desktop") {
      setError(copy.targetRegistryRemoteDesktopBlocked);
      return;
    }

    if (gatewayBaseUrl && !draftIsSaved) {
      setError(copy.targetRegistryRemoteDesktopSaveRequired);
      return;
    }

    if (!gatewayBaseUrl) {
      const now = new Date().toISOString();
      if (action === "request_control") {
        setError(copy.targetRegistryRemoteDesktopGatewayRequired);
        return;
      }

      const currentSession = remoteDesktopSession ?? createRemoteDesktopSessionPreview(currentTarget);
      const nextSession =
        action === "release_control"
          ? createRemoteDesktopSessionPreview(currentTarget, {
              ...currentSession,
              state: "released",
              mode: "observe",
              controlRequestId: undefined,
              releasedAt: now,
              lastUpdatedAt: now,
              notes: [...currentSession.notes.slice(-4), "Control released in local preview."],
              })
          : action === "disconnect"
            ? createRemoteDesktopSessionPreview(currentTarget, {
                ...currentSession,
                state: "released",
                mode: "observe",
                controlRequestId: undefined,
                releasedAt: now,
                clientLaunchState: currentSession.clientLaunchState === "dry-run" || currentSession.clientLaunchState === "launched" ? "idle" : currentSession.clientLaunchState,
                clientLaunchPid: null,
                clientLaunchError: undefined,
                lastUpdatedAt: now,
                notes: [...currentSession.notes.slice(-4), "Remote desktop client disconnected in local preview."],
              })
          : action === "launch_client" || action === "reconnect"
            ? createRemoteDesktopSessionPreview(currentTarget, {
                ...currentSession,
                state: currentTarget.connection.sessionMode === "control" ? "controlling" : "observing",
                mode: currentTarget.connection.sessionMode,
                transport: "local-native-rdp-preview",
                clientLaunchState: action === "reconnect" ? "launched" : "dry-run",
                clientLaunchCommand: defaultRemoteDesktopLaunchCommand(currentTarget),
                clientLaunchAt: now,
                clientLaunchPid: null,
                clientLaunchError: undefined,
                launchHistory: [
                  ...(currentSession.launchHistory?.slice(-4) ?? []),
                  {
                    launchedAt: now,
                    transport: "local-native-rdp-preview",
                    command: defaultRemoteDesktopLaunchCommand(currentTarget),
                    mode: currentTarget.connection.sessionMode,
                    dryRun: action !== "reconnect",
                  },
                ],
                lastUpdatedAt: now,
                notes: [
                  ...currentSession.notes.slice(-4),
                  action === "reconnect"
                    ? "Native RDP client reconnect recorded in local preview."
                    : "Native RDP client launch recorded in local preview.",
                ],
              })
          : createRemoteDesktopSessionPreview(currentTarget, {
              ...currentSession,
              state: "observing",
              mode: "observe",
              lastObservedAt: now,
              lastUpdatedAt: now,
              screenSummary: `本機預覽：${currentTarget.displayName} · ${currentTarget.adapters[0]?.endpoint ?? currentTarget.displayName}.`,
              notes: [...currentSession.notes.slice(-4), "Observation refreshed in local preview."],
            });

      setRemoteDesktopSession(nextSession);
      setMessage(`已更新 ${currentTarget.displayName} 的本機遠端桌面預覽。`);
      setError(undefined);
      return;
    }

    const requestToken = ++remoteDesktopSessionRequestTokenRef.current;
    setRemoteDesktopBusy(true);
    setError(undefined);
    try {
      const response = await fetch(`${gatewayBaseUrl}/targets/remote-desktop/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId: currentTarget.id, action }),
      });
      const payload = (await response.json()) as {
        allowed?: boolean;
        reason?: string;
        session?: Partial<RemoteDesktopSessionState>;
        permissionRequest?: { requestId?: string };
        launch?: {
          launchedAt?: string;
          transport?: string;
          command?: string;
          mode?: TargetSessionMode;
          dryRun?: boolean;
          pid?: number | null;
          error?: string;
        };
        target?: TargetProfile;
        registry?: TargetRegistry;
        dispatches?: TargetDispatchRecord[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || payload.reason || "bad response");
      }
      if (payload.allowed === false) {
        if (requestToken !== remoteDesktopSessionRequestTokenRef.current) {
          return;
        }
        setError(payload.reason || "遠端桌面 session 更新失敗。");
        return;
      }

      if (requestToken !== remoteDesktopSessionRequestTokenRef.current) {
        return;
      }
      const nextTarget = payload.target ?? currentTarget;
      if (payload.registry?.targets?.length) {
        setRegistry(cloneTargetRegistry(payload.registry));
        if (Array.isArray(payload.dispatches)) {
          setDispatches(payload.dispatches);
        }
      }
      setSelectedTargetId(nextTarget.id);
      setDraft(draftFromTarget(nextTarget));
      setRemoteDesktopSession(normalizeRemoteDesktopSessionState(nextTarget, payload.session, payload.permissionRequest?.requestId));
      void loadTargetTimeline(nextTarget);
      setMessage(payload.reason || "遠端桌面 session 已更新。");
      setError(undefined);
    } catch (caught) {
      if (requestToken !== remoteDesktopSessionRequestTokenRef.current) {
        return;
      }
      setError(caught instanceof Error ? caught.message : "遠端桌面 session 更新失敗。");
    } finally {
      if (requestToken === remoteDesktopSessionRequestTokenRef.current) {
        setRemoteDesktopBusy(false);
      }
    }
  }

  return (
    <div className="panel-backdrop" role="presentation">
      <section className="provider-panel target-registry-panel" role="dialog" aria-modal="true" aria-labelledby="target-registry-title">
        <header className="provider-header">
          <div>
            <h2 id="target-registry-title">{copy.targetRegistryTitle}</h2>
            <p>{copy.targetRegistrySubtitle}</p>
          </div>
          <div className="panel-actions">
            <button className="secondary-button" type="button" onClick={loadTargets} disabled={busy}>
              <RefreshCw size={16} />
              {copy.targetRegistryRefresh}
            </button>
            <button className="icon-button" type="button" aria-label={t("common.close")} onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </header>

        <section className="comparison-summary">
          <article className="commercial-card">
            <Server size={23} />
            <h3>{copy.targetRegistrySummaryTotalPrefix} {summary.totalTargets}</h3>
            <p>{copy.targetRegistrySummaryDefaultPrefix}{summary.defaultTargetName ?? copy.fieldTargetEndpointMissing}</p>
          </article>
          <article className="commercial-card">
            <CircleCheck size={23} />
            <h3>{copy.targetRegistrySummaryReadyPrefix} {summary.readyTargets} · {copy.targetRegistrySummaryPairedPrefix} {summary.pairedTargets}</h3>
            <p>{copy.targetRegistrySummaryGroupPrefix} {summary.targetGroupCount ?? 0} · {copy.targetRegistrySummaryReadyDescription}</p>
          </article>
          <article className="commercial-card">
            <CircleAlert size={23} />
            <h3>{copy.targetRegistrySummaryDispatchLogPrefix} {dispatches.length}</h3>
            <p>{copy.targetRegistrySummaryDispatchDescription}</p>
          </article>
        </section>

        <section className="target-registry-layout">
          <section className="commercial-card">
            <div className="panel-actions">
              <button className="secondary-button" type="button" onClick={() => startDraft("local-shell")} disabled={busy}>
                <Plus size={16} />
                {copy.targetRegistryNewLocal}
              </button>
              <button className="secondary-button" type="button" onClick={() => startDraft("ssh-terminal")} disabled={busy}>
                <Plus size={16} />
                {copy.targetRegistryNewSsh}
              </button>
              <button className="secondary-button" type="button" onClick={() => startDraft("remote-desktop")} disabled={busy}>
                <Plus size={16} />
                {copy.targetRegistryNewRemoteDesktop}
              </button>
              <button className="secondary-button" type="button" onClick={() => startDraft("mock")} disabled={busy}>
                <Plus size={16} />
                {copy.targetRegistryNewMock}
              </button>
            </div>
            <section className="target-group-manager">
              <div className="target-group-manager-header">
                <strong>{copy.targetGroupsTitle}</strong>
                <span>{copy.targetGroupsCount.replace("{count}", String(targetGroups.length))}</span>
              </div>
              <label>
                <span>{copy.targetGroupsSelectLabel}</span>
                <select value={selectedTargetGroup?.id ?? ""} onChange={(event) => applyTargetGroup(findTargetGroup(registry, event.target.value))}>
                  <option value="">{copy.targetGroupsEmpty}</option>
                  {targetGroups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name} · {group.targetIds.length}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>{copy.targetGroupsNameLabel}</span>
                <input value={targetGroupNameDraft} onChange={(event) => setTargetGroupNameDraft(event.target.value)} placeholder={copy.targetGroupsNamePlaceholder} />
              </label>
              <label>
                <span>{copy.targetGroupsDescriptionLabel}</span>
                <input value={targetGroupDescriptionDraft} onChange={(event) => setTargetGroupDescriptionDraft(event.target.value)} placeholder={copy.targetGroupsDescriptionPlaceholder} />
              </label>
              <div className="panel-actions">
                <button className="secondary-button" type="button" onClick={() => void saveTargetGroup()} disabled={busy || selectedBroadcastTargetIds.length === 0}>
                  <Save size={16} />
                  {copy.targetGroupsSave}
                </button>
                <button className="secondary-button" type="button" onClick={() => applyTargetGroup(selectedTargetGroup)} disabled={busy || !selectedTargetGroup}>
                  <Send size={16} />
                  {copy.targetGroupsApply}
                </button>
                <button className="secondary-button" type="button" onClick={() => void removeTargetGroup(selectedTargetGroup?.id ?? "")} disabled={busy || !selectedTargetGroup}>
                  <X size={16} />
                  {copy.targetGroupsDelete}
                </button>
              </div>
              <div className="target-group-list">
                {targetGroups.map((group) => (
                  <button key={group.id} type="button" className={`target-group-chip${selectedTargetGroup?.id === group.id ? " active" : ""}`} onClick={() => applyTargetGroup(group)}>
                    <strong>{group.name}</strong>
                    <small>{copy.targetGroupsChipTargets.replace("{count}", String(group.targetIds.length))}</small>
                  </button>
                ))}
              </div>
            </section>
            <div className="target-list">
              {registry.targets.map((target) => {
                const active = selectedTargetId === target.id;
                const readiness = buildTargetConnectionReadinessReport(target);
                const readinessLabel = readiness.readyToConnect ? copy.fieldConnectionBadgeReady : readiness.nextAction;
                return (
                  <article key={target.id} className={`target-list-item${active ? " active" : ""}`}>
                    <button type="button" className="target-list-select" onClick={() => selectExistingTarget(target)}>
                      <strong>{target.displayName}</strong>
                      <small className={`target-readiness-badge ${readinessBadgeClass(readiness)}`}>
                        {readiness.readyToConnect ? copy.fieldConnectionBadgeReady : readiness.nextAction}
                      </small>
                      <small className="target-readiness-summary">{readinessIssueSummary(readiness)}</small>
                      <small>{summarizeTargetProfile(target)}</small>
                      <small>{summarizeTargetConnectionProfile(target)}</small>
                      <small>
                        {copy.targetRegistryTargetListReadinessPrefix}{readinessLabel}
                        {readiness.lastProbeResult ? ` · ${copy.targetRegistryTargetListReadinessProbe} ${readiness.lastProbeResult}` : ""}
                      </small>
                      <small>{target.adapters[0]?.endpoint ?? copy.fieldTargetEndpointMissing}</small>
                      <small>
                        {target.id}
                        {registry.defaultTargetId === target.id ? ` · ${copy.fieldTargetDefaultMark}` : ""}
                      </small>
                    </button>
                    <div className="target-list-actions">
                      <label className="target-list-select-toggle">
                        <input
                          type="checkbox"
                          checked={selectedBroadcastTargetIds.includes(target.id)}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            setBroadcastTargetIds((current) => {
                              const withoutTarget = current.filter((targetId) => targetId !== target.id);
                              return checked ? [...withoutTarget, target.id] : withoutTarget;
                            });
                          }}
                        />
                        <span>{copy.fieldTargetListBroadcast}</span>
                      </label>
                      <button
                        type="button"
                        className="secondary-button target-list-action"
                        onClick={() => {
                          selectExistingTarget(target);
                          void runConnectionAction(readiness.readyToConnect ? "connect" : readiness.nextAction === "none" ? "refresh" : readiness.nextAction, target);
                        }}
                        disabled={busy}
                      >
                        <Send size={16} />
                        {readinessActionLabel(readiness)}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="commercial-card target-draft-form">
            <div>
              <h3>{draftIsSaved ? copy.targetRegistryDraftTitle : copy.targetRegistryDraftTitleNew}</h3>
              <p>{copy.targetRegistryDraftDescription}</p>
            </div>
            <label>
              <span>{copy.fieldTargetId}</span>
              <input value={draft.id} onChange={(event) => setDraft((current) => ({ ...current, id: event.target.value }))} />
            </label>
            <label>
              <span>{copy.fieldDisplayName}</span>
              <input value={draft.displayName} onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))} />
            </label>
            <label>
              <span>{copy.fieldTargetType}</span>
              <select
                value={draft.kind}
                onChange={(event) => {
                  const nextKind = event.target.value as TargetKind;
                  const nextConnection = defaultTargetConnection(nextKind);
                  setDraft((current) => {
                    const localLike = nextKind === "local-shell" || nextKind === "mock";
                    return {
                      ...current,
                      kind: nextKind,
                      endpoint: current.endpoint.trim() ? current.endpoint : defaultEndpointForKind(nextKind),
                      state: localLike ? "ready" : current.state === "ready" ? "offline" : current.state,
                      paired: localLike ? true : current.paired,
                      authenticated: localLike ? true : current.authenticated,
                      hostKeyVerified: localLike ? true : nextKind === "ssh-terminal" ? current.hostKeyVerified : false,
                      username: "",
                      port: nextConnection.port?.toString() ?? current.port,
                      credentialMode: nextConnection.credentialMode,
                      credentialRef: "",
                      knownHostFingerprint: "",
                      sessionMode: nextConnection.sessionMode,
                      note: "",
                    };
                  });
                  clearSensitiveDraftState();
                }}
              >
                {kindOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{copy.fieldEndpoint}</span>
              <input value={draft.endpoint} onChange={(event) => setDraft((current) => ({ ...current, endpoint: event.target.value }))} />
            </label>
            <label>
              <span>{copy.fieldState}</span>
              <select value={draft.state} onChange={(event) => setDraft((current) => ({ ...current, state: event.target.value as TargetConnectionState }))}>
                {stateOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="target-toggle">
              <span>{copy.fieldPaired}</span>
              <input type="checkbox" checked={draft.paired} onChange={(event) => setDraft((current) => ({ ...current, paired: event.target.checked }))} />
            </label>
            <label className="target-toggle">
              <span>{copy.fieldAuthenticated}</span>
              <input type="checkbox" checked={draft.authenticated} onChange={(event) => setDraft((current) => ({ ...current, authenticated: event.target.checked }))} />
            </label>
            <label className="target-toggle">
              <span>{copy.fieldHostKey}</span>
              <input type="checkbox" checked={draft.hostKeyVerified} onChange={(event) => setDraft((current) => ({ ...current, hostKeyVerified: event.target.checked }))} />
            </label>
            <label>
              <span>{copy.fieldTrustedWorkspaces}</span>
              <textarea
                value={draft.trustedWorkspaces}
                onChange={(event) => setDraft((current) => ({ ...current, trustedWorkspaces: event.target.value }))}
                placeholder={copy.fieldTrustedWorkspacesPlaceholder}
              />
              <small>{copy.targetRegistryTargetListTrustedWorkspaceCount.replace("{count}", String(trustedWorkspaceCount))}</small>
            </label>
            <label>
              <span>{copy.fieldConnectionUsername}</span>
              <input value={draft.username} onChange={(event) => setDraft((current) => ({ ...current, username: event.target.value }))} placeholder={copy.fieldConnectionUsernamePlaceholder} />
            </label>
            <label>
              <span>{copy.fieldConnectionPort}</span>
              <input
                inputMode="numeric"
                value={draft.port}
                onChange={(event) => setDraft((current) => ({ ...current, port: event.target.value }))}
                placeholder={draft.kind === "ssh-terminal" ? copy.fieldConnectionPortSshPlaceholder : draft.kind === "remote-desktop" ? copy.fieldConnectionPortRdpPlaceholder : copy.fieldConnectionPortOptionalPlaceholder}
              />
            </label>
            <label>
              <span>{copy.fieldCredentialMode}</span>
              <select value={draft.credentialMode} onChange={(event) => setDraft((current) => ({ ...current, credentialMode: event.target.value as TargetCredentialMode }))}>
                <option value="none">{copy.fieldCredentialModeNone}</option>
                <option value="secret-ref">{copy.fieldCredentialModeSecretRef}</option>
                <option value="ssh-agent">{copy.fieldCredentialModeSshAgent}</option>
                <option value="platform-managed">{copy.fieldCredentialModePlatformManaged}</option>
              </select>
            </label>
            <label>
              <span>{copy.fieldCredentialRef}</span>
              <input
                value={draft.credentialRef}
                onChange={(event) => setDraft((current) => ({ ...current, credentialRef: event.target.value }))}
                placeholder={copy.fieldCredentialRefPlaceholder}
              />
            </label>
            {draft.kind === "ssh-terminal" || draft.kind === "remote-desktop" ? (
              <label>
                <span>{draft.kind === "ssh-terminal" ? copy.fieldSshPrivateKey : copy.fieldRemoteDesktopCredentialLabel}</span>
                <textarea
                  value={sshPrivateKeyDraft}
                  onChange={(event) => setSshPrivateKeyDraft(event.target.value)}
                  placeholder={draft.kind === "ssh-terminal" ? copy.fieldSshPrivateKeyPlaceholder : copy.fieldRemoteDesktopSecretPlaceholder}
                />
                <small>{copy.fieldCredentialRefGatewayOnly}</small>
              </label>
            ) : null}
            <label>
              <span>{copy.fieldKnownHostKey}</span>
              <input
                value={draft.knownHostFingerprint}
                onChange={(event) => setDraft((current) => ({ ...current, knownHostFingerprint: event.target.value }))}
                placeholder={copy.fieldKnownHostKeyPlaceholder}
              />
                {draft.kind === "ssh-terminal" ? <small>{copy.fieldKnownHostKeyHint}</small> : null}
              </label>
            <label>
              <span>{copy.fieldSessionMode}</span>
              <select value={draft.sessionMode} onChange={(event) => setDraft((current) => ({ ...current, sessionMode: event.target.value as TargetSessionMode }))}>
                <option value="observe">{copy.fieldSessionModeObserve}</option>
                <option value="control">{copy.fieldSessionModeControl}</option>
              </select>
            </label>
            <label>
              <span>{copy.fieldConnectionNote}</span>
              <textarea
                value={draft.note}
                onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
                placeholder={copy.fieldConnectionNotePlaceholder}
              />
            </label>
            <section className="target-connection-summary">
              <div>
                <strong>{copy.fieldConnectionStatus}</strong>
                <span>{draft.paired ? copy.targetRegistryFieldPaired : copy.targetRegistryFieldNotPaired}</span>
              </div>
              <div>
                <strong>{copy.fieldAuthenticationStatus}</strong>
                <span>{draft.authenticated ? copy.targetRegistryFieldAuthenticated : copy.targetRegistryFieldNotAuthenticated}</span>
              </div>
              <div>
                <strong>{copy.fieldHostKey}</strong>
                <span>{draft.hostKeyVerified ? copy.targetRegistryHostKeyVerified : copy.targetRegistryHostKeyNotVerified}</span>
              </div>
              <div>
                <strong>{copy.fieldLastSeen}</strong>
                <span>{formatLastSeenAt(selectedTarget?.lastSeenAt)}</span>
              </div>
              <div>
                <strong>{copy.fieldConnectionProfile}</strong>
                <span>{summarizeTargetConnectionProfile(draftTarget)}</span>
              </div>
              <div>
                <strong>{copy.fieldProbe}</strong>
                <span>{draft.lastProbeResult || copy.fieldProbeNotYet}</span>
              </div>
              <div>
                <strong>{copy.fieldProbeEndpoint}</strong>
                <span>
                  {draft.lastProbeHost ? `${draft.lastProbeHost}${draft.lastProbePort ? `:${draft.lastProbePort}` : ""}` : copy.fieldTargetEndpointMissing}
                </span>
              </div>
              <div>
                <strong>{copy.fieldProbeAt}</strong>
                <span>{draft.lastProbeAt ? formatLastSeenAt(draft.lastProbeAt) : copy.fieldProbeNotYet}</span>
              </div>
              <div>
                <strong>{copy.fieldProbeLatency}</strong>
                <span>{draft.lastProbeLatencyMs ? `${draft.lastProbeLatencyMs}ms` : copy.fieldProbeLatencyNa}</span>
              </div>
              <div>
                <strong>{copy.fieldProbeError}</strong>
                <span>{draft.lastProbeError || copy.fieldProbeErrorNone}</span>
              </div>
            </section>
            <section className="connection-readiness-card">
              <div className="panel-actions">
                <button className="secondary-button" type="button" onClick={() => void loadTargetConnectionReadiness(selectedTarget ?? draftTarget)} disabled={busy}>
                  <RefreshCw size={16} />
                  {copy.targetRegistryConnectionReadinessRefreshAction}
                </button>
                <button className="secondary-button" type="button" onClick={() => void copyConnectionReadinessReport(selectedTarget ?? draftTarget)} disabled={busy}>
                  <Save size={16} />
                  {copy.targetRegistryConnectionReadinessCopyAction}
                </button>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => void runConnectionAction(connectionReadiness.nextAction === "none" ? "refresh" : connectionReadiness.nextAction)}
                  disabled={busy || connectionReadiness.nextAction === "none"}
                >
                  <Send size={16} />
                  {copy.targetRegistryConnectionReadinessExecuteAction}
                </button>
                <small>{copy.targetRegistryConnectionReadinessSourcePrefix}{connectionReadinessReport?.source ?? "local"}</small>
              </div>
              <strong>{copy.targetRegistryConnectionReadinessTitle}</strong>
              <p>
                {connectionReadiness.readyToConnect
                  ? copy.targetRegistryConnectionReadinessReady
                  : `${copy.targetRegistryConnectionReadinessNextStepPrefix}${connectionReadiness.nextAction}`}
              </p>
              <small>{copy.targetRegistryConnectionReadinessReadyToConnectPrefix}{connectionReadiness.readyToConnect ? copy.targetRegistryFieldYes : copy.targetRegistryFieldNo}</small>
              <small>{copy.targetRegistryConnectionReadinessNextActionPrefix}{connectionReadiness.nextAction}</small>
              <small>{copy.targetRegistryConnectionReadinessLastProbePrefix}{connectionReadiness.lastProbeResult ?? copy.fieldProbeNotYet}</small>
              <div className="connection-readiness-checks">
                {connectionReadiness.checks.map((check) => (
                  <article key={check.key} className={`connection-readiness-check readiness-${check.status}`}>
                    <strong>{check.label}</strong>
                    <p>{check.detail}</p>
                    <small>
                      {check.status} · {check.required ? copy.targetRegistryConnectionReadinessRequired : copy.targetRegistryConnectionReadinessOptional}
                    </small>
                  </article>
                ))}
              </div>
            </section>
            {connectionIssues.length > 0 ? (
              <section className="target-connection-issues">
                {connectionIssues.map((issue) => (
                  <div key={issue}>{issue}</div>
                ))}
              </section>
            ) : null}
            <section className="mcp-preview target-credential-bundle">
              <span>{copy.targetRegistryFieldBundleTitle}</span>
              <strong>{copy.fieldBundleSubtitle}</strong>
              <p>{copy.fieldTargetListTimelineBundleHint}</p>
              <div className="target-credential-bundle-targets">
                <div className="target-credential-bundle-targets-header">
                  <strong>{copy.fieldBundleExportTargets}</strong>
                  <span>{selectedCredentialBundleTargetIds.length} / {registry.targets.length}</span>
                </div>
                <div className="target-credential-bundle-targets-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setCredentialBundleTargetIds(registry.targets.map((target) => target.id))}
                  >
                    {copy.targetGroupsPresetSelectButton ?? "全選"}
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setCredentialBundleTargetIds([])}
                  >
                    {copy.targetGroupsPresetRemove ?? "清除"}
                  </button>
                </div>
                <div className="target-credential-bundle-targets-list">
                  {registry.targets.map((target) => (
                    <label key={target.id} className="target-credential-bundle-target-item">
                      <input
                        type="checkbox"
                        checked={selectedCredentialBundleTargetIds.includes(target.id)}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          setCredentialBundleTargetIds((current) => {
                            const withoutTarget = current.filter((targetId) => targetId !== target.id);
                            return checked ? [...withoutTarget, target.id] : withoutTarget;
                          });
                        }}
                      />
                      <span>{target.displayName}</span>
                      <small>{target.kind}</small>
                    </label>
                  ))}
                </div>
              </div>
              <label>
                <span>{copy.fieldBundlePassphrase}</span>
                <input
                  type="password"
                  value={credentialBundlePassphraseDraft}
                  onChange={(event) => setCredentialBundlePassphraseDraft(event.target.value)}
                  placeholder={copy.fieldCredentialBundlePassphrasePlaceholder}
                  autoComplete="new-password"
                />
              </label>
              <label>
                <span>{copy.fieldBundleImportJson}</span>
                <textarea
                  value={credentialBundleImportDraft}
                  onChange={(event) => setCredentialBundleImportDraft(event.target.value)}
                  placeholder={copy.fieldCredentialBundleImportPlaceholder}
                />
              </label>
              <small>{copy.fieldCredentialBundleHint}</small>
              <small>{copy.fieldCredentialBundleExportHint}</small>
              {credentialBundlePreview ? (
                <section className="target-credential-bundle-preview">
                  <span>{copy.targetRegistryFieldBundlePreviewTitle}</span>
                  <strong>
                    {credentialBundlePreview.targetCount} targets · {credentialBundlePreview.groupCount ?? 0} groups · {credentialBundlePreview.secretCount} secrets
                  </strong>
                  <small>{copy.targetRegistryFieldCreatedAtPrefix}{credentialBundlePreview.createdAt ?? copy.targetRegistryFieldNa} · {copy.targetRegistryFieldVersionPrefix}{credentialBundlePreview.version}</small>
                  <small>{copy.targetRegistryFieldTargetIdsPrefix}{credentialBundlePreview.targetIds.join(", ") || copy.targetRegistryFieldNone}</small>
                  <small>{copy.targetRegistryFieldTargetNamesPrefix}{credentialBundlePreview.targetNames.join(", ") || copy.targetRegistryFieldNone}</small>
                  <small>{copy.targetRegistryFieldGroupIdsPrefix}{credentialBundlePreview.groupIds?.join(", ") || copy.targetRegistryFieldNone}</small>
                  <small>{copy.targetRegistryFieldGroupNamesPrefix}{credentialBundlePreview.groupNames?.join(", ") || copy.targetRegistryFieldNone}</small>
                  <small>{copy.targetRegistryFieldSecretKindsPrefix}{credentialBundlePreview.secretKinds.join(", ") || copy.targetRegistryFieldNone}</small>
                  <small>{copy.targetRegistryFieldSecretLabelsPrefix}{credentialBundlePreview.secretLabels.join(", ") || copy.targetRegistryFieldNone}</small>
                  <small>新增 target：{credentialBundlePreview.addedTargetNames.join(", ") || copy.targetRegistryFieldNone}</small>
                  <small>更新 target：{credentialBundlePreview.updatedTargetNames.join(", ") || copy.targetRegistryFieldNone}</small>
                  <small>不變 target：{credentialBundlePreview.unchangedTargetIds.join(", ") || copy.targetRegistryFieldNone}</small>
                  <small>新增 group：{credentialBundlePreview.addedGroupNames?.join(", ") || copy.targetRegistryFieldNone}</small>
                  <small>更新 group：{credentialBundlePreview.updatedGroupNames?.join(", ") || copy.targetRegistryFieldNone}</small>
                  <small>不變 group：{credentialBundlePreview.unchangedGroupIds?.join(", ") || copy.targetRegistryFieldNone}</small>
                  <small>{copy.targetRegistryFieldSecretTargetsPrefix}{credentialBundlePreview.secretTargetIds.join(", ") || copy.targetRegistryFieldNone}</small>
                  <small>{copy.targetRegistryFieldOverwriteCount}：{credentialBundlePreview.overwriteCount}</small>
                  <small>{copy.targetRegistryFieldGroupOverwriteCount}：{credentialBundlePreview.groupOverwriteCount ?? 0}</small>
                </section>
              ) : null}
            </section>
            {draft.kind === "remote-desktop" ? (
              <section className="mcp-preview target-remote-desktop-session">
                <span>{copy.fieldRemoteDesktopTitle}</span>
                <strong>{remoteDesktopView?.targetName ?? draft.displayName}</strong>
                <p>{remoteDesktopView?.screenSummary ?? copy.fieldRemoteDesktopConnectionHint}</p>
                <div className="panel-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void downloadTargetSessionExport(selectedTarget ?? draftTarget)}
                  >
                    {copy.fieldSessionExportButton}
                  </button>
                </div>
                <small>{copy.fieldRemoteDesktopSessionSummary}：{remoteDesktopView?.sessionSummary ?? copy.targetRegistryFieldNotEstablished}</small>
                <small>
                  {copy.fieldRemoteDesktopSessionStateIdle}：{remoteDesktopView?.state ?? copy.targetRegistryFieldNone} · mode：{remoteDesktopView?.mode ?? draft.sessionMode}
                </small>
                <small>permission request：{remoteDesktopView?.permissionRequestId ?? copy.targetRegistryFieldNotSelected}</small>
                <small>transport：{remoteDesktopView?.transport ?? copy.targetRegistryFieldNotConfigured}</small>
                <small>{copy.fieldRemoteDesktopCredentialSource}：{remoteDesktopView?.credentialSource ?? copy.targetRegistryFieldNone}</small>
                <small>{copy.fieldRemoteDesktopCredentialSeedState}：{remoteDesktopView?.credentialSeedState ?? copy.fieldRemoteDesktopLaunchStateIdle}</small>
                {remoteDesktopView?.credentialSeedError ? <small>credential seed error：{remoteDesktopView.credentialSeedError}</small> : null}
                <small>active window：{remoteDesktopView?.activeWindow ?? copy.targetRegistryFieldNotConfigured}</small>
                <small>
                  visible windows：{remoteDesktopView?.visibleWindows?.length ? remoteDesktopView.visibleWindows.length : 0}
                </small>
                <small>client launch：{remoteDesktopView?.clientLaunchState ?? copy.fieldRemoteDesktopLaunchStateIdle}</small>
                <small>launch command：{remoteDesktopView?.clientLaunchCommand ?? copy.targetRegistryFieldNotEstablished}</small>
                <small>launch pid：{remoteDesktopView?.clientLaunchPid ?? copy.targetRegistryFieldNa}</small>
                <small>last observed：{formatLastSeenAt(remoteDesktopView?.lastObservedAt ?? remoteDesktopView?.lastUpdatedAt)}</small>
                {latestRemoteDesktopNote ? <small>latest note：{latestRemoteDesktopNote}</small> : null}
                {remoteDesktopActionBlocked ? <small>{copy.targetRegistryRemoteDesktopSaveRequired}</small> : null}
                {remoteDesktopView?.clientLaunchError ? <small>launch error：{remoteDesktopView.clientLaunchError}</small> : null}
              </section>
            ) : null}
            {draft.kind === "ssh-terminal" ? (
              <section className="mcp-preview target-ssh-terminal-session">
                <span>{copy.fieldSSHSessionTitle}</span>
                <strong>{sshTerminalView?.targetName ?? draft.displayName}</strong>
                <p>
                  {sshTerminalView?.state === "connected"
                    ? copy.fieldSSHSessionStateConnected
                    : sshTerminalView?.state === "closed"
                      ? copy.fieldSSHSessionStateClosed
                    : copy.fieldSSHSessionStateIdle}
                </p>
                <div className="panel-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void downloadTargetSessionExport(selectedTarget ?? draftTarget)}
                  >
                    {copy.fieldSessionExportButton}
                  </button>
                </div>
                <small>{copy.fieldRemoteDesktopSessionSummary}：{sshTerminalView?.sessionSummary ?? copy.targetRegistryFieldNotEstablished}</small>
                <small>{copy.fieldSshSessionStateIdle}：{sshTerminalView?.state ?? copy.fieldSshSessionStateIdle} · mode：{sshTerminalView?.mode ?? draft.sessionMode}</small>
                <small>prompt：{sshTerminalView?.prompt ?? copy.targetRegistryFieldNotEstablished}</small>
                <small>cwd：{sshTerminalView?.currentDirectory ?? "~"} · last exit：{sshTerminalView?.lastExitCode ?? copy.targetRegistryFieldNotEstablished}</small>
                <small>transport：{sshTerminalView?.transport ?? copy.targetRegistryFieldNotConfigured}</small>
                <small>last command：{sshTerminalView?.lastCommand ?? copy.targetRegistryFieldNotEstablished}</small>
                <small>last observed：{formatLastSeenAt(sshTerminalView?.lastObservedAt ?? sshTerminalView?.lastUpdatedAt)}</small>
                {latestSshTerminalNote ? <small>latest note：{latestSshTerminalNote}</small> : null}
                {sshTerminalActionBlocked ? <small>{copy.targetRegistrySSHSessionSaveRequired}</small> : null}
                <label className="ssh-terminal-command">
                  <span>{copy.fieldSSHCommandLabel}</span>
                  <textarea
                    value={sshTerminalCommandDraft}
                    onChange={(event) => setSshTerminalCommandDraft(event.target.value)}
                    placeholder={copy.fieldSSHCommandPlaceholder}
                  />
                  <small>{copy.fieldSSHSessionHint}</small>
                </label>
                <section className="ssh-terminal-transcript">
                  <span>{copy.fieldSSHTranscriptTitle}</span>
                  <div className="ssh-terminal-transcript-list">
                    {sshTerminalTranscript.length > 0 ? (
                      sshTerminalTranscript.map((entry) => (
                        <article key={entry.id} className={`ssh-terminal-transcript-entry role-${entry.role}`}>
                          <strong>{entry.role}</strong>
                          <p>{entry.text}</p>
                          <small>{formatLastSeenAt(entry.createdAt)}</small>
                        </article>
                      ))
                    ) : (
                      <p>{copy.fieldSSHSessionNoTranscript}</p>
                    )}
                  </div>
                </section>
              </section>
            ) : null}
            <div className="panel-actions">
              {draft.kind === "remote-desktop" ? (
                <>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void mutateRemoteDesktopSession("observe_screen")}
                    disabled={busy || remoteDesktopBusy || remoteDesktopActionBlocked}
                  >
                    <RefreshCw size={16} />
                    {copy.fieldRemoteDesktopObserveButton}
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void mutateRemoteDesktopSession("request_control")}
                    disabled={busy || remoteDesktopBusy || remoteDesktopActionBlocked || !gatewayBaseUrl}
                  >
                    <Send size={16} />
                    {copy.fieldRemoteDesktopRequestControlButton}
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void mutateRemoteDesktopSession("release_control")}
                    disabled={busy || remoteDesktopBusy || remoteDesktopActionBlocked}
                  >
                    {copy.fieldRemoteDesktopReleaseButton}
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void mutateRemoteDesktopSession("disconnect")}
                    disabled={busy || remoteDesktopBusy || remoteDesktopActionBlocked}
                  >
                    {copy.fieldRemoteDesktopDisconnectButton}
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void mutateRemoteDesktopSession("seed_credentials")}
                    disabled={busy || remoteDesktopBusy || remoteDesktopActionBlocked || draft.credentialMode !== "secret-ref" || !draft.credentialRef.trim()}
                  >
                    <Save size={16} />
                    {copy.fieldRemoteDesktopSeedButton}
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void mutateRemoteDesktopSession("refresh")}
                    disabled={busy || remoteDesktopBusy || remoteDesktopActionBlocked}
                  >
                    <RefreshCw size={16} />
                    {copy.fieldRemoteDesktopRefreshButton}
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => void mutateRemoteDesktopSession("launch_client")}
                    disabled={busy || remoteDesktopBusy || remoteDesktopActionBlocked}
                  >
                    <Send size={16} />
                    {copy.fieldRemoteDesktopLaunchButton}
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void mutateRemoteDesktopSession("reconnect")}
                    disabled={busy || remoteDesktopBusy || remoteDesktopActionBlocked}
                  >
                    {copy.fieldRemoteDesktopReconnectButton}
                  </button>
                </>
              ) : null}
              {draft.kind === "ssh-terminal" ? (
                <>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void mutateSshTerminalSession("open_session")}
                    disabled={busy || sshTerminalBusy || sshTerminalActionBlocked || connectionIssues.length > 0}
                  >
                    <RefreshCw size={16} />
                    {copy.fieldSSHSessionOpenButton}
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => void mutateSshTerminalSession("run_command")}
                    disabled={busy || sshTerminalBusy || sshTerminalActionBlocked || connectionIssues.length > 0 || !sshTerminalCommandDraft.trim()}
                  >
                    <Send size={16} />
                    {copy.fieldSSHCommandSendButton}
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void mutateSshTerminalSession("refresh")}
                    disabled={busy || sshTerminalBusy || sshTerminalActionBlocked || connectionIssues.length > 0}
                  >
                    <RefreshCw size={16} />
                    {copy.targetRegistryConnectionReadinessRefreshAction}
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void mutateSshTerminalSession("reconnect")}
                    disabled={busy || sshTerminalBusy || sshTerminalActionBlocked || connectionIssues.length > 0}
                  >
                    {copy.fieldSSHSessionReconnectButton}
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void mutateSshTerminalSession("close_session")}
                    disabled={busy || sshTerminalBusy || sshTerminalActionBlocked || connectionIssues.length > 0}
                  >
                    {copy.fieldSSHSessionCloseButton}
                  </button>
                </>
              ) : null}
              {draft.kind === "ssh-terminal" || draft.kind === "remote-desktop" ? (
                <button className="secondary-button" type="button" onClick={() => void issueTargetCredentialRef()} disabled={busy || !sshPrivateKeyDraft.trim()}>
                  <Send size={16} />
                  {draft.kind === "ssh-terminal" ? copy.fieldSSHCredentialRefIssueButton : copy.fieldRemoteDesktopCredentialRefIssueButton}
                </button>
              ) : null}
              <button className="secondary-button" type="button" onClick={() => void exportCredentialBundle()} disabled={busy || !credentialBundlePassphraseDraft.trim()}>
                {copy.fieldBundleExportButton}
              </button>
              <button className="secondary-button" type="button" onClick={() => void previewCredentialBundle()} disabled={busy || !credentialBundlePassphraseDraft.trim() || !credentialBundleImportDraft.trim()}>
                {copy.fieldBundlePreviewButton}
              </button>
              <button className="secondary-button" type="button" onClick={() => void importCredentialBundle()} disabled={busy || !credentialBundlePassphraseDraft.trim() || !credentialBundleImportDraft.trim()}>
                {copy.fieldBundleImportButton}
              </button>
              <button className="secondary-button" type="button" onClick={() => void runConnectionAction("pair")} disabled={busy}>
                {copy.fieldConnectionBadgeNeedPair}
              </button>
              <button className="secondary-button" type="button" onClick={() => void runConnectionAction("probe")} disabled={busy}>
                {copy.fieldConnectionBadgeNeedProbe}
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => void runConnectionAction("verify_host_key")}
                disabled={busy || draft.kind !== "ssh-terminal"}
              >
                {copy.fieldConnectionBadgeNeedVerify}
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => void runConnectionAction("connect")}
                disabled={busy || (draft.kind !== "local-shell" && connectionIssues.length > 0)}
              >
                {copy.fieldConnectionBadgeNeedConnect}
              </button>
              <button className="secondary-button" type="button" onClick={() => void runConnectionAction("disconnect")} disabled={busy}>
                {copy.fieldConnectionBadgeNeedDisconnect}
              </button>
              <button className="secondary-button" type="button" onClick={() => void runConnectionAction("refresh")} disabled={busy}>
                {copy.fieldConnectionBadgeNeedRefresh}
              </button>
            </div>
            <div className="panel-actions">
              <button className="primary-button" type="button" onClick={() => void saveDraft(false)} disabled={busy}>
                <Save size={16} />
                {copy.targetRegistryDraftSaveButton}
              </button>
              <button className="secondary-button" type="button" onClick={() => void saveDraft(true)} disabled={busy}>
                <Save size={16} />
                {copy.targetRegistryDraftSaveDefaultButton}
              </button>
            </div>
            <small>
              {copy.targetRegistryDraftSaved}{selectedTarget ? summarizeTargetProfile(selectedTarget) : copy.targetRegistryDraftUnsaved} · {draftIsSaved ? copy.targetRegistryDraftSavedAligned : copy.targetRegistryDraftEditing}
            </small>
          </section>

          <section className="commercial-card target-dispatch-form">
            <div>
              <h3>{copy.targetRegistryDispatchTitle}</h3>
              <p>{copy.targetRegistryDispatchDescription}</p>
            </div>
            <label>
              <span>{copy.fieldDispatchMode}</span>
              <select value={dispatchCategory} onChange={(event) => setDispatchCategory(event.target.value as TargetDispatchCategory)}>
                {dispatchCategoryOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{copy.fieldDispatchSummary}</span>
              <textarea value={dispatchSummary} onChange={(event) => setDispatchSummary(event.target.value)} placeholder={copy.fieldDispatchSummaryHint} />
            </label>
            <label>
              <span>{copy.fieldDispatchCommand}</span>
              <textarea
                value={dispatchCommand}
                onChange={(event) => setDispatchCommand(event.target.value)}
                placeholder={copy.fieldDispatchCommandHint}
              />
            </label>
            <div className="panel-actions">
              <button className="primary-button" type="button" onClick={() => void previewDispatch()} disabled={busy || !draftTarget.id.trim() || !dispatchSummary.trim()}>
                <Server size={16} />
                {copy.fieldDispatchPreview}
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => void executeSafeDispatch()}
                disabled={busy || !preview || preview.request.category !== "execute_safe" || !preview.decision.allowed}
              >
                <Send size={16} />
                {copy.fieldDispatchExecutionButton}
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => void executeSafeDispatch()}
                disabled={busy || !preview || preview.request.category !== "execute_safe" || !preview.decision.allowed || selectedBroadcastTargetIds.length < 2}
              >
                <Send size={16} />
                {copy.fieldDispatchBatchButton} {selectedBroadcastTargetIds.length > 0 ? `(${selectedBroadcastTargetIds.length})` : ""}
              </button>
              <button className="secondary-button" type="button" onClick={() => void queueDispatch()} disabled={busy || !draftSummaryReady(dispatchSummary)}>
                <Send size={16} />
                {copy.fieldDispatchCreateRecord}
              </button>
            </div>

            {preview ? (
              <div className="mcp-preview">
                <span>{copy.fieldDispatchLatestPreview}</span>
                <strong>{preview.target.displayName}</strong>
                <p>{preview.request.summary}</p>
                <small>
                  {preview.request.category} · {dispatchStatusLabel(preview.decision)} · {preview.decision.reason}
                </small>
                <small>adapter：{preview.decision.adapterKind ?? "unknown"}{preview.decision.commandSafety ? ` · command=${preview.decision.commandSafety}` : ""}</small>
              </div>
            ) : (
              <div className="mcp-empty">{copy.fieldMcpEmptyPreview}</div>
            )}

            {execution ? (
              <div className="mcp-preview target-execution-result">
                <span>{copy.fieldDispatchLatestExecution}</span>
                <strong>{execution.targetName}</strong>
                <p>{execution.mode} · exit {execution.exitCode ?? "unknown"}</p>
                <small>credential source：{execution.credentialSource ?? "unknown"}</small>
                <small>command：{execution.command}</small>
                {execution.stdout ? (
                  <pre>{execution.stdout}</pre>
                ) : null}
                {execution.stderr ? (
                  <pre className="target-execution-stderr">{execution.stderr}</pre>
                ) : null}
              </div>
            ) : null}
            {batchExecutions.length > 0 ? (
              <section className="target-batch-execution-results">
                <span>{copy.fieldDispatchBatchExecution}</span>
                {batchExecutions.map((result) => (
                  <article key={result.targetId} className={`target-batch-execution-result ${result.allowed ? "allowed" : "blocked"}`}>
                    <strong>{result.targetName ?? result.targetId}</strong>
                    <p>{result.allowed ? "allowed" : "blocked"} · {result.reason}</p>
                    {result.execution ? (
                      <small>
                        exit {result.execution.exitCode ?? "unknown"} · {result.execution.mode}
                      </small>
                    ) : null}
                  </article>
                ))}
              </section>
            ) : null}

            <dl className="status-list">
              <div>
                <dt>{copy.fieldTargetLabel}</dt>
                <dd>{draftTarget.displayName} · {draftTarget.kind} · {draftTarget.state}</dd>
              </div>
              <div>
                <dt>{copy.fieldSecurityStatusLabel}</dt>
                <dd>
                  {preview ? (
                    <span className={`risk-pill ${dispatchStatusClass(preview.decision)}`}>{dispatchStatusLabel(preview.decision)}</span>
                  ) : (
                    "等待預覽"
                  )}
                </dd>
              </div>
              <div>
                <dt>{copy.fieldDispatchTrustedWorkspaces}</dt>
                <dd>{trustedWorkspaceCount > 0 ? trustedWorkspaceCount : copy.fieldTargetEndpointMissing}</dd>
              </div>
            </dl>

            <section className="adapter-list">
              <div>
                <dt>{copy.fieldTargetListTargetTimeline}</dt>
                {selectedTarget ? (
                  <dd>{selectedTarget.displayName} · 最近 {targetTimeline.length} 筆紀錄</dd>
                ) : (
                  <dd>{copy.fieldTargetListTimelineNoSelection}</dd>
                )}
              </div>
              {targetTimeline.length > 0 ? (
                targetTimeline.map((entry) => (
                  <div key={entry.id}>
                    <dt>
                      {entry.eventType} · {entry.createdAt}
                    </dt>
                    <dd>{entry.summary}</dd>
                    <dd>{copy.fieldTargetListTimelineSource}：{entry.source}</dd>
                    {entry.kind === "dispatch" ? (
                      <dd>
                        {entry.allowed ? copy.targetRegistryFieldEnabled : copy.targetRegistryFieldDisabled} · {entry.decision}
                        {entry.category ? ` · ${entry.category}` : ""}
                      </dd>
                    ) : null}
                    {entry.kind === "audit" ? <dd>action：{entry.action}</dd> : null}
                    {entry.command ? <dd>command：{entry.command}</dd> : null}
                    {entry.state ? <dd>state：{entry.state}</dd> : null}
                    {entry.transport ? <dd>transport：{entry.transport}</dd> : null}
                    {entry.lastProbeResult ? <dd>{copy.fieldProbe}：{entry.lastProbeResult}</dd> : null}
                    {entry.lastProbeHost ? <dd>{copy.fieldProbeEndpoint}：{entry.lastProbeHost}{entry.lastProbePort ? `:${entry.lastProbePort}` : ""}</dd> : null}
                    {typeof entry.lastProbeLatencyMs === "number" ? <dd>{copy.fieldProbeLatency}：{entry.lastProbeLatencyMs}ms</dd> : null}
                    {entry.lastProbeError ? <dd>{copy.fieldProbeError}：{entry.lastProbeError}</dd> : null}
                    {entry.credentialSource ? <dd>{copy.fieldRemoteDesktopCredentialSource}：{entry.credentialSource}</dd> : null}
                    {entry.credentialSeedState ? <dd>{copy.fieldRemoteDesktopCredentialSeedState}：{entry.credentialSeedState}</dd> : null}
                    {entry.credentialTarget ? <dd>credential target：{entry.credentialTarget}</dd> : null}
                    {entry.lastCommand ? <dd>{copy.fieldSshSessionLastCommandPrefix}{entry.lastCommand}</dd> : null}
                    {typeof entry.lastExitCode === "number" ? <dd>{copy.fieldSshSessionExitPrefix}{entry.lastExitCode}</dd> : null}
                    {entry.clientLaunchState ? <dd>{copy.fieldRemoteDesktopClientLaunchState}：{entry.clientLaunchState}</dd> : null}
                    {entry.clientLaunchCommand ? <dd>{copy.fieldRemoteDesktopClientLaunchCommand}：{entry.clientLaunchCommand}</dd> : null}
                    {entry.activeWindow ? <dd>{copy.fieldRemoteDesktopActiveWindow}：{entry.activeWindow}</dd> : null}
                  </div>
                ))
              ) : (
                <div>
                  <dt>{copy.fieldTargetListTargetTimeline}</dt>
                  <dd>{copy.fieldTargetListTimelineNoRecords}</dd>
                </div>
              )}
            </section>

            <section className="adapter-list">
              <div className="panel-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => void loadTargetAuditReport(selectedTarget ?? draftTarget)}
                >
                  {copy.targetRegistryFieldAuditReportRefreshButton}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => void copyTargetAuditReport(selectedTarget ?? draftTarget)}
                >
                  {copy.targetRegistryFieldAuditReportCopyButton}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => downloadTargetAuditReport(selectedTarget ?? draftTarget)}
                >
                  {copy.targetRegistryFieldAuditReportDownloadButton}
                </button>
              </div>
              <div>
                <dt>{copy.targetRegistryFieldAuditReportTitle}</dt>
                <dd>{copy.targetRegistryTargetListAuditReportHint}</dd>
              </div>
              <pre className="target-audit-report-preview">{targetAuditReport || copy.targetRegistryTargetListAuditReportNoRecords}</pre>
            </section>

            <section className="adapter-list">
              <div className="panel-actions">
                <button
                  className={timelineViewMode === "target" ? "primary-button" : "secondary-button"}
                  type="button"
                  onClick={() => setTimelineViewMode("target")}
                >
                  {copy.fieldTargetListTargetTimeline}
                </button>
                <button
                  className={timelineViewMode === "global" ? "primary-button" : "secondary-button"}
                  type="button"
                  onClick={() => setTimelineViewMode("global")}
                >
                  {copy.fieldTargetListGlobalDispatchLog}
                </button>
              </div>
              {visibleDispatchRecords.map((record) => (
                <div key={record.id}>
                  <dt>
                    {record.targetName} · {record.category}
                  </dt>
                  <dd>
                    {record.decision.allowed ? "allow" : "block"} · {dispatchStatusLabel(record.decision)} · {record.decision.reason}
                  </dd>
                  {record.command ? <dd>command：{record.command}</dd> : null}
                </div>
              ))}
              {visibleDispatchRecords.length === 0 ? <div><dt>{copy.targetRegistryFieldDispatchLogTitle}</dt><dd>{copy.fieldTargetListTimelineEmpty}</dd></div> : null}
            </section>
          </section>
        </section>

        {message ? <p className="panel-success">{message}</p> : null}
        {error ? <p className="panel-error">{error}</p> : null}
      </section>
    </div>
  );
}

function draftSummaryReady(summary: string): boolean {
  return summary.trim().length > 0;
}
