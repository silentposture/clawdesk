# ClawDesk Desktop MVP

This repository publishes the Windows mainline and is released under `PolyForm Noncommercial 1.0.0`. The macOS version lives in [ClawDesk-MAC](https://github.com/silentposture/clawdesk-mac).

ClawDesk is an OpenClaw-compatible, local-first Windows desktop AI agent. Public inspection, forks, PRs, and multi-editor collaboration are welcome, but commercial use, resale, hosted paid use, and any direct or indirect monetization are prohibited. New public documentation is written in English first; legacy Chinese text remains only where it has not yet been migrated.

The first release uses a mock Gateway sidecar, so we can ship the desktop shell, streaming event contract, Live Canvas, permission flow, licensing, diagnostics, and Agent management without waiting on the upstream OpenClaw repo.

## Current Focus

- Prioritize the Windows 11 x64 desktop app experience.
- Keep the product name, Tauri `productName`, and window title as `ClawDesk`; keep the npm package, Cargo crate, and bundle identifier unchanged to avoid breaking the build path.
- Use the Windows native title bar and WebView2 in the Tauri window.
- Target the Windows NSIS installer first for packaging.
- The macOS version lives in [ClawDesk-MAC](https://github.com/silentposture/clawdesk-mac); Linux native integration remains as an architectural interface and is not a primary development target right now.
- Keep all core features open by default, with no paid unlocks or feature locks; the license and account panels are retained only for compatibility, testing, and collaboration verification.
- The release, payment, signing, and beta sections later in this README are legacy planning notes kept for provenance. They do not change the current free, noncommercial, open-source policy in this repository.

## Browser Dev Mode

啟動 mock Gateway：

```sh
npm run gateway
```

啟動 React/Vite 前端：

```sh
npm run dev
```

開啟：

```txt
http://127.0.0.1:5173/
```

瀏覽器開發模式會連到 `http://127.0.0.1:18790` 的 mock Gateway。

## Windows Tauri Desktop App Mode

請先安裝 Rust toolchain：

```sh
rustup default stable
```

接著執行：

```sh
npm run tauri:dev:win
```

建立 Windows NSIS installer：

```sh
npm run tauri:build:win
```

正式 production Windows build：

```sh
npm run tauri:build:prod:win
```

Windows 直售 Beta 發佈 gate：

```powershell
npm run beta:env:doctor
npm run gateway:doctor
npm run tauri:build:win
npm run sign:win:doctor
npm run sign:win-installer
npm run release:metadata:win
npm run release:guard:beta
npm run smoke:win-installer -- --no-build
npm run qa:beta-direct:win
```

Microsoft Store readiness 候選 build 保留為未來路徑，首發 Windows 直售 Beta 不執行：

```sh
npm run tauri:build:store:win
npm run smoke:store-installer:win
npm run qa:store:win
```

Store 路徑使用獨立設定 `src-tauri/tauri.microsoftstore.conf.json`，保留 direct-download NSIS 設定不受影響。此設定使用 WebView2 offline installer mode、明確 publisher、legal resources、production CSP，並且不打包 mock Gateway resource。只有未來恢復 Store readiness 時才手動執行：

```sh
npm run release:guard -- --store-readiness
```

這個檢查會把 Windows Authenticode certificate 或 Microsoft Trusted Signing / Azure Artifact Signing 環境視為 blocking requirement；本機沒有簽章憑證時會失敗，屬於預期行為。

Tauri 外殼提供 Gateway 探測/啟動與權限回覆命令。開發模式會透過 Node 啟動 mock Gateway。Windows mock 候選版會先把 mock Gateway 腳本作為 app resource 放入 bundle；之後若要產品化，再替換成簽章後的 sidecar binary，並維持相同 Gateway 合約。

## Windows 效能策略

- Rust release profile 啟用 LTO、單一 codegen unit、`opt-level = 3`、`panic = "abort"` 與 strip，降低啟動與執行開銷。
- Cargo 預設 target 使用 Windows x64 MSVC toolchain。
- mock Gateway sidecar 以 `NODE_ENV=production` 與 `--max-old-space-size=128` 啟動，避免開發期記憶體無限制膨脹。
- Tauri 關閉時會清理 sidecar 子程序，避免背景程序殘留；Windows Job Objects 是 production hardening 後續項。
- React 串流文字用 `requestAnimationFrame` 批次更新，降低 token streaming 造成的重繪頻率。
- 聊天訊息保留最近 80 筆，避免長時間使用時 UI 記憶體持續成長。
- 主要滾動區與卡片使用 CSS containment / content visibility，減少 WebView layout 與 paint 成本。

## 事件合約

前端只接受以下可序列化 Gateway 事件：

- `agent.message.delta`
- `agent.message.done`
- `canvas.begin`
- `canvas.patch`
- `canvas.data`
- `permission.request`
- `permission.result`
- `gateway.status`

Canvas payload 是宣告式資料，會映射到受信任的 React 元件型錄：`Text`、`Button`、`Table`、`Metric`、`List`、`Progress`、`Panel`。

## AI 模型與連線設定

桌面端設定面板目前提供四種 provider/模式：

- `ChatGPT Pro`：需要使用者先完成 ChatGPT 網站 Pro 帳號登入；桌面端只登錄帳號 Email 與連線狀態，不保存密碼、不擷取 cookie，也不把 ChatGPT Pro 當成 API key。
- `OpenAI API key`：供後續真正 API 呼叫使用。MVP 只把 key 暫存在本機 mock Gateway 記憶體，並可在 GUI 內指定模型。
- `本機模型`：在 GUI 內設定 Ollama、LM Studio 或 OpenAI-compatible local endpoint；MVP 僅允許 `127.0.0.1` / `localhost` endpoint。
- `Mock Gateway`：預設模式，用來開發桌面 UI、串流事件、Live Canvas 與權限流程。

注意：ChatGPT Pro 訂閱與 OpenAI API 是不同平台與不同計費系統。正式 AI 呼叫應接官方 API key 或使用者明確設定的本機模型 endpoint。

## 工作區

- 工作區左側提供專案分類：`全部`、`AI 代理`、`資料分析`、`文件工作`、`系統自動化`。
- 專案可釘選，釘選專案會排序在前。
- 可切換「只顯示釘選專案」，方便把常用專案固定在工作流前排。

## MCP 與 Microsoft 文書能力

桌面端已新增 MCP 連接器中心，從 `MCP` 按鈕開啟。MVP 先提供 mock adapter，建立安全邊界與 UI 合約：

- `Word`：文件摘要、修訂建議。
- `Excel`：資料檢查、圖表草稿。
- `PowerPoint`：簡報大綱。
- `Outlook`：回信草稿，不自動寄送。
- `OneDrive`：受信任工作區與授權雲端文件搜尋。
- `Google Drive / Docs / Sheets / Slides`：搜尋、摘要、資料檢查與簡報大綱。
- `Gmail / Google Calendar`：草稿與排程建議，不自動寄送、不直接建立活動。
- `Browser / Chrome / 螢幕 GUI`：網際網路搜尋、受控瀏覽器與授權後的螢幕視覺辨識。
- `程式開發工具`：VS Code、Visual Studio、JetBrains、GitHub、GitLab、Docker、Terminal。
- `工程與設計軟體`：AutoCAD、Fusion 360、SolidWorks、MATLAB、Jupyter。
- `雲端服務`：AWS、Azure、Google Cloud、Cloudflare、Vercel、Supabase。

目前所有 MCP 功能仍是 mock Gateway 預覽，不會直接修改本機文件、寄信、建立行事曆活動或連接真實帳號。中高風險工具會轉成 `permission.request`，必須由使用者在桌面 UI 允許後才可進入正式執行階段。後續可把同一個 `/mcp/*` adapter 邊界替換為真正 MCP server、Microsoft Graph、Google API、PowerShell/Windows UI Automation 或文件處理 sidecar。

## 安全沙盒、多模態上傳與快速設定

新程式啟動時會先顯示快速設定，引導一般使用者設定：

- 專案資料夾：所有上傳檔案都先複製到專案資料夾的 `uploads`，再做分析或改寫。
- 備份資料夾：專案內每次改動前先備份。
- 專案外改動：任何超出專案資料夾的改動都需要人工授權。
- 不主動刪除：刪除動作不自動執行。
- 多模態資料：文件、試算表、簡報、圖片、音訊、影片、壓縮檔都走上傳副本流程。
- 網際網路與螢幕 GUI 視覺辨識：可在權限面板啟用，並透過 tooltip 說明用途。

## 多媒體與文字記錄

`媒體` 面板列出桌面端自帶的本機處理能力，所有檔案仍先複製到專案沙盒再分析或轉換：

- 影片：Windows Media Foundation / DirectX Video Acceleration，支援 mp4、mov、m4v、HEVC、H.264，優先 Windows 硬體加速。
- 音訊：Windows WASAPI / Media Foundation，支援 mp3、wav、m4a、aac、flac，可作為逐字稿與會議摘要前處理。
- 圖片：Windows Imaging Component / Direct2D，支援 png、jpg、webp、heic、tiff，先建立縮圖與預覽副本。
- 文字記錄：Rust 本機索引器合約，支援 txt、md、jsonl、log、csv，保留聊天、操作與工具輸出記錄。

MVP 先建立桌面 GUI、Gateway 合約與安全限制；正式產品化時可把相同合約接到簽章後的 ffmpeg/Whisper/OCR sidecar 或原生 Rust adapter。

## 學習模式

`學習` 面板用來觀察人類一般操作，拆解成可審核的自動化工作流草稿。安全預設如下：

- 必須由使用者按下「開始學習」才會記錄。
- 不記錄密碼、token、付款資料或私密欄位。
- 螢幕影像只在授權後做摘要，不保存原始畫面。
- 停止學習後只建立草稿工作流，正式啟用前仍需人工審核與授權。
- 檔案動作、跨專案動作與中高風險步驟會標記為需要人工授權。

## 相容設定導引

`相容` 面板把上游相容設定搬成兩層：

- 一般設定：用「你要做什麼」「要用哪個 AI」「專案資料夾在哪」「要不要網路/螢幕辨識」帶使用者完成。
- 進階設定：保留底層 key 對照，例如 `agents.defaults.workspace`、`models.providers`、`channels.telegram`、`gateway.auth`、`tools.web.search`、`contextPruning`。

目前已整理的相容設定群組：

- 工作區與專案沙盒：workspace、project config。
- 模型與 AI 供應商：providers、primary model、fallbacks、model params。
- Agent 身分、多 Agent 與記憶：identity、memory、concurrency。
- 訊息頻道：Telegram、Discord、WhatsApp、Slack/Teams。
- Gateway 與背景服務：mode、bind、port、auth、daemon。
- 祕密、安全與權限：`.env`、SecretRef、API key、sandbox policy。
- Plugins、Skills、Tools、多模態：web search、media/audio、plugins、skills。
- Hooks 與進階行為：BOOT/HEARTBEAT、context pruning、compaction、messages、commands、update。

## 自動化排程與工作流

`工作流` 面板提供範本與排程管理：

- 每日文件摘要：Drive 搜尋與 Docs 摘要。
- 每週文書報告：Excel/Sheets 檢查與 Slides 大綱。
- 信件與行事曆追蹤：Gmail 草稿與 Calendar 建議。

工作流建立後先是草稿，包含跨專案或中高風險步驟時仍會走人工授權。

## 通訊頻道

`通訊` 面板用來搭建聊天軟體與 ClawDesk 桌面程式的入口。MVP 只做設定、允許名單、串流模式與測試訊息預覽，不會直接送出外部訊息。

每個頻道都有桌面內建的逐步設定精靈，會用對話式卡片拆解「去哪裡建立 token」「要貼什麼欄位」「允許誰使用」「如何先做不送出的測試預覽」。Telegram 會從 BotFather 建 bot 開始引導，適合非 IT 使用者照著一步一步完成。

- Telegram：BotFather token、允許使用者/群組。
- Discord：bot token、application id、允許 server/channel。
- WhatsApp：phone number id、access token、verify token。
- Slack：bot token、app token、signing secret。
- Microsoft Teams：tenant/team/channel allowlist。
- Gmail / Email：draft-only 原則，寄送前人工確認。
- LINE：Messaging API channel token / secret。
- Matrix：homeserver、room allowlist。

所有通訊頻道啟用與測試都走授權預覽；高風險頻道不會自動寄信、發訊息或加入群組。

## 帳號與多人協作

`帳號` 面板用來建立多入口登入與授權狀態，方便後續工作流依照專案與指定軟體進行多人協作。MVP 不保存密碼、不保存真 token，只保存 mock 授權狀態與 scope。

- ChatGPT Pro：AI 對話與工作流協助狀態。
- Google Workspace：Drive、Gmail、Calendar scopes。
- Microsoft 365：OneDrive/Office、Outlook、Teams scopes。
- GitHub：repository、issue/PR 草稿 scopes。
- Slack / LINE / Email：通訊草稿與允許名單。
- 雲端服務帳號：AWS、Azure、Google Cloud、Cloudflare、Vercel、Supabase 的讀取與變更計畫 scopes。

每個帳號可設定協作角色：擁有者、管理員、編輯者、檢視者、自動化服務帳號。高風險 scope 會要求人工授權。

## 授權、更新與診斷

`授權` 面板保留作 mock / 相容性驗證，不代表付費解鎖機制。

- 授權模型保留 machine binding、離線票券與撤銷驗證的相容介面，但核心功能不因付款而關閉。
- Windows machine fingerprint 只保存 salted hash，不保存明文 CPU/主機板序號。

`版權` 面板顯示 ClawDesk 非商業授權、安裝同意條款、OpenClaw-compatible 聲明、OpenClaw upstream notice、第三方 NOTICE、隱私與使用者內容權利。使用者保留輸入、上傳檔案、專案資料與 AI 輸出內容權利；ClawDesk 不主張使用者內容所有權。

安裝與發布條款草案放在 `docs/legal/INSTALLER_TERMS.md`，並會被打包到 Tauri app resources 的 `legal/INSTALLER_TERMS.md`。OpenClaw upstream notice 放在 `docs/legal/OPENCLAW_MIT_NOTICE.md`，並會被打包到 `legal/OPENCLAW_MIT_NOTICE.md`。這兩份文件是歷史/規劃草案，不構成法律意見；若未來要轉為其他發行方案，需另外建立獨立條款與法務審閱流程。

`診斷` 面板會在本機建立非個資診斷包，使用者確認後才送出或匯出。診斷包不包含 Email、完整路徑、完整金鑰、API key、聊天內容、螢幕截圖或 Lemon customer id 明文，故障碼格式為 `CLWD-AREA-NNNN`。

## 記憶、Agent 與人體工學驗證

- `記憶` 面板：SQLite mock 索引 + Markdown/YAML mock 可讀記憶，支援釘選事實、長期記憶、Context token 估算與壓縮。
- `Agent` 面板：預設個人助理、文書助理、自動化助理、研究助理；每個 Agent 有獨立模型、工具權限、工作區、知識庫、記憶範圍與學習模式。
- `驗證` 面板：GUI 人體工學 smoke tests，檢查任務步數、最小視窗、文字不溢出、鍵盤可達、tooltip coverage 與危險操作提示，產生 ergonomics score。

## 驗證

```sh
npm run preflight
npm run i18n:audit:strict
npm test
npm run build
npm run verify:mvp
npm run verify:backend
npm run verify:backend:sim
npm run verify:production-gateway:sim
npm run verify:lemon:production
npm run release:guard
npm run release:configs:check
npm run legal:notices:check
npm run sbom:check
```

`cargo test` 需要先安裝 Rust/Cargo，且 `cargo` 必須在 `PATH` 中。

`npm run preflight` 會同時檢查 legal manifest、第三方 NOTICE、release config 與 strict i18n audit；若 GUI 新增硬編碼文案而沒有放入 `src/lib/i18n.tsx`，preflight 會失敗。

Windows 排程隱藏視窗守則（不跳出 CMD/PowerShell）：

```powershell
npm run audit:tasks:hidden
```

- 稽核腳本：`scripts/audit-scheduled-tasks.ps1`
- 預設檢查任務名稱 pattern：`^Studio_`, `^OpenClaw`, `^NaviaWorks`
- 規則：必須符合 `wscript.exe //B` 或 `powershell.exe ... -WindowStyle Hidden`（含 hidden vbs launcher）
- 這條檢查已整合進 `npm run preflight`（僅 Windows 執行，非 Windows 會自動略過）

若要擴充新產品線任務命名範圍，可用環境變數覆蓋：

```powershell
$env:CLAWDESK_TASK_AUDIT_PATTERNS='^Studio_,^OpenClaw,^NaviaWorks,^LumiCore'
npm run audit:tasks:hidden
```

## 發佈前檢查

`npm run release:guard` 是 mock 候選版檢查，會確認 ClawDesk 品牌、Tauri 版本、legal manifest、bundle resources 與可用 artifact 狀態。這個模式允許 mock Gateway 與 mock Lemon Squeezy，但報告會明確標示 `mock-candidate`，不能視為正式發布版本。

桌面殼層有兩份 Tauri 設定：

- `src-tauri/tauri.conf.json`：開發與 mock 候選版，會打包 `sidecars/mock-gateway/server.mjs`。
- `src-tauri/tauri.prod.conf.json`：正式發布版，不打包 mock Gateway，只保留安裝條款與 OpenClaw upstream notice。正式版需由 `CLAWDESK_GATEWAY_BASE_URL` 指向 production Gateway，必要時用 `CLAWDESK_GATEWAY_WS_URL` 指定事件串流端點。
- `src-tauri/tauri.microsoftstore.conf.json`：Windows Store readiness 候選版，使用 offline WebView2 installer、production resources 與 Store publisher metadata。
- `src-tauri/tauri.macos.conf.json`：macOS re-entry 專用設定，輸出 `.app` / `.dmg`，不污染 Windows 主線設定。

正式 production 發佈需使用：

```sh
CLAWDESK_RELEASE_CHANNEL=production npm run release:guard:strict
```

Windows 直售 Beta 使用：

```powershell
$env:CLAWDESK_RELEASE_CHANNEL="beta-direct"
npm run release:guard:beta
```

`beta-direct` 模式會要求 production Gateway、Lemon Squeezy webhook/store/product/variant、SBOM、Windows installer artifact、Windows code signing 與公開客服入口。SSO 不擋第一版 Windows 直售 Beta。變數名稱請參考 `.env.production.example`；桌面端不得保存 Lemon API key、webhook secret 或付款資料。

填寫 `.env.production` 後，可先執行：

```powershell
npm run beta:env:doctor
```

這個 doctor 會讀取 `.env.production` / `.env`，只輸出哪些 key 缺少或格式不符合，不輸出任何 secret 值。`CLAWDESK_GATEWAY_BASE_URL` 必須是正式 HTTPS API host，不應使用 `https://naviaworks.net/` 首頁網址。

完整直售 Beta readiness 彙整報告：

```powershell
npm run beta:readiness
npm run beta:handoff:prepare
```

這會產出 `artifacts/beta-readiness/*-beta-readiness.json` 與 `.html`，彙整 env、Gateway、Docker compose、Lemon production contract、Windows signing、installer metadata、release guard 與 preflight。預設即使有 blocker 也會完整產出報告；若要在 CI 強制失敗，使用 `npm run beta:readiness:check`。

`beta:handoff:prepare` 會把網站上傳包、Lemon onboarding pack、Gateway compose、簽章文件、env 範本與最新 readiness report 集中到 `artifacts/beta-handoff/`。

Production Gateway 連線與合約檢查可用：

```powershell
npm run gateway:deploy:prepare
npm run gateway:public:doctor
npm run verify:production-gateway:compose
npm run gateway:doctor
```

`gateway:public:doctor` 會直接檢查 `api.naviaworks.net` 的 DNS、TCP 443、TLS certificate 與 `GET /health`。`gateway:doctor` 會讀取 `CLAWDESK_GATEWAY_BASE_URL`，檢查它是否為 HTTPS API host，並實際呼叫 `GET /health` 與 `GET /contract`。這些檢查不會傳送 Lemon、license key、API key 或使用者資料。

Gateway 部署候選 compose、Nginx reverse proxy 範本與 VPS/API host 操作步驟請看 `docs/deploy/PRODUCTION_GATEWAY_DIRECT_BETA.md`。`gateway:deploy:prepare` 會產出 `artifacts/gateway-deploy/`，正式網址應由反向代理提供 TLS，將 `https://api.naviaworks.net` 轉到 compose 內的 `clawdesk-gateway:19130`。

strict 模式會要求 Lemon Squeezy、SSO 與 Windows code signing 相關環境變數；變數名稱請參考 `.env.production.example`。檢查報告只記錄環境變數是否存在，不會輸出 secret 值。

Release guard report 會輸出 production readiness matrix，分類包含：

- Legal：安裝條款、NOTICE 與 legal manifest 是否同步。
- Gateway：正式版是否已設定 production Gateway endpoint。
- Payment/Licensing：Lemon Squeezy webhook secret、store id、product id 與 variant id 是否存在。
- Identity：SSO issuer/client 是否存在；此項只阻擋 strict production / enterprise，不阻擋第一版 Windows 直售 Beta。
- Windows：code signing credential 是否存在。
- Packaging：正式打包 script 是否受 strict guard 保護、是否仍包含 mock resource、NSIS installer artifact 是否存在。

正式發布打包入口必須使用 guard-protected scripts：

```sh
npm run tauri:build:prod:win
```

這個指令會先執行 production release guard。只要仍打包 mock Gateway、缺少 Lemon Squeezy/SSO production credentials、或缺少 Windows signing 環境，就會在 build 前失敗，避免把 mock 候選版誤當正式發布版。第一版直通 Beta 請走 `qa:beta-direct:win`，不要把 SSO 當成首發 blocker。

Microsoft Store readiness 目前是保留的第二條 Windows release lane，不是首發 gate：

```sh
npm run tauri:build:store:win
npm run smoke:store-installer:win
npm run qa:store:win
```

Store lane 不代表已可上架；正式送審前仍需完成 Windows code signing、更新 feed URL、Store listing metadata、隱私條款與消費者退款條款審閱。簽章檢查支援兩種環境合約：

- 傳統憑證：`WINDOWS_SIGNING_CERTIFICATE`、`WINDOWS_SIGNING_CERTIFICATE_PASSWORD`。
- Windows certificate store：`WINDOWS_SIGNING_CERTIFICATE_SUBJECT`。
- Microsoft Trusted Signing / Azure Artifact Signing：`AZURE_TRUSTED_SIGNING_ACCOUNT_NAME`、`AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME`、`AZURE_TRUSTED_SIGNING_ENDPOINT`。

簽章前可先執行：

```powershell
npm run sign:win:doctor
```

doctor 會讀取 `.env.production` / `.env`，檢查 `signtool.exe`、NSIS installer artifact、PFX / certificate store / Azure Trusted Signing env 是否存在，並確認只設定一種簽章方法；報告只輸出 env 是否存在與憑證路徑摘要，不輸出 secret 值。三種簽章方式的設定請看 `docs/windows/WINDOWS_SIGNING_SETUP.md`。

installer SHA256 與下載頁 metadata：

```powershell
npm run release:metadata:win
npm run release:metadata:win:check
npm run website:prepare
```

這會讀取最新 NSIS installer，產生 `artifacts/windows-release/latest-windows-beta.json`，並更新 `docs/download/beta-windows.html` 的版本、檔名、SHA256、日期與簽章狀態。若正式 Beta 要強制簽章，使用 `npm run release:metadata:win:check -- --require-signature`。

`website:prepare` 會把下載頁、FAQ、legal/support 文件、release metadata 與 installer 打包到 `artifacts/website/clawdesk/`，可作為 `https://naviaworks.net/clawdesk/` 的上傳目錄。若簽章不是 `valid`，輸出 package 會保留 warning，不能作為公開付費 Beta。

macOS re-entry 走獨立腳本，避免重新引入 Apple-specific 設定到 Windows 主線：

```sh
npm run tauri:build:mac
npm run smoke:mac-dmg
npm run qa:release:mac
```

這些指令只應在 macOS + Apple signing/notarization 環境執行；Windows 上會明確失敗並回報平台限制。

SBOM 與第三方 NOTICE：

```sh
npm run legal:notices
npm run sbom
```

`docs/legal/THIRD_PARTY_NOTICES.md` 會從 npm direct dependencies 與 Cargo direct dependencies 產生。SBOM 產物輸出到 `artifacts/sbom/`，屬於 release evidence，不提交 build artifact 到 repo。

Rust Gateway adapter 的啟動順序：

1. 若環境變數提供 `CLAWDESK_GATEWAY_BASE_URL`，只連線該 Gateway；健康檢查失敗就中止，不回退到 mock sidecar。
2. 正式 build 會設定 `CLAWDESK_BUILD_PROFILE=production`，Rust runtime 會停用 mock Gateway fallback；即使在開發機上執行 production app，也不能因 repo 中存在 mock script 而啟動 mock。
3. mock 候選版若未設定正式 Gateway，才使用本機 mock Gateway 偵測與 sidecar 啟動流程。
4. 權限結果會送到目前 active Gateway 的 `/permission-result`，避免正式版仍固定打到 mock port。

本機 production Gateway contract simulator：

```sh
npm run verify:production-gateway:sim
```

這個驗證會啟動 `backend/server.mjs` 與 `backend/production-gateway-sim.mjs`，由外部 Gateway 提供 `/health`、`/contract`、`/events`、`/chat`、`/permission-result`、`/identity/*`、`/license/*`、`/updates/check`、`/legal/*`、`/diagnostics/create-report`，並確認沒有啟動 `sidecars/mock-gateway/server.mjs`。它是 production runtime contract simulator，不是正式金流或授權服務。

Lemon Squeezy production webhook contract 驗證：

```sh
npm run lemon:onboarding:prepare
npm run verify:lemon:production
```

`lemon:onboarding:prepare` 會產出 Lemon 審核回覆、產品/variant 設定、webhook 事件與 env checklist；詳細步驟請看 `docs/payments/LEMON_SQUEEZY_SETUP.md`。`verify:lemon:production` 會以 `CLAWDESK_BACKEND_ADAPTER_MODE=production` 啟動後端，確認未簽章/錯誤簽章 webhook 會被拒絕，正確簽章的 `license_key_created` 會啟用授權，`refund_created` 與 `subscription_cancelled` 會降權到 `safe-mode`，且 Paddle/Keygen endpoint 仍維持 disabled。

完整本機 release 候選驗證：

```sh
npm run qa:release:win
```

一次性全流程（建議每次準備交付前跑一次）：

```sh
npm run qa:full:win
```

如果要啟用 direct-download signed QA：

```sh
npm run qa:full:win:sign
```

這會依序執行 preflight、release guard、unit tests、build、MVP/backend 驗證、production preview GUI smoke、Cargo tests、Windows executable smoke 與 NSIS installer smoke；不會預設執行 Store smoke。未來若要測 Store，需手動加 `--run-store-smoke`。

因為 preflight 已包含 `i18n:audit:strict`，`qa:full:win` 與 `qa-loop` 也會自動阻擋未國際化的新增 UI 文案。

## 後端服務數量與模擬部署

- **MVP 本機版**（最少後端）：`mock-gateway` 1 個服務即可。已覆蓋帳號、授權、MCP、工作流、記憶、診斷、人體工學與語音/影像能力驗證。
- **模擬完整授權與通知鏈路**：再加 `backend-auth`（模擬 Lemon Squeezy license + 訂閱 webhook）與 `mock-mail`（驗證信預覽）與可選 `reverse-proxy`，總計 3～4 個服務。
  - 不含 reverse-proxy：3 服務（gateway + backend-auth + mock-mail）
  - 含 reverse-proxy：4 服務
- **推薦環境差異**：
  - 開發者只測前端與事件合約：用 `docker-compose.mock-gateway.yml`。
  - 模擬帳號/授權全鏈路：用 `docker-compose.backend-sim.yml` + `docker-compose.mock-gateway.yml`。
  - 一鍵整體模擬：用 `docker-compose.mock-gateway.full.yml`（gateway + mock-mail + reverse-proxy）。

```sh
# 1) MVP（含 gateway）
npm run deploy:mock
npm run deploy:mock:logs
npm run deploy:mock:down

# 2) gateway + backend-auth + mail
npm run deploy:backend-sim
docker compose -f docker-compose.mock-gateway.yml -f docker-compose.backend-sim.yml up -d
docker compose -f docker-compose.mock-gateway.yml -f docker-compose.backend-sim.yml logs -f
docker compose -f docker-compose.mock-gateway.yml -f docker-compose.backend-sim.yml down

# 3) 一鍵完整模擬（含反向代理）
# 預設會自動偵測 docker：
# - 有 docker：使用 docker-compose 啟用 mock-gateway + mock-mail + reverse-proxy
# - 沒有 docker：降級為本機簡化堆疊（僅 mock gateway + backend，仍保留主要登入、授權與事件鏈路）
npm run deploy:mock:full
npm run deploy:mock:full:check
npm run deploy:mock:full:logs
npm run deploy:mock:full:down

# 4) 一鍵全鏈路（gateway + backend-auth + mail + reverse-proxy）
# 預設會自動偵測 docker：
# - 有 docker：使用 compose 啟動
# - 沒有 docker：自動降級為本機 Node stack（與 `npm run stack:local` 行為一致）
npm run deploy:full:stack
npm run deploy:full:stack:check
npm run deploy:full:stack:logs
npm run deploy:full:stack:down

# 5) 本機無 Docker fallback（本地 Node 啟動，適合 CI/開發機無 Docker 環境）
npm run stack:local
npm run stack:local:check
```

連線端點：

- mock-gateway：`http://127.0.0.1:18890`（WebSocket `ws://127.0.0.1:18890/events`）
- backend-auth：`http://127.0.0.1:19090`（Health `http://127.0.0.1:19090/health`）
- mock mail UI：`http://127.0.0.1:8025`
- 反向代理：`http://127.0.0.1:18889`（轉送 gateway）

完整部署說明、模擬架構與服務拆分，請見 `docs/backend-architecture-simulated-deploy.md`，裡面列出正式版的拆模建議（Gateway / 身分服務 / 授權服務 / 通知服務 / 觀測服務）。
