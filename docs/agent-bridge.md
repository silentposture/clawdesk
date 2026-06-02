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

