import { describe, expect, it } from "vitest";
import {
  classifyShellCommand,
  createTargetProfile,
  createTargetRegistry,
  decideTargetDispatch,
  selectTargetForDispatch,
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
