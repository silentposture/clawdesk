# Windows Development And Certification Plan

Primary target: Windows 11 x64 MSVC direct-download Beta.

## Current release gate

Run:

```powershell
npm run tauri:build:win
npm run sign:win-installer -- .\src-tauri\target\release\bundle\nsis\ClawDesk_0.1.0_x64-setup.exe
$env:CLAWDESK_RELEASE_CHANNEL="beta-direct"
npm run cert:windows:check
```

## Blocking certification items

- Authenticode OV/EV certificate or Azure Trusted Signing profile.
- `signtool verify /pa /v` pass for the NSIS installer.
- SHA256 hash published on the Windows download page.
- SBOM artifacts generated and attached to release.
- `THIRD_PARTY_NOTICES.md`, OpenClaw MIT license, EULA, Privacy, Refund Policy, Digital Content Waiver, and AI Agent Risk Notice bundled in app resources.
- Lemon Squeezy webhook env and production Gateway URL configured outside the desktop app.

## OpenClaw source import status

The Windows Beta imports the OpenClaw upstream provider/auth contract at commit `d4484158d9291820d7af236d4277704da019f609`.

Imported auth surfaces:

- `openai:api_key` for OpenAI API key login.
- `openai-codex:oauth` for OpenAI/Codex account login.
- Provider catalog metadata and auth source tracking surfaced through `/llm-providers` and `/openclaw/upstream/import-status`.

Full upstream runtime bundling is deferred until installer size, update policy, process cleanup, and signing reputation are stable.
