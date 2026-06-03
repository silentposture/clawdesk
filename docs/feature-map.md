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
| Multi-target orchestration | Provides a target registry UI, pairing / host-key verification / connect actions, safe dispatch preview, gateway-managed SSH credential ref issuance, allowlisted local-shell / SSH command execution, a gateway-managed SSH terminal session contract, and a gateway-managed remote-desktop observe/control session contract with a gated native client launch helper under one control plane. SSH host-key verification persists a gateway-managed known_hosts entry before execution, SSH sessions keep a redacted transcript snapshot, and remote-desktop control requests are permission-gated. | Implemented / Experimental | [`src/lib/targets.ts`](../src/lib/targets.ts), [`src/components/TargetRegistryPanel.tsx`](../src/components/TargetRegistryPanel.tsx), [`sidecars/mock-gateway/server.mjs`](../sidecars/mock-gateway/server.mjs), [`docs/target-orchestration.md`](target-orchestration.md) |
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
- SSH terminal execution is available for allowlisted commands through the safe connector path, and SSH terminal sessions are available as a gateway-managed contract with redacted transcript snapshots; remote desktop is currently a gateway-managed observe/control session contract with a gated native client launch helper rather than a production transport.
- Transport hardening, pairing/auth hardening, and production gateway replacement remain planned.
- The app must not be described as a full remote desktop clone or a production-ready remote control product.

## Related docs

- [Architecture](architecture.md)
- [Security model](security-model.md)
- [Agent bridge](agent-bridge.md)
- [MVP scope](mvp.md)
- [Release process](release-process.md)
