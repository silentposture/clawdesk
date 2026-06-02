# Maintenance Cadence

This document describes the recurring work needed to keep ClawDesk credible as a public OSS project and as an agentic desktop orchestration codebase.

## Weekly

- Refresh the public release audit and blocker list if public-facing files changed.
- Run the public release scan and review any new warnings.
- Triage new issues for redaction, reproducibility, and security impact.

## Per change

- Update `docs/public-oss-evidence.md` whenever the branch state or public-release evidence changes.
- Keep `README.md`, `SECURITY.md`, `CONTRIBUTING.md`, and the roadmap aligned with the actual codebase.
- Mark features as `Implemented`, `Experimental`, or `Planned` instead of implying production status.

## Before a support request or external review

- Re-check that no private emails, endpoints, local paths, or binary artifacts are exposed.
- Ensure the request text matches the actual repo state and does not claim invite eligibility or production readiness.
- Attach the evidence snapshot instead of ad hoc claims.

## Agentic-program hygiene

- Keep human approval required for critical actions.
- Keep the debug bundle redacted.
- Keep remote control local-first and explicitly paired.
- Prefer small auditable PRs over broad refactors.
