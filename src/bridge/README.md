# Bridge

Planned boundary for the agent bridge contract.

Status: experimental.

Responsibilities:

- Observe and inspect calls.
- Debug bundle requests.
- Safe execution requests.
- Human approval handoff.

Reusable runtime entrypoint:

- [`src/bridge/host-bridge-agent.mjs`](./host-bridge-agent.mjs) contains the reusable host bridge runtime for enrollment, attestation, heartbeat, and daemon-style loops, persists identity to a local config file by default, and can be invoked with `npm run bridge:host`.

Example wrapper:

- [`examples/local-agent-bridge/bridge-agent.mjs`](../../examples/local-agent-bridge/bridge-agent.mjs) is a thin CLI wrapper around the reusable host bridge runtime.
