import { describe, expect, it } from "vitest";
import {
  applyTargetConnectionAction,
  classifyShellCommand,
  createTargetProfile,
  createTargetRegistry,
  createTargetDispatchRecord,
  defaultTargetRegistry,
  findTargetGroup,
  decideTargetDispatch,
  defaultTargetGroups,
  selectTargetForDispatch,
  buildTargetConnectionReadinessReport,
  summarizeTargetConnectionProfile,
  summarizeTargetRegistry,
  summarizeTargetProfile,
  targetConnectionReadinessIssues,
  listTargetsForGroup,
  normalizeTargetGroup,
  upsertTargetGroup,
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
    expect(summarizeTargetConnectionProfile(sshTarget)).toContain("control");
  });

  it("summarizes secret-ref credential profiles with a masked ref", () => {
    const target = createTargetProfile({
      id: "builder-ssh",
      displayName: "Builder SSH",
      kind: "ssh-terminal",
      endpoint: "ssh://builder.example",
      paired: true,
      state: "ready",
      adapterOverrides: { authenticated: true, hostKeyVerified: true },
      connectionOverrides: {
        username: "builder",
        credentialMode: "secret-ref",
        credentialRef: "tcr_abcdef1234567890",
        knownHostFingerprint: "ssh-ed25519 AAAA...builder",
      },
    });

    const summary = summarizeTargetConnectionProfile(target);
    expect(summary).toContain("secret-ref");
    expect(summary).toContain("ref tcr_ab");
    expect(summary).toContain("…7890");
  });

  it("accepts remote desktop secret-ref credential profiles for managed launch flows", () => {
    const target = createTargetProfile({
      id: "ops-rdp",
      displayName: "Ops RDP",
      kind: "remote-desktop",
      endpoint: "rdp://ops.example",
      paired: true,
      state: "ready",
      adapterOverrides: { authenticated: true },
      connectionOverrides: {
        username: "ops-user",
        credentialMode: "secret-ref",
        credentialRef: "rdp-secret-12345678",
        hostBridge: {
          state: "registered",
          bridgeId: "ops-rdp-bridge",
          hostName: "Ops Host Bridge",
          bridgeVersion: "1.0.0-test",
        },
      },
    });

    const issues = targetConnectionReadinessIssues(target);
    expect(issues).toHaveLength(0);

    const summary = summarizeTargetConnectionProfile(target);
    expect(summary).toContain("secret-ref");
    expect(summary).toContain("ref rdp-se");
    expect(summary).toContain("…5678");
  });

  it("keeps remote default targets offline until paired", () => {
    const registry = defaultTargetRegistry();
    const sshTarget = registry.targets.find((target) => target.id === "builder-ssh");
    const remoteDesktop = registry.targets.find((target) => target.id === "ops-rdp");

    expect(sshTarget?.state).toBe("offline");
    expect(sshTarget?.paired).toBe(false);
    expect(sshTarget?.adapters[0]?.authenticated).toBe(false);
    expect(sshTarget?.adapters[0]?.hostKeyVerified).toBe(false);
    expect(sshTarget?.connection.credentialMode).toBe("none");
    expect(sshTarget?.connection.port).toBe(22);
    expect(remoteDesktop?.state).toBe("offline");
    expect(remoteDesktop?.paired).toBe(false);
    expect(remoteDesktop?.adapters[0]?.authenticated).toBe(false);
    expect(remoteDesktop?.connection.sessionMode).toBe("observe");
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
        connectionOverrides: {
          username: "ops-user",
          credentialMode: "platform-managed",
          sessionMode: "observe",
          hostBridge: {
            state: "registered",
            bridgeId: "ops-vm-bridge",
            hostName: "Ops Host Bridge",
            bridgeVersion: "1.0.0-test",
          },
        },
      }),
      createTargetProfile({
        id: "builder-ssh",
        displayName: "Builder SSH",
        kind: "ssh-terminal",
        endpoint: "ssh://builder.example",
        paired: true,
        state: "ready",
        adapterOverrides: { authenticated: true, hostKeyVerified: true },
        connectionOverrides: {
          username: "builder",
          credentialMode: "ssh-agent",
          knownHostFingerprint: "ssh-ed25519 AAAA...builder",
          hostBridge: {
            state: "registered",
            bridgeId: "builder-ssh-bridge",
            hostName: "SSH Host Bridge",
            bridgeVersion: "1.0.0-test",
          },
        },
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
        connectionOverrides: {
          username: "builder",
          credentialMode: "ssh-agent",
          knownHostFingerprint: "ssh-ed25519 AAAA...offline",
        },
      }),
    ], "local-builder");

    const summary = summarizeTargetRegistry(registry);

    expect(summary.totalTargets).toBe(2);
    expect(summary.readyTargets).toBe(1);
    expect(summary.pairedTargets).toBe(2);
    expect(summary.defaultTargetId).toBe("local-builder");
    expect(summary.defaultTargetName).toBe("Local Builder");
    expect(summary.targetGroupCount).toBe(0);
  });

  it("keeps target groups in the registry and normalizes them to known targets", () => {
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
        id: "builder-ssh",
        displayName: "Builder SSH",
        kind: "ssh-terminal",
        endpoint: "ssh://builder.example",
        paired: true,
        state: "ready",
        adapterOverrides: { authenticated: true, hostKeyVerified: true },
        connectionOverrides: {
          username: "builder",
          credentialMode: "ssh-agent",
          knownHostFingerprint: "ssh-ed25519 AAAA...builder",
        },
      }),
    ]);

    const withGroups = upsertTargetGroup(registry, {
      id: "fleet-alpha",
      name: "Fleet Alpha",
      description: "Main fleet preset",
      targetIds: ["local-builder", "builder-ssh", "missing-target"],
    });

    const group = findTargetGroup(withGroups, "fleet-alpha");
    expect(group?.targetIds).toEqual(["local-builder", "builder-ssh"]);

    const summary = summarizeTargetRegistry(withGroups);
    expect(summary.targetGroupCount).toBe(1);
  });

  it("provides default target groups for the built-in registry", () => {
    const groups = defaultTargetGroups(["local-builder", "builder-ssh", "ops-rdp", "lab-mock"]);
    expect(groups.length).toBeGreaterThan(0);
    expect(groups[0].targetIds.length).toBeGreaterThan(0);
  });

  it("normalizes target groups against the current target ids", () => {
    const group = normalizeTargetGroup(
      {
        id: "",
        name: "Fleet Alpha",
        description: "Main fleet preset",
        targetIds: ["local-builder", "missing-target", "builder-ssh", "local-builder"],
      },
      ["local-builder", "builder-ssh"],
    );

    expect(group.id).toBe("fleet-alpha");
    expect(group.targetIds).toEqual(["local-builder", "builder-ssh"]);
  });

  it("lists targets for a saved target group", () => {
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
        id: "builder-ssh",
        displayName: "Builder SSH",
        kind: "ssh-terminal",
        endpoint: "ssh://builder.example",
        paired: true,
        state: "ready",
        adapterOverrides: { authenticated: true, hostKeyVerified: true },
        connectionOverrides: {
          username: "builder",
          credentialMode: "ssh-agent",
          knownHostFingerprint: "ssh-ed25519 AAAA...builder",
        },
      }),
    ]);
    const withGroup = upsertTargetGroup(registry, {
      id: "fleet-alpha",
      name: "Fleet Alpha",
      targetIds: ["local-builder", "builder-ssh"],
    });

    expect(listTargetsForGroup(withGroup, "fleet-alpha").map((target) => target.id)).toEqual(["local-builder", "builder-ssh"]);
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
      connectionOverrides: {
        username: "builder",
        credentialMode: "ssh-agent",
        knownHostFingerprint: "ssh-ed25519 AAAA...builder",
        hostBridge: {
          state: "registered",
          bridgeId: "builder-ssh-bridge",
          hostName: "SSH Host Bridge",
          bridgeVersion: "1.0.0-test",
        },
      },
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
      connectionOverrides: {
        username: "builder",
        credentialMode: "ssh-agent",
        knownHostFingerprint: "ssh-ed25519 AAAA...builder",
        hostBridge: {
          state: "registered",
          bridgeId: "builder-ssh-bridge",
          hostName: "SSH Host Bridge",
          bridgeVersion: "1.0.0-test",
        },
      },
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
      connectionOverrides: {
        username: "builder",
        credentialMode: "secret-ref",
        credentialRef: "ssh-builder-secret",
        knownHostFingerprint: "ssh-ed25519 AAAA...builder",
        hostBridge: {
          state: "registered",
          bridgeId: "builder-ssh-bridge",
          hostName: "SSH Host Bridge",
          bridgeVersion: "1.0.0-test",
        },
      },
    });

    const enrollResult = applyTargetConnectionAction(target, "enroll_host", {
      enrollmentCode: "host-enroll-12345678",
      hostName: "SSH Host Bridge",
      bridgeVersion: "1.0.0-test",
    });
    expect(enrollResult.allowed).toBe(true);
    expect(enrollResult.target.paired).toBe(true);
    expect(enrollResult.target.state).toBe("connecting");
    expect(enrollResult.target.adapters[0].authenticated).toBe(true);
    expect(enrollResult.target.adapters[0].hostKeyVerified).toBe(false);

    const hostKeyResult = applyTargetConnectionAction(enrollResult.target, "verify_host_key");
    expect(hostKeyResult.allowed).toBe(true);
    expect(hostKeyResult.target.adapters[0].hostKeyVerified).toBe(true);
    expect(hostKeyResult.target.connection.knownHostFingerprint).toContain("ssh-ed25519");

    const connectResult = applyTargetConnectionAction(hostKeyResult.target, "connect");
    expect(connectResult.allowed).toBe(true);
    expect(connectResult.target.state).toBe("ready");
  });

  it("enrolls a remote desktop host bridge before readiness moves to connect", () => {
    const target = createTargetProfile({
      id: "ops-vm",
      displayName: "Ops VM",
      kind: "remote-desktop",
      endpoint: "rdp://ops.example",
      paired: false,
      state: "offline",
      connectionOverrides: {
        username: "ops-user",
        credentialMode: "platform-managed",
        lastProbeResult: "reachable",
        lastProbeAt: "2026-06-05T12:00:00.000Z",
      },
      adapterOverrides: { authenticated: false },
    });

    const enrolled = applyTargetConnectionAction(target, "enroll_host", {
      enrollmentCode: "host-enroll-12345678",
      hostName: "Ops Host Bridge",
      bridgeVersion: "1.0.0-test",
    });

    expect(enrolled.allowed).toBe(true);
    expect(enrolled.target.paired).toBe(true);
    expect(enrolled.target.connection.hostBridge?.state).toBe("registered");
    expect(enrolled.target.connection.hostBridge?.hostName).toBe("Ops Host Bridge");
    expect(enrolled.target.connection.hostBridge?.bridgeVersion).toBe("1.0.0-test");

    const readiness = buildTargetConnectionReadinessReport(enrolled.target);
    expect(readiness.readyToConnect).toBe(true);
    expect(readiness.nextAction).toBe("connect");
    expect(targetConnectionReadinessIssues(enrolled.target)).toHaveLength(0);
  });

  it("requests a heartbeat when a remote host bridge goes stale", () => {
    const staleAt = new Date(Date.now() - 12 * 60 * 1000).toISOString();
    const target = createTargetProfile({
      id: "ops-vm",
      displayName: "Ops VM",
      kind: "remote-desktop",
      endpoint: "rdp://ops.example",
      paired: true,
      state: "ready",
      connectionOverrides: {
        username: "ops-user",
        credentialMode: "platform-managed",
        hostBridge: {
          state: "registered",
          bridgeId: "ops-vm-bridge",
          hostName: "Ops Host Bridge",
          bridgeVersion: "1.0.0-test",
          registeredAt: staleAt,
          lastSeenAt: staleAt,
        },
        lastProbeResult: "reachable",
        lastProbeAt: "2026-06-05T12:00:00.000Z",
      },
      adapterOverrides: { authenticated: true },
    });

    const readiness = buildTargetConnectionReadinessReport(target);
    expect(readiness.readyToConnect).toBe(false);
    expect(readiness.nextAction).toBe("heartbeat");
    expect(readiness.checks.find((check) => check.key === "host-bridge")?.status).toBe("fail");

    const heartbeat = applyTargetConnectionAction(target, "heartbeat", {
      bridgeId: "ops-vm-bridge",
      hostName: "Ops Host Bridge",
      bridgeVersion: "1.0.0-test",
    });

    expect(heartbeat.allowed).toBe(true);
    expect(heartbeat.target.connection.hostBridge?.state).toBe("registered");
    expect(heartbeat.target.connection.hostBridge?.hostName).toBe("Ops Host Bridge");
    expect(heartbeat.target.connection.hostBridge?.bridgeVersion).toBe("1.0.0-test");
    expect(buildTargetConnectionReadinessReport(heartbeat.target).nextAction).toBe("connect");
  });

  it("blocks SSH host-key verification before pairing", () => {
    const target = createTargetProfile({
      id: "builder-ssh",
      displayName: "Builder SSH",
      kind: "ssh-terminal",
      endpoint: "ssh://builder.example",
      paired: false,
      state: "offline",
      connectionOverrides: {
        username: "builder",
        credentialMode: "secret-ref",
        credentialRef: "ssh-builder-secret",
        hostBridge: {
          state: "registered",
          bridgeId: "builder-ssh-bridge",
          hostName: "SSH Host Bridge",
          bridgeVersion: "1.0.0-test",
        },
      },
    });

    const result = applyTargetConnectionAction(target, "verify_host_key");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Pair the SSH target");
  });

  it("blocks SSH connect until credential metadata is present", () => {
    const target = createTargetProfile({
      id: "builder-ssh",
      displayName: "Builder SSH",
      kind: "ssh-terminal",
      endpoint: "ssh://builder.example",
      paired: true,
      state: "connecting",
      adapterOverrides: { authenticated: true, hostKeyVerified: true },
      connectionOverrides: {
        credentialMode: "none",
        username: "",
        hostBridge: {
          state: "registered",
          bridgeId: "builder-ssh-bridge",
          hostName: "SSH Host Bridge",
          bridgeVersion: "1.0.0-test",
        },
      },
    });

    const issues = targetConnectionReadinessIssues(target);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]).toContain("username");

    const connectResult = applyTargetConnectionAction(target, "connect");
    expect(connectResult.allowed).toBe(false);
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
