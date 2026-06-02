# Security Policy

ClawDesk is an experimental desktop orchestration project. Security issues are treated as release blockers.

## Report privately

- Prefer a private GitHub Security Advisory if the issue is exploitable.
- If a private advisory is not available, open a minimal issue that describes the category without including secrets, tokens, private URLs, screenshots, or local paths.
- If an email contact is configured for a release, use `security@clawdesk.example` as the public placeholder only.

## What to include

- A short summary of the impact.
- Affected files or flows.
- Reproduction steps with redacted values.
- Whether the issue affects local-only, paired, or release flows.
- Whether screen capture, logs, or bundle exports are involved.

## What not to include

- Secrets, API keys, passwords, tokens, private keys, or credentials.
- Personal data.
- Private hostnames, IPs, or filesystem paths.
- Sensitive screenshots or raw debug bundles.

## Scope

- Remote control must remain explicitly paired and human-approved.
- Transport must remain local-first by default.
- Shell execution must remain allowlisted and approval-gated.
- Debug bundles must be redacted before sharing outside the repo.

