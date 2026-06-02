# Contributing

## Windows Task Scheduler Hidden-Window Gate

所有新增或修改的 Windows 排程任務，必須符合「啟動時不跳出命令提示字元或 PowerShell 視窗」規則。

允許形式：

- `wscript.exe //B //Nologo ...`
- `powershell.exe ... -WindowStyle Hidden ...`
- 透過 hidden launcher（例如 `launch-*-hidden.vbs`）間接啟動

必要檢查（本機提交前）：

```powershell
npm run audit:tasks:hidden
npm run preflight
```

若 `audit:tasks:hidden` 或 `preflight` 失敗，不得合併。

## Task Naming Scope

稽核腳本預設檢查以下任務名稱樣式：

- `^Studio_`
- `^OpenClaw`
- `^NaviaWorks`

新增產品線時，請用環境變數擴充範圍再執行稽核：

```powershell
$env:CLAWDESK_TASK_AUDIT_PATTERNS='^Studio_,^OpenClaw,^NaviaWorks,^YourProduct'
npm run audit:tasks:hidden
```

## Branch Protection Required

請在 GitHub repository 的受保護分支（至少 `main`）設定 Required status checks，並勾選：

- `Hidden Window Gate / hidden-window-and-preflight`

建議同時啟用：

- Require a pull request before merging
- Require branches to be up to date before merging
- Do not allow bypassing the above settings
