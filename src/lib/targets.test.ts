import { describe, expect, it } from "vitest";
import {
  applyTargetConnectionAction,
  classifyShellCommand,
  createTargetProfile,
  createTargetRegistry,
  createTargetDispatchRecord,
  defaultTargetRegistry,
  decideTargetDispatch,
  selectTargetForDispatch,
  summarizeTargetRegistry,
  summarizeTargetProfile,
} from "./targets";

describe("target orchestration contract", () => {
  it("creates safe defaults for SSH and remote desktop targets", () => {
    const sshTarget = createTargetProfile({
      id: "builder-ssh",
      displayName: "Builder SSH",
      kind: "ssh-terminal",
      endpoint: "ssh://builder.example",
      paired: true,
      state: "ready",
      adapterOverrides: { authenticated: true, hostKeyVerified: true },
    });
    const remoteDesktop = createTargetProfile({
      id: "ops-vm",
      displayName: "Ops VM",
      kind: "remote-desktop",
      endpoint: "rdp://ops.example",
      paired: true,
      state: "ready",
      adapterOverrides: { authenticated: true },
    });

    expect(sshTarget.adapters[0].supportsTerminal).toBe(true);
    expect(sshTarget.adapters[0].supportsScreen).toBe(false);
    expect(remoteDesktop.adapters[0].supportsScreen).toBe(true);
    expect(remoteDesktop.adapters[0].supportsTerminal).toBe(false);
    expect(summarizeTargetProfile(remoteDesktop)).toContain("paired");
  });

  it("keeps remote default targets offline until paired", () => {
    const registry = defaultTargetRegistry();
    const sshTarget = registry.targets.find((target) => target.id === "builder-ssh");
    const remoteDesktop = registry.targets.find((target) => target.id === "ops-rdp");

    expect(sshTarget?.state).toBe("offline");
    expect(sshTarget?.paired).toBe(false);
    expect(sshTarget?.adapters[0]?.authenticated).toBe(false);
    expect(sshTarget?.adapters[0]?.hostKeyVerified).toBe(false);
    expect(remoteDesktop?.state).toBe("offline");
    expect(remoteDesktop?.paired).toBe(false);
    expect(remoteDesktop?.adapters[0]?.authenticated).toBe(false);
  });

  it("classifies shell commands into safe, review, and blocked buckets", () => {
    expect(classifyShellCommand("git status")).toBe("allowlisted");
    expect(classifyShellCommand("python deploy.py")).toBe("needs-review");
    expect(classifyShellCommand("rm -rf /")).toBe("blocked");
  });

  it("selects the best target for observe and execute flows", () => {
    const registry = createTargetRegistry([
      createTargetProfile({
        id: "ops-vm",
        displayName: "Ops VM",
        kind: "remote-desktop",
        endpoint: "rdp://ops.example",
        paired: true,
        state: "ready",
        adapterOverrides: { authenticated: true },
      }),
      createTargetProfile({
        id: "builder-ssh",
        displayName: "Builder SSH",
        kind: "ssh-terminal",
        endpoint: "ssh://builder.example",
        paired: true,
        state: "ready",
        adapterOverrides: { authenticated: true, hostKeyVerified: true },
      }),
    ]);

    expect(selectTargetForDispatch(registry, "observe")?.id).toBe("ops-vm");
    expect(selectTargetForDispatch(registry, "execute_safe")?.id).toBe("builder-ssh");
  });

  it("summarizes registry readiness and default target metadata", () => {
    const registry = createTargetRegistry([
      createTargetProfile({
        id: "local-builder",
        displayName: "Local Builder",
        kind: "local-shell",
        endpoint: "local://workspace",
        state: "ready",
        paired: true,
      }),
      createTargetProfile({
        id: "offline-builder",
        displayName: "Offline Builder",
        kind: "ssh-terminal",
        endpoint: "ssh://offline.example",
        paired: true,
        state: "offline",
        adapterOverrides: { authenticated: true, hostKeyVerified: true },
      }),
    ], "local-builder");

    const summary = summarizeTargetRegistry(registry);

    expect(summary.totalTargets).toBe(2);
    expect(summary.readyTargets).toBe(1);
    expect(summary.pairedTargets).toBe(2);
    expect(summary.defaultTargetId).toBe("local-builder");
    expect(summary.defaultTargetName).toBe("Local Builder");
  });

  it("requires approval for safe remote shell dispatch and blocks unsafe commands", () => {
    const target = createTargetProfile({
      id: "builder-ssh",
      displayName: "Builder SSH",
      kind: "ssh-terminal",
      endpoint: "ssh://builder.example",
      paired: true,
      state: "ready",
      adapterOverrides: { authenticated: true, hostKeyVerified: true },
    });

    const safeDecision = decideTargetDispatch(target, {
      category: "execute_safe",
      summary: "Check git status on the remote builder.",
      command: "git status",
    });
    expect(safeDecision.allowed).toBe(true);
    expect(safeDecision.requiresApproval).toBe(true);
    expect(safeDecision.commandSafety).toBe("allowlisted");

    const unsafeDecision = decideTargetDispatch(target, {
      category: "execute_safe",
      summary: "Destroy a directory on the remote builder.",
      command: "rm -rf /",
    });
    expect(unsafeDecision.allowed).toBe(false);
    expect(unsafeDecision.requiresApproval).toBe(true);
    expect(unsafeDecision.commandSafety).toBe("blocked");
  });

  it("creates dispatch records from a target decision", () => {
    const target = createTargetProfile({
      id: "builder-ssh",
      displayName: "Builder SSH",
      kind: "ssh-terminal",
      endpoint: "ssh://builder.example",
      paired: true,
      state: "ready",
      adapterOverrides: { authenticated: true, hostKeyVerified: true },
    });

    const decision = decideTargetDispatch(target, {
      category: "request_approval",
      summary: "Request a human to approve the next step.",
    });
    const record = createTargetDispatchRecord(
      target,
      { category: "request_approval", summary: "Request a human to approve the next step." },
      decision,
      "dispatch-001",
      "2026-06-03T12:00:00.000Z",
    );

    expect(record.id).toBe("dispatch-001");
    expect(record.targetId).toBe(target.id);
    expect(record.targetName).toBe(target.displayName);
    expect(record.decision.allowed).toBe(true);
    expect(record.createdAt).toBe("2026-06-03T12:00:00.000Z");
  });

  it("supports the SSH pairing and host key verification flow before connecting", () => {
    const target = createTargetProfile({
      id: "builder-ssh",
      displayName: "Builder SSH",
      kind: "ssh-terminal",
      endpoint: "ssh://builder.example",
      paired: false,
      state: "offline",
    });

    const pairResult = applyTargetConnectionAction(target, "pair");
    expect(pairResult.allowed).toBe(true);
    expect(pairResult.target.paired).toBe(true);
    expect(pairResult.target.state).toBe("connecting");
    expect(pairResult.target.adapters[0].authenticated).toBe(true);
    expect(pairResult.target.adapters[0].hostKeyVerified).toBe(false);

    const hostKeyResult = applyTargetConnectionAction(pairResult.target, "verify_host_key");
    expect(hostKeyResult.allowed).toBe(true);
    expect(hostKeyResult.target.adapters[0].hostKeyVerified).toBe(true);

    const connectResult = applyTargetConnectionAction(hostKeyResult.target, "connect");
    expect(connectResult.allowed).toBe(true);
    expect(connectResult.target.state).toBe("ready");
  });

  it("blocks SSH host-key verification before pairing", () => {
    const target = createTargetProfile({
      id: "builder-ssh",
      displayName: "Builder SSH",
      kind: "ssh-terminal",
      endpoint: "ssh://builder.example",
      paired: false,
      state: "offline",
    });

    const result = applyTargetConnectionAction(target, "verify_host_key");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Pair the SSH target");
  });

  it("blocks execute_safe on remote desktop targets without a terminal adapter", () => {
    const target = createTargetProfile({
      id: "ops-vm",
      displayName: "Ops VM",
      kind: "remote-desktop",
      endpoint: "rdp://ops.example",
      paired: true,
      state: "ready",
      adapterOverrides: { authenticated: true },
    });

    const decision = decideTargetDispatch(target, {
      category: "execute_safe",
      summary: "Run a shell command through the remote desktop.",
      command: "git status",
    });

    expect(decision.allowed).toBe(false);
    expect(decision.requiresApproval).toBe(true);
  });

  it("keeps non-ready targets out of dispatch decisions", () => {
    const target = createTargetProfile({
      id: "offline-builder",
      displayName: "Offline Builder",
      kind: "ssh-terminal",
      endpoint: "ssh://offline.example",
      paired: true,
      state: "offline",
      adapterOverrides: { authenticated: true, hostKeyVerified: true },
    });

    const decision = decideTargetDispatch(target, {
      category: "observe",
      summary: "Try to inspect an offline target.",
    });

    expect(decision.allowed).toBe(false);
    expect(decision.requiresApproval).toBe(true);
  });
});
