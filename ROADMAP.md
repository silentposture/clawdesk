# Roadmap

Status legend:

- Implemented: already present in the repo or release tooling.
- Experimental: present in a guarded or mock form.
- Planned: not yet shipped.

## v0.1.0-alpha

- Implemented: desktop shell, local policy surfaces, diagnostics, legal export, release tooling, and CI scaffolding.
- Experimental: local agent bridge contract, approval flow, and debug bundle collection.
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
| Security Hardening | Planned | Secrets, redaction, dependency review, and approval gates. |
| CI/Release | Implemented / Planned | Lightweight public-release CI plus stronger release gates. |
| v0.1.0-alpha | Planned | Tag after blockers are resolved and evidence is complete. |

## Not goals

- A full remote desktop clone.
- Public internet exposure by default.
- Unrestricted shell or unauthenticated remote control.
- Production security claims without the matching evidence.

