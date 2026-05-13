# 測試與問題紀錄

## 2026-05-11 自動驗證迴圈

### 目標

- 安裝 macOS / Apple M4 所需桌面端工具鏈。
- 建立可重複執行的 MVP 自動驗證腳本。
- 驗證 Gateway、WebSocket 串流、Provider 設定、權限回覆、安全限制、前端測試與 production build。

### 已處理

- 已安裝 Rust stable `aarch64-apple-darwin` toolchain。
- 已確認 Xcode Command Line Tools 存在。
- 已新增 `npm run verify:mvp`，自動啟動隔離 port 的 mock Gateway，不依賴外部瀏覽器。

### 目前待驗證

- `cargo test`
- `npm test`
- `npm run build`
- `npm run verify:mvp`
- `npm run tauri -- info`

### 迭代 1 發現與修正

- 問題：`cargo test` 首次編譯失敗，Tauri `generate_context!()` 需要 `src-tauri/icons/icon.png`。
- 修正：新增 `scripts/generate-icons.mjs` 與 `npm run icons`，產生輕量 PNG app icon；Tauri icon 設定改為 `icons/icon.png`。
- 狀態：`cargo test` 已通過。

### 迭代 2 發現與修正

- 結果：`npm test`、`npm run build`、`npm run verify:mvp`、`cargo test`、`tauri info` 全部通過。
- 結果：Apple M4 native release binary 已成功產生，為 thin arm64 Mach-O，約 4.8MB。
- 問題：`npm run tauri:build:m4` 在 `.app` 成功後，卡在 `.dmg` bundling 的 `bundle_dmg.sh`，退出碼為 1；目前沒有更詳細錯誤輸出。
- 修正：新增 `npm run tauri:build:app`，把主要可執行桌面 app 產物與 DMG 封裝拆開，避免 DMG 工具鏈阻塞 `.app` 驗證。
- 待辦：若需要發佈安裝包，再針對 DMG 進行獨立修復與簽章/公證設定。

### 迭代 3 發現與修正

- 問題：自動啟動 `.app` 後 Gateway 可正常起來，但透過 macOS quit 關閉 app 後，Node mock Gateway sidecar 仍留在背景。
- 修正：Tauri `CloseRequested` 事件會呼叫 `cleanup_gateway()`，kill/wait sidecar，並以 `app.exit(0)` 結束 app，避免 macOS 關窗後 app/sidecar 進入殘留狀態。
- 問題：透過 macOS `quit` 關閉 app 時仍可能只觸發 app lifecycle，不觸發 window close，sidecar 仍殘留。
- 修正：改用 `Builder::build(...).run(...)`，在 `RunEvent::ExitRequested` 與 `RunEvent::Exit` 都呼叫 `cleanup_gateway()`。
- 狀態：重建 app 後驗證通過。`.app` 啟動會帶起 Gateway；透過 macOS quit 關閉後，`openclaw-desktop` 與 `server.mjs` 均無殘留，`/health` 無法連線，符合預期。

### 迭代 4 發現與修正

- 需求：ChatGPT Pro 仍需要使用者先具備並登入 ChatGPT 網站 Pro 帳號，桌面端不可假裝成 API key 或保存網站密碼/cookie。
- 修正：新增 `POST /auth/chatgpt-pro/account` mock endpoint 與桌面端設定 UI，僅登錄帳號 Email 與連線狀態；Provider 顯示「需先完成網站帳號登入」。
- 需求：工作區需有專案分類與釘選功能。
- 修正：新增左側工作區專案面板、分類篩選、釘選/僅顯示釘選切換與 reducer 單元測試。
- 狀態：重跑前端、Gateway、Rust、production build 與 `.app` lifecycle 驗證，全部通過。

### 迭代 5 發現與修正

- 需求：開始開發 MCP 功能，尤其是 Microsoft Word、Excel、PowerPoint、Outlook、OneDrive 等文書軟體能力。
- 修正：新增桌面端 MCP 連接器中心、Microsoft 365 mock adapter、工具型錄、啟用流程、動作預覽與中風險工具授權要求。
- 修正：新增 `GET /mcp/connectors`、`POST /mcp/connect`、`POST /mcp/preview`，並把 Microsoft MCP 檢查納入 `npm run verify:mvp`。
- 問題：新增 MCP 測試後，`npm run build` 首次失敗，原因是新測試檔未顯式 import Vitest globals。
- 修正：補上 `import { describe, expect, it } from "vitest"`，重跑 production build 通過。
- 狀態：`npm test`、`npm run verify:mvp`、`npm run build` 均通過。

### 迭代 6 發現與修正

- 需求：加入自動化排程管理、工作流建立、Google 系列 MCP、瀏覽器能力、專案沙盒、多模態上傳、網際網路連線、螢幕 GUI 視覺辨識、tooltip 與首次快速設定。
- 修正：新增 Google Workspace MCP、瀏覽器/螢幕 GUI MCP、`GET /workflows`、`POST /workflows`、工作流面板、沙盒/上傳權限面板與快速設定對話框。
- 修正：新增安全策略測試，規則包含專案外改動需人工授權、專案內改動需先備份、不主動刪除、螢幕視覺辨識需明確啟用。
- 修正：多模態上傳以「複製到專案資料夾 uploads」作為唯一作業入口，保留來源檔案不直接修改。
- 問題：MCP/設定 topbar 圖示在窄視窗下不易點擊。
- 修正：新增 session strip 的 `MCP`、`工作流`、`權限`、`設定` 文字入口，並保留 tooltip 說明。
- 狀態：`npm test`、`npm run build`、`npm run verify:mvp` 與 Browser UI smoke test 均通過。

### 迭代 7 發現與修正

- 需求：了解 OpenClaw 全部設定並搬入本程式，但要用簡單易懂的方式引導一般使用者。
- 修正：依 OpenClaw 設定文件整理八大群組：工作區、模型、Agent、頻道、Gateway、安全、Tools/Plugins/Skills、多模態與 Hooks/進階行為。
- 修正：新增 `OpenClaw 設定導引` 面板，以 5 個一般問題完成基本設定，同時保留底層 key 與預設值對照。
- 修正：新增 `GET /openclaw/settings`、`POST /openclaw/settings` mock Gateway 端點，供未來匯入/匯出 OpenClaw config。
- 狀態：新增設定 schema 單元測試與 MVP 驗證項目。

### 迭代 8 發現與修正

- 需求：MCP 拓展要包含各類程式開發軟體、工程軟體與雲端服務。
- 修正：新增 `developer-tools` 連接器，涵蓋 VS Code、Xcode、JetBrains、GitHub、GitLab、Docker、Terminal。
- 修正：新增 `engineering-tools` 連接器，涵蓋 AutoCAD、Fusion 360、SolidWorks、MATLAB、Jupyter。
- 修正：新增 `cloud-services` 連接器，涵蓋 AWS、Azure、Google Cloud、Cloudflare、Vercel、Supabase。
- 安全：Terminal 指令、Cloudflare DNS 等高風險工具只產生預覽與授權要求，不直接執行。
- 狀態：新增 MCP 單元測試與 Gateway 驗證項目。

### 迭代 9 發現與修正

- 需求：建立多種通訊軟體與本程式的溝通頻道搭建。
- 修正：新增 `通訊頻道中心`，支援 Telegram、Discord、WhatsApp、Slack、Microsoft Teams、Gmail/Email、LINE、Matrix、iMessage。
- 修正：新增頻道 allowlist、stream mode、required fields、啟用/停用與測試訊息預覽。
- 修正：新增 `GET /channels`、`POST /channels/configure`、`POST /channels/test-message` mock Gateway 端點。
- 安全：MVP 不直接寄送或發訊息，所有高風險頻道啟用與外部測試都只產生預覽與授權要求。

### 迭代 10 發現與修正

- 需求：加入多入口帳號登入，讓後續自動化工作流、專案與指定軟體可透過電子郵件與帳號授權進行多人協作。
- 修正：新增 `帳號與協作授權中心`，支援 ChatGPT、Google Workspace、Microsoft 365、GitHub、Slack、LINE、Email、雲端服務帳號。
- 修正：帳號可設定 Email、協作角色、綁定專案、指定軟體/服務與授權 scopes。
- 修正：新增 `GET /accounts`、`POST /accounts/connect` mock Gateway 端點。
- 安全：不保存密碼或真 token；高風險 scope 會建立 permission request。

### 迭代 11 發現與修正

- 需求：Telegram 等通訊設定也要有對話視窗，協助一般使用者拆解每一步並引導設定。
- 修正：新增通訊頻道逐步設定精靈，Telegram 從 BotFather、bot token、允許名單到測試預覽分成 4 步；Discord、WhatsApp、Slack、Teams、Gmail、LINE、Matrix、iMessage 也都有引導卡片。
- 修正：Gateway `/channels` 回傳 `guideSteps`，前端依進度顯示步驟與完成百分比。
- 驗證：`npm run verify:mvp` 新增 Telegram BotFather 引導步驟檢查，避免 Gateway 回傳資料退化。

### 迭代 12 發現與修正

- 需求：軟體本身要自帶影片編碼解碼器、音頻、圖片、文字記錄能力。
- 修正：新增 `媒體` 面板與 `/media/capabilities` Gateway 合約，列出影片、音訊、圖片、文字記錄的本機處理能力、格式、Apple Silicon 硬體加速與沙盒限制。
- 需求：加入學習模式，觀察人類一般操作工作流，拆解後納入自動化工作流能力。
- 修正：新增 `學習模式與工作流拆解` 面板與 `/learning/session`、`/learning/start`、`/learning/observe`、`/learning/stop` 端點。
- 安全：學習模式預設不記錄密碼、token、付款資料或原始螢幕影像；停止後只建立草稿工作流，檔案與中高風險步驟需人工授權。
- 驗證：新增媒體能力與學習模式單元測試，`npm run verify:mvp` 新增本機媒體能力與學習工作流草稿檢查。

### 迭代 13 發現與修正

- 需求：品牌改名為 `ClawDesk`，並加入 Paddle + Keygen 商業授權、更新權益、診斷回報、長期記憶、Context 壓縮、多 Agent 知識庫、學習預演與 GUI 人體工學驗證。
- 修正：Tauri `productName` 與視窗標題改為 `ClawDesk`；npm package、Cargo crate 與 bundle identifier 保留原值。
- 修正：新增 `授權、方案與更新` 面板，支援 Paddle/Keygen mock、Keygen license key 啟用、machine fingerprint salted hash、裝置綁定、離線票券、篡改降級 safe mode、支援更新到期日與 USD 售價方案。
- 修正：新增 `版權與授權中心`，顯示 ClawDesk 閉源商業授權、OpenClaw-compatible 聲明、第三方 NOTICE、隱私與使用者內容權利。
- 修正：新增 `故障回報` 面板與診斷包 mock，去識別化 Email、完整路徑、完整金鑰、API key 與 Paddle customer id。
- 修正：新增路徑治理、記憶/Context、Agent catalog、人體工學驗證 domain 模組與單元測試。
- 修正：新增 Gateway endpoints：`/license/*`、`/machine/fingerprint`、`/webhooks/paddle/mock`、`/webhooks/keygen/mock`、`/updates/*`、`/diagnostics/*`、`/legal/*`、`/ergonomics/*`、`/paths/resolve`、`/memory/profile`、`/context/status`、`/agents`、`/learning/rehearse` 等。
- 修正：新增 `npm run smoke:gui`，用 Playwright 自動驗證 ClawDesk 首屏、授權啟用、故障回報與 GUI 人體工學面板。
- 問題：新增 Playwright 後 npm audit 顯示 Vitest 內部舊版 Vite/esbuild 有 5 個 moderate dev dependency 項目。
- 修正：升級 `vitest` 到 `4.1.6`，`npm audit --audit-level=moderate` 已清零，重跑測試與 build 通過。

### 最終驗證結果

- `npm audit --audit-level=moderate`：通過，0 vulnerabilities。
- `npm test`：通過，20 個 test files / 61 tests。
- `npm run build`：通過，Vite production build 成功。
- `npm run verify:mvp`：通過，16 項 Gateway/provider/ChatGPT Pro account/accounts/channels/Microsoft MCP/Google MCP/workflows/media/learning/OpenClaw-compatible settings/Paddle/Keygen/update/diagnostics/legal/path/memory/agents/ergonomics/WebSocket/permission 自動檢查。
- `npm run smoke:gui`：通過，GUI smoke score 98。
- `cargo test`：通過。
- `npm run tauri -- info`：通過，Rust/Tauri 套件可偵測；完整 Xcode app 未安裝但 CLT 已安裝。
- `npm run tauri:build:app`：通過，產生 Apple Silicon arm64 `ClawDesk.app`。
- `.app` 啟動/退出 lifecycle：通過，sidecar 無殘留。
- 產物：`src-tauri/target/aarch64-apple-darwin/release/bundle/macos/ClawDesk.app`，主程式為 Mach-O arm64。

### 剩餘非阻塞事項

- `.dmg` bundling 仍需獨立修復；目前 `.app` 可用，DMG 發佈包不列入 MVP 完成條件。
- 正式發佈前需補 Apple Developer ID 簽章、公證與更完整 app icon asset set。

### 已知限制

- 完整 Xcode app 尚未安裝；目前只有 Command Line Tools。Tauri 開發與一般 macOS build 通常可先用 CLT 推進，簽章、公證、App Store 流程會需要完整 Apple 開發者設定。

### 迭代 14 快照（2026-05-12）

- 需求：補齊後端模擬部署說明與腳本，解答「這套程式實際需要幾個後端」，並完成一輪迭代驗證回路。
- 修正：
  - 更新 `README.md` 的「後端服務數量與模擬部署」章節，明確列出 1（MVP）、2（認證拆分）、3（加 Mail）、4（加反向代理）種組態。
  - 新增 `docker-compose.mock-gateway.full.yml` 的運行指令與 `docs/backend-architecture-simulated-deploy.md` 快速部署步驟對應。
  - 新增 package script：`deploy:full:stack`、`deploy:full:stack:down`、`deploy:full:stack:logs`（`mock-gateway + backend-auth + mock-mail + reverse-proxy`）。
  - 補充 `.env.mock.example` 的 `CLAWDESK_PROJECT_ROOT`、`CLAWDESK_HOME_DIR` 可配置項。
  - 修正 `sidecars/mock-gateway/server.mjs` 的 `homeDir` fallback，移除硬編碼 `/Users/demo`，改為可移植的 `os.tmpdir()` 兜底。
- 驗證結果：
  - `npm test`：通過，21 files / 64 tests。
  - `npm run build`：通過。
  - `npm run verify:mvp`：通過，18 項檢查。
  - `npm run verify:backend`：通過，3 項檢查。
  - `npm run smoke:gui`：通過，8 項 GUI Smoke。
  - `npm run verify:mock-stack`：通過，與 `verify:backend` 等價。
- 問題記錄：
  - 嘗試透過 `docker compose` 進行完整模擬佈署時，回報 `docker: command not found`，目前環境未安裝 Docker，故無法在本機直接啟起服務堆疊。
  - 建議：安裝 Docker Desktop 後，依 `README` 指令重跑「全鏈路」流程。

### 迭代 15 發佈候選檢查（2026-05-12）

- 需求：持續優化除錯驗證循環到可發佈，避免 mock 候選版被誤判成正式商業 production 發佈。
- 修正：
  - 新增 `scripts/release-guard.mjs`，檢查 ClawDesk 品牌、Tauri/package 版本一致、legal manifest、bundle resources、mock candidate 與 strict production 條件。
  - 新增 `npm run release:guard` 與 `npm run release:guard:strict`。
  - `qa:release:dmg` 現在會自動執行 release guard，QA report 會記錄 `includeReleaseGuard: true`。
  - 新增 `.env.production.example`，列出 Paddle、Keygen、SSO、Apple 簽章/公證所需環境變數名稱；檢查報告只記錄是否存在，不輸出 secret 值。
  - 修正 release guard 平行執行時報告檔名碰撞問題，檔名加入 release type 與 process id。
- 驗證結果：
  - `npm run release:guard`：通過，輸出 `mock-candidate`，並警告缺少正式 production env 與 Apple 簽章/公證設定。
  - `CLAWDESK_RELEASE_CHANNEL=production npm run release:guard:strict`：預期失敗，正確列出 Paddle、Keygen、SSO、Apple Developer ID 與 notarization 缺口。
  - `npm test`：通過，23 files / 69 tests。
  - `npm run build`：通過。
  - `npm run qa:release:dmg`：通過，11/11 checks，包含 preflight、release guard、unit tests、build、MVP/backend/backend-sim、GUI production smoke、Cargo tests、Tauri `.app` smoke、DMG smoke。
  - QA report：`artifacts/qa-loop/2026-05-12T18_50_16_532Z-qa-cycle-cycles-1.json`。
  - DMG 產物：`src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/ClawDesk_0.1.0_aarch64.dmg`。
- 收尾檢查：
  - `18890`、`18790`、`5173` 無殘留 listener。
  - 無殘留 ClawDesk / dmg mount。
- 剩餘事項：
  - 目前狀態可視為本機 mock release candidate。
  - 正式商業發佈仍需真實 Paddle/Keygen/SSO credentials、Apple Developer ID certificate、notarization credential、隱私/EULA 法務審核與簽章後 sidecar binary。

### 迭代 16 Production Readiness Matrix（2026-05-12）

- 需求：繼續補齊正式發佈前可機器檢查、可 UI 判讀的缺口矩陣。
- 修正：
  - 新增 `src/lib/releaseReadiness.ts`，定義 production readiness item、status、summary 與 mock candidate/strict production 判斷。
  - 新增 `src/lib/releaseReadiness.test.ts`，覆蓋 mock candidate、strict production blocked、production ready 三種狀態。
  - `LicensePanel` 新增「正式發佈準備矩陣」，顯示 Legal、Production Gateway、Paddle、Keygen、SSO、Apple signing、Developer ID、notarization、prod build guard、mock resource、artifact 狀態。
  - `release-guard` report 新增 `readiness.summary` 與 `readiness.matrix`，並修正 `.app` bundle 是目錄導致 artifact 誤判 blocked 的問題。
  - README 補上 readiness matrix 分類說明。
  - 修正 GUI smoke：登入前先關閉快速設定 overlay，避免首次設定對話框遮住帳號密碼登入流程。
- 驗證結果：
  - `npm test`：通過，24 files / 72 tests。
  - `npm run build`：通過。
  - `npm run release:guard`：通過，`mock-candidate-ready`，3 ready / 8 warning / 0 blocked。
  - `CLAWDESK_RELEASE_CHANNEL=production npm run release:guard:strict`：預期失敗，`production-blocked`，正確列出 production gateway、Paddle、Keygen、SSO、Apple signing/notarization 缺口。
  - `npm run verify:mvp`：通過，22 checks。
  - `npm run smoke:gui:prod`：第一次失敗，根因為 quick setup overlay 擋住登入；修正後重跑通過，8/8 checks。
  - `npm run qa:release:dmg`：通過，11/11 checks，QA report `artifacts/qa-loop/2026-05-12T19_10_17_243Z-qa-cycle-cycles-1.json`。
- 收尾檢查：
  - `18890`、`18790`、`5173` 無殘留 listener。
  - 無殘留 ClawDesk / dmg mount。
- 剩餘事項：
  - 正式 production 仍 blocked，需接入真實 `CLAWDESK_GATEWAY_BASE_URL`、Paddle、Keygen、SSO、Apple Developer ID certificate 與 notarization credential。

### 迭代 17 Production Gateway Profile（2026-05-12）

- 需求：建立正式版 Gateway profile，讓 production app 不再打包或回退啟動 mock Gateway。
- 修正：
  - 新增/確認 `src-tauri/tauri.prod.conf.json` 作為正式商業版 Tauri config；只打包 legal resources，不打包 `sidecars/mock-gateway/server.mjs`。
  - production CSP 改為 `connect-src ipc: https: wss:`，避免正式版允許 localhost / 127.0.0.1 mock Gateway。
  - `tauri:build:prod:app` 與 `tauri:build:prod:dmg` 現在設定 `CLAWDESK_BUILD_PROFILE=production`，並使用 `src-tauri/tauri.prod.conf.json`。
  - `src-tauri/build.rs` 新增 `CLAWDESK_BUILD_PROFILE` compile-time propagation，Rust 可辨識 production build。
  - Rust Gateway lifecycle 新增 `mock_gateway_allowed()`：production build 或 runtime `CLAWDESK_DISABLE_MOCK_GATEWAY=true` 時，若未設定健康的 `CLAWDESK_GATEWAY_BASE_URL`，會直接失敗，不會偵測 localhost 或啟動 mock sidecar。
  - `release-guard` strict 模式新增檢查：prod scripts 必須設定 `CLAWDESK_BUILD_PROFILE=production`，prod CSP 不得允許 localhost / 127.0.0.1。
- 驗證結果：
  - `cargo test --manifest-path src-tauri/Cargo.toml`：通過，13 tests。
  - `npm test`：通過，25 files / 77 tests。
  - `npm run build`：通過。
  - `npm run verify:mvp`：通過，22 checks。
  - `npm run release:guard`：通過，`mock-candidate-ready`。
  - `CLAWDESK_RELEASE_CHANNEL=production npm run release:guard:strict`：預期失敗，僅因 production Gateway、Paddle、Keygen、SSO、Apple signing/notarization 缺口而 blocked；未再出現 prod config、mock resource 或 CSP 錯誤。
  - `npm run tauri:build:prod:app`：預期在 build 前失敗，strict guard 成功阻擋缺少正式 credentials/簽章的 production 打包。
  - `npm run qa:release:dmg`：通過，11/11 checks，QA report `artifacts/qa-loop/2026-05-12T19_21_03_244Z-qa-cycle-cycles-1.json`。
- 收尾檢查：
  - 發現 `18890` mock gateway 與 `5173` vite preview listener 殘留，確認為本專案 process 後已終止。
  - 最終重查 `18890`、`18790`、`5173` 無 listener。
  - 無殘留 ClawDesk / dmg mount。
- 剩餘事項：
  - 若要真正通過 `tauri:build:prod:*`，需先部署 production Gateway 並設定 `CLAWDESK_GATEWAY_BASE_URL`、Paddle、Keygen、SSO、Apple Developer ID 與 notarization credentials。

### 迭代 18 Production Gateway Simulator 與 QA 穩定化（2026-05-12）

- 需求：下一步持續優化除錯驗證到可發佈，補上正式 Gateway 外部合約模擬，並確認桌面端不依賴 mock sidecar 才能通過 production-like Gateway 驗證。
- 修正：
  - 新增 `backend/production-gateway-sim.mjs`，以外部 Gateway 形式橋接 backend simulator，提供 identity、Keygen/Paddle license、updates、legal、diagnostics、machine fingerprint、chat stream、permission roundtrip 等桌面合約。
  - 新增 `scripts/verify-production-gateway-sim.mjs` 與 `npm run verify:production-gateway:sim`，驗證外部 Gateway health、contract、identity bridge、授權啟用、WebSocket stream、permission roundtrip，並確認不啟動 `sidecars/mock-gateway/server.mjs`。
  - `scripts/qa-loop.mjs` 在 release QA 模式納入 production Gateway simulator 驗證，並加入 `19120`、`19130` guarded port 清理。
  - `scripts/smoke-gui.mjs` 增強面板開啟穩定性：DOM 原生 click、鍵盤 Enter fallback、較長 selector 等待，降低 Playwright 時序誤判。
  - `scripts/smoke-tauri-app.mjs` 修正 app quit 流程：先等待 macOS/Tauri 正常退出與 sidecar 回收，再視情況補 SIGTERM，避免測試自身造成 sidecar 孤兒程序。
  - `DiagnosticsPanel` 新增本機去識別化 fallback：Gateway 診斷 summary/create-report 暫時失敗時，仍可產生本機診斷摘要與診斷包，不阻塞故障回報流程。
  - README 補上 production Gateway simulator 的用途、port 與驗證指令。
- 驗證結果：
  - `npm run verify:production-gateway:sim`：通過，6 項檢查。
  - `npm test`：通過，26 files / 86 tests。
  - `npm run build`：通過。
  - `npm run smoke:gui:prod`：通過，8/8 checks，GUI report `artifacts/gui-smoke/2026-05-12T19_47_45_361Z-report.json`。
  - `node scripts/smoke-tauri-app.mjs --no-build --timeout-ms=30000`：通過，確認 `.app` 啟動、Gateway health、sidecar 存在與退出清理。
  - `npm run qa:release:dmg`：通過，包含 preflight、release guard、unit tests、build、MVP/backend/backend-sim、production Gateway sim、GUI production smoke、Cargo tests、Tauri `.app` smoke、DMG smoke。QA report `artifacts/qa-loop/2026-05-12T19_52_54_259Z-qa-cycle-cycles-1.json`。
  - DMG 產物：`src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/ClawDesk_0.1.0_aarch64.dmg`。
- 問題記錄：
  - 第一次完整 QA 中 GUI smoke 偶發 `session-button-channels` 面板未開啟，判定為 Playwright 點擊/等待時序太緊；修正 smoke fallback 後重跑通過。
  - 第二次完整 QA 中 Tauri app smoke 在清理階段等待 Gateway shutdown 逾時，根因為測試腳本送出 quit 後立即 SIGTERM app，可能打斷 Tauri sidecar 回收；修正退出順序後重跑通過。
  - 第三次完整 QA 中診斷面板遇到 Gateway `Failed to fetch`，已新增本機 fallback；重跑 `smoke:gui:prod` 與完整 `qa:release:dmg` 通過。
- 收尾檢查：
  - `18890`、`18790`、`5173`、`19120`、`19130` 無殘留 listener。
  - DMG smoke 已完成 detach。
- 剩餘事項：
  - 目前狀態為可安裝、可 smoke 的本機 mock release candidate。
  - 正式 commercial production 仍需真實 production Gateway、Paddle/Keygen/SSO credentials、Apple Developer ID 簽章與 notarization。
