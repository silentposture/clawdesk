# Public OSS Evidence Snapshot

This snapshot records the current public-release posture of ClawDesk. Refresh it whenever the repository changes materially before using it in an external request.

## Repository state

- Public GitHub repository: `https://github.com/silentposture/clawdesk.git`
- Current launch-prep branch: `oss-launch-prep`
- Latest known commit on this branch: `9fd65ba`
- Anonymous GitHub access check: successful `git ls-remote` against the repository returned `HEAD` and `refs/heads/oss-launch-prep`

## Public-release evidence

- `bash scripts/check-public-release.sh` -> `PASS: public release surface looks clean.`
- `npm audit --omit=dev --json` -> 0 vulnerabilities
- `git diff --check` -> no formatting errors in the current public-launch document set
- `git status --short` -> clean after the latest push

## OSS foundation evidence

- Apache-2.0 license in `LICENSE`
- Public OSS entry points in `README.md`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `ROADMAP.md`, and `CHANGELOG.md`
- Public release audit in `docs/audit/public-release-audit.md`
- Public release blockers in `PUBLIC_RELEASE_BLOCKERS.md`
- Lightweight CI in `.github/workflows/public-release-ci.yml`
- Maintenance cadence in `docs/maintenance.md`

## Agentic-program evidence

- Agent bridge documentation in `docs/agent-bridge.md`
- Architecture and security model docs in `docs/architecture.md` and `docs/security-model.md`
- Local-only and human-approved automation rules documented in `README.md`
- Debug bundle and public-release checks documented in `docs/release-process.md`

## Submission note

Use this file as the factual backing for any OpenAI support or promo request. Do not claim production readiness, invite eligibility, or promotional approval that has not been granted.
