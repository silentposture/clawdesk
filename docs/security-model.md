# Security Model

ClawDesk treats security as a product boundary, not a postscript.

## Threats we account for

- Remote control abuse.
- Screen leakage.
- Credential exposure.
- Command abuse.
- Prompt/tool injection.
- Transport tampering.
- Sensitive logs and debug bundles.
- Dependency and supply-chain risk.

## Controls

| Threat | Control |
| --- | --- |
| Remote control abuse | Local-only default, pairing, and approval gates. |
| Screen leakage | Screen-related actions are approval-gated and redaction-aware. |
| Credentials | No plaintext credentials in repo examples or debug bundles. |
| Command abuse | Allowlisted safe execution only, with approval for critical actions. |
| Prompt/tool injection | Policy layer separates observation from execution. |
| Transport tampering | Local-first transport with explicit pairing before stateful handoff. |
| Sensitive logs | Debug bundles exclude secrets and require redaction before sharing. |
| Dependency risk | Audit dependencies and keep public-release CI lightweight and explicit. |

## Safe defaults

- Local-only on first run.
- No unauthenticated remote control.
- No unrestricted shell.
- No public internet exposure by default.
- No sensitive screenshots or raw logs in issues.

## Approval rules

- Observe and inspect can be low-risk, but they still remain policy-controlled.
- Debug, execute_safe, and any state-changing action require human approval.
- Critical actions must never bypass the approval queue.

