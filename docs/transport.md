# Transport

ClawDesk is local-first. Transport choices are intentionally constrained.

## Current posture

- Local loopback or local bridge only by default.
- Explicit pairing before any stateful handoff.
- No public internet exposure by default.
- No unauthenticated remote session channel.

## Transport options

| Transport | Status | Notes |
| --- | --- | --- |
| Loopback local gateway | Implemented | Used for local development and release prep. |
| Paired local bridge | Experimental | Intended for guarded agent interaction. |
| Secure remote transport | Planned | Only after pairing, auth, and policy hardening are complete. |

## Transport rules

- Transport must be paired to identity and policy state.
- Transport must not carry plaintext credentials.
- Transport logs must be redacted before external sharing.
- Transport errors must not echo secrets or local paths.

