export type TargetKind = "local-shell" | "ssh-terminal" | "remote-desktop" | "mock";
export type TargetConnectionState = "offline" | "connecting" | "ready" | "degraded";
export type TargetDispatchCategory = "observe" | "inspect" | "debug" | "execute_safe" | "request_approval";
export type TargetConnectionAction = "pair" | "verify_host_key" | "connect" | "disconnect" | "refresh";
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
}

export interface TargetRegistrySummary {
  totalTargets: number;
  readyTargets: number;
  pairedTargets: number;
  defaultTargetId?: string;
  defaultTargetName?: string;
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

export function defaultTargetConnection(kind: TargetKind): TargetConnectionProfile {
  if (kind === "local-shell" || kind === "mock") {
    return {
      credentialMode: "platform-managed",
      sessionMode: "control",
    };
  }

  if (kind === "ssh-terminal") {
    return {
      credentialMode: "none",
      sessionMode: "control",
      port: 22,
    };
  }

  return {
    credentialMode: "none",
    sessionMode: "observe",
    port: 3389,
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
  };
}

export function defaultTargetRegistry(): TargetRegistry {
  return createTargetRegistry([
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
  ]);
}

export function cloneTargetRegistry(registry: TargetRegistry): TargetRegistry {
  return {
    defaultTargetId: registry.defaultTargetId,
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

export function findTarget(registry: TargetRegistry, targetId: string): TargetProfile | undefined {
  return registry.targets.find((target) => target.id === targetId);
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
  if (target.connection.credentialMode === "secret-ref" && target.connection.credentialRef) {
    parts.push(`ref ${maskTargetCredentialRef(target.connection.credentialRef)}`);
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
  const issues: string[] = [];
  const connection = target.connection;

  if (target.kind === "local-shell" || target.kind === "mock") {
    return issues;
  }

  if (!target.paired) {
    issues.push("Target must be paired before it can connect.");
  }

  if (!connection.username) {
    issues.push("Connection username is required.");
  }

  if (connection.credentialMode === "none") {
    issues.push("Select a credential mode before connecting.");
  }

  if (connection.credentialMode === "secret-ref" && !connection.credentialRef) {
    issues.push("Secret-ref mode requires a credential reference.");
  }

  if (target.kind === "ssh-terminal" && !connection.knownHostFingerprint) {
    issues.push("SSH host key is required for host-key verification.");
  }

  return issues;
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

export function applyTargetConnectionAction(target: TargetProfile, action: TargetConnectionAction): TargetConnectionResult {
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
