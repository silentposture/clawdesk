# OpenClaw Feature Parity Matrix

Source repository: https://github.com/openclaw/openclaw  
Audited commit: `d4484158d9291820d7af236d4277704da019f609`  
License: MIT  
Scan date: 2026-05-14  
Audited source files under `src`, `extensions`, `apps`, and `packages`: 14,886

This matrix is the Windows landing baseline. ClawDesk should not bundle the full upstream tree into the NSIS installer until signing, update, sidecar cleanup, and credential storage are hardened. Instead, every upstream feature domain is mapped to a Windows-safe implementation status and a concrete next action.

| Domain | Upstream surface | ClawDesk Windows status | Difference / next action |
| --- | --- | --- | --- |
| Model auth and OpenAI login | `src/agents/model-auth.ts`, `src/agents/auth-profiles/*`, `src/plugin-sdk/provider-auth.ts` | Partial | Imported `openai:api_key` and `openai-codex:oauth` contracts. Next: Windows Credential Manager and token refresh. |
| Provider/model catalog | `src/model-catalog/*`, `src/agents/models-config.providers.ts`, `src/plugin-sdk/provider-catalog-shared.ts` | Partial | Local provider list exists. Next: import context window, cost, live catalog/cache metadata. |
| Gateway protocol | `src/gateway/*` | Mock | Mock Gateway covers current desktop flow. Next: signed Windows upstream sidecar launcher and full RPC/auth parity. |
| Agents runtime | `src/agents/*` | Mock | GUI has agent/project mock. Next: session model, failover, tool approval, embedded runner. |
| Plugin SDK/tools | `src/plugin-sdk/*`, `packages/plugin-sdk/*` | Partial | MCP/tool previews exist. Next: Windows plugin sandbox and provider/tool runtime. |
| Extensions/connectors | `extensions/*` | Mock | Connector catalog exists. Next: allowlist Windows Beta connectors first. |
| Messaging channels | `src/channels/*`, channel extensions | Partial | UI and permission preview exist. Next: webhook/runtime delivery. |
| Cron/workflows | `src/cron/*` | Mock | Workflow CRUD mock exists. Next: Windows Task Scheduler or app-owned scheduler. |
| Memory/embeddings | `packages/memory-host-sdk/*`, context modules | Mock | Memory UI/mock exists. Next: local SQLite/JSON then embeddings/vector store. |
| Security/auth profiles/secret refs | auth profiles, secrets, config secret refs | Partial | Redaction and masked keys exist. Next: profile store and Windows Credential Manager. |
| Config schema/guided setup | `src/config/*`, `src/commands/*` | Partial | Guided setup exists. Next: import/export upstream config with Windows validation. |
| Control UI/TUI/model picker | `ui/src/*`, `src/tui/*` | Partial | Tauri React GUI is native Windows path. Next: auth status/model picker behavior parity. |
| Media understanding/generation | `src/media-understanding/*`, `src/media-generation/*` | Mock | Capability declaration exists. Next: Windows Media Foundation/WASAPI/WIC or ffmpeg sidecar. |
| TTS/talk/realtime transcription | `src/tts/*`, realtime transcription | Deferred | Not a first Beta blocker. Next: Windows audio pipeline and speech provider. |
| Pairing/device/node mode | `src/pairing/*`, mobile apps | Deferred | First Beta uses loopback only. Next: device pairing after desktop stability. |
| macOS/iOS/Android apps | `apps/macos/*`, `apps/ios/*`, `apps/android/*` | Not applicable | Not bundled into Windows installer; only protocol/UX lessons apply. |
| SDK/client API | `packages/sdk/*` | Deferred | Internal Gateway contract now. Next: local SDK or upstream SDK compatibility. |
| Windows packaging/certification | upstream package/windows helpers plus local Tauri | Partial | NSIS/release guard present. Signing/certification intentionally held. |

Machine-readable parity is exposed in the app via `src/lib/openclawFeatureParity.ts` and in the mock Gateway at:

- `GET /openclaw/upstream/import-status`
- `GET /openclaw/feature-parity`
