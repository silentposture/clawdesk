# Feature Map

ClawDesk is an AI desktop workbench, control plane, and contract layer. This page maps the current product surfaces to the code that implements them.

## Status key

- Implemented: available in the current desktop shell or gateway flow.
- Experimental: available, but guarded, mock-backed, or contract-first.
- Planned: intentionally not shipped yet.

## What the app does today

| Surface | What it does | Status | Primary code |
| --- | --- | --- | --- |
| Desktop shell | Presents the three-pane desktop workspace: left project panel, center conversation/composer, right canvas. | Implemented | [`src/App.tsx`](../src/App.tsx), [`src/components/WorkspacePanel.tsx`](../src/components/WorkspacePanel.tsx), [`src/components/CanvasRenderer.tsx`](../src/components/CanvasRenderer.tsx) |
| Gateway and session bridge | Resolves the local gateway, reads gateway status, and forwards permission results and legal consent state. | Implemented / Experimental | [`src/lib/tauri.ts`](../src/lib/tauri.ts), [`sidecars/mock-gateway/server.mjs`](../sidecars/mock-gateway/server.mjs) |
| Provider routing | Manages the active provider session, provider catalog, and local model defaults. | Implemented / Experimental | [`src/lib/providers.ts`](../src/lib/providers.ts), [`src/components/ProviderPanel.tsx`](../src/components/ProviderPanel.tsx) |
| Safety and approval | Requires legal consent, shows permission prompts, and keeps high-risk actions behind human review. | Implemented | [`src/components/LegalConsentModal.tsx`](../src/components/LegalConsentModal.tsx), [`src/components/PermissionModal.tsx`](../src/components/PermissionModal.tsx), [`src/components/SecurityPanel.tsx`](../src/components/SecurityPanel.tsx), [`src/components/SafetyQueuePanel.tsx`](../src/components/SafetyQueuePanel.tsx) |
| Diagnostics and debug bundles | Produces redacted diagnostics, release-review artifacts, and support bundle surfaces. | Implemented / Experimental | [`src/components/DiagnosticsPanel.tsx`](../src/components/DiagnosticsPanel.tsx), [`docs/release-process.md`](release-process.md), [`scripts/check-public-release.sh`](../scripts/check-public-release.sh), [`scripts/preflight.mjs`](../scripts/preflight.mjs) |
| Workflows, channels, MCP, memory | Exposes workflow, channel, MCP, and memory surfaces for agent-assisted desktop work. | Experimental / Mock | [`src/components/WorkflowPanel.tsx`](../src/components/WorkflowPanel.tsx), [`src/components/ChannelsPanel.tsx`](../src/components/ChannelsPanel.tsx), [`src/components/McpPanel.tsx`](../src/components/McpPanel.tsx), [`src/components/MemoryPanel.tsx`](../src/components/MemoryPanel.tsx), [`sidecars/mock-gateway/server.mjs`](../sidecars/mock-gateway/server.mjs) |
| Multi-target orchestration | Provides a target registry UI, pairing / host-key verification / connect / probe actions, a connection readiness report with next-action guidance, readiness badges in the target list, target-card quick actions that can execute the recommended next connection step directly from each card, a copyable readiness report for collaboration, a shareable target audit report export for handoff / issue tracking with copy and download actions, and saved target groups / fleet presets that can be applied to the broadcast selection, plus safe dispatch preview, gateway-managed SSH credential ref issuance, short-lived pairing code issuance for secure enrollment, short-lived host enrollment code issuance for host bridge registration, host bridge attestation for device / install identity, host bridge heartbeat support for stale/fresh freshness tracking, passphrase-protected credential bundle export/import with preview and impact summary, allowlisted local-shell / SSH command execution, a gateway-managed SSH terminal session contract with redacted transcripts, session summaries, and per-target timelines, a gateway-managed SSH reconnect lifecycle verifier that is wired into preflight, a gateway-managed remote-desktop observe/control session contract with a gated native client launch helper, a client reconnect / disconnect path, credential-seed action, session summaries, and per-target timelines under one control plane, and a reusable host bridge runtime plus local wrapper example that seeds a registry entry, persists host identity to a local config file by default, enforces a single-instance lock, writes a launcher status file for service-friendly supervision, and can be packaged into an install bundle with launcher / uninstall scripts, redeems a host enrollment code, attests device/install identity, and heartbeats against the gateway. The UI can toggle between target timeline and global dispatch log views, and remote-desktop control requests plus permission results are captured in the same timeline. SSH host-key verification persists a gateway-managed known_hosts entry before execution, SSH sessions keep a redacted transcript snapshot, remote-desktop control requests are permission-gated, the audit report now includes the selected SSH or remote-desktop session snapshot in addition to readiness and timeline, and SSH / remote-desktop session panels can export Markdown handoff artifacts with transcript or launch-history summaries. | Implemented / Experimental | [`src/lib/targets.ts`](../src/lib/targets.ts), [`src/components/TargetRegistryPanel.tsx`](../src/components/TargetRegistryPanel.tsx), [`sidecars/mock-gateway/server.mjs`](../sidecars/mock-gateway/server.mjs), [`docs/target-orchestration.md`](target-orchestration.md), [`src/bridge/host-bridge-agent.mjs`](../src/bridge/host-bridge-agent.mjs), [`src/bridge/host-agent-launcher.mjs`](../src/bridge/host-agent-launcher.mjs), [`scripts/prepare-host-agent-install-bundle.mjs`](../scripts/prepare-host-agent-install-bundle.mjs), [`examples/local-agent-bridge/bridge-agent.mjs`](../examples/local-agent-bridge/bridge-agent.mjs), [`scripts/verify-host-agent-config.mjs`](../scripts/verify-host-agent-config.mjs), [`scripts/verify-host-agent-lock.mjs`](../scripts/verify-host-agent-lock.mjs), [`scripts/verify-host-agent-launcher.mjs`](../scripts/verify-host-agent-launcher.mjs), [`scripts/verify-host-agent-install-bundle.mjs`](../scripts/verify-host-agent-install-bundle.mjs) |
| Compatibility and roadmap tracking | Describes parity gaps, planned milestones, and release gating. | Implemented / Planned | [`src/lib/compatFeatureParity.ts`](../src/lib/compatFeatureParity.ts), [`ROADMAP.md`](../ROADMAP.md), [`docs/roadmap-issues.md`](roadmap-issues.md) |

## Typical user flow

1. Launch the desktop shell.
2. Read and accept legal consent.
3. Connect or configure an identity and provider session.
4. Compose a prompt and optionally attach an image.
5. Let the gateway stream the response back into the conversation and canvas.
6. Approve or reject any sensitive action before it executes.
7. Use diagnostics or redacted debug bundles when something needs review.

## What is still mock or guarded

- The local gateway is still the default contract surface.
- Agent runtime, workflows, memory, channels, and some provider integrations are still mock-backed or contract-first.
- SSH terminal execution is available for allowlisted commands through the safe connector path, and SSH terminal sessions are available as a gateway-managed contract with redacted transcript snapshots, session summaries, reconnect lifecycle coverage in preflight, and per-target timelines; remote desktop is currently a gateway-managed observe/control session contract with a gated native client launch helper, a reconnect / disconnect path, plus credential-seed support, session summaries, and per-target timelines rather than a production transport. Credential bundles can now be exported/imported through a passphrase-protected encrypted bundle with a pre-import preview and impact summary so trusted machines can be migrated without exposing plaintext secrets. The UI can toggle between per-target timelines and the global dispatch log to support operator review, the timeline includes remote-desktop control request / permission-result events, SSH / RDP targets also support a connectivity probe and a connection readiness report so operators can see host/port reachability and the remaining connect prerequisites before trying to connect, both the readiness panel and target cards can execute the recommended next connection action directly, the readiness report can be copied for issue / approval discussion, saved target groups can be applied to the broadcast selection for repeatable fleet dispatch, short-lived pairing / host enrollment codes can be issued for secure enrollment before pairing remote targets, the host bridge can submit attestation details for device / install identity, and the host bridge can send heartbeat updates so stale targets are marked and the readiness report can recommend `attest` or `heartbeat` as the next action.
- Transport hardening, pairing/auth hardening, and production gateway replacement remain planned.
- The app must not be described as a full remote desktop clone or a production-ready remote control product.

## Related docs

- [Architecture](architecture.md)
- [Security model](security-model.md)
- [Agent bridge](agent-bridge.md)
- [MVP scope](mvp.md)
- [Release process](release-process.md)
