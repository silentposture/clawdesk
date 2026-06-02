# ClawDesk Windows Beta FAQ

開發者：Alisonsoftware

Alisonsoftware 是 ClawDesk 的個人開發者 / independent publisher。ClawDesk 與 OpenClaw、OpenAI、Microsoft、Google、Lemon Squeezy 或其他第三方服務之間，除非另有書面揭露，沒有隸屬、背書或贊助關係。

客服聯絡信箱：alison.ai.tech.studio@gmail.com。`beta-direct` 發佈前仍必須設定 `CLAWDESK_SUPPORT_EMAIL` 或 `CLAWDESK_SUPPORT_URL`，讓 release guard 能確認正式發佈環境已配置客服入口。

首發購買與下載路徑採官網直售 signed NSIS installer，不走 Microsoft Store。下載頁必須提供版本號、更新日期、SHA256、EULA、Privacy、Refund、AI Agent Risk Notice、OpenClaw MIT Notice 與客服信箱。

## 安裝被 SmartScreen 擋住

第一批 Beta 仍需要累積 Windows reputation。正式可賣版本必須使用 Authenticode 或 Trusted Signing 簽章，下載頁也要提供 SHA256。若 SmartScreen 顯示警告，使用者應先確認檔名、版本、SHA256 與發佈者資訊一致，再決定是否安裝。

## 如何輸入 license key

開啟 ClawDesk 後進入「授權」面板，貼上 Lemon Squeezy email 中的 license key。桌面端只保存 license key hash、machine hash 與最後驗證 entitlement。

## 如何匯出診斷

進入「故障回報」，先產生診斷包，再按「匯出給客服」。診斷包不得包含完整 license key、email、API key、完整本機路徑、聊天內容或螢幕截圖。

## 如何退款

退款由 hosted checkout 平台處理。退款 webhook 到達後，ClawDesk 會進入 safe-mode，保留資料匯出與診斷功能，停用付費 agent、workflow、connector 與更新資格。

## Launch pricing 是什麼

ClawDesk 的首發對外方案只有三種：

- Free Trial：USD $0，功能受限。
- Pro Yearly：USD $79/年。
- Lifetime：USD $99 一次性，含 12 個月更新。

AI API costs are not included unless explicitly stated. 使用者可自備自己的 AI provider 或 API key。
