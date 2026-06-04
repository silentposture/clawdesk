# ClawDesk Mock Gateway

這個 Node sidecar 提供第一版桌面 MVP 合約，不需要先取得 upstream OpenClaw checkout。

- `GET /health`
- `GET /backend/status`
- `GET /backend/deployment-plan`
- `GET /backend/audit`
- `POST /backend/save-state`
- `POST /chat`
- `POST /permission-result`
- `GET /auth/session`
- `GET /identity/session`
- `POST /identity/register`
- `GET /identity/verification-code`
- `POST /identity/resend-verification`
- `POST /identity/confirm`
- `POST /identity/login`
- `POST /identity/sso`
- `POST /identity/logout`
- `GET /llm-providers`
- `POST /auth/chatgpt-pro/configure`
- `POST /auth/chatgpt-pro/account`
- `POST /auth/provider`
- `POST /auth/openai-api-key`
- `POST /auth/local-model`
- `POST /auth/mock`
- `GET /provider/secret-ref/contract`
- `POST /provider/secret-ref/issue`
- `POST /provider/token-refresh`
- `GET /provider/openai/runtime-contract`
- `POST /provider/openai/validate-key`
- `POST /provider/openai/chat-test`
- `POST /chat`：若目前供應商為 `openai-api`，會先透過 `openai` runtime 文字輸出生成後再串流；預設為 dry-run，不回傳 API key。
- `GET /accounts`
- `POST /accounts/connect`
- `GET /channels`
- `POST /channels/configure`
- `POST /channels/test-message`
- `GET /mcp/connectors`
- `POST /mcp/connect`
- `POST /mcp/preview`
- `GET /workflows`
- `POST /workflows`
- `GET /targets`
- `POST /targets`
- `POST /targets/credential-ref/issue`
- `POST /targets/credential-bundle/export`
- `POST /targets/credential-bundle/preview`
- `POST /targets/credential-bundle/import`
- `POST /targets/connection`
- `GET /targets/ssh-terminal/session`
- `POST /targets/ssh-terminal/session`
- `GET /targets/remote-desktop/session`
- `POST /targets/remote-desktop/session`
- `POST /targets/dispatch-preview`
- `POST /targets/dispatch`
- `POST /targets/execute`

SSH terminal sessions maintain a redacted transcript snapshot and session summary, and only allow allowlisted commands after pairing, credential-ref / known-host validation, and gateway-managed session open. Remote desktop sessions expose observe / control / release state and session summary under the same contract layer, plus a gated native client launch helper for the local RDP client.
Remote desktop credential refs can be seeded into the local Windows credential flow before launch when the target uses `secret-ref` mode.
The remote-desktop session endpoint also accepts a `seed_credentials` action so the control plane can prepare the client credential before the actual launch.
`credential-bundle` 匯出 / 預覽 / 匯入端點會把 target registry 與 gateway-managed credential refs 以 passphrase-protected encrypted bundle 在機器間移轉，匯入後會重新發行本機 credential refs；preview 只回傳可審核的 target / secret 摘要與匯入影響，不會暴露明文 secret。
`POST /targets/connection` 現在支援 `pair`、`probe`、`verify_host_key`、`connect`、`disconnect` 與 `refresh`，其中 `probe` 會回報 SSH / RDP host 與 port 的實際可達性。

- `GET /compat/settings`
- `POST /compat/settings`
- Legacy aliases: `GET /openclaw/settings`, `POST /openclaw/settings`
- `ws://127.0.0.1:18890/events`

Email 檢核流程（mock）：

- `register`：建立帳號後先回傳 `emailVerificationPending=true`，不直接登入。
- `GET /identity/verification-code?email=<email>`：回傳目前有效驗證碼，用於本地除錯與 UI 測試。
- `identity/resend-verification`：重新建立驗證記錄。
- `confirm`：可用 `code` 或 `token` 驗證，通過後才可 login。

OpenAI runtime probe 預設只做 dry-run，不會呼叫外部 OpenAI API，也不回傳 API key。若要做 live 測試，需設定 `CLAWDESK_OPENAI_LIVE_TEST=1` 並提供 request body `apiKey` 或環境變數 `OPENAI_API_KEY`；實作使用 OpenAI Responses API 合約。

MCP 與帳號/授權相關 API 全部僅為本機模擬，實際郵件發送與 SSO 需接上正式後端時另外接線。

後端模擬部署能力：

- 設定 `CLAWDESK_MOCK_STATE_FILE=/path/to/state.json` 後，mock gateway 會保存帳號、授權、工作流、Agent、記憶、知識源、診斷與審計事件。
- `/backend/status` 回傳目前後端服務、持久化、provider 與資料量狀態。
- `/backend/audit` 回傳去識別化審計事件；Email 只保存 hash，不保存完整金鑰、API key 或完整使用者路徑。
- `npm run verify:backend` 會驗證狀態持久化、重啟復原、審計去識別化與部署計畫端點。

WebSocket 串流會送出 React 前端使用的穩定事件合約：

- `agent.message.delta`
- `agent.message.done`
- `canvas.begin`
- `canvas.patch`
- `canvas.data`
- `permission.request`
- `permission.result`
- `gateway.status`

瀏覽器開發模式可用以下指令啟動：

```sh
npm run gateway
```

MCP 端點目前提供 Microsoft 365、Google Workspace、瀏覽器與螢幕 GUI、程式開發工具、工程設計軟體與雲端服務 mock adapter。

其中：

- Microsoft 365 connector 包含 `microsoft-graph`（OAuth 2.0）與本機 mock 的 Office URI protocol metadata。
- Google Workspace connector 包含 `google-workspace-apis`（OAuth 2.0）協定 metadata。

需要授權的工具會送出 `permission.request`。工作流端點提供排程範本與草稿建立，用來測試桌面端自動化管理 UI。
