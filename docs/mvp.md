# MVP

## v0.1.0-alpha scope

- ClawDesk's v0.1.0-alpha scope is the AI desktop workbench, control plane, and contract layer.
- Desktop host shell.
- Client UI for workspace, approval, diagnostics, and release surfaces.
- Local-only agent bridge contract.
- Explicit pairing and human approval.
- Debug bundle collection with redaction rules.
- Public-release CI and checklist.

## Implemented

- Tauri app shell for the AI desktop workbench.
- Policy and approval surfaces for the control plane.
- Local mock gateway path for contract-layer development.
- Diagnostics and legal export helpers.
- Build and release tooling.

## Experimental

- Agent bridge schema.
- Transport abstraction.
- Pairing and session handoff.
- Debug bundle export shape.

## Planned

- Hardened host/client split.
- Secure transport hardening.
- Codex-focused OSS application packaging.
- Full release automation and validation evidence.

## Non-goals

- Full remote desktop clone.
- Public internet exposure by default.
- Unrestricted shell execution.
- Production security claims without matching evidence.
