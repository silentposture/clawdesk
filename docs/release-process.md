# Release Process

ClawDesk release work for the AI desktop workbench, control plane, and contract layer should stay auditable, honest, and redaction-safe.

## Release phases

1. Update the roadmap and release checklist.
2. Run the public-release audit.
3. Resolve blockers or move them into explicit archival notes.
4. Run the local validation set.
5. Generate the debug bundle only if it is redacted.
6. Tag the release after the evidence is current.

## Minimum checks

```powershell
npm run preflight
npm run i18n:audit:strict
npm test
npm run build
```

## Public-release checks

- Run `sh scripts/check-public-release.sh` in CI or from a Unix shell.
- Verify no private support contact, private hostname, or local path is still visible.
- Verify the release notes do not imply production readiness unless the matching evidence exists.

## Evidence rules

- Screenshots must be redacted before being attached to issues or PRs.
- Logs must be trimmed to the smallest reproducible slice.
- Debug bundles must exclude credentials and private endpoints.
