import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();
const timestampUrl = process.env.WINDOWS_SIGNING_TIMESTAMP_URL || "http://timestamp.digicert.com";

function newestInstaller() {
  const dir = path.join(cwd, "src-tauri", "target", "release", "bundle", "nsis");
  if (!fs.existsSync(dir)) return null;
  return fs
    .readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith(".exe"))
    .map((name) => {
      const filePath = path.join(dir, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.filePath ?? null;
}

function findSigntool() {
  const roots = [
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "Windows Kits", "10", "bin") : null,
    process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"], "Windows Kits", "10", "bin") : null,
  ].filter(Boolean);
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const versions = fs.readdirSync(root).sort().reverse();
    for (const version of versions) {
      for (const arch of ["x64", "x86"]) {
        const candidate = path.join(root, version, arch, "signtool.exe");
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }
  return "signtool.exe";
}

const installer = process.argv.slice(2).find((arg) => arg.toLowerCase().endsWith(".exe")) ?? newestInstaller();
if (!installer) throw new Error("找不到 Windows NSIS installer，請先執行 npm run tauri:build:win。");

const certPath = process.env.WINDOWS_SIGNING_CERTIFICATE;
const certPassword = process.env.WINDOWS_SIGNING_CERTIFICATE_PASSWORD;
const certSubject = process.env.WINDOWS_SIGNING_CERTIFICATE_SUBJECT;
const hasTrustedSigning =
  process.env.AZURE_TRUSTED_SIGNING_ACCOUNT_NAME &&
  process.env.AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME &&
  process.env.AZURE_TRUSTED_SIGNING_ENDPOINT;

if (!certPath && !certSubject) {
  if (hasTrustedSigning) {
    throw new Error("偵測到 Azure Trusted Signing env，但本機腳本不直接呼叫 Azure 簽章；請在 CI 執行 Azure Artifact Signing 後再跑驗證。");
  }
  throw new Error("缺少 WINDOWS_SIGNING_CERTIFICATE 或 WINDOWS_SIGNING_CERTIFICATE_SUBJECT。");
}

const args = ["sign", "/fd", "SHA256", "/td", "SHA256", "/tr", timestampUrl];
if (certPath) {
  args.push("/f", certPath);
  if (certPassword) args.push("/p", certPassword);
} else {
  args.push("/n", certSubject);
}
args.push(installer);

const signtool = findSigntool();
const result = spawnSync(signtool, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: false });
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.status !== 0) process.exit(result.status ?? 1);

console.log(`Signed Windows installer: ${installer}`);
