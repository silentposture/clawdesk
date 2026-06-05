# Local Agent Bridge Example

This folder contains a local-only bridge example that can seed a target registry entry, redeem a host enrollment code, attest device/install identity, and send a heartbeat to the mock gateway.

Status: experimental example.

Goals:

- Show the smallest possible approval-gated bridge flow.
- Stay local-first.
- Avoid secrets, private endpoints, and unrestricted shell execution.
- Demonstrate the next step toward a real host-side agent bridge.

Run:

```bash
node examples/local-agent-bridge/bridge-agent.mjs --gateway http://127.0.0.1:18890 --target-id local-host-bridge --target-name "Local Host Bridge" --kind remote-desktop
```
