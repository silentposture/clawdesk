# Bridge

Planned boundary for the agent bridge contract.

Status: experimental.

Responsibilities:

- Observe and inspect calls.
- Debug bundle requests.
- Safe execution requests.
- Human approval handoff.

Example implementation:

- [`examples/local-agent-bridge/bridge-agent.mjs`](../../examples/local-agent-bridge/bridge-agent.mjs) seeds a target, redeems a host enrollment code, records attestation, and can either send a bounded heartbeat smoke or run as a long-lived daemon against the mock gateway.
