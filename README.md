# ClawDesk

ClawDesk is an experimental AI-agent-first desktop orchestration layer for remote development, local LLM workflows, Codex/OpenClaw integration, secure screen/session control, debug bundles, and human-approved automation.

This repository is in alpha. It is not a full remote desktop clone, and it does not allow unauthenticated remote control or unrestricted shell execution.

## Status

- Implemented: desktop shell, policy surfaces, diagnostics, legal export, release tooling, and the current local mock gateway path.
- Experimental: agent bridge contract, pairing/auth UX, transport abstraction, approval flow tuning, and debug bundle collection.
- Planned: hardened host/client/bridge split, stronger transport hardening, Codex-focused OSS application packaging, and cross-platform parity work.

## Core architecture

- Host: desktop shell, local state, policy enforcement, and bundle generation.
- Client UI: React/Tauri screens for workspaces, approvals, diagnostics, and release surfaces.
- Bridge: local agent bridge contract and mock gateway integration.
- Transport: local-only or explicitly paired transport by default.
- Debug bundle: redacted evidence pack for bug reports and release review.
- Policy layer: deny-by-default rules, human approval gates, and redaction requirements.

## Security model

- Local-only by default.
- Explicit pairing before any sensitive session handoff.
- Human approval for critical actions.
- No plaintext credentials in repo examples or release bundles.
- No sensitive screenshots, logs, or debug exports in issues.
- No production security claim until the controls are actually verified.

See:
- [Security model](docs/security-model.md)
- [Agent bridge](docs/agent-bridge.md)
- [Transport](docs/transport.md)
- [Release process](docs/release-process.md)

## Build and run

Windows-first development:

```powershell
npm ci
npm run dev
```

Tauri desktop run:

```powershell
npm run tauri:dev:win
```

Validation:

```powershell
npm run preflight
npm run i18n:audit:strict
npm test
npm run build
```

## Contributing

Contributions are welcome if they improve the public OSS launch posture, redaction hygiene, tests, build reliability, or documentation quality.

Read:
- [CONTRIBUTING.md](CONTRIBUTING.md)
- [PUBLIC_RELEASE_CHECKLIST.md](PUBLIC_RELEASE_CHECKLIST.md)
- [PUBLIC_RELEASE_BLOCKERS.md](PUBLIC_RELEASE_BLOCKERS.md)

## Roadmap

The current roadmap and issue drafts are tracked in:
- [ROADMAP.md](ROADMAP.md)
- [docs/roadmap-issues.md](docs/roadmap-issues.md)

## License

Licensed under the Apache License, Version 2.0.

