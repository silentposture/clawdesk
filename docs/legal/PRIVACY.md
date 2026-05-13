# ClawDesk Beta Privacy Draft

This draft covers the Windows direct-download Beta and requires legal review before public sale.

ClawDesk stores workspace settings, license entitlement state, machine binding hashes, and diagnostic reports locally unless the user explicitly submits or exports a report. The app must not store full license keys, payment secrets, full API keys, plaintext email in diagnostics, full local file paths, screenshots, or chat contents inside support bundles.

Payments are handled by hosted checkout. The desktop app does not process or store card details.

Support diagnostics may include app version, build channel, operating system summary, redacted errors, release status, and legal consent hash.
