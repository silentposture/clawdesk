# OpenClaw Windows Runtime Adapter

This project does not directly bundle the full upstream OpenClaw runtime into the first Windows NSIS Beta. The upstream tree is large and includes multi-platform app code, plugin runtimes, CLI auth stores, pairing, cron, media, and deployment surfaces that need signing, sandboxing, and credential hardening before commercial distribution.

The Windows landing path is therefore a runtime adapter contract:

- Provider auth: OpenAI API key, OpenAI/Codex account OAuth stub, local endpoint, and mock modes are exposed as Windows Gateway endpoints.
- Provider catalog: ClawDesk carries upstream provider ids/source metadata and validates provider selection through the mock Gateway.
- Gateway events: WebSocket event contract covers agent deltas, canvas patches/data, permission request/result, and gateway status.
- Permission/tools: GUI approval flow is implemented and tested; real plugin loading remains blocked on Windows sandbox policy.
- Sessions/agents: deterministic mock-backed session flow exists; signed production Gateway runner remains the next migration layer.
- Config: Windows guided settings and release configs exist; upstream config import/export remains pending.
- Memory/workflows: mock-backed state exists; durable local store, scheduler, embeddings, and vector runtime remain pending.

Runtime contract source:

- `src/lib/openclawRuntime.ts`
- `GET /openclaw/runtime-contract`
- `POST /openclaw/runtime/auth-plan`

Current status is honest by design: several surfaces are contract-compatible, but not all upstream execution paths are production-backed yet.
