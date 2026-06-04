# Roadmap Issues Draft

These are issue drafts for the public OSS roadmap.

## Windows Host MVP

- Label: `roadmap`
- Goal: stabilize the Windows host shell, approval surfaces, and release packaging.

## macOS Client MVP

- Label: `roadmap`
- Goal: document and harden the companion macOS client path.

## Pairing/Auth

- Label: `security`, `roadmap`
- Goal: explicit pairing before any sensitive handoff.

## Transport

- Label: `infra`, `roadmap`
- Goal: local-first transport with clear boundaries and no public exposure by default.

## Agent Bridge

- Label: `feature`, `roadmap`
- Goal: ship the local bridge contract and its approval-gated actions.

## Debug Bundle

- Label: `diagnostics`, `roadmap`
- Goal: standardize redacted bundles for bug reports and release review.

## Multi-target Orchestration

- Label: `feature`, `roadmap`
- Goal: unify safe dispatch across SSH terminals, remote desktop sessions, and local targets under a single control plane, with registry UI, pairing, connectivity probe, gateway-managed host-key verification, gateway-managed SSH credential refs, passphrase-protected credential bundle export/import with preview and impact summary, allowlisted SSH/local-shell execution, gateway-managed SSH terminal session contracts with redacted transcripts, session summaries, and per-target timelines, gateway-managed remote-desktop observe/control session contracts with a gated remote-desktop client launch helper, credential-seed support, session summaries, and per-target timelines, a UI toggle between target timeline and global dispatch log, permission-gated control requests, and auditable dispatch records. Remote-desktop control request and permission-result events should appear in the per-target timeline.

## Security Hardening

- Label: `security`, `roadmap`
- Goal: remove private data, improve approval gating, and harden defaults.

## CI / Release

- Label: `infra`, `roadmap`
- Goal: keep the public-release checks lightweight, auditable, and useful.

## v0.1.0-alpha

- Label: `release`, `roadmap`
- Goal: tag the first alpha only after blockers and evidence are current.
