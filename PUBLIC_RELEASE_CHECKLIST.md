# Public Release Checklist

Use this checklist before any public OSS launch or public artifact publish.

## Identity and licensing

- [ ] README states the project purpose without overclaiming.
- [ ] LICENSE is Apache-2.0.
- [ ] CONTRIBUTING, SECURITY, and CODE_OF_CONDUCT are present.
- [ ] No personal/company refs remain in public-facing files.

## Security and redaction

- [ ] No live secrets, tokens, or private keys are committed.
- [ ] No private endpoints, private hostnames, or personal email addresses remain.
- [ ] Debug bundle instructions are redaction-safe.
- [ ] Sensitive screenshots and logs are excluded from issue templates.

## Build and release

- [ ] `npm run preflight` passes.
- [ ] `npm run i18n:audit:strict` passes.
- [ ] `npm test` passes.
- [ ] `npm run build` passes.
- [ ] Public-release CI passes.

## Evidence

- [ ] `docs/audit/public-release-audit.md` is current.
- [ ] `PUBLIC_RELEASE_BLOCKERS.md` is empty or explicitly accepted.
- [ ] Roadmap and MVP scope match the actual implementation state.

