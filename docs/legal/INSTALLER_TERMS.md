# Historical Planning Draft

This document is a legacy commercial planning note. It is retained for provenance only and does not describe the current free, noncommercial, open-source policy. See `README.md`, `LICENSE`, and `CONTRIBUTING.md` for the active policy.

# ClawDesk 安裝與使用同意條款草案

版本：0.1.0
最後更新：2026-05-13

本文件是 ClawDesk 安裝檔與程式內法務中心使用的條款草案，不構成法律意見。正式商業發行前，必須由熟悉銷售地區、訂閱制、消費者保護、隱私、稅務與開源授權的律師審閱。

## 1. 接受條款

安裝、啟動、註冊、登入或使用 ClawDesk，即表示使用者同意本條款、EULA、隱私政策、第三方授權聲明與購買頁顯示的方案條件。不同意者不得安裝或使用本軟體。

## 2. 授權範圍

ClawDesk 是 OpenClaw-compatible、local-first 桌面 AI Agent。除明確標示的第三方開源元件外，ClawDesk 的 GUI、Agent、記憶、工作流、授權、診斷、商業與模仿學習功能採閉源商業授權。

ClawDesk 由 Alisonsoftware 以個人開發者 / independent publisher 名義開發與發行。除未來版本另有明確聲明外，Alisonsoftware 不以公司、代理商、系統整合商、財務顧問、法律顧問、稅務顧問或代管服務提供者身分對外表示。

使用者取得的是有限、非專屬、不可轉讓、可撤銷的使用授權，不取得 ClawDesk 原始碼、商標、服務端系統、授權後台或商業資料的所有權。

## 3. 使用者內容權利

使用者保留其輸入、上傳檔案、專案資料、知識庫、工作流與 AI 輸出內容的權利。ClawDesk 不主張使用者內容所有權。

使用者必須確保上傳或處理的資料有合法權利與授權，不得用於侵權、違法、未授權監控、竊取憑證、繞過系統保護或破壞第三方服務。

## 4. 付費、訂閱與自動續費

ClawDesk 的商業版固定使用 Lemon Squeezy 作為付款與授權供應商，處理付款、稅務、收據、退款、訂閱、取消、license key、機器綁定、撤銷、離線票券與更新資格。

訂閱方案會依購買頁顯示的價格、週期與稅額自動續費，直到使用者取消或付款失敗。購買前必須清楚顯示方案價格、付款週期、試用或促銷結束時間、取消方式、退款條件、支援更新到期日與功能限制。

使用者應可透過 Lemon Squeezy 客戶入口、ClawDesk 帳號/授權面板或客服入口取得取消訂閱方式。取消後，通常可使用至當期結束；若 Lemon Squeezy 或適用法律另有規定，以 Lemon Squeezy buyer terms、購買頁條件與適用法律為準。

## 5. 退款與消費者權利

數位內容、軟體與訂閱的退款、撤回權與取消權依購買地、使用者身分、Lemon Squeezy 條款與適用消費者保護法而異。ClawDesk 必須在購買與安裝前提供清楚、可保存的費用、功能、取消、退款、支援與聯絡資訊。

若使用者位於歐盟、英國、加州、台灣或其他具有特別消費者保護規範的地區，產品頁與結帳流程必須符合當地對數位內容、遠距交易、自動續費、資訊揭露與取消流程的要求。

## 6. 授權金鑰與機器綁定

ClawDesk 使用 Lemon Squeezy license key 授權模型。授權啟用時會建立 machine fingerprint 的 salted hash，用於裝置綁定、啟用限制、撤銷與離線票券驗證。ClawDesk 不應保存明文 CPU 序號、主機板序號、完整金鑰、API key 或付款識別碼。

偵測授權檔、方案、到期日、支援更新日期、裝置數或簽章被竄改時，軟體可降級為 safe mode、清除本機離線票券，並要求重新線上驗證。正式版可向授權後台回報竄改事件以便撤銷或人工審查。

## 7. 更新與支援到期日

Lifetime 可永久使用符合授權的本機功能，但支援更新權益以授權顯示的 supportUpdatesUntil 為準。支援更新到期後，使用者仍可使用最後符合資格的版本；若需安裝較新版本，必須續買更新支援或改用有效訂閱。

第一版採用「程式內檢查 + 手動下載」更新流程，不自動覆蓋安裝新版本。

## 8. 隱私、診斷與錯誤回報

ClawDesk 可在本機整理非個資診斷摘要，例如 app 版本、作業系統版本、CPU 架構、記憶體/磁碟容量區間、Gateway 狀態、錯誤碼、授權狀態類型與去識別化 log。

診斷包不得包含使用者姓名、Email、完整檔案內容、完整路徑、完整授權金鑰、API key、聊天內容、螢幕截圖或 Lemon customer id 明文。送出或匯出診斷包前，必須由使用者明確確認。

## 9. 第三方服務與模型供應商

使用者可在程式內連接 OpenAI、ChatGPT Pro 登入流程、Gemini API、Ollama、本地模型、Microsoft、Google、MCP 與其他供應商。各供應商的帳號、API、模型、資料處理、價格、限制與可用性受該供應商條款約束。

ClawDesk 不應收集或保存使用者的明文密碼。外部帳號登入應採安全的 browser-login handoff、OAuth 或供應商正式授權流程。

## 10. OpenClaw MIT 與第三方開源聲明

ClawDesk 保留 OpenClaw-compatible 聲明，但不主張上游 OpenClaw 商標、著作權或專案所有權。若 ClawDesk 發行版包含、改作或重製上游 OpenClaw MIT 授權程式碼，必須保留上游原始 copyright notice、MIT permission notice 與完整 LICENSE/NOTICE。

第三方元件的授權、用途與聲明列於程式內「版權與授權中心」及 `docs/legal/OPENCLAW_MIT_NOTICE.md`。

## 11. 禁止行為

使用者不得反向工程、破解授權、繞過裝置限制、出售或分享授權金鑰、移除版權聲明、用於未授權自動化、竊取資料、散布惡意程式、破壞第三方服務或違反適用法律。

## 12. 免責與責任限制

ClawDesk 以現況提供。除法律不得排除者外，不保證軟體不中斷、無錯誤、符合特定目的或能連接所有第三方服務。使用者應自行備份重要資料，並在高風險自動化前人工確認。

## 13. 條款更新

ClawDesk 可因法規、商業模式、金流、授權、第三方服務或產品功能調整本條款。重大變更應在程式內或帳號系統中提示使用者。
