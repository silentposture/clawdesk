# Contributing to ClawDesk

ClawDesk is published as noncommercial, source-available software. Forks, PRs, test improvements, documentation improvements, and multi-editor collaboration are welcome. New contributor-facing text should be written in English first; legacy Chinese text should be migrated or treated as historical notes.

## What to contribute

- Fix bugs, strengthen tests, and improve verification flows
- Fill in documentation, runbooks, release gates, and CI
- Improve source integrity, build reproducibility, and cross-platform parity
- Remove or reword any remaining commercial phrasing

## What not to contribute

- Any change that turns this project into a commercial paid product, paywall, subscription wall, or hosted paid service
- Secrets, tokens, private keys, payment credentials, or any other sensitive data
- Noise-only formatting PRs unless there is a clear reason

## Local checks

Before opening a PR, run:

```powershell
npm run preflight
npm run i18n:audit:strict
npm test
npm run build
```

If you touch release or CI files, also run the relevant workflow locally or verify the latest GitHub Actions run.

## PR expectations

- Keep changes small and focused.
- Explain the problem, the change, and the validation in the PR description.
- If you are changing licensing or governance text, update every visible entry point that describes the project model.
