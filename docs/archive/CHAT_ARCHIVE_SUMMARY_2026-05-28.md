# ClawDesk 對話封存摘要（2026-05-28）

## 1) 本對話主旨

將 ClawDesk 從「可運作原型」推進到「可持續驗證、可發布前檢核」狀態，重點放在：

- 本地/雲端 LLM 供應鏈可切換（含 Ollama 轉發雲端）
- GUI 可用性與行為一致性
- Windows 打包、metadata、smoke 流程收斂
- 任務/排程在 Windows 啟動時不可彈出 cmd/PowerShell 視窗

---

## 2) 本對話目標

### A. 產品與體驗面

- 讓使用者可在 ClawDesk 直接完成工作，不依賴手動先開 gateway 再開瀏覽器。
- 保留「可隨時更換 LLM 供應商」能力。
- 對話與附件操作可用，並能做全功能驗證循環。

### B. 工程與發布面

- 對齊 UniversalServer 契約方向（帳號、entitlement、license 主線一致化）。
- 收斂 Windows 產物命名、installer metadata、smoke 驗證流程。
- 建立可重複執行的品質閘門（preflight / QA / smoke / signing doctor）。

### C. 本輪新增硬性要求

- 「所有排程與任務啟動必須隱藏視窗」成為守則，且後續新建流程也要自動受檢。

---

## 3) 底層思維（Decision Logic）

### 3.1 先把規則變成系統，不靠人記憶

- 單次修正 `windowsHide` 不夠，必須加上自動檢查與流程 gate，避免回歸。
- 守則落到「程式碼 + 腳本 + preflight/qa 流程」三層，形成持續約束。

### 3.2 先保可驗證，再談可發布

- 先確保 `tauri:build:win`、`smoke:win-app -- --no-build`、`smoke:win-installer -- --no-build` 可穩定通過。
- 簽章則以 `sign:win:doctor` 明確標出阻塞點，不假裝完成。

### 3.3 最小安全變更（Small Safe Changes）

- 優先改動啟動子程序入口與既有 QA/Preflight 腳本，不做大規模架構重寫。
- 變更集中在 `scripts/*` 與 `src-tauri/src/lib.rs` 的程序啟動點。

---

## 4) 已落地的解決方案

### 4.1 Windows 隱藏視窗守則

- 新增守則文件：  
  `docs/windows/WINDOWS_HIDDEN_WINDOW_POLICY.md`
- 規範：
  - Node `spawn/spawnSync`：Windows 必須 `windowsHide: true`
  - PowerShell `Start-Process`：必須 `-WindowStyle Hidden`
  - Rust `Command`：Windows 必須 `creation_flags(CREATE_NO_WINDOW)`

### 4.2 啟動點全面修正

- 已修正多個 `scripts/*` 啟動流程與 `src-tauri/src/lib.rs` sidecar 啟動，避免彈窗。
- Rust sidecar 啟動加上 `CREATE_NO_WINDOW`。

### 4.3 自動守則檢查

- 新增：`scripts/enforce-hidden-window-policy.mjs`
- 新增 npm script：`npm run policy:hidden-window`
- 該檢查已可掃描 Node / PowerShell / Rust 相關規則違反。

### 4.4 併入主流程 gate

- `preflight` 已納入 hidden-window policy 檢查。
- `qa-loop` / `qa-win-one-shot` 已納入 hidden-window policy 步驟。
- `tauri:build:win`（`scripts/build-windows.mjs`）已在打包前強制執行 `preflight`。

### 4.5 實測結果（本輪）

- `npm run tauri:build:win`：PASS  
  - 產物：
    - `src-tauri/target/release/clawdesk-desktop.exe`
    - `src-tauri/target/release/bundle/nsis/ClawDesk_0.1.0_x64-setup.exe`
- `npm run smoke:win-app -- --no-build`：PASS
- `npm run smoke:win-installer -- --no-build`：PASS
- `npm run sign:win:doctor`：BLOCKED（簽章環境未設定）
- `npm run smoke:win-installer -- --no-build --require-signature`：FAIL（`signature-invalid`，符合現況）

### 4.6 目前唯一主要阻塞

- Windows 簽章環境缺失（PFX / cert-store-subject / Azure Trusted Signing 三者皆未配置）。

---

## 封存結論

本對話已把「隱藏視窗守則」從口頭要求轉成可持續執行的工程制度，並完成 build/smoke 實測收斂。  
目前距離正式發布的關鍵阻塞僅剩「簽章環境配置」。
