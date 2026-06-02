# Windows Development And Certification Plan

Primary target: Windows 11 x64 MSVC direct-download Beta.

First release lane is official-site direct sales only: signed NSIS installer, Lemon Squeezy license flow, production Gateway, and public support/legal links. Microsoft Store packaging remains in the repository for future readiness work, but it is not a first-release gate and should not be run for the direct-download Beta.

## Current release gate

Run:

```powershell
npm run beta:env:doctor
npm run beta:readiness
npm run verify:production-gateway:compose
npm run gateway:doctor
npm run verify:lemon:production
npm run tauri:build:win
npm run sign:win:doctor
npm run sign:win-installer
npm run release:metadata:win
$env:CLAWDESK_RELEASE_CHANNEL="beta-direct"
npm run release:guard:beta
npm run smoke:win-installer -- --no-build
npm run qa:beta-direct:win
```

Do not run these for first release direct sales:

```powershell
npm run tauri:build:store:win
npm run smoke:store-installer:win
npm run qa:store:win
```

## Blocking certification items

- Authenticode OV/EV certificate or Azure Trusted Signing profile.
- Windows SDK Signing Tools (`signtool.exe`) installed locally, unless signing is performed in CI.
- `signtool verify /pa /v` pass for the NSIS installer.
- Signing setup must follow `docs/windows/WINDOWS_SIGNING_SETUP.md`; configure exactly one signing method.
- SHA256 hash published on the Windows download page.
- SBOM artifacts generated and attached to release.
- `THIRD_PARTY_NOTICES.md`, OpenClaw MIT license, EULA, Privacy, Refund Policy, Digital Content Waiver, and AI Agent Risk Notice bundled in app resources.
- Lemon Squeezy webhook env and production Gateway URL configured outside the desktop app.
- SSO is optional for the first direct-download Beta. Keep `CLAWDESK_SSO_ISSUER_URL` and `CLAWDESK_SSO_CLIENT_ID` for future enterprise / strict production gates.
- `npm run preflight` must pass, including strict i18n audit, so Windows Beta builds do not ship new hardcoded UI copy outside the locale catalog.

## OpenClaw source import status

The Windows Beta imports the OpenClaw upstream provider/auth contract at commit `d4484158d9291820d7af236d4277704da019f609`.

Imported auth surfaces:

- `openai:api_key` for OpenAI API key login.
- `openai-codex:oauth` for OpenAI/Codex account login.
- Provider catalog metadata and auth source tracking surfaced through `/llm-providers` and `/compat/upstream/import-status`.

Full upstream runtime bundling is deferred until installer size, update policy, process cleanup, and signing reputation are stable.
