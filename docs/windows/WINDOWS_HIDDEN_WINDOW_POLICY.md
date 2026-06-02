# Windows 任務啟動隱藏視窗守則

適用範圍：所有由 ClawDesk 啟動的排程、背景任務、驗證腳本、sidecar、安裝/簽章流程。

## 強制規則

1. Node.js `spawn` / `spawnSync` 在 Windows 必須設定：
   - `windowsHide: true`（或 `windowsHide: process.platform === "win32"`）。
2. PowerShell `Start-Process` 必須設定：
   - `-WindowStyle Hidden`。
3. Rust `std::process::Command` 在 Windows 啟動背景程序必須設定：
   - `creation_flags(CREATE_NO_WINDOW)`。
4. 禁止新增會彈出 `cmd.exe`、`powershell.exe` 視窗的任務啟動流程。

## 實作檢查清單（新增任務時必做）

- 是否透過上述方式隱藏視窗？
- 是否仍保留可觀測性（log 檔或 pipe）而非依賴可見終端？
- smoke / qa 任務是否仍可無 UI 終端彈窗完成？
