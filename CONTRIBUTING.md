# Contributing to ClawDesk

ClawDesk is published as an Apache-2.0 licensed, experimental OSS desktop orchestration project.
Forks, issues, PRs, test improvements, documentation improvements, and multi-editor collaboration are welcome.

## What to contribute

- Bug fixes with clear reproduction and verification.
- Redaction and public-release hygiene.
- Better tests, stronger CI, and release/reproducibility tooling.
- Documentation that improves the public OSS launch posture.
- Small, auditable feature work that matches the current roadmap.

## What not to contribute

- Any change that adds a paywall, subscription wall, or commercial usage restriction beyond the license.
- Secrets, tokens, private keys, private endpoints, personal data, or company/customer references.
- Unreviewed automation that can run actions without explicit approval.
- Large refactors or dependency migrations without an issue and a clear rationale.

## Local checks

Before opening a PR, run:

```powershell
npm run preflight
npm run i18n:audit:strict
npm test
npm run build
```

If you touch release, CI, security, or public-facing docs, also run the public-release check:

```bash
sh scripts/check-public-release.sh
```

## PR expectations

- Keep changes small and focused.
- Explain the problem, the change, and the validation in the PR description.
- Include a security impact note for anything touching approvals, transport, debug bundles, or release packaging.
- Redact issue attachments and screenshots before upload.

