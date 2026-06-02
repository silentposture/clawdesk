# ClawDesk Production Gateway Draft

This document is a historical planning note. The public OSS launch uses placeholder hosts and local-first defaults unless a future release explicitly documents a different transport.

## Public placeholders

- Website: `https://clawdesk.example/`
- API host: `https://api.clawdesk.example`
- Webhook path: `https://api.clawdesk.example/webhooks/license`

## Current guidance

- Keep gateway deployment separate from the desktop shell.
- Keep secrets server-side only.
- Keep public docs free of private hostnames, private support contacts, and personal names.
- Use the release checklist and audit file before publishing any generated gateway artifact.
