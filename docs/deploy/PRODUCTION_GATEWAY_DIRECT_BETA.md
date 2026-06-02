# ClawDesk Windows 直售 Beta Production Gateway 部署

目標：把桌面 app 的 `CLAWDESK_GATEWAY_BASE_URL` 指到正式 HTTPS API host，例如 `https://api.naviaworks.net`。首頁 `https://naviaworks.net/` 只能作為下載/說明頁，不能當 Gateway base URL。

## 本機檢查

```powershell
npm run beta:env:doctor
npm run verify:production-gateway:compose
npm run verify:production-gateway:sim
npm run verify:lemon:production
```

`verify:production-gateway:compose` 只檢查 Docker Compose 設定是否可解析，不會輸出 `.env.production` 的敏感值。

## 部署檔

使用：

```powershell
docker compose -f docker-compose.production-gateway.yml config
docker compose -f docker-compose.production-gateway.yml up -d
```

若要同時啟用 Nginx HTTPS reverse proxy：

```powershell
npm run gateway:deploy:prepare
docker compose -f docker-compose.production-gateway.yml -f docker-compose.production-gateway.proxy.yml config
docker compose -f docker-compose.production-gateway.yml -f docker-compose.production-gateway.proxy.yml up -d
```

服務：

- `clawdesk-backend`：License / Identity / Lemon webhook / Provider SecretRef backend。
- `clawdesk-gateway`：桌面 app 對外 Gateway contract，內部連 `clawdesk-backend:19120`，容器對外 port `19130`。
- `clawdesk-proxy`：Nginx HTTPS reverse proxy，將 `https://api.naviaworks.net` 轉到 `clawdesk-gateway:19130`。

正式網域需由反向代理提供 TLS：

- Public URL：`https://api.naviaworks.net`
- Upstream：`http://127.0.0.1:19130`
- Required endpoints：`GET /health`、`GET /contract`、`POST /webhooks/lemon`、`POST /license/activate-key`、`POST /diagnostics/create-report`

proxy 範本在 `infra/nginx.production-gateway.conf`。它預期憑證位於：

```text
/etc/letsencrypt/live/api.naviaworks.net/fullchain.pem
/etc/letsencrypt/live/api.naviaworks.net/privkey.pem
```

## 上線後驗證

`.env.production` 設定：

```text
CLAWDESK_GATEWAY_BASE_URL=https://api.naviaworks.net
```

然後執行：

```powershell
npm run gateway:public:doctor
npm run gateway:doctor
npm run beta:env:doctor
```

`gateway:public:doctor` 不讀 secret，也不需要 `.env.production`；它直接檢查 `api.naviaworks.net` 的 DNS、TCP 443、TLS 憑證與 `GET /health`。

## 注意

目前 compose 使用 repo 內的 Gateway contract runner，適合直售 Beta 前的 API host readiness。正式付款啟用前，仍需完成 Lemon Squeezy webhook secret、產品/variant id、Windows installer 簽章與法律文件審閱。

`verify:lemon:production` 會在 production adapter mode 下驗證 Lemon webhook 簽章與退款/取消降權。正式部署前這個檢查必須通過，避免未簽章 webhook 或錯誤 provider 被接受。
