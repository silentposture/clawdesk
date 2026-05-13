# ClawDesk Windows Beta FAQ

## 安裝被 SmartScreen 擋住

第一批 Beta 仍需要累積 Windows reputation。正式可賣版本必須使用 Authenticode 或 Trusted Signing 簽章，下載頁也要提供 SHA256。

## 如何輸入 license key

開啟 ClawDesk 後進入「授權」面板，貼上 Lemon Squeezy email 中的 license key。桌面端只保存 license key hash、machine hash 與最後驗證 entitlement。

## 如何匯出診斷

進入「故障回報」，先產生診斷包，再按「匯出給客服」。診斷包不得包含完整 license key、email、API key、完整本機路徑、聊天內容或螢幕截圖。

## 如何退款

退款由 hosted checkout 平台處理。退款 webhook 到達後，ClawDesk 會進入 safe-mode，保留資料匯出與診斷功能，停用付費 agent、workflow、connector 與更新資格。
