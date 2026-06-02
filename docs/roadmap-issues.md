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
- Goal: unify safe dispatch across SSH terminals, remote desktop sessions, and local targets under a single control plane, with registry UI, pairing, host-key verification, allowlisted SSH/local-shell execution, and auditable dispatch records.

## Security Hardening

- Label: `security`, `roadmap`
- Goal: remove private data, improve approval gating, and harden defaults.

## CI / Release

- Label: `infra`, `roadmap`
- Goal: keep the public-release checks lightweight, auditable, and useful.

## v0.1.0-alpha

- Label: `release`, `roadmap`
- Goal: tag the first alpha only after blockers and evidence are current.
