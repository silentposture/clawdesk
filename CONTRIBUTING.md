# Contributing to ClawDesk

ClawDesk 目前以非商業、source-available 的方式公開，歡迎 fork、修改、提交 PR、補強測試與文件。

## What to contribute

- 修正 bug、補強測試、改善驗證流程
- 補齊文件、runbook、release gate、CI
- 針對 source integrity、build reproducibility、cross-platform parity 提出改進
- 把仍然殘留的商業措辭改成歷史註記或移除

## What not to contribute

- 任何會讓本專案變成商業收費、付費解鎖、訂閱牆或代管收費服務的變更
- secrets、token、私鑰、付款憑證或其他敏感資料
- 只為格式而改的雜訊型 PR，除非有明確理由

## Local checks

Before opening a PR, run:

```powershell
npm run preflight
npm run i18n:audit:strict
npm test
npm run build
```

If you touch release or CI files, also run the relevant workflow locally or verify the latest GitHub Actions run.

## PR expectations

- Keep changes small and focused.
- Explain the problem, the change, and the validation in the PR description.
- If you are changing licensing or governance text, update every visible entry point that describes the project model.
