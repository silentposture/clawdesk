export type TargetKind = "local-shell" | "ssh-terminal" | "remote-desktop" | "mock";
export type TargetConnectionState = "offline" | "connecting" | "ready" | "degraded";
export type TargetDispatchCategory = "observe" | "inspect" | "debug" | "execute_safe" | "request_approval";
export type TargetConnectionAction = "enroll_host" | "attest" | "heartbeat" | "pair" | "verify_host_key" | "probe" | "connect" | "disconnect" | "refresh";
export type TargetCredentialMode = "none" | "secret-ref" | "ssh-agent" | "platform-managed";
export type TargetSessionMode = "observe" | "control";
export type ShellCommandSafety = "allowlisted" | "needs-review" | "blocked";

export interface TargetAdapter {
  kind: TargetKind;
  endpoint: string;
  authenticated: boolean;
  hostKeyVerified: boolean;
  supportsTerminal: boolean;
  supportsScreen: boolean;
  supportsClipboard: boolean;
  supportsFileTransfer: boolean;
}

export interface TargetConnectionProfile {
  username?: string;
  port?: number;
  credentialMode: TargetCredentialMode;
  credentialRef?: string;
  knownHostFingerprint?: string;
  sessionMode: TargetSessionMode;
  note?: string;
  hostBridge?: TargetHostBridgeProfile;
  lastProbeAt?: string;
  lastProbeResult?: "reachable" | "unreachable" | "error";
  lastProbeHost?: string;
  lastProbePort?: number;
  lastProbeLatencyMs?: number;
  lastProbeError?: string;
}

export interface TargetHostBridgeProfile {
  state: "unregistered" | "registered" | "stale";
  bridgeId?: string;
  hostName?: string;
  bridgeVersion?: string;
  deviceId?: string;
  installId?: string;
  platform?: string;
  registeredAt?: string;
  attestedAt?: string;
  lastSeenAt?: string;
  lastError?: string;
  lastAttestationError?: string;
}

export interface TargetProfile {
  id: string;
  displayName: string;
  kind: TargetKind;
  state: TargetConnectionState;
  paired: boolean;
  trustedWorkspaces: string[];
  adapters: TargetAdapter[];
  connection: TargetConnectionProfile;
  lastSeenAt?: string;
}

export interface TargetRegistry {
  targets: TargetProfile[];
  defaultTargetId?: string;
  targetGroups?: TargetGroup[];
}

export interface TargetGroup {
  id: string;
  name: string;
  description?: string;
  targetIds: string[];
}

export interface TargetRegistrySummary {
  totalTargets: number;
  readyTargets: number;
  pairedTargets: number;
  defaultTargetId?: string;
  defaultTargetName?: string;
  targetGroupCount?: number;
}

export interface TargetDispatchRequest {
  category: TargetDispatchCategory;
  summary: string;
  command?: string;
}

export interface TargetDispatchDecision {
  allowed: boolean;
  requiresApproval: boolean;
  reason: string;
  adapterKind?: TargetKind;
  commandSafety?: ShellCommandSafety;
}

export interface TargetDispatchRecord {
  id: string;
  targetId: string;
  targetName: string;
  category: TargetDispatchCategory;
  summary: string;
  command?: string;
  decision: TargetDispatchDecision;
  createdAt: string;
}

export interface TargetConnectionResult {
  allowed: boolean;
  reason: string;
  action: TargetConnectionAction;
  target: TargetProfile;
}

export interface TargetConnectionReadinessCheck {
  key: string;
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  required: boolean;
}

export interface TargetConnectionReadinessReport {
  targetId: string;
  targetName: string;
  kind: TargetKind;
  state: TargetConnectionState;
  readyToConnect: boolean;
  lastProbeResult?: TargetConnectionProfile["lastProbeResult"];
  lastProbeAt?: string;
  nextAction:
    | "enroll_host"
    | "attest"
    | "heartbeat"
    | "pair"
    | "probe"
    | "verify_host_key"
    | "connect"
    | "refresh"
    | "none";
  checks: TargetConnectionReadinessCheck[];
}

export interface TargetProfileInput {
  id: string;
  displayName: string;
  kind: TargetKind;
  endpoint: string;
  state?: TargetConnectionState;
  paired?: boolean;
  trustedWorkspaces?: string[];
  connectionOverrides?: Partial<TargetConnectionProfile>;
  lastSeenAt?: string;
  adapterOverrides?: Partial<TargetAdapter>;
}

const SAFE_COMMAND_PATTERNS = [
  /^ls(\s|$)/i,
  /^dir(\s|$)/i,
  /^pwd(\s|$)/i,
  /^Get-Location(\s|$)/i,
  /^whoami(\s|$)/i,
  /^hostname(\s|$)/i,
  /^git status(\s|$)/i,
  /^git diff(\s|$)/i,
  /^git log(\s|$)/i,
  /^Get-ChildItem(\s|$)/i,
  /^Get-Content(\s|$)/i,
  /^cat(\s|$)/i,
  /^type(\s|$)/i,
] as const;

const BLOCKED_COMMAND_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\bdel\b/i,
  /\brmdir\b/i,
  /\bremove-item\b/i,
  /\bformat\b/i,
  /\bshutdown\b/i,
  /\brestart-computer\b/i,
  /\bstop-process\b/i,
  /\bsudo\b/i,
  /\bchmod\s+777\b/i,
  /\bcurl\b.*\|\s*sh/i,
  /\bwget\b.*\|\s*sh/i,
] as const;

const HOST_BRIDGE_STALE_AFTER_MS = 10 * 60 * 1000;

function getHostBridgeStalenessState(hostBridge?: TargetHostBridgeProfile): "fresh" | "stale" | "missing" {
  if (!hostBridge || hostBridge.state !== "registered") {
    return "missing";
  }

  if (!hostBridge.lastSeenAt) {
    return "fresh";
  }

  const seenAt = new Date(hostBridge.lastSeenAt).getTime();
  if (!Number.isFinite(seenAt)) {
    return "stale";
  }

  return Date.now() - seenAt > HOST_BRIDGE_STALE_AFTER_MS ? "stale" : "fresh";
}

function getHostBridgeAttestationState(hostBridge?: TargetHostBridgeProfile): "fresh" | "missing" {
  if (!hostBridge || hostBridge.state !== "registered") {
    return "missing";
  }

  if (!hostBridge.attestedAt || !hostBridge.deviceId || !hostBridge.installId) {
    return "missing";
  }

  return "fresh";
}

export function defaultTargetConnection(kind: TargetKind): TargetConnectionProfile {
  if (kind === "local-shell" || kind === "mock") {
    return {
      credentialMode: "platform-managed",
      sessionMode: "control",
      hostBridge: {
        state: "registered",
        bridgeId: `${kind}-bridge`,
        hostName: kind === "local-shell" ? "Local Host" : "Mock Host",
        bridgeVersion: "local",
        attestedAt: new Date().toISOString(),
      },
    };
  }

  if (kind === "ssh-terminal") {
    return {
      credentialMode: "none",
      sessionMode: "control",
      port: 22,
      hostBridge: {
        state: "unregistered",
      },
    };
  }

  return {
    credentialMode: "none",
    sessionMode: "observe",
    port: 3389,
    hostBridge: {
      state: "unregistered",
    },
  };
}

export function defaultTargetAdapter(kind: TargetKind, endpoint: string): TargetAdapter {
  if (kind === "local-shell") {
    return {
      kind,
      endpoint,
      authenticated: true,
      hostKeyVerified: true,
      supportsTerminal: true,
      supportsScreen: false,
      supportsClipboard: true,
      supportsFileTransfer: true,
    };
  }

  if (kind === "ssh-terminal") {
    return {
      kind,
      endpoint,
      authenticated: false,
      hostKeyVerified: false,
      supportsTerminal: true,
      supportsScreen: false,
      supportsClipboard: false,
      supportsFileTransfer: true,
    };
  }

  if (kind === "remote-desktop") {
    return {
      kind,
      endpoint,
      authenticated: false,
      hostKeyVerified: false,
      supportsTerminal: false,
      supportsScreen: true,
      supportsClipboard: false,
      supportsFileTransfer: false,
    };
  }

  return {
    kind,
    endpoint,
    authenticated: true,
    hostKeyVerified: true,
    supportsTerminal: true,
    supportsScreen: true,
    supportsClipboard: true,
    supportsFileTransfer: true,
  };
}

export function createTargetProfile(input: TargetProfileInput): TargetProfile {
  const adapter = {
    ...defaultTargetAdapter(input.kind, input.endpoint),
    ...input.adapterOverrides,
    kind: input.kind,
    endpoint: input.endpoint,
  };
  const connection = {
    ...defaultTargetConnection(input.kind),
    ...input.connectionOverrides,
  };

  return {
    id: input.id,
    displayName: input.displayName,
    kind: input.kind,
    state: input.state ?? (input.kind === "local-shell" ? "ready" : "offline"),
    paired: input.paired ?? input.kind === "local-shell",
    trustedWorkspaces: input.trustedWorkspaces ?? [],
    adapters: [adapter],
    connection,
    lastSeenAt: input.lastSeenAt,
  };
}

export function createTargetRegistry(targets: TargetProfile[] = [], defaultTargetId?: string): TargetRegistry {
  return {
    targets: [...targets],
    defaultTargetId: defaultTargetId ?? targets[0]?.id,
    targetGroups: [],
  };
}

export function defaultTargetRegistry(): TargetRegistry {
  const targets = [
    createTargetProfile({
      id: "local-builder",
      displayName: "Local Builder",
      kind: "local-shell",
      endpoint: "local://workspace",
      state: "ready",
      paired: true,
      trustedWorkspaces: ["~/ClawDesk Projects/桌面 GUI"],
    }),
    createTargetProfile({
      id: "builder-ssh",
      displayName: "Builder SSH",
      kind: "ssh-terminal",
      endpoint: "ssh://builder.example.internal",
      state: "offline",
      paired: false,
      adapterOverrides: { authenticated: false, hostKeyVerified: false },
      trustedWorkspaces: ["~/ClawDesk Projects/桌面 GUI"],
    }),
    createTargetProfile({
      id: "ops-rdp",
      displayName: "Ops Remote Desktop",
      kind: "remote-desktop",
      endpoint: "rdp://ops.example.internal",
      state: "offline",
      paired: false,
      adapterOverrides: { authenticated: false },
      trustedWorkspaces: ["~/ClawDesk Projects/桌面 GUI"],
    }),
    createTargetProfile({
      id: "lab-mock",
      displayName: "Lab Mock Target",
      kind: "mock",
      endpoint: "mock://lab",
      state: "degraded",
      paired: true,
      trustedWorkspaces: ["~/ClawDesk Projects/桌面 GUI"],
    }),
  ];

  return {
    ...createTargetRegistry(targets),
    targetGroups: defaultTargetGroups(targets.map((target) => target.id)),
  };
}

export function cloneTargetRegistry(registry: TargetRegistry): TargetRegistry {
  return {
    defaultTargetId: registry.defaultTargetId,
    targetGroups: Array.isArray(registry.targetGroups)
      ? registry.targetGroups.map((group) => ({
          ...group,
          targetIds: [...group.targetIds],
        }))
      : [],
    targets: registry.targets.map((target) => ({
      ...target,
      trustedWorkspaces: [...target.trustedWorkspaces],
      adapters: target.adapters.map((adapter) => ({ ...adapter })),
      connection: { ...target.connection },
    })),
  };
}

export function summarizeTargetRegistry(registry: TargetRegistry): TargetRegistrySummary {
  const defaultTarget = registry.defaultTargetId ? findTarget(registry, registry.defaultTargetId) : undefined;
  return {
    totalTargets: registry.targets.length,
    readyTargets: listReadyTargets(registry).length,
    pairedTargets: registry.targets.filter((target) => target.paired).length,
    defaultTargetId: registry.defaultTargetId,
    defaultTargetName: defaultTarget?.displayName,
    targetGroupCount: Array.isArray(registry.targetGroups) ? registry.targetGroups.length : 0,
  };
}

export function upsertTarget(registry: TargetRegistry, target: TargetProfile): TargetRegistry {
  const targets = registry.targets.filter((item) => item.id !== target.id);
  targets.unshift(target);
  return {
    ...registry,
    targets,
    defaultTargetId: registry.defaultTargetId ?? target.id,
  };
}

export function normalizeTargetGroup(group: TargetGroup, validTargetIds: string[] = []): TargetGroup {
  const targetIds = Array.isArray(group.targetIds)
    ? group.targetIds
        .map((targetId) => (typeof targetId === "string" ? targetId.trim() : ""))
        .filter((targetId) => targetId && (!validTargetIds.length || validTargetIds.includes(targetId)))
    : [];
  const dedupedTargetIds = [...new Set(targetIds)];
  const name = typeof group.name === "string" && group.name.trim() ? group.name.trim() : "未命名群組";
  const description = typeof group.description === "string" && group.description.trim() ? group.description.trim() : undefined;
  const id = typeof group.id === "string" && group.id.trim() ? group.id.trim() : normalizeTargetGroupId(name);
  return {
    id,
    name,
    description,
    targetIds: dedupedTargetIds,
  };
}

export function defaultTargetGroups(targetIds: string[] = []): TargetGroup[] {
  const valid = targetIds.filter(Boolean);
  const allTargets = valid.length > 0 ? valid : ["local-builder", "builder-ssh", "ops-rdp", "lab-mock"];
  return [
    normalizeTargetGroup({
      id: "default-local-ssh",
      name: "Local + SSH",
      description: "本機與 SSH 終端機的日常發配群組。",
      targetIds: ["local-builder", "builder-ssh"],
    }, allTargets),
    normalizeTargetGroup({
      id: "remote-ops",
      name: "Remote Ops",
      description: "遠端桌面與 lab target 的觀察 / 控制群組。",
      targetIds: ["ops-rdp", "lab-mock"],
    }, allTargets),
    normalizeTargetGroup({
      id: "all-targets",
      name: "All Targets",
      description: "全部已註冊 target。",
      targetIds: allTargets,
    }, allTargets),
  ].filter((group) => group.targetIds.length > 0);
}

export function normalizeTargetGroupId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || `group-${Date.now().toString(36)}`;
}

export function findTarget(registry: TargetRegistry, targetId: string): TargetProfile | undefined {
  return registry.targets.find((target) => target.id === targetId);
}

export function findTargetGroup(registry: TargetRegistry, groupId: string): TargetGroup | undefined {
  return Array.isArray(registry.targetGroups) ? registry.targetGroups.find((group) => group.id === groupId) : undefined;
}

export function listTargetsForGroup(registry: TargetRegistry, group: TargetGroup | string): TargetProfile[] {
  const groupId = typeof group === "string" ? group : group.id;
  const nextGroup = typeof group === "string" ? findTargetGroup(registry, group) : group;
  if (!nextGroup) return [];
  const targetIds = new Set(nextGroup.targetIds);
  return registry.targets.filter((target) => targetIds.has(target.id));
}

export function upsertTargetGroup(registry: TargetRegistry, group: TargetGroup): TargetRegistry {
  const targetGroups = Array.isArray(registry.targetGroups) ? registry.targetGroups.slice() : [];
  const nextGroup = normalizeTargetGroup(group, registry.targets.map((target) => target.id));
  const index = targetGroups.findIndex((entry) => entry.id === nextGroup.id);
  if (index >= 0) {
    targetGroups[index] = nextGroup;
  } else {
    targetGroups.unshift(nextGroup);
  }
  return {
    ...registry,
    targetGroups,
  };
}

export function removeTargetGroup(registry: TargetRegistry, groupId: string): TargetRegistry {
  return {
    ...registry,
    targetGroups: Array.isArray(registry.targetGroups) ? registry.targetGroups.filter((group) => group.id !== groupId) : [],
  };
}

export function listReadyTargets(registry: TargetRegistry): TargetProfile[] {
  return registry.targets.filter((target) => target.state === "ready");
}

export function summarizeTargetProfile(target: TargetProfile): string {
  return `${target.displayName} · ${target.kind} · ${target.state}${target.paired ? " · paired" : ""}`;
}

export function summarizeTargetConnectionProfile(target: TargetProfile): string {
  const parts: string[] = [target.connection.credentialMode, target.connection.sessionMode];
  if (target.connection.username) parts.push(target.connection.username);
  if (target.connection.port) parts.push(`port ${target.connection.port}`);
  if (target.connection.hostBridge?.state) {
    parts.push(`bridge ${target.connection.hostBridge.state}`);
    if (target.connection.hostBridge.deviceId) {
      parts.push(`device ${target.connection.hostBridge.deviceId}`);
    }
    if (target.connection.hostBridge.attestedAt) {
      parts.push("attested");
    }
  }
  if (target.connection.credentialMode === "secret-ref" && target.connection.credentialRef) {
    parts.push(`ref ${maskTargetCredentialRef(target.connection.credentialRef)}`);
  }
  if (target.connection.lastProbeResult) {
    const probeLabel =
      target.connection.lastProbeResult === "reachable"
        ? "probe reachable"
        : target.connection.lastProbeResult === "unreachable"
          ? "probe unreachable"
          : "probe error";
    parts.push(probeLabel);
    if (target.connection.lastProbeHost) {
      parts.push(`${target.connection.lastProbeHost}${target.connection.lastProbePort ? `:${target.connection.lastProbePort}` : ""}`);
    }
  }
  return parts.filter(Boolean).join(" · ") || "未設定連線資訊";
}

function maskTargetCredentialRef(value: string): string {
  const normalized = value.trim();
  if (!normalized) return "";
  if (normalized.length <= 10) {
    return `${normalized.slice(0, 4)}…`;
  }
  return `${normalized.slice(0, 6)}…${normalized.slice(-4)}`;
}

export function targetConnectionReadinessIssues(target: TargetProfile): string[] {
  return buildTargetConnectionReadinessReport(target).checks
    .filter((check) => check.status === "fail")
    .map((check) => check.detail);
}

export function buildTargetConnectionReadinessReport(target: TargetProfile): TargetConnectionReadinessReport {
  const connection = target.connection;
  const checks: TargetConnectionReadinessCheck[] = [];
  const isLocalLike = target.kind === "local-shell" || target.kind === "mock";
  const isRemote = target.kind === "ssh-terminal" || target.kind === "remote-desktop";
  const hostBridgeStaleness = getHostBridgeStalenessState(connection.hostBridge);
  const hostBridgeAttestation = getHostBridgeAttestationState(connection.hostBridge);

  if (isLocalLike) {
    checks.push({
      key: "host-bridge",
      label: "Host bridge",
      status: connection.hostBridge?.state === "registered" ? (hostBridgeStaleness === "fresh" ? "pass" : "warn") : "warn",
      detail:
        connection.hostBridge?.state === "registered"
          ? hostBridgeStaleness === "fresh"
            ? `Host bridge registered${connection.hostBridge.hostName ? ` for ${connection.hostBridge.hostName}` : ""}.`
            : "Host bridge heartbeat is stale; request a fresh heartbeat from the host bridge."
          : "Local targets ship with the host bridge already present.",
      required: false,
    });
    checks.push({
      key: "pair",
      label: "Pairing",
      status: target.paired ? "pass" : "warn",
      detail: target.paired ? "Local targets remain paired and ready." : "Local targets can be paired before dispatch.",
      required: false,
    });
    checks.push({
      key: "attestation",
      label: "Host attestation",
      status: connection.hostBridge?.state === "registered" ? "pass" : "warn",
      detail: connection.hostBridge?.state === "registered" ? "Local host bridge attestation is already present." : "Local targets ship with the host bridge already present.",
      required: false,
    });
    checks.push({
      key: "probe",
      label: "Probe",
      status: "pass",
      detail: "Local targets do not require a network probe.",
      required: false,
    });
    return {
      targetId: target.id,
      targetName: target.displayName,
      kind: target.kind,
      state: target.state,
      readyToConnect: true,
      lastProbeResult: connection.lastProbeResult,
      lastProbeAt: connection.lastProbeAt,
      nextAction: target.paired ? "connect" : "pair",
      checks,
    };
  }

  checks.push({
    key: "host-bridge",
    label: "Host bridge",
    status: connection.hostBridge?.state === "registered" ? (hostBridgeStaleness === "fresh" ? "pass" : "fail") : "fail",
    detail:
      connection.hostBridge?.state === "registered"
        ? hostBridgeStaleness === "fresh"
          ? `Host bridge registered${connection.hostBridge.hostName ? ` for ${connection.hostBridge.hostName}` : ""}${connection.hostBridge.bridgeVersion ? ` (${connection.hostBridge.bridgeVersion})` : ""}.`
          : "Host bridge heartbeat is stale; request a fresh heartbeat from the host bridge."
        : "Install and enroll the ClawDesk host bridge before pairing this target.",
    required: true,
  });

  checks.push({
    key: "pair",
    label: "Pairing",
    status: target.paired ? "pass" : connection.hostBridge?.state === "registered" ? "warn" : "fail",
    detail: target.paired
      ? "Target is paired."
      : connection.hostBridge?.state === "registered"
        ? "Enroll the host, then complete pairing before connect."
        : "Target must be paired after host enrollment before it can connect.",
    required: true,
  });

  checks.push({
    key: "attestation",
    label: "Host attestation",
    status: hostBridgeAttestation === "fresh" ? "pass" : "fail",
    detail:
      hostBridgeAttestation === "fresh"
        ? `Host bridge attested${connection.hostBridge?.deviceId ? ` from device ${connection.hostBridge.deviceId}` : ""}${connection.hostBridge?.installId ? ` / install ${connection.hostBridge.installId}` : ""}.`
        : "Host bridge attestation is required before connect.",
    required: true,
  });

  checks.push({
    key: "username",
    label: "Username",
    status: connection.username ? "pass" : "fail",
    detail: connection.username ? `Username: ${connection.username}` : "Connection username is required.",
    required: true,
  });

  checks.push({
    key: "credential-mode",
    label: "Credential mode",
    status: connection.credentialMode === "none" ? "fail" : "pass",
    detail:
      connection.credentialMode === "none"
        ? "Select a credential mode before connecting."
        : `Credential mode: ${connection.credentialMode}`,
    required: true,
  });

  checks.push({
    key: "credential-ref",
    label: "Credential ref",
    status:
      connection.credentialMode === "secret-ref" && !connection.credentialRef
        ? "fail"
        : connection.credentialMode === "secret-ref"
          ? "pass"
          : "warn",
    detail:
      connection.credentialMode === "secret-ref" && !connection.credentialRef
        ? "Secret-ref mode requires a credential reference."
        : connection.credentialMode === "secret-ref" && connection.credentialRef
          ? `Credential ref: ${maskTargetCredentialRef(connection.credentialRef)}`
          : "Credential ref not required for this credential mode.",
    required: connection.credentialMode === "secret-ref",
  });

  if (target.kind === "ssh-terminal") {
    checks.push({
      key: "host-key",
      label: "SSH host key",
      status: connection.knownHostFingerprint ? "pass" : "fail",
      detail: connection.knownHostFingerprint
        ? "SSH host key recorded."
        : "SSH host key is required for host-key verification.",
      required: true,
    });
  } else {
    checks.push({
      key: "host-key",
      label: "Host key",
      status: "warn",
      detail: "Host-key verification is not required for this target kind.",
      required: false,
    });
  }

  const probeStatus =
    connection.lastProbeResult === "reachable"
      ? "pass"
      : connection.lastProbeResult === "unreachable" || connection.lastProbeResult === "error"
        ? "fail"
        : "warn";
  checks.push({
    key: "probe",
    label: "Connectivity probe",
    status: probeStatus,
    detail:
      connection.lastProbeResult === "reachable"
        ? `Last probe succeeded${connection.lastProbeHost ? ` at ${connection.lastProbeHost}${connection.lastProbePort ? `:${connection.lastProbePort}` : ""}` : ""}.`
        : connection.lastProbeResult
          ? `Last probe reported ${connection.lastProbeResult}${connection.lastProbeError ? `: ${connection.lastProbeError}` : ""}.`
          : "Run a probe before connect to confirm reachability.",
    required: true,
  });

  const issues = checks.filter((check) => check.status === "fail").map((check) => check.detail);
  let nextAction: TargetConnectionReadinessReport["nextAction"] = "connect";
  if (connection.hostBridge?.state !== "registered") {
    nextAction = "enroll_host";
  } else if (hostBridgeAttestation === "missing") {
    nextAction = "attest";
  } else if (hostBridgeStaleness === "stale") {
    nextAction = "heartbeat";
  } else if (!target.paired) {
    nextAction = "pair";
  } else if (connection.lastProbeResult !== "reachable") {
    nextAction = "probe";
  } else if (target.kind === "ssh-terminal" && !connection.knownHostFingerprint) {
    nextAction = "verify_host_key";
  } else if (!isRemote || connection.credentialMode !== "none") {
    nextAction = "connect";
  }

  return {
    targetId: target.id,
    targetName: target.displayName,
    kind: target.kind,
    state: target.state,
    readyToConnect: issues.length === 0,
    lastProbeResult: connection.lastProbeResult,
    lastProbeAt: connection.lastProbeAt,
    nextAction,
    checks,
  };
}

function cloneTargetProfile(target: TargetProfile): TargetProfile {
  return {
    ...target,
    trustedWorkspaces: [...target.trustedWorkspaces],
    adapters: target.adapters.map((adapter) => ({ ...adapter })),
    connection: { ...target.connection },
  };
}

function updatePrimaryAdapter(target: TargetProfile, updater: (adapter: TargetAdapter) => TargetAdapter): TargetProfile {
  const [primaryAdapter, ...restAdapters] = target.adapters;
  if (!primaryAdapter) return cloneTargetProfile(target);
  const updatedPrimary = updater({ ...primaryAdapter });
  return {
    ...target,
    adapters: [updatedPrimary, ...restAdapters.map((adapter) => ({ ...adapter }))],
  };
}

export function applyTargetConnectionAction(
  target: TargetProfile,
  action: TargetConnectionAction,
  options: {
    pairingCode?: string;
    enrollmentCode?: string;
    bridgeId?: string;
    hostName?: string;
    bridgeVersion?: string;
    deviceId?: string;
    installId?: string;
    platform?: string;
  } = {},
): TargetConnectionResult {
  const now = new Date().toISOString();
  const baseTarget = cloneTargetProfile(target);
  const adapter = baseTarget.adapters[0];

  if (!adapter) {
    return {
      allowed: false,
      reason: "This target does not expose a connection adapter.",
      action,
      target: baseTarget,
    };
  }

  if (action === "disconnect") {
    return {
      allowed: true,
      reason: "The target was marked offline.",
      action,
      target: {
        ...baseTarget,
        state: "offline",
        lastSeenAt: now,
      },
    };
  }

  if (action === "refresh") {
    return {
      allowed: true,
      reason: "The target status was refreshed.",
      action,
      target: {
        ...baseTarget,
        lastSeenAt: now,
      },
    };
  }

  if (action === "enroll_host") {
    if (baseTarget.kind === "local-shell" || baseTarget.kind === "mock") {
      return {
        allowed: true,
        reason: "Local targets already include the host bridge.",
        action,
        target: {
          ...baseTarget,
          paired: true,
          state: "ready",
          lastSeenAt: now,
          connection: {
            ...baseTarget.connection,
            hostBridge: {
              state: "registered",
              bridgeId: baseTarget.connection.hostBridge?.bridgeId ?? `${baseTarget.id}-bridge`,
              hostName: options.hostName?.trim() || baseTarget.displayName,
              bridgeVersion: options.bridgeVersion?.trim() || baseTarget.connection.hostBridge?.bridgeVersion || "local",
              deviceId: baseTarget.connection.hostBridge?.deviceId ?? `${baseTarget.id}-device`,
              installId: baseTarget.connection.hostBridge?.installId ?? `${baseTarget.id}-install`,
              platform: baseTarget.connection.hostBridge?.platform ?? "local",
              registeredAt: baseTarget.connection.hostBridge?.registeredAt ?? now,
              attestedAt: baseTarget.connection.hostBridge?.attestedAt ?? now,
              lastSeenAt: now,
              lastError: undefined,
              lastAttestationError: baseTarget.connection.hostBridge?.lastAttestationError,
            },
          },
        },
      };
    }

    const enrollmentCode = typeof options.enrollmentCode === "string" ? options.enrollmentCode.trim() : "";
    if (!enrollmentCode) {
      return {
        allowed: false,
        reason: "A host enrollment code is required.",
        action,
        target: baseTarget,
      };
    }

    return {
      allowed: true,
      reason: "The host bridge was enrolled in the local preview.",
      action,
      target: updatePrimaryAdapter(
        {
          ...baseTarget,
          paired: true,
          state: "connecting",
          lastSeenAt: now,
            connection: {
              ...baseTarget.connection,
              hostBridge: {
                state: "registered",
                bridgeId: baseTarget.connection.hostBridge?.bridgeId ?? `${baseTarget.id}-bridge`,
                hostName: options.hostName?.trim() || baseTarget.displayName,
                bridgeVersion: options.bridgeVersion?.trim() || baseTarget.connection.hostBridge?.bridgeVersion || "1.0.0",
                deviceId: baseTarget.connection.hostBridge?.deviceId ?? `${baseTarget.id}-device`,
                installId: baseTarget.connection.hostBridge?.installId ?? `${baseTarget.id}-install`,
                platform: baseTarget.connection.hostBridge?.platform ?? "unknown",
                registeredAt: baseTarget.connection.hostBridge?.registeredAt ?? now,
                attestedAt: baseTarget.connection.hostBridge?.attestedAt,
                lastSeenAt: now,
                lastError: undefined,
                lastAttestationError: baseTarget.connection.hostBridge?.lastAttestationError,
            },
          },
        },
        (current) => ({
          ...current,
          authenticated: true,
          hostKeyVerified: baseTarget.kind === "ssh-terminal" ? false : current.hostKeyVerified,
        }),
      ),
    };
  }

  if (action === "attest") {
    if (baseTarget.connection.hostBridge?.state !== "registered") {
      return {
        allowed: false,
        reason: "Enroll the host bridge before attesting its identity.",
        action,
        target: baseTarget,
      };
    }

    const bridgeId = typeof options.bridgeId === "string" ? options.bridgeId.trim() : "";
    if (bridgeId && baseTarget.connection.hostBridge.bridgeId && bridgeId !== baseTarget.connection.hostBridge.bridgeId) {
      return {
        allowed: false,
        reason: "The host bridge identity does not match this target.",
        action,
        target: baseTarget,
      };
    }

    return {
      allowed: true,
      reason: "The host bridge identity was attested.",
      action,
      target: updatePrimaryAdapter(
        {
          ...baseTarget,
          state: baseTarget.state === "offline" ? "connecting" : baseTarget.state,
          lastSeenAt: now,
          connection: {
            ...baseTarget.connection,
            hostBridge: {
              ...baseTarget.connection.hostBridge,
              state: "registered",
              bridgeId: baseTarget.connection.hostBridge.bridgeId ?? `${baseTarget.id}-bridge`,
              hostName: options.hostName?.trim() || baseTarget.connection.hostBridge.hostName || baseTarget.displayName,
              bridgeVersion: options.bridgeVersion?.trim() || baseTarget.connection.hostBridge.bridgeVersion || "1.0.0",
              deviceId: options.deviceId?.trim() || baseTarget.connection.hostBridge.deviceId || `${baseTarget.id}-device`,
              installId: options.installId?.trim() || baseTarget.connection.hostBridge.installId || `${baseTarget.id}-install`,
              platform: options.platform?.trim() || baseTarget.connection.hostBridge.platform || "unknown",
              registeredAt: baseTarget.connection.hostBridge.registeredAt ?? now,
              attestedAt: now,
              lastSeenAt: now,
              lastError: undefined,
              lastAttestationError: undefined,
            },
          },
        },
        (current) => ({
          ...current,
          authenticated: true,
          hostKeyVerified: current.hostKeyVerified,
        }),
      ),
    };
  }

  if (action === "heartbeat") {
    if (baseTarget.connection.hostBridge?.state !== "registered") {
      return {
        allowed: false,
        reason: "Enroll the host bridge before reporting a heartbeat.",
        action,
        target: baseTarget,
      };
    }

    const bridgeId = typeof options.bridgeId === "string" ? options.bridgeId.trim() : "";
    if (bridgeId && baseTarget.connection.hostBridge.bridgeId && bridgeId !== baseTarget.connection.hostBridge.bridgeId) {
      return {
        allowed: false,
        reason: "The host bridge identity does not match this target.",
        action,
        target: baseTarget,
      };
    }

    return {
      allowed: true,
      reason: "The host bridge heartbeat was recorded.",
      action,
      target: updatePrimaryAdapter(
        {
          ...baseTarget,
          state: baseTarget.state === "offline" ? "connecting" : baseTarget.state,
          lastSeenAt: now,
          connection: {
            ...baseTarget.connection,
            hostBridge: {
              ...baseTarget.connection.hostBridge,
              state: "registered",
              bridgeId: baseTarget.connection.hostBridge.bridgeId ?? `${baseTarget.id}-bridge`,
              hostName: options.hostName?.trim() || baseTarget.connection.hostBridge.hostName || baseTarget.displayName,
              bridgeVersion: options.bridgeVersion?.trim() || baseTarget.connection.hostBridge.bridgeVersion || "1.0.0",
              registeredAt: baseTarget.connection.hostBridge.registeredAt ?? now,
              attestedAt: baseTarget.connection.hostBridge.attestedAt,
              lastSeenAt: now,
              lastError: undefined,
              lastAttestationError: baseTarget.connection.hostBridge.lastAttestationError,
            },
          },
        },
        (current) => ({
          ...current,
          authenticated: true,
          hostKeyVerified: current.hostKeyVerified,
        }),
      ),
    };
  }

  if (action === "pair") {
    if (baseTarget.kind === "local-shell" || baseTarget.kind === "mock") {
      return {
        allowed: true,
        reason: "Local targets remain paired and ready.",
        action,
        target: {
          ...baseTarget,
          paired: true,
          state: "ready",
          lastSeenAt: now,
          adapters: baseTarget.adapters.map((item) => ({
            ...item,
            authenticated: true,
            hostKeyVerified: true,
          })),
        },
      };
    }

    return {
      allowed: true,
      reason: "The target was paired and moved into connecting state.",
      action,
      target: updatePrimaryAdapter(
        {
          ...baseTarget,
          paired: true,
          state: "connecting",
          lastSeenAt: now,
        },
        (current) => ({
          ...current,
          authenticated: true,
          hostKeyVerified: baseTarget.kind === "ssh-terminal" ? false : current.hostKeyVerified,
        }),
      ),
    };
  }

  if (action === "verify_host_key") {
    if (baseTarget.kind !== "ssh-terminal") {
      return {
        allowed: false,
        reason: "SSH host-key verification only applies to SSH targets.",
        action,
        target: baseTarget,
      };
    }

    if (!baseTarget.paired) {
      return {
        allowed: false,
        reason: "Pair the SSH target before verifying its host key.",
        action,
        target: baseTarget,
      };
    }

    if (!baseTarget.connection.knownHostFingerprint) {
      return {
        allowed: false,
        reason: "Record the SSH host key before verification.",
        action,
        target: baseTarget,
      };
    }

    return {
      allowed: true,
      reason: "SSH host key verified.",
      action,
      target: updatePrimaryAdapter(
        {
          ...baseTarget,
          state: baseTarget.state === "offline" ? "connecting" : baseTarget.state,
          lastSeenAt: now,
        },
        (current) => ({
          ...current,
          authenticated: true,
          hostKeyVerified: true,
        }),
      ),
    };
  }

  if (action === "probe") {
    return {
      allowed: true,
      reason: "Connection probe requested.",
      action,
      target: {
        ...baseTarget,
        state: baseTarget.kind === "local-shell" || baseTarget.kind === "mock" ? "ready" : "connecting",
        lastSeenAt: now,
        connection: {
          ...baseTarget.connection,
          lastProbeAt: now,
          lastProbeResult: "error",
          lastProbeError: "Gateway probe required for a real reachability check.",
          lastProbeHost: undefined,
          lastProbePort: baseTarget.connection.port,
          lastProbeLatencyMs: undefined,
        },
      },
    };
  }

  if (action === "connect") {
    if (baseTarget.kind !== "local-shell" && !baseTarget.paired) {
      return {
        allowed: false,
        reason: "Remote targets must be paired before connecting.",
        action,
        target: baseTarget,
      };
    }

    const readinessIssues = targetConnectionReadinessIssues(baseTarget);
    if (readinessIssues.length > 0) {
      return {
        allowed: false,
        reason: readinessIssues[0],
        action,
        target: baseTarget,
      };
    }

    if ((baseTarget.kind === "ssh-terminal" || baseTarget.kind === "remote-desktop") && !adapter.authenticated) {
      return {
        allowed: false,
        reason: "Remote targets must be authenticated before connecting.",
        action,
        target: baseTarget,
      };
    }

    if (baseTarget.kind === "ssh-terminal" && !adapter.hostKeyVerified) {
      return {
        allowed: false,
        reason: "SSH host key verification must be completed before connecting.",
        action,
        target: baseTarget,
      };
    }

    return {
      allowed: true,
      reason: "The target is now marked ready for dispatch.",
      action,
      target: {
        ...baseTarget,
        paired: true,
        state: "ready",
        lastSeenAt: now,
      },
    };
  }

  return {
    allowed: false,
    reason: "Unknown connection action.",
    action,
    target: baseTarget,
  };
}

export function createTargetDispatchRecord(
  target: TargetProfile,
  request: TargetDispatchRequest,
  decision: TargetDispatchDecision,
  id: string,
  createdAt = new Date().toISOString(),
): TargetDispatchRecord {
  return {
    id,
    targetId: target.id,
    targetName: target.displayName,
    category: request.category,
    summary: request.summary,
    command: request.command,
    decision,
    createdAt,
  };
}

export function classifyShellCommand(command: string): ShellCommandSafety {
  const normalized = command.trim();
  if (!normalized) return "blocked";

  if (BLOCKED_COMMAND_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return "blocked";
  }

  if (SAFE_COMMAND_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return "allowlisted";
  }

  return "needs-review";
}

function adapterSupportsCategory(adapter: TargetAdapter, category: TargetDispatchCategory): boolean {
  if (category === "request_approval") return true;
  if (category === "execute_safe") return adapter.supportsTerminal;
  return adapter.supportsScreen || adapter.supportsTerminal;
}

function adapterIsReachable(target: TargetProfile, adapter: TargetAdapter): boolean {
  if (target.kind !== "local-shell" && !target.paired) return false;
  if ((adapter.kind === "ssh-terminal" || adapter.kind === "remote-desktop") && !adapter.authenticated) return false;
  if (adapter.kind === "ssh-terminal" && !adapter.hostKeyVerified) return false;
  if ((adapter.kind === "ssh-terminal" || adapter.kind === "remote-desktop") && targetConnectionReadinessIssues(target).length > 0) return false;
  return true;
}

export function chooseTargetAdapter(target: TargetProfile, category: TargetDispatchCategory): TargetAdapter | undefined {
  const priorities: Record<TargetDispatchCategory, TargetKind[]> = {
    observe: ["remote-desktop", "ssh-terminal", "local-shell", "mock"],
    inspect: ["ssh-terminal", "local-shell", "remote-desktop", "mock"],
    debug: ["ssh-terminal", "local-shell", "remote-desktop", "mock"],
    execute_safe: ["local-shell", "ssh-terminal", "remote-desktop", "mock"],
    request_approval: ["local-shell", "ssh-terminal", "remote-desktop", "mock"],
  };

  for (const kind of priorities[category]) {
    const adapter = target.adapters.find((item) => item.kind === kind);
    if (adapter && adapterSupportsCategory(adapter, category) && adapterIsReachable(target, adapter)) {
      return adapter;
    }
  }

  return target.adapters.find((adapter) => adapterSupportsCategory(adapter, category) && adapterIsReachable(target, adapter));
}

export function selectTargetForDispatch(
  registry: TargetRegistry,
  category: TargetDispatchCategory,
  preferredTargetId?: string,
): TargetProfile | undefined {
  const candidates = listReadyTargets(registry);

  const preferred = preferredTargetId ? candidates.find((target) => target.id === preferredTargetId) : undefined;
  if (preferred && chooseTargetAdapter(preferred, category)) {
    return preferred;
  }

  if (registry.defaultTargetId) {
    const defaultTarget = candidates.find((target) => target.id === registry.defaultTargetId);
    if (defaultTarget && chooseTargetAdapter(defaultTarget, category)) {
      return defaultTarget;
    }
  }

  return candidates.find((target) => chooseTargetAdapter(target, category));
}

export function decideTargetDispatch(target: TargetProfile, request: TargetDispatchRequest): TargetDispatchDecision {
  if (request.category !== "request_approval" && target.state !== "ready") {
    return {
      allowed: false,
      requiresApproval: true,
      reason: "This target is not ready for dispatch yet.",
    };
  }

  const adapter = chooseTargetAdapter(target, request.category);
  if (!adapter) {
    return {
      allowed: false,
      requiresApproval: true,
      reason: "This target does not expose a safe adapter for the requested action.",
    };
  }

  if (request.category === "request_approval") {
    return {
      allowed: true,
      requiresApproval: false,
      reason: "Human approval was explicitly requested.",
      adapterKind: adapter.kind,
    };
  }

  if (request.category === "execute_safe") {
    if (!adapter.supportsTerminal) {
      return {
        allowed: false,
        requiresApproval: true,
        reason: "This target does not expose a terminal adapter.",
        adapterKind: adapter.kind,
      };
    }

    const commandSafety = classifyShellCommand(request.command ?? "");
    if (commandSafety === "blocked") {
      return {
        allowed: false,
        requiresApproval: true,
        reason: "The requested command is blocked by the safe-dispatch policy.",
        adapterKind: adapter.kind,
        commandSafety,
      };
    }

    if (commandSafety === "needs-review") {
      return {
        allowed: false,
        requiresApproval: true,
        reason: "The requested command needs human review before dispatch.",
        adapterKind: adapter.kind,
        commandSafety,
      };
    }

    return {
      allowed: true,
      requiresApproval: true,
      reason: target.kind === "local-shell" ? "Allowlisted local-shell command prepared for approval." : "Allowlisted remote command prepared for approval.",
      adapterKind: adapter.kind,
      commandSafety,
    };
  }

  if (target.kind !== "local-shell" && !target.paired) {
    return {
      allowed: false,
      requiresApproval: true,
      reason: "Remote targets must be paired before any dispatch can continue.",
      adapterKind: adapter.kind,
    };
  }

  if ((adapter.kind === "ssh-terminal" || adapter.kind === "remote-desktop") && !adapter.authenticated) {
    return {
      allowed: false,
      requiresApproval: true,
      reason: "Remote targets must be authenticated before dispatch.",
      adapterKind: adapter.kind,
    };
  }

  if (adapter.kind === "ssh-terminal" && !adapter.hostKeyVerified) {
    return {
      allowed: false,
      requiresApproval: true,
      reason: "SSH host key verification must be completed before dispatch.",
      adapterKind: adapter.kind,
    };
  }

  return {
    allowed: true,
    requiresApproval: target.kind !== "local-shell",
    reason:
      request.category === "observe"
        ? "Observation is available through the selected target adapter."
        : request.category === "inspect"
          ? "Inspection is available through the selected target adapter."
          : "Debug output is available through the selected target adapter.",
    adapterKind: adapter.kind,
  };
}
