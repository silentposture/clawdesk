# Public OSS Evidence Snapshot

This snapshot records the current public-release posture of ClawDesk. Refresh it whenever the repository changes materially before using it in an external request.

## Repository state

- Public GitHub repository: `https://github.com/silentposture/clawdesk.git`
- Current public refs: `main` at `7049952` and `oss-launch-prep` at `7049952`
- Launch evidence commit used for this snapshot: `8b8ce37`
- Anonymous GitHub access check: successful `git ls-remote` against the repository returned `HEAD`, `refs/heads/main`, and `refs/heads/oss-launch-prep`

## Public-release evidence

- `npm run legal:manifest` -> regenerated `src/lib/legalConsentManifest.ts` for the current launch branch snapshot `8b8ce37`
- `npm run legal:notices` -> regenerated `docs/legal/THIRD_PARTY_NOTICES.md` for the current launch branch snapshot `8b8ce37`
- `npm run preflight` -> `PASS`
- GitHub Actions `Hidden Window Gate` run [26847013000](https://github.com/silentposture/clawdesk/actions/runs/26847013000) on `main` -> success
- GitHub Actions `Hidden Window Gate` run [26846862868](https://github.com/silentposture/clawdesk/actions/runs/26846862868) on `oss-launch-prep` -> success
- GitHub Actions `Public Release CI` run [26847012999](https://github.com/silentposture/clawdesk/actions/runs/26847012999) on `main` -> success
- GitHub Actions `Public Release CI` run [26846863161](https://github.com/silentposture/clawdesk/actions/runs/26846863161) on `oss-launch-prep` -> success
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

Use this file as the factual backing for the Codex for Open Source application packet or any other OpenAI support request. Do not claim production readiness, selection, approval, or guaranteed funding that has not been granted.
