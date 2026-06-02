# Roadmap

Status legend:

- Implemented: already present in the repo or release tooling.
- Experimental: present in a guarded or mock form.
- Planned: not yet shipped.

This roadmap tracks the AI desktop workbench, control plane, and contract layer that make up ClawDesk's first objective.

## v0.1.0-alpha

- Implemented: desktop shell, local policy surfaces, diagnostics, legal export, release tooling, and CI scaffolding for the AI desktop workbench.
- Experimental: local agent bridge contract, approval flow, and debug bundle collection in the contract layer.
- Planned: host/client/bridge hardening, pairing/auth, transport hardening, and OSS launch packaging.

## Near-term goals

| Area | Status | Notes |
| --- | --- | --- |
| Windows Host MVP | Implemented / Experimental | Keep the Windows mainline stable and auditable. |
| macOS Client MVP | Planned | Track parity work separately from the Windows launch path. |
| Pairing/Auth | Experimental | Explicit pairing before any sensitive handoff. |
| Transport | Experimental | Local-first transport with no public exposure by default. |
| Agent Bridge | Experimental | Observe, inspect, debug, execute_safe, request_approval. |
| Debug Bundle | Experimental | Redacted bundles for issues and release review. |
| Multi-target Orchestration | Implemented / Experimental | Target registry UI + pairing / host-key verification / safe dispatch preview exist; SSH and remote-desktop execution remains contract-only. |
| Security Hardening | Planned | Secrets, redaction, dependency review, and approval gates. |
| CI/Release | Implemented / Planned | Lightweight public-release CI plus stronger release gates. |
| v0.1.0-alpha | Planned | Tag after blockers are resolved and evidence is complete. |

## Not goals

- A full remote desktop clone.
- Public internet exposure by default.
- Unrestricted shell or unauthenticated remote control.
- Production security claims without the matching evidence.
