# ClawDesk 後端授權模擬服務

這份模擬後端是「Windows 直售 Beta 先用 Lemon Squeezy，後續可替換 Paddle + Keygen」的本地替代，目的是讓桌面端整套授權、帳號、webhook 與診斷流程先行自動化驗證。

## 啟動方式

```sh
node backend/server.mjs
```

或使用 npm：

```sh
npm run deploy:backend-sim
```

可直接呼叫 `http://127.0.0.1:19090`。

## 重要介面（MVP）

- `GET /health`
- `GET /contract`
- `GET /machine/fingerprint`
- `POST /auth/register`
- `POST /auth/confirm`
- `POST /auth/login`
- `POST /auth/sso/start`
- `POST /auth/sso/finish`
- `GET /auth/sso/providers`
- `GET /auth/session`
- `POST /licenses/activate-key`
- `POST /licenses/validate`
- `POST /licenses/refresh-offline-ticket`
- `POST /licenses/report-tamper`
- `GET /license/status`
- `POST /webhooks/paddle`
- `POST /webhooks/keygen`
- `POST /webhooks/lemon`
- `GET /updates/check`
- `GET /updates/history`
- `POST /diagnostics/create-report`
- `GET /legal/documents`
- `GET /legal/notices`

## 簽章與防篡改

- 授權內容以 `key`, `issuedAt` 等欄位組合後做 HMAC-SHA256 簽章。
- `offlineTicket` 封裝成 `keyId.base64payload.signature`。
- `/licenses/validate` 可驗證簽章與機器雜湊，不符會回傳失敗。

## Production adapter contract

- 共用合約定義在 `backend/contracts.mjs`。
- Adapter registry 定義在 `backend/adapters/`，目前有 `mock` 與 `production` 兩種模式。
- `CLAWDESK_BACKEND_ADAPTER_MODE=production` 會啟用 production adapter scaffold；在正式 Paddle/Keygen/OIDC 串接完成前，live API 呼叫會回傳明確 `501/503`，避免誤以為已上線。
- `/health` 會回傳 `contractVersion`、`paymentProvider=paddle`、`licenseProvider=keygen`、`betaPaymentProvider=lemon-squeezy`、`betaLicenseProvider=lemon-license`，以及 production / beta-direct 必要環境變數是否存在；不回傳 secret 值。
- `/contract` 會回傳正式 Gateway、Paddle、Keygen、Identity、Updates、Diagnostics、Legal 需要支援的 endpoint manifest。
- mock backend 與未來 production backend 必須共用同一份 Lemon / Paddle / Keygen webhook event mapping，避免桌面端與後端部署分裂。

## 開發注意

- 這是模擬環境，**所有機器資訊與信箱僅保留匿名化雜湊**。
- `CLAWDESK_BACKEND_STATE_FILE` 可指定持久化路徑，預設在 `.clawdesk-backend/state.json`。
