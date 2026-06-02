# Windows Signing Setup

ClawDesk Windows 直售 Beta 需要 signed NSIS installer。簽章設定只能選一種方式，避免 build 機器用錯憑證。

## 共同前置

1. 安裝 Windows SDK Signing Tools，確認 `signtool.exe` 可用。
2. 先產生 installer：

```powershell
npm run tauri:build:win
```

3. 檢查簽章環境：

```powershell
npm run sign:win:doctor
```

## Method A: PFX 檔案

適合本機首發簽章。PFX 必須放在 repo 外，不要提交到 Git。

`.env.production`：

```text
WINDOWS_SIGNING_CERTIFICATE=C:\secure-certs\clawdesk-code-signing.pfx
WINDOWS_SIGNING_CERTIFICATE_PASSWORD=your-local-secret
WINDOWS_SIGNING_TIMESTAMP_URL=http://timestamp.digicert.com
```

執行：

```powershell
npm run sign:win:doctor
npm run sign:win-installer
npm run release:metadata:win
npm run release:metadata:win:check -- --require-signature
```

## Method B: Windows Certificate Store

適合憑證已安裝在 `CurrentUser\My` 或 `LocalMachine\My` 的情境。

`.env.production`：

```text
WINDOWS_SIGNING_CERTIFICATE_SUBJECT=ClawDesk Contributors
WINDOWS_SIGNING_TIMESTAMP_URL=http://timestamp.digicert.com
```

執行：

```powershell
npm run sign:win:doctor
npm run sign:win-installer
npm run release:metadata:win
npm run release:metadata:win:check -- --require-signature
```

## Method C: Azure Trusted Signing

適合後續 CI。此方法不由本機 `sign:win-installer` 直接簽章；本機只檢查 env 是否完整，實際簽章應由 Azure/CI workflow 完成。

`.env.production`：

```text
AZURE_TRUSTED_SIGNING_ACCOUNT_NAME=
AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME=
AZURE_TRUSTED_SIGNING_ENDPOINT=
```

簽章完成後回到本機或 CI 驗證：

```powershell
npm run release:metadata:win
npm run release:metadata:win:check -- --require-signature
npm run smoke:win-installer -- --no-build --require-signature
```

## 上線判斷

正式公開付費 Beta 前，以下指令必須通過：

```powershell
npm run sign:win:doctor
npm run release:metadata:win:check -- --require-signature
npm run beta:readiness:check
```

若 `Signature` 仍是 `invalid`，installer 只能作為測試候選，不能公開收費販售。
