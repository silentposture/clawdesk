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
| High | 3 |
| Medium | 2 |
| Low | 1 |
| Info | 1 |

## Findings

### High: private identity data in public-facing materials

- A private developer/publisher identity and private support contact appeared in release docs, env templates, and release metadata helpers.
- Impact: public repo leakage of personal/company references.
- Status: being redacted toward placeholder values, but any remaining occurrences are blockers.

### High: private website and API hostnames in release docs and scripts

- A private website and API hostname were used in release-planning docs, gateway helpers, and release-packaging scripts.
- Impact: public repo exposes private infrastructure references.
- Status: move to `clawdesk.example` / `api.clawdesk.example` style placeholders or remove from public-facing files.

### Medium: commercial planning docs still exist in-tree

- Several docs under `docs/download`, `docs/legal`, `docs/payments`, and `docs/support` still reflect older commercial-beta planning language.
- Impact: the repo can read as mixed-policy unless these files are clearly archived or redacted.
- Status: retain only as provenance until the launch docs and archive policy are fully aligned.

### Medium: generated and release helper artifacts need explicit handling

- Generated HTML, logs, and release evidence files should not be treated as source of truth unless they are redaction-safe.
- Impact: accidental publication of stale or sensitive output.
- Status: keep generated artifacts out of public launch bundles unless intentionally redacted.

### Low: legacy text encoding and historical copy remain mixed

- Some historical documents still have legacy or garbled text and should be normalized or archived.
- Impact: lowers public clarity and launch credibility.
- Status: clean up over time, but it is not a security issue by itself.

### Info: mock secret placeholders exist in tests and local tooling

- The repo includes obvious fake tokens and passwords for test coverage and mock flows.
- Impact: not a live secret exposure, but they should remain clearly fake.
- Status: acceptable only if they stay mock-only and are not used for real services.

## Conclusion

The repo is not yet safe to publish as a public OSS launch artifact until the High findings are fully cleared and the blocker list is empty or explicitly accepted.

