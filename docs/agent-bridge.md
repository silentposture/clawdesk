# Agent Bridge

The agent bridge is the contract between ClawDesk's UI/policy layer and any agent-facing tooling.

## Categories

- `observe`: read-only observation of screen, windows, or workspace state.
- `inspect`: structured inspection of local state, logs, or metadata.
- `debug`: collect or prepare redacted diagnostics.
- `execute_safe`: allowlisted actions that are still approval-gated.
- `request_approval`: explicitly ask a human before a critical action.

## Rules

- Critical actions require human approval.
- Observe and inspect must not silently escalate into execution.
- Debug output must be redacted before leaving the local machine.
- Safe execution must stay inside the workspace boundary and the allowlist.

## Host bridge example

- The reusable host bridge runtime at [`src/bridge/host-bridge-agent.mjs`](../src/bridge/host-bridge-agent.mjs) shows the next step toward a real installed host bridge.
- It can be invoked directly with `npm run bridge:host`, which makes it a concrete install-time entrypoint instead of just a one-off example.
- It persists bridge identity to a local config file by default, so repeated launches on the same machine reuse the same bridge / device / install identity instead of generating fresh identities every time.
- It also uses a local single-instance lock by default, so a machine behaves like a service-style host agent instead of accidentally running multiple competing bridges.
- The runtime is therefore install-friendly: a future Windows service or startup hook can point at the same entrypoint without duplicating bridge logic.
- The dedicated launcher at [`src/bridge/host-agent-launcher.mjs`](../src/bridge/host-agent-launcher.mjs) adds a lifecycle status file, which is the clean handoff point for a service manager or installer.
- The install bundle generator at [`scripts/prepare-host-agent-install-bundle.mjs`](../scripts/prepare-host-agent-install-bundle.mjs) produces launcher, scheduled-task registration, and uninstall scripts plus a manifest, so packaging can target the same runtime without inventing a second contract.
- The install bundle verifier is wired into preflight, so the install handoff is checked as part of the normal release gate instead of living as a one-off smoke test.
- The local wrapper at [`examples/local-agent-bridge/bridge-agent.mjs`](../examples/local-agent-bridge/bridge-agent.mjs) seeds a target registry entry, redeems a short-lived host enrollment code, records device / install attestation, and can send heartbeat updates either as a bounded smoke run or as a long-lived daemon.
- The example stays local-first and does not expose plaintext secrets or unrestricted execution.
- The current shape is intentionally reusable so a future installed host-side agent can share the same runtime flow instead of duplicating enrollment / attestation / heartbeat logic.

## Example payloads

### observe_screen

```json
{
  "type": "observe_screen",
  "category": "observe",
  "payload": {
    "scope": "active-window",
    "redaction": "default"
  }
}
```

### list_windows

```json
{
  "type": "list_windows",
  "category": "inspect",
  "payload": {
    "includeHidden": false,
    "redaction": "default"
  }
}
```

### collect_debug_bundle

```json
{
  "type": "collect_debug_bundle",
  "category": "debug",
  "payload": {
    "includeLogs": true,
    "includeScreenshots": false,
    "redaction": "strict"
  }
}
```

### request_human_approval

```json
{
  "type": "request_human_approval",
  "category": "request_approval",
  "payload": {
    "action": "run_safe_command",
    "reason": "The next step changes local workspace files."
  }
}
```

### run_safe_command

```json
{
  "type": "run_safe_command",
  "category": "execute_safe",
  "payload": {
    "command": "npm test",
    "workspaceScoped": true,
    "approvalRequired": true
  }
}
```
