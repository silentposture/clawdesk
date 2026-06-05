# Local Agent Bridge Example

This folder contains a local-only wrapper around the reusable host bridge runtime. It can seed a target registry entry, redeem a host enrollment code, attest device/install identity, and send heartbeat updates to the mock gateway.

Status: experimental example.

Goals:

- Show the smallest possible approval-gated bridge flow.
- Stay local-first.
- Avoid secrets, private endpoints, and unrestricted shell execution.
- Demonstrate the next step toward a real host-side agent bridge.
- Demonstrate both one-shot onboarding and daemon-style heartbeat loops.
- Reuse the same runtime that future host-side installs can share.
- Keep the install-time identity in a local config file so repeated runs keep the same bridge / device / install identity.

Run:

```bash
npm run bridge:host -- --dry-run --target-id local-host-bridge --target-name "Local Host Bridge" --kind remote-desktop
```

Or run the example wrapper directly:

```bash
node examples/local-agent-bridge/bridge-agent.mjs --gateway http://127.0.0.1:18890 --target-id local-host-bridge --target-name "Local Host Bridge" --kind remote-desktop
```

Add `--daemon --heartbeat-interval-ms 10000 --max-heartbeats 3` to exercise the long-lived heartbeat loop in a bounded smoke run.

The runtime persists identity to `~/.clawdesk/host-agent.json` by default, or to a path passed with `--config`.

Reusable runtime:

- [`src/bridge/host-bridge-agent.mjs`](../../src/bridge/host-bridge-agent.mjs)
