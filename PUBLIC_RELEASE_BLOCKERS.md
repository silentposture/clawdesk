# Public Release Blockers

This file records what still blocks a credible public OSS launch.

## P0 blockers

- Any remaining private developer name, support email, or company reference in public-facing docs, release metadata, or bundle resources.
- Any remaining private website or API hostname in release docs or scripts.
- Any tracked generated artifact that contains sensitive operational details.

## P1 blockers

- Historical commercial planning docs that still need redaction or archival treatment.
- Any release workflow that can fail due to environment-only requirements on a clean local checkout.
- Any issue template or debug bundle flow that can leak logs, screenshots, or local paths.

## Current stance

Safe public release: NO until the blockers above are cleared and the audit file says otherwise.

