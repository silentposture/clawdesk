export type TargetKind = "local-shell" | "ssh-terminal" | "remote-desktop" | "mock";
export type TargetConnectionState = "offline" | "connecting" | "ready" | "degraded";
export type TargetDispatchCategory = "observe" | "inspect" | "debug" | "execute_safe" | "request_approval";
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

export interface TargetProfile {
  id: string;
  displayName: string;
  kind: TargetKind;
  state: TargetConnectionState;
  paired: boolean;
  trustedWorkspaces: string[];
  adapters: TargetAdapter[];
  lastSeenAt?: string;
}

export interface TargetRegistry {
  targets: TargetProfile[];
  defaultTargetId?: string;
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

export interface TargetProfileInput {
  id: string;
  displayName: string;
  kind: TargetKind;
  endpoint: string;
  state?: TargetConnectionState;
  paired?: boolean;
  trustedWorkspaces?: string[];
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

  return {
    id: input.id,
    displayName: input.displayName,
    kind: input.kind,
    state: input.state ?? (input.kind === "local-shell" ? "ready" : "offline"),
    paired: input.paired ?? input.kind === "local-shell",
    trustedWorkspaces: input.trustedWorkspaces ?? [],
    adapters: [adapter],
    lastSeenAt: input.lastSeenAt,
  };
}

export function createTargetRegistry(targets: TargetProfile[] = [], defaultTargetId?: string): TargetRegistry {
  return {
    targets: [...targets],
    defaultTargetId: defaultTargetId ?? targets[0]?.id,
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
