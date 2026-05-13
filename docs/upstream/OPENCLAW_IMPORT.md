# OpenClaw Upstream Import Record

Windows landing focus: ClawDesk imports the OpenClaw provider/auth contract needed for Windows direct-download Beta, instead of bundling the full 17k-file upstream workspace into the installer.

## Source

- Repository: https://github.com/openclaw/openclaw
- Commit: `d4484158d9291820d7af236d4277704da019f609`
- License: MIT
- Local audit clone used during import: `%TEMP%\openclaw-upstream`

## Imported surfaces

- `src/agents/model-auth.ts`: provider auth resolution precedence, env/profile/custom provider model.
- `src/agents/auth-profiles/*`: OAuth/API-key profile concept and account-based credential state.
- `src/plugin-sdk/provider-auth.ts`: provider onboarding helpers and API key/OAuth exports.
- `src/commands/auth-choice-options.static.ts`: custom provider / OpenAI-compatible endpoint onboarding shape.
- `src/plugin-sdk/provider-catalog-shared.ts`: configured provider catalog normalization.

## ClawDesk adaptation

- `openai-api` and `openai` use the upstream `openai:api_key` contract.
- `openai-codex` and ChatGPT Pro account mode use the upstream `openai-codex:oauth` account/profile contract.
- Desktop GUI never stores website passwords or cookies.
- API keys are accepted by the mock Gateway only for local simulation and are displayed as masked previews.
- Production Windows Beta must move credential storage to Windows Credential Manager or an equivalent encrypted store before GA.

## Deferred full upstream sidecar

Full upstream OpenClaw runtime bundling is intentionally deferred until Windows signing, installer size, update policy, and process cleanup are hardened. The current app exposes an OpenClaw-compatible Gateway contract and an import-status endpoint at `/openclaw/upstream/import-status`.
