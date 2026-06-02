# Troubleshooting

Use this guide for common launch-prep problems.

## Build or test failures

- Run `npm run preflight`.
- Run `npm test`.
- Run `npm run build`.
- Check whether generated legal files or release metadata are stale.

## Public-release scan failures

- Look for private email addresses, private hostnames, or local paths.
- Check `README.md`, `docs/README.md`, `PUBLIC_RELEASE_BLOCKERS.md`, and the current release docs first.
- Confirm that screenshots, logs, and debug bundles are redacted.

## Hidden-window or policy gate failures

- Confirm the host is running locally.
- Confirm the approval queue is populated correctly.
- Confirm the action is allowlisted and workspace-scoped.
- Confirm the change does not require a sensitive handoff.

## Debug bundle issues

- Exclude secrets, screenshots with sensitive content, and raw credentials.
- Include the minimal evidence needed to reproduce the bug.
- Prefer a redacted bundle over a full workspace dump.

