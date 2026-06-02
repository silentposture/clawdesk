# Target Orchestration

ClawDesk is moving toward a unified dispatcher for multiple controllable computers. The goal is to let one control plane route work to local machines, SSH terminals, or remote desktop sessions without losing safety, auditability, or human approval.

This document describes the contract layer for that workflow. It is not a production claim.

## Core idea

Each remote computer is represented as a target profile. A target can expose one or more adapters:

- `local-shell`: local workstation or build host
- `ssh-terminal`: remote terminal access
- `remote-desktop`: screen/session access
- `mock`: local test adapter

The control plane chooses a target and then chooses the safest adapter for the requested action.

## Dispatch categories

- `observe`: watch a screen or shell session.
- `inspect`: query state, logs, or metadata.
- `debug`: collect diagnostics or redacted bundles.
- `execute_safe`: run an allowlisted shell command.
- `request_approval`: ask a human to approve the next step.

## Safety rules

- Pair before any remote dispatch.
- Verify SSH host keys before shell dispatch.
- Require human approval for execute-safe actions.
- Only allowlisted commands may flow through `execute_safe`.
- Keep secrets out of the profile, logs, and debug bundles.
- Do not imply public-internet exposure by default.

## Current implementation surface

- Contract and dispatch helpers: [`src/lib/targets.ts`](../src/lib/targets.ts)
- Unit coverage: [`src/lib/targets.test.ts`](../src/lib/targets.test.ts)
- Target registry UI: [`src/components/TargetRegistryPanel.tsx`](../src/components/TargetRegistryPanel.tsx)
- Mock gateway storage for registry and dispatch logs: [`sidecars/mock-gateway/server.mjs`](../sidecars/mock-gateway/server.mjs)
- Existing approval and policy primitives: [`src/lib/security.ts`](../src/lib/security.ts), [`src/lib/permissions.ts`](../src/lib/permissions.ts), [`src/components/PermissionModal.tsx`](../src/components/PermissionModal.tsx)
- Current gateway and desktop shell integration: [`src/lib/tauri.ts`](../src/lib/tauri.ts), [`sidecars/mock-gateway/server.mjs`](../sidecars/mock-gateway/server.mjs), [`src/App.tsx`](../src/App.tsx)

## Intended flow

```mermaid
flowchart TD
  User["User"]
  Shell["ClawDesk shell"]
  Registry["Target registry"]
  Policy["Policy and approval"]
  SSH["SSH terminal adapter"]
  RDP["Remote desktop adapter"]
  Target["Controlled computer"]

  User --> Shell
  Shell --> Registry
  Registry --> Policy
  Policy --> SSH
  Policy --> RDP
  SSH --> Target
  RDP --> Target
```

1. The user selects a target from the registry.
2. The control plane resolves the safest available adapter.
3. The policy layer checks pairing, authentication, host-key verification, and command safety.
4. Observe / inspect / debug requests can proceed when the target is ready.
5. Execute-safe requests are queued for approval before command dispatch.
6. The target returns screen state, terminal output, or diagnostic evidence back into the shell.

## What is not implemented yet

- A production SSH connector.
- A production remote desktop connector.
- A production audit trail for remote sessions.
- Any claim that this is a full remote desktop clone.

## Next implementation steps

1. Connect SSH host-key verification and credential storage to the gateway.
2. Add a remote-desktop adapter contract for screen/control sessions.
3. Route dispatch decisions through the existing permission queue.
4. Add audit-friendly session summaries for each target.
5. Introduce real transport/session execution once the safe contract is stable.
