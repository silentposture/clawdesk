# Chat Archive Summary (2026-05-28)

## 主旨
在 ClawDesk/Studio 生態下，建立並落地「Windows 排程與背景任務一律隱藏視窗啟動」治理機制，避免跳出 CMD/PowerShell 視窗，並把規範變成可持續驗證的工程流程。

## 目標
- 盤點既有相關排程與啟動方式。
- 修正不符合隱藏視窗規則的任務。
- 將規則固化為：腳本檢查 + preflight gate + CI gate + 團隊文件規範。
- 讓後續新建任務也自動受控，不依賴人工記憶。

## 底層思維
- 規範必須「可機器驗證」，不能只靠口頭要求。
- 規範要「前移」到開發流程早期（preflight）與合併流程（CI/branch protection）。
- 對 Windows 任務採明確允許策略：
  - `wscript.exe //B //Nologo ...`
  - `powershell.exe ... -WindowStyle Hidden ...`
  - hidden vbs launcher
- 保留擴充性：以任務命名 pattern 管理產品線範圍，可透過環境變數擴充。

## 解決方案
1. 排程盤點與修正
- 掃描 Task Scheduler 相關任務（Studio/OpenClaw/NaviaWorks）。
- 將高風險直接 `python` 啟動任務改為隱藏啟動鏈。

2. 稽核腳本
- 新增 `scripts/audit-scheduled-tasks.ps1`。
- 檢查任務是否符合 hidden-window 規則。
- 支援 `CLAWDESK_TASK_AUDIT_PATTERNS` 覆蓋命名範圍。

3. 本機流程整合
- 新增 npm 指令：`audit:tasks:hidden`。
- 將 hidden-window 稽核整合進 `preflight`（Windows 強制、非 Windows 略過）。

4. 團隊規範固化
- 更新 README：說明守則、指令與環境變數覆蓋方式。
- 新增 CONTRIBUTING：把此規範列為 merge 前必要 gate。

5. CI 與分支治理
- 新增 GitHub Actions：`.github/workflows/hidden-window-gate.yml`。
- CI 於 Windows runner 執行 `audit:tasks:hidden` + `preflight`。
- 新增 branch protection readiness 檢查腳本：`scripts/verify-branch-protection-readiness.mjs`。

## 目前狀態
- 本機 `audit:tasks:hidden`、`preflight` 均已多次 PASS。
- 規範已具備「腳本、流程、CI、文件」四層防線。
- 剩餘平台側動作：在 GitHub 將 `Hidden Window Gate / hidden-window-and-preflight` 設為 required status check（repo 設定層）。
