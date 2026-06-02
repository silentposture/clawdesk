# Codex for Open Source Application Pack

This is the canonical application packet for OpenAI's Codex for Open Source program.
It is based only on official OpenAI sources:

- [Announcement / program page](https://developers.openai.com/community/codex-for-oss)
- [Application form](https://openai.com/form/codex-for-oss/)
- [Program terms](https://developers.openai.com/codex/codex-for-oss-terms)

## Summary

ClawDesk is an experimental AI desktop workbench, control plane, and contract layer focused on local-first control, explicit approval, redacted diagnostics, and transparent release tooling. It is public, Apache-2.0, and actively maintained, but it is not a production-ready remote desktop product.

## What the program includes

Selected maintainers may receive:

- Six months of ChatGPT Pro, which includes Codex
- Conditional access to Codex Security
- API credits for coding, maintainer automation, release workflows, and core open source work

## Who should apply

- Core maintainers or primary maintainers of active public OSS projects
- Maintainership with real repo control or permissions
- Projects with meaningful usage, ecosystem importance, or clear maintenance activity
- Projects that may not fit the criteria perfectly, but can explain why they matter to the ecosystem

## What OpenAI says it looks for

- Repository usage or clear ecosystem importance
- Evidence of active maintenance
- Role and permissions that match the submission
- Accurate and complete information about the repo and maintainer
- Rolling review with no guarantee of selection, funding, or access

## Application fields

- Email linked to a ChatGPT account
- Public GitHub username
- Public GitHub repository URL
- Primary maintainer or core maintainer role
- Why the repository qualifies, max 500 characters
- Interest in Codex Security and/or API credits
- OpenAI Organization ID, if requested by the form
- How API credits will be used, max 500 characters
- Anything else we should know, max 500 characters

## Suggested drafts

### Why this repository qualifies

ClawDesk is a public Apache-2.0 OSS project focused on AI-agent-first desktop orchestration, local-first control, human-approved automation, redacted diagnostics, and transparent release hygiene. The repo has current public OSS entry points, a documented security model, public-release checks, issue and PR templates, and a clear maintenance cadence. It is relevant to maintainers and the wider ecosystem because it documents and prototypes guarded agentic desktop workflows.

### How API credits will be used

Use API credits for maintainer review, issue triage, release prep, documentation updates, redaction checks, and lightweight automation around public OSS hygiene. Keep all impactful changes human-reviewed and avoid using credits to bypass approval or safety gates.

### Anything else we should know

ClawDesk is intentionally local-first, human-approved, and audit-friendly. It does not claim production readiness, unrestricted remote control, or unsupported adoption metrics. Public evidence is tracked in `docs/public-oss-evidence.md`, and release hygiene is maintained through `docs/maintenance.md`.

## Submission checklist

- Refresh `docs/public-oss-evidence.md` before submitting.
- Verify the GitHub profile and repository are public.
- Do not claim selection, production readiness, or unverified adoption.
- Submit the form manually through the official OpenAI page.

## Evidence snapshot

- [Public OSS evidence snapshot](public-oss-evidence.md)
- [Maintenance cadence](maintenance.md)
- Anonymous GitHub access to `https://github.com/silentposture/clawdesk.git` has been verified from this workspace.
- The public-release scan, dependency audit, and current branch state are recorded in the evidence snapshot and should be refreshed before any external request.
