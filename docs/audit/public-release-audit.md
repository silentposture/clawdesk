# Public Release Audit

## Scope

- Repository: `silentposture/clawdesk`
- Public name: `ClawDesk`
- Branch: `oss-launch-prep`
- Audit focus: secrets, credentials, private URLs/IPs, local paths, logs, binaries, generated files, and personal/company data.

## Findings summary

| Severity | Count |
| --- | ---: |
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 2 |
| Info | 1 |

## Findings

### Low: historical provenance docs still exist in-tree

- Several docs under `docs/download`, `docs/legal`, `docs/payments`, and `docs/support` are legacy planning notes.
- Impact: the repo can read as mixed-policy if those notes are mistaken for active policy.
- Status: acceptable because the files are clearly labeled historical and no longer define launch policy.

### Low: generated and release helper artifacts need explicit handling

- Generated HTML, logs, and release evidence files should not be treated as source of truth unless they are redaction-safe.
- Impact: accidental publication of stale output.
- Status: the public-release check covers the obvious leak patterns; keep generated artifacts out of public launch bundles unless intentionally redacted.

### Info: mock secret placeholders exist in tests and local tooling

- The repo includes obvious fake tokens and passwords for test coverage and mock flows.
- Impact: not a live secret exposure, but they should remain clearly fake.
- Status: acceptable only if they stay mock-only and are not used for real services.

## Conclusion

The repo has no live secret, private-email, or private-hostname findings in the active public surface. Remaining work is routine hygiene: keep historical notes clearly labeled and keep the release checks current.
