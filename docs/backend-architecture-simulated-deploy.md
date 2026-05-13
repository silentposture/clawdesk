# ClawDesk 後端架設與模擬部署

## 你現在這個版本（MVP）實際需要的後端

以目前程式實作，最少只要 **1 個主要後端服務**：

- `mock-gateway`（Node）
  - 身分（註冊 / 登入 / SSO mock / Email 驗證）
  - 授權（Paddle + Keygen mock 事件）
  - MCP 目錄與權限預覽
  - 訊息串流 (`/chat`, WebSocket `/events`)
  - 工作流、Agent、記憶、診斷、人體工學驗證 API

## 建議啟動服務（模擬 / 本機測試）

可按用途選擇：

- `mock-gateway`（1 服務）：可完成桌面端基本功能驗證
- `backend-auth`（2 服務）：模擬獨立認證授權服務（Paddle/Keygen）
- `mock-mail`（3 服務）：模擬寄件/收件流程（Email 驗證）
- `reverse-proxy`（4 服務）：模擬外部對外入口

建議實務配法：

- 開發/GUI 驗證：`mock-gateway`（1 服務）
- 帳號驗證與 webhook 演練：`mock-gateway + backend-auth`（2 服務）
- 驗證信預覽流程：再加上 `mock-mail`（3 服務）
- 要求更像上線前入口：再加上 `reverse-proxy`（4 服務）

目前實務上，前端功能已可僅靠 `mock-gateway` 驗證；完整認證與付款模擬建議至少用 3 服務。

## 目前已實作的後端工程化能力

- 狀態持久化：設定 `CLAWDESK_MOCK_STATE_FILE` 後，會保存帳號、授權、工作流、Agent、知識源、記憶、診斷與審計事件。
- 審計事件：`/backend/audit` 只輸出去識別化 actor hash 與 redacted details，不保存完整 Email、完整 license key、API key 或完整使用者路徑。
- 後端健康：`/backend/status` 回傳目前 provider、資料量、持久化狀態與部署模式。
- 部署計畫：`/backend/deployment-plan` 回傳正式版要拆出的 production modules 與必要環境變數。
- 自動驗證：`npm run verify:backend` 會啟動 gateway、建立資料、保存狀態、重啟 gateway、確認資料仍可讀。

另外新增了 `backend/server.mjs`（本機授權服務模擬）：

- 身分：註冊、信箱確認、登入、SSO 入口、會話查詢、SSO 提供者清單
- 授權：key 啟用、離線票券、ticket 驗證、device binding、tamper 回報
- webhook：`/webhooks/paddle`、`/webhooks/keygen` mock
- 更新權益：`/updates/check`、`/updates/history`
- 法務與診斷：`/legal/documents`、`/legal/notices`、`/diagnostics/create-report`
- 產品：`/machine/fingerprint`

## 正式版本（建議）建議拆分

若日後上 production，建議拆成：

1. Gateway API（事件、工作流、MCP Adapter Proxy）
2. 身分認證服務（Email/SSO、密碼、會話）
3. 授權服務（Paddle webhook + Keygen adapter + license 狀態）
4. 企業帳號 / 組織服務（多人權限）
5. 通知與 Webhook 服務（信件、Slack、Teams 等）
6. 觀測與日誌（監控、診斷封包、稽核）

## 快速模擬部署

使用下列現成指令即可：

```sh
# 1) MVP
npm run deploy:mock
npm run deploy:mock:logs
npm run deploy:mock:down

# 2) 加入 auth 模擬（建議）
docker compose -f docker-compose.mock-gateway.yml -f docker-compose.backend-sim.yml up -d
docker compose -f docker-compose.mock-gateway.yml -f docker-compose.backend-sim.yml down

# 3) 一鍵完整模擬
npm run deploy:mock:full
npm run deploy:mock:full:logs
npm run deploy:mock:full:down

# 4) 一鍵全鏈路（gateway + backend-auth + mail + reverse-proxy）
npm run deploy:full:stack
npm run deploy:full:stack:logs
npm run deploy:full:stack:down
```

## 模擬部署步驟

1. 安裝 Docker。
2. 在專案根目錄執行：

```sh
npm run deploy:mock
npm run deploy:backend-sim
docker compose -f docker-compose.mock-gateway.yml -f docker-compose.backend-sim.yml up -d
npm run deploy:mock:full
npm run deploy:full:stack
```

3. 連到 Gateway：
- REST: `http://127.0.0.1:18890`
- WebSocket: `ws://127.0.0.1:18890/events`
4. 連到後端認證中心（模擬）：
- REST: `http://127.0.0.1:19090`
- 健康檢查: `http://127.0.0.1:19090/health`
5. Mail / 反向代理（完整模式）：
- Mail UI: `http://127.0.0.1:8025`
- 代理入口: `http://127.0.0.1:18889`

6. 用前端桌面端或 `npm run dev` 測試：

```sh
npm run dev
```

7. Email 驗證 mock 可在 `mock-mail` 的 Web UI 檢查：`http://127.0.0.1:8025`

## 後端驗證指令

```sh
npm run verify:backend
npm run verify:backend:sim
npm run verify:mvp
npm test
npm run build
npm run smoke:gui
```

`verify:backend` 使用暫存 state file，不會污染正式專案資料；Docker mock 則會把 state 放在 `.clawdesk-mock/state.json`，此資料夾已加入 `.gitignore`。

## 你目前可直接用的差異

- `npm run gateway` 啟動的就是同一套 mock-gateway。
- `npm run verify:mvp` 已覆寫為 email 註冊驗證流程：
  - register → verification endpoint → confirm → login
