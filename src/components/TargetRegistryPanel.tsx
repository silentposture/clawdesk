import { CircleAlert, CircleCheck, Plus, RefreshCw, Save, Send, Server, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  applyTargetConnectionAction,
  cloneTargetRegistry,
  createTargetDispatchRecord,
  createTargetProfile,
  defaultTargetRegistry,
  defaultTargetConnection,
  decideTargetDispatch,
  summarizeTargetProfile,
  summarizeTargetConnectionProfile,
  summarizeTargetRegistry,
  targetConnectionReadinessIssues,
  upsertTarget,
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
} from "../lib/targets";
import { useI18n } from "../lib/i18n";

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

interface TargetTimelineEntry {
  id: string;
  kind: "dispatch" | "session";
  targetId: string;
  targetName: string;
  createdAt: string;
  summary: string;
  source: string;
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

type RemoteDesktopSessionAction = "observe_screen" | "request_control" | "release_control" | "refresh" | "launch_client";
type SshTerminalSessionAction = "open_session" | "run_command" | "close_session" | "refresh";

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
    clientLaunchState: session?.clientLaunchState ?? base.clientLaunchState,
    clientLaunchCommand: session?.clientLaunchCommand ?? base.clientLaunchCommand,
    clientLaunchAt: session?.clientLaunchAt ?? base.clientLaunchAt,
    clientLaunchPid: session?.clientLaunchPid ?? base.clientLaunchPid,
    clientLaunchError: session?.clientLaunchError ?? base.clientLaunchError,
    launchHistory: Array.isArray(session?.launchHistory) ? [...session.launchHistory] : base.launchHistory,
  };
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
  const [remoteDesktopSession, setRemoteDesktopSession] = useState<RemoteDesktopSessionState>();
  const [remoteDesktopBusy, setRemoteDesktopBusy] = useState(false);
  const remoteDesktopSessionRequestTokenRef = useRef(0);
  const [sshTerminalSession, setSshTerminalSession] = useState<SshTerminalSessionState>();
  const [sshTerminalBusy, setSshTerminalBusy] = useState(false);
  const sshTerminalSessionRequestTokenRef = useRef(0);
  const [sshPrivateKeyDraft, setSshPrivateKeyDraft] = useState("");
  const [sshTerminalCommandDraft, setSshTerminalCommandDraft] = useState("git status");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  const summary = useMemo(() => summarizeTargetRegistry(registry), [registry]);
  const selectedTarget = useMemo(() => registry.targets.find((target) => target.id === selectedTargetId), [registry, selectedTargetId]);
  const draftTarget = useMemo(() => buildTargetFromDraft(draft), [draft]);
  const draftIsSaved = Boolean(selectedTarget && selectedTarget.id === draftTarget.id);
  const connectionIssues = targetConnectionReadinessIssues(draftTarget);
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
      setMessage("已使用本機預設 target 登錄。");
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
      setMessage("已讀取 gateway target registry。");
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
      setError("無法讀取 gateway 的 target registry，已切回本機預設清單。");
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
          targetId: record.targetId,
          targetName: record.targetName,
          createdAt: record.createdAt,
          summary: record.summary,
          source: "local-dispatch-log",
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
    setMessage(`已建立 ${defaultDisplayNameForKind(kind)} 的草稿。`);
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
      setMessage(`${statusMessage}（僅保留本機狀態，gateway 儲存失敗）`);
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

  async function runConnectionAction(action: TargetConnectionAction) {
    const currentTarget = draftTarget;
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
    setMessage(`已產生 ${snapshot.target.displayName} 的派發預覽。`);
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
      setError("派發預覽已在本機產生，但 gateway 回傳失敗。");
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
        setMessage(`已建立 ${snapshot.record.targetName} 的派發紀錄。`);
        setError(undefined);
        return;
      } catch {
        setMessage(`已建立本機派發紀錄，但 gateway 儲存失敗。`);
      }
    }

    setDispatches((current) => [snapshot.record, ...current].slice(0, 100));
    setMessage(`已建立 ${snapshot.record.targetName} 的派發紀錄。`);
    setError(undefined);
  }

  async function executeSafeDispatch() {
    const snapshot = createPreviewSnapshot(draftTarget);
    setPreview(snapshot);
    setError(undefined);
    clearSensitiveDraftState();

    if (snapshot.request.category !== "execute_safe") {
      setExecution(undefined);
      setError("只有 execute_safe 分類才能直接執行。");
      return;
    }

    if (!snapshot.decision.allowed) {
      setExecution(undefined);
      setError(snapshot.decision.reason);
      return;
    }

    if (!gatewayBaseUrl) {
      setExecution(undefined);
      setError("需要 gateway 才能執行實際連線。");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`${gatewayBaseUrl}/targets/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preview: snapshot, record: snapshot.record }),
      });
      if (!response.ok) throw new Error("bad response");
      const payload = (await response.json()) as {
        allowed?: boolean;
        reason?: string;
        execution?: TargetExecutionState;
        record?: TargetDispatchRecord;
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
      setSelectedTargetId(nextTarget.id);
      setDraft(draftFromTarget(nextTarget));
      setExecution(payload.execution);
      clearSensitiveDraftState();
      void loadTargetTimeline(nextTarget);
      setMessage(`${payload.reason ?? "命令已執行"} · ${payload.execution?.mode ?? "unknown"}`);
    } catch {
      setExecution(undefined);
      setError("安全命令執行失敗，請先確認 ssh / PowerShell 可用且 target 已正確配對。");
    } finally {
      setBusy(false);
    }
  }

  async function issueSshCredentialRef() {
    if (!gatewayBaseUrl) {
      setError("需要 gateway 才能發行 SSH credential ref。");
      return;
    }

    if (draft.kind !== "ssh-terminal") {
      setError("只有 SSH target 才能發行 credential ref。");
      return;
    }

    const privateKey = sshPrivateKeyDraft.trim();
    if (!privateKey) {
      setError("請先貼上 SSH private key。");
      return;
    }

    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch(`${gatewayBaseUrl}/targets/credential-ref/issue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetId: draftTarget.id,
          kind: "ssh-private-key",
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
        throw new Error(payload.error || "SSH credential ref issuance failed");
      }
      if (!payload.credentialRef) {
        throw new Error("SSH credential ref was not returned by the gateway.");
      }

      setDraft((current) => ({
        ...current,
        credentialMode: "secret-ref",
        credentialRef: payload.credentialRef ?? current.credentialRef,
      }));
      setSshPrivateKeyDraft("");
      setMessage(`已發行 SSH credential ref ${payload.credentialRef}${payload.maskedSecret ? ` · ${payload.maskedSecret}` : ""}`);
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "SSH credential ref issuance failed");
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
      setError("只有 SSH target 才能操作 session。");
      return;
    }

    if (gatewayBaseUrl && !draftIsSaved) {
      setError("請先儲存這個 target，再與 gateway 互動。");
      return;
    }

    if (!gatewayBaseUrl) {
      const now = new Date().toISOString();
      const currentSession = sshTerminalSession ?? createSshTerminalSessionPreview(currentTarget);

      if (action === "run_command") {
        const command = sshTerminalCommandDraft.trim();
        if (!command) {
          setError("請先輸入 SSH command。");
          return;
        }
        if (currentSession.state !== "connected") {
          setError("請先開啟 SSH terminal session。");
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
        setMessage("已在本機預覽中開啟 SSH session。");
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
        setMessage("已在本機預覽中關閉 SSH session。");
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
      setMessage("已在本機預覽中重新整理 SSH session。");
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
      setError("只有遠端桌面 target 才能操作 session。");
      return;
    }

    if (gatewayBaseUrl && !draftIsSaved) {
      setError("請先儲存遠端桌面 target，再與 gateway 互動。");
      return;
    }

    if (!gatewayBaseUrl) {
      const now = new Date().toISOString();
      if (action === "request_control") {
        setError("需要 gateway 才能請求遠端桌面控制。");
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
          : action === "launch_client"
            ? createRemoteDesktopSessionPreview(currentTarget, {
                ...currentSession,
                state: currentTarget.connection.sessionMode === "control" ? "controlling" : "observing",
                mode: currentTarget.connection.sessionMode,
                transport: "local-native-rdp-preview",
                clientLaunchState: "dry-run",
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
                    dryRun: true,
                  },
                ],
                lastUpdatedAt: now,
                notes: [...currentSession.notes.slice(-4), "Native RDP client launch recorded in local preview."],
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
            <h2 id="target-registry-title">Target Registry</h2>
            <p>把 local-shell、SSH 終端機與遠端桌面收斂成同一個安全派發面板。</p>
          </div>
          <div className="panel-actions">
            <button className="secondary-button" type="button" onClick={loadTargets} disabled={busy}>
              <RefreshCw size={16} />
              重新讀取
            </button>
            <button className="icon-button" type="button" aria-label={t("common.close")} onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </header>

        <section className="comparison-summary">
          <article className="commercial-card">
            <Server size={23} />
            <h3>總目標數 {summary.totalTargets}</h3>
            <p>預設目標：{summary.defaultTargetName ?? "未設定"}</p>
          </article>
          <article className="commercial-card">
            <CircleCheck size={23} />
            <h3>就緒 {summary.readyTargets} · 已配對 {summary.pairedTargets}</h3>
            <p>只有就緒且已配對的 target 才會進入安全派發選擇。</p>
          </article>
          <article className="commercial-card">
            <CircleAlert size={23} />
            <h3>dispatch log {dispatches.length}</h3>
            <p>先預覽，再送出紀錄；高風險或未配對狀態會被 contract 擋下。</p>
          </article>
        </section>

        <section className="target-registry-layout">
          <section className="commercial-card">
            <div className="panel-actions">
              <button className="secondary-button" type="button" onClick={() => startDraft("local-shell")} disabled={busy}>
                <Plus size={16} />
                新增本機
              </button>
              <button className="secondary-button" type="button" onClick={() => startDraft("ssh-terminal")} disabled={busy}>
                <Plus size={16} />
                新增 SSH
              </button>
              <button className="secondary-button" type="button" onClick={() => startDraft("remote-desktop")} disabled={busy}>
                <Plus size={16} />
                新增遠端桌面
              </button>
              <button className="secondary-button" type="button" onClick={() => startDraft("mock")} disabled={busy}>
                <Plus size={16} />
                新增 Mock
              </button>
            </div>
            <div className="target-list">
              {registry.targets.map((target) => {
                const active = selectedTargetId === target.id;
                return (
                  <button key={target.id} type="button" className={active ? "active" : ""} onClick={() => selectExistingTarget(target)}>
                    <strong>{target.displayName}</strong>
                    <small>{summarizeTargetProfile(target)}</small>
                    <small>{summarizeTargetConnectionProfile(target)}</small>
                    <small>{target.adapters[0]?.endpoint ?? "未設定 endpoint"}</small>
                    <small>
                      {target.id}
                      {registry.defaultTargetId === target.id ? " · 預設" : ""}
                    </small>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="commercial-card target-draft-form">
            <div>
              <h3>{draftIsSaved ? "目標設定" : "新目標草稿"}</h3>
              <p>這裡定義每台電腦的連線類型、配對狀態與可授權範圍。</p>
            </div>
            <label>
              <span>Target ID</span>
              <input value={draft.id} onChange={(event) => setDraft((current) => ({ ...current, id: event.target.value }))} />
            </label>
            <label>
              <span>顯示名稱</span>
              <input value={draft.displayName} onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))} />
            </label>
            <label>
              <span>類型</span>
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
              <span>Endpoint</span>
              <input value={draft.endpoint} onChange={(event) => setDraft((current) => ({ ...current, endpoint: event.target.value }))} />
            </label>
            <label>
              <span>連線狀態</span>
              <select value={draft.state} onChange={(event) => setDraft((current) => ({ ...current, state: event.target.value as TargetConnectionState }))}>
                {stateOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="target-toggle">
              <span>已配對</span>
              <input type="checkbox" checked={draft.paired} onChange={(event) => setDraft((current) => ({ ...current, paired: event.target.checked }))} />
            </label>
            <label className="target-toggle">
              <span>已驗證認證</span>
              <input type="checkbox" checked={draft.authenticated} onChange={(event) => setDraft((current) => ({ ...current, authenticated: event.target.checked }))} />
            </label>
            <label className="target-toggle">
              <span>SSH host key verified</span>
              <input type="checkbox" checked={draft.hostKeyVerified} onChange={(event) => setDraft((current) => ({ ...current, hostKeyVerified: event.target.checked }))} />
            </label>
            <label>
              <span>Trusted workspaces</span>
              <textarea
                value={draft.trustedWorkspaces}
                onChange={(event) => setDraft((current) => ({ ...current, trustedWorkspaces: event.target.value }))}
                placeholder="每行一個工作區，或用逗號分隔"
              />
              <small>目前解析出 {trustedWorkspaceCount} 個 trusted workspace。</small>
            </label>
            <label>
              <span>Connection username</span>
              <input value={draft.username} onChange={(event) => setDraft((current) => ({ ...current, username: event.target.value }))} placeholder="SSH / RDP 登入帳號" />
            </label>
            <label>
              <span>Connection port</span>
              <input
                inputMode="numeric"
                value={draft.port}
                onChange={(event) => setDraft((current) => ({ ...current, port: event.target.value }))}
                placeholder={draft.kind === "ssh-terminal" ? "22" : draft.kind === "remote-desktop" ? "3389" : "可留空"}
              />
            </label>
            <label>
              <span>Credential mode</span>
              <select value={draft.credentialMode} onChange={(event) => setDraft((current) => ({ ...current, credentialMode: event.target.value as TargetCredentialMode }))}>
                <option value="none">none</option>
                <option value="secret-ref">secret-ref</option>
                <option value="ssh-agent">ssh-agent</option>
                <option value="platform-managed">platform-managed</option>
              </select>
            </label>
            <label>
              <span>Credential ref</span>
              <input
                value={draft.credentialRef}
                onChange={(event) => setDraft((current) => ({ ...current, credentialRef: event.target.value }))}
                placeholder="例如 ssh-builder-secret"
              />
            </label>
            {draft.kind === "ssh-terminal" ? (
              <label>
                <span>SSH private key</span>
                <textarea
                  value={sshPrivateKeyDraft}
                  onChange={(event) => setSshPrivateKeyDraft(event.target.value)}
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                />
                <small>只會發行成 gateway-managed credential ref，不會寫入 repo 或 debug bundle。</small>
              </label>
            ) : null}
            <label>
              <span>SSH known host key</span>
              <input
                value={draft.knownHostFingerprint}
                onChange={(event) => setDraft((current) => ({ ...current, knownHostFingerprint: event.target.value }))}
                placeholder="ssh-ed25519 AAAA..."
              />
              {draft.kind === "ssh-terminal" ? <small>驗證時會寫入 gateway 管理的 known_hosts，不會顯示實際路徑。</small> : null}
            </label>
            <label>
              <span>Session mode</span>
              <select value={draft.sessionMode} onChange={(event) => setDraft((current) => ({ ...current, sessionMode: event.target.value as TargetSessionMode }))}>
                <option value="observe">observe</option>
                <option value="control">control</option>
              </select>
            </label>
            <label>
              <span>Connection note</span>
              <textarea
                value={draft.note}
                onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
                placeholder="例如：僅允許登入後執行 git status / collect-debug-bundle"
              />
            </label>
            <section className="target-connection-summary">
              <div>
                <strong>配對狀態</strong>
                <span>{draft.paired ? "paired" : "not paired"}</span>
              </div>
              <div>
                <strong>認證</strong>
                <span>{draft.authenticated ? "authenticated" : "not authenticated"}</span>
              </div>
              <div>
                <strong>SSH host key</strong>
                <span>{draft.hostKeyVerified ? "verified" : "not verified"}</span>
              </div>
              <div>
                <strong>Last seen</strong>
                <span>{formatLastSeenAt(selectedTarget?.lastSeenAt)}</span>
              </div>
              <div>
                <strong>Connection profile</strong>
                <span>{summarizeTargetConnectionProfile(draftTarget)}</span>
              </div>
            </section>
            {connectionIssues.length > 0 ? (
              <section className="target-connection-issues">
                {connectionIssues.map((issue) => (
                  <div key={issue}>{issue}</div>
                ))}
              </section>
            ) : null}
            {draft.kind === "remote-desktop" ? (
              <section className="mcp-preview target-remote-desktop-session">
                <span>遠端桌面 Session</span>
                <strong>{remoteDesktopView?.targetName ?? draft.displayName}</strong>
                <p>{remoteDesktopView?.screenSummary ?? "尚未讀取遠端桌面 session，請先按觀察或重新整理。"}</p>
                <small>summary：{remoteDesktopView?.sessionSummary ?? "未建立"}</small>
                <small>
                  state：{remoteDesktopView?.state ?? "idle"} · mode：{remoteDesktopView?.mode ?? draft.sessionMode}
                </small>
                <small>permission request：{remoteDesktopView?.permissionRequestId ?? "未送出"}</small>
                <small>transport：{remoteDesktopView?.transport ?? "未設定"}</small>
                <small>active window：{remoteDesktopView?.activeWindow ?? "未取得"}</small>
                <small>
                  visible windows：{remoteDesktopView?.visibleWindows?.length ? remoteDesktopView.visibleWindows.length : 0}
                </small>
                <small>client launch：{remoteDesktopView?.clientLaunchState ?? "idle"}</small>
                <small>launch command：{remoteDesktopView?.clientLaunchCommand ?? "未啟動"}</small>
                <small>launch pid：{remoteDesktopView?.clientLaunchPid ?? "n/a"}</small>
                <small>last observed：{formatLastSeenAt(remoteDesktopView?.lastObservedAt ?? remoteDesktopView?.lastUpdatedAt)}</small>
                {latestRemoteDesktopNote ? <small>latest note：{latestRemoteDesktopNote}</small> : null}
                {remoteDesktopActionBlocked ? <small>請先儲存這個 target，再與 gateway 互動。</small> : null}
                {remoteDesktopView?.clientLaunchError ? <small>launch error：{remoteDesktopView.clientLaunchError}</small> : null}
              </section>
            ) : null}
            {draft.kind === "ssh-terminal" ? (
              <section className="mcp-preview target-ssh-terminal-session">
                <span>SSH Terminal Session</span>
                <strong>{sshTerminalView?.targetName ?? draft.displayName}</strong>
                <p>
                  {sshTerminalView?.state === "connected"
                    ? "SSH session 已開啟，可送出 allowlisted command。"
                    : sshTerminalView?.state === "closed"
                      ? "SSH session 已關閉，必要時可重新開啟。"
                    : "尚未開啟 SSH session，請先按開啟 Session。"}
                </p>
                <small>summary：{sshTerminalView?.sessionSummary ?? "未建立"}</small>
                <small>state：{sshTerminalView?.state ?? "idle"} · mode：{sshTerminalView?.mode ?? draft.sessionMode}</small>
                <small>prompt：{sshTerminalView?.prompt ?? "未建立"}</small>
                <small>cwd：{sshTerminalView?.currentDirectory ?? "~"} · last exit：{sshTerminalView?.lastExitCode ?? "未執行"}</small>
                <small>transport：{sshTerminalView?.transport ?? "未設定"}</small>
                <small>last command：{sshTerminalView?.lastCommand ?? "未執行"}</small>
                <small>last observed：{formatLastSeenAt(sshTerminalView?.lastObservedAt ?? sshTerminalView?.lastUpdatedAt)}</small>
                {latestSshTerminalNote ? <small>latest note：{latestSshTerminalNote}</small> : null}
                {sshTerminalActionBlocked ? <small>請先儲存這個 target，再與 gateway 互動。</small> : null}
                <label className="ssh-terminal-command">
                  <span>SSH command</span>
                  <textarea
                    value={sshTerminalCommandDraft}
                    onChange={(event) => setSshTerminalCommandDraft(event.target.value)}
                    placeholder="git status"
                  />
                  <small>只會透過 safe-dispatch 與 gateway-managed SSH session contract 執行 allowlisted 命令。</small>
                </label>
                <section className="ssh-terminal-transcript">
                  <span>Transcript</span>
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
                      <p>尚未建立 transcript。</p>
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
                    觀察螢幕
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void mutateRemoteDesktopSession("request_control")}
                    disabled={busy || remoteDesktopBusy || remoteDesktopActionBlocked || !gatewayBaseUrl}
                  >
                    <Send size={16} />
                    請求控制
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void mutateRemoteDesktopSession("release_control")}
                    disabled={busy || remoteDesktopBusy || remoteDesktopActionBlocked}
                  >
                    釋放控制
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void mutateRemoteDesktopSession("refresh")}
                    disabled={busy || remoteDesktopBusy || remoteDesktopActionBlocked}
                  >
                    <RefreshCw size={16} />
                    重新整理 Session
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => void mutateRemoteDesktopSession("launch_client")}
                    disabled={busy || remoteDesktopBusy || remoteDesktopActionBlocked}
                  >
                    <Send size={16} />
                    啟動 RDP Client
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
                    開啟 Session
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => void mutateSshTerminalSession("run_command")}
                    disabled={busy || sshTerminalBusy || sshTerminalActionBlocked || connectionIssues.length > 0 || !sshTerminalCommandDraft.trim()}
                  >
                    <Send size={16} />
                    送出命令
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void mutateSshTerminalSession("refresh")}
                    disabled={busy || sshTerminalBusy || sshTerminalActionBlocked || connectionIssues.length > 0}
                  >
                    <RefreshCw size={16} />
                    重新整理
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void mutateSshTerminalSession("close_session")}
                    disabled={busy || sshTerminalBusy || sshTerminalActionBlocked || connectionIssues.length > 0}
                  >
                    關閉 Session
                  </button>
                </>
              ) : null}
              {draft.kind === "ssh-terminal" ? (
                <button className="secondary-button" type="button" onClick={() => void issueSshCredentialRef()} disabled={busy || !sshPrivateKeyDraft.trim()}>
                  <Send size={16} />
                  發行 SSH credential ref
                </button>
              ) : null}
              <button className="secondary-button" type="button" onClick={() => void runConnectionAction("pair")} disabled={busy}>
                Pair
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => void runConnectionAction("verify_host_key")}
                disabled={busy || draft.kind !== "ssh-terminal"}
              >
                Verify host key
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => void runConnectionAction("connect")}
                disabled={busy || (draft.kind !== "local-shell" && connectionIssues.length > 0)}
              >
                Connect
              </button>
              <button className="secondary-button" type="button" onClick={() => void runConnectionAction("disconnect")} disabled={busy}>
                Disconnect
              </button>
              <button className="secondary-button" type="button" onClick={() => void runConnectionAction("refresh")} disabled={busy}>
                Refresh
              </button>
            </div>
            <div className="panel-actions">
              <button className="primary-button" type="button" onClick={() => void saveDraft(false)} disabled={busy}>
                <Save size={16} />
                儲存目標
              </button>
              <button className="secondary-button" type="button" onClick={() => void saveDraft(true)} disabled={busy}>
                <Save size={16} />
                儲存並設為預設
              </button>
            </div>
            <small>
              目前狀態：{selectedTarget ? summarizeTargetProfile(selectedTarget) : "草稿尚未儲存"} · {draftIsSaved ? "已對齊 registry" : "編輯中"}
            </small>
          </section>

          <section className="commercial-card target-dispatch-form">
            <div>
              <h3>派發預覽</h3>
              <p>先做本地判斷，再把安全決策送到 gateway 當成 audit record。</p>
            </div>
            <label>
              <span>分類</span>
              <select value={dispatchCategory} onChange={(event) => setDispatchCategory(event.target.value as TargetDispatchCategory)}>
                {dispatchCategoryOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>摘要</span>
              <textarea value={dispatchSummary} onChange={(event) => setDispatchSummary(event.target.value)} placeholder="說明這次要做什麼" />
            </label>
            <label>
              <span>命令 / 動作</span>
              <textarea
                value={dispatchCommand}
                onChange={(event) => setDispatchCommand(event.target.value)}
                placeholder="例如 git status / collect-debug-bundle / request-human-approval"
              />
            </label>
            <div className="panel-actions">
              <button className="primary-button" type="button" onClick={() => void previewDispatch()} disabled={busy || !draftTarget.id.trim() || !dispatchSummary.trim()}>
                <Server size={16} />
                預覽
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => void executeSafeDispatch()}
                disabled={busy || !preview || preview.request.category !== "execute_safe" || !preview.decision.allowed}
              >
                <Send size={16} />
                審批並執行
              </button>
              <button className="secondary-button" type="button" onClick={() => void queueDispatch()} disabled={busy || !draftSummaryReady(dispatchSummary)}>
                <Send size={16} />
                建立紀錄
              </button>
            </div>

            {preview ? (
              <div className="mcp-preview">
                <span>最新預覽</span>
                <strong>{preview.target.displayName}</strong>
                <p>{preview.request.summary}</p>
                <small>
                  {preview.request.category} · {dispatchStatusLabel(preview.decision)} · {preview.decision.reason}
                </small>
                <small>adapter：{preview.decision.adapterKind ?? "unknown"}{preview.decision.commandSafety ? ` · command=${preview.decision.commandSafety}` : ""}</small>
              </div>
            ) : (
              <div className="mcp-empty">尚未產生預覽，請先按「預覽」。</div>
            )}

            {execution ? (
              <div className="mcp-preview target-execution-result">
                <span>最近執行結果</span>
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

            <dl className="status-list">
              <div>
                <dt>目標</dt>
                <dd>{draftTarget.displayName} · {draftTarget.kind} · {draftTarget.state}</dd>
              </div>
              <div>
                <dt>安全狀態</dt>
                <dd>
                  {preview ? (
                    <span className={`risk-pill ${dispatchStatusClass(preview.decision)}`}>{dispatchStatusLabel(preview.decision)}</span>
                  ) : (
                    "等待預覽"
                  )}
                </dd>
              </div>
              <div>
                <dt>trusted workspaces</dt>
                <dd>{trustedWorkspaceCount > 0 ? trustedWorkspaceCount : "未設定"}</dd>
              </div>
            </dl>

            <section className="adapter-list">
              <div>
                <dt>target timeline</dt>
                {selectedTarget ? (
                  <dd>{selectedTarget.displayName} · 最近 {targetTimeline.length} 筆紀錄</dd>
                ) : (
                  <dd>尚未選取 target。</dd>
                )}
              </div>
              {targetTimeline.length > 0 ? (
                targetTimeline.map((entry) => (
                  <div key={entry.id}>
                    <dt>
                      {entry.kind} · {entry.createdAt}
                    </dt>
                    <dd>{entry.summary}</dd>
                    <dd>source：{entry.source}</dd>
                    {entry.kind === "dispatch" ? (
                      <dd>
                        {entry.allowed ? "allow" : "block"} · {entry.decision}
                        {entry.category ? ` · ${entry.category}` : ""}
                      </dd>
                    ) : null}
                    {entry.command ? <dd>command：{entry.command}</dd> : null}
                    {entry.state ? <dd>state：{entry.state}</dd> : null}
                    {entry.transport ? <dd>transport：{entry.transport}</dd> : null}
                    {entry.lastCommand ? <dd>last command：{entry.lastCommand}</dd> : null}
                    {typeof entry.lastExitCode === "number" ? <dd>last exit：{entry.lastExitCode}</dd> : null}
                    {entry.clientLaunchState ? <dd>client launch：{entry.clientLaunchState}</dd> : null}
                    {entry.clientLaunchCommand ? <dd>launch command：{entry.clientLaunchCommand}</dd> : null}
                    {entry.activeWindow ? <dd>active window：{entry.activeWindow}</dd> : null}
                  </div>
                ))
              ) : (
                <div>
                  <dt>target timeline</dt>
                  <dd>尚未有這台 target 的派發紀錄。</dd>
                </div>
              )}
            </section>

            <section className="adapter-list">
              {dispatches.slice(0, 6).map((record) => (
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
              {dispatches.length === 0 ? <div><dt>dispatch log</dt><dd>尚未有派發紀錄。</dd></div> : null}
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
