import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { defaultHostName } from "../src/bridge/host-bridge-agent.mjs";

function parseArgs(argv) {
  const options = {
    outputDir: "",
    targetId: "",
    targetName: "",
    kind: "remote-desktop",
    hostName: "",
    gatewayBaseUrl: "http://127.0.0.1:18890",
    bridgeVersion: "local-example-bridge",
    heartbeatIntervalMs: 10_000,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--output" && next) {
      options.outputDir = next;
      i += 1;
    } else if (arg === "--target-id" && next) {
      options.targetId = next;
      i += 1;
    } else if (arg === "--target-name" && next) {
      options.targetName = next;
      i += 1;
    } else if (arg === "--kind" && next) {
      options.kind = next;
      i += 1;
    } else if (arg === "--host-name" && next) {
      options.hostName = next;
      i += 1;
    } else if (arg === "--gateway" && next) {
      options.gatewayBaseUrl = next;
      i += 1;
    } else if (arg === "--bridge-version" && next) {
      options.bridgeVersion = next;
      i += 1;
    } else if (arg === "--heartbeat-interval-ms" && next) {
      const parsed = Number.parseInt(next, 10);
      if (Number.isFinite(parsed) && parsed > 0) options.heartbeatIntervalMs = parsed;
      i += 1;
    }
  }

  return options;
}

function resolveOutputDir(value) {
  const raw = String(value || "").trim();
  if (raw) return path.resolve(raw);
  return path.join(process.cwd(), "artifacts", "host-agent-install-bundle");
}

function shellQuote(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function buildLauncherArgs({ targetId, targetName, kind, hostName, gatewayBaseUrl, bridgeVersion, statusPath, configPath, lockPath, heartbeatIntervalMs }) {
  return [
    shellQuote("src/bridge/host-agent-launcher.mjs"),
    "--status-file",
    shellQuote(statusPath),
    "--gateway",
    shellQuote(gatewayBaseUrl),
    "--target-id",
    shellQuote(targetId),
    "--target-name",
    shellQuote(targetName),
    "--kind",
    shellQuote(kind),
    "--host-name",
    shellQuote(hostName),
    "--bridge-version",
    shellQuote(bridgeVersion),
    "--config",
    shellQuote(configPath),
    "--lock-file",
    shellQuote(lockPath),
    "--daemon",
    "--heartbeat-interval-ms",
    String(heartbeatIntervalMs),
  ];
}

async function writeText(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

async function copyFile(srcPath, dstPath) {
  await fs.mkdir(path.dirname(dstPath), { recursive: true });
  await fs.copyFile(srcPath, dstPath);
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function prepareHostAgentInstallBundle(argv) {
  const options = parseArgs(argv);
  if (!options.targetId.trim()) {
    throw new Error("Target id is required.");
  }

  const nodeExecutable = process.execPath;
  const targetId = options.targetId.trim();
  const targetName = options.targetName.trim() || targetId;
  const kind = options.kind.trim();
  const hostName = options.hostName.trim() || defaultHostName();
  const gatewayBaseUrl = String(options.gatewayBaseUrl || "").trim().replace(/\/+$/, "");
  const bridgeVersion = options.bridgeVersion.trim();
  const outputDir = resolveOutputDir(options.outputDir);
  const bundleName = `${targetId}-host-agent-install-bundle`;
  const runtimeLauncherPath = path.join(outputDir, "src", "bridge", "host-agent-launcher.mjs");
  const runtimeBridgePath = path.join(outputDir, "src", "bridge", "host-bridge-agent.mjs");
  const runtimeLauncherRelativePath = "src/bridge/host-agent-launcher.mjs";
  const runtimeBridgeRelativePath = "src/bridge/host-bridge-agent.mjs";
  const configRelativePath = "host-agent.json";
  const lockRelativePath = "host-agent.lock";
  const statusRelativePath = "host-agent-status.json";
  const installRootRelativePath = `${targetId}-host-agent-install`;
  const startupRegistryHive = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
  const startupRegistryValueName = `ClawDeskHostAgent-${targetId}`;

  const configPath = configRelativePath;
  const lockPath = lockRelativePath;
  const statusPath = statusRelativePath;

  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });
  await copyFile(path.join(process.cwd(), "src", "bridge", "host-agent-launcher.mjs"), runtimeLauncherPath);
  await copyFile(path.join(process.cwd(), "src", "bridge", "host-bridge-agent.mjs"), runtimeBridgePath);

  const launcherArgs = buildLauncherArgs({
    targetId,
    targetName,
    kind,
    hostName,
    gatewayBaseUrl,
    bridgeVersion,
    statusPath,
    configPath,
    lockPath,
    heartbeatIntervalMs: options.heartbeatIntervalMs,
  });
  const launcherCommand = [shellQuote(nodeExecutable), ...launcherArgs].join(" ");

  const manifest = {
    createdAt: new Date().toISOString(),
    bundleName,
    outputDir,
    targetId,
    targetName,
    kind,
    hostName,
    gatewayBaseUrl,
    bridgeVersion,
    configPath,
    lockPath,
    statusPath,
    launcherArgs,
    launcherCommand,
    taskName: `ClawDeskHostAgent-${targetId}`,
    runtimeRoot: "src/bridge",
    runtimeEntryPoint: runtimeLauncherRelativePath,
    runtimeBridgeEntryPoint: runtimeBridgeRelativePath,
    runtimeInstallMode: "service-friendly-launcher",
    bundlePortable: true,
    installRootRelativePath,
    startupRegistryHive,
    startupRegistryValueName,
    files: [
      runtimeLauncherRelativePath,
      runtimeBridgeRelativePath,
      "README.md",
      "launch-host-agent.cmd",
      "launch-host-agent.ps1",
      "install-host-agent.ps1",
      "remove-host-agent.ps1",
      "register-host-agent.ps1",
      "unregister-host-agent.ps1",
      "uninstall-host-agent.ps1",
      "host-agent-install.json",
    ],
  };

  const readme = `# Host Agent Install Bundle

This folder contains a service-friendly handoff for the ClawDesk host bridge runtime.

## Paths

- Target ID: \`${targetId}\`
- Target name: \`${targetName}\`
- Kind: \`${kind}\`
- Host name: \`${hostName}\`
- Gateway: \`${gatewayBaseUrl}\`
- Config: \`${configRelativePath}\`
- Lock: \`${lockRelativePath}\`
- Status: \`${statusRelativePath}\`

## Launch

\`\`\`powershell
launch-host-agent.ps1
\`\`\`

or

\`\`\`cmd
launch-host-agent.cmd
\`\`\`

## Install

\`\`\`powershell
install-host-agent.ps1
\`\`\`

## Remove

\`\`\`powershell
remove-host-agent.ps1
\`\`\`

## Uninstall

\`\`\`powershell
uninstall-host-agent.ps1
\`\`\`

The bundle includes a local copy of the reusable host bridge runtime so the install root can be moved without depending on the repo checkout.

The launcher writes a lifecycle status file so a future Windows service or startup hook can supervise the runtime without changing the bridge contract.

## Startup Hook

\`\`\`powershell
register-host-agent-startup.ps1
\`\`\`

This creates a hidden per-user startup hook that launches the same runtime through the launcher entrypoint when the user session starts.
`;

  const launchCmd = `@echo off
setlocal
pushd "%~dp0"
set "CLAWDESK_HOST_AGENT_STATUS_FILE=%CD%\\${statusRelativePath}"
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0launch-host-agent.ps1"
popd
endlocal
`;

  const launchPs1 = `param(
  [int]$MaxHeartbeats = 0
)
$ErrorActionPreference = "Stop"
$bundleRoot = $PSScriptRoot
Push-Location $bundleRoot
try {
  $launcherScript = Join-Path $bundleRoot "${runtimeLauncherRelativePath}"
  $statusFile = Join-Path $bundleRoot "${statusRelativePath}"
  $configFile = Join-Path $bundleRoot "${configRelativePath}"
  $lockFile = Join-Path $bundleRoot "${lockRelativePath}"
  $arguments = @(
    $launcherScript,
    "--status-file", $statusFile,
    "--gateway", "${gatewayBaseUrl}",
    "--target-id", "${targetId}",
    "--target-name", "${targetName}",
    "--kind", "${kind}",
    "--host-name", "${hostName}",
    "--bridge-version", "${bridgeVersion}",
    "--config", $configFile,
    "--lock-file", $lockFile,
    "--daemon",
    "--heartbeat-interval-ms", "${options.heartbeatIntervalMs}"
  )
  if ($MaxHeartbeats -gt 0) {
    $arguments += @("--max-heartbeats", [string]$MaxHeartbeats)
  }
  & ${shellQuote(nodeExecutable)} @arguments
} finally {
  Pop-Location
}
`;

  const installPs1 = `param(
  [switch]$Preview,
  [string]$InstallRoot = ""
)
$ErrorActionPreference = "Stop"
$sourceRoot = $PSScriptRoot
$defaultInstallRoot = Join-Path $env:ProgramData "ClawDesk\\HostAgents\\${targetId}"
$resolvedInstallRoot = if ([string]::IsNullOrWhiteSpace($InstallRoot)) { $defaultInstallRoot } else { [System.IO.Path]::GetFullPath($InstallRoot) }
$installDefinition = [pscustomobject]@{
  SourceRoot = $sourceRoot
  InstallRoot = $resolvedInstallRoot
  InstallMode = "copy-bundle-and-register-startup"
  TaskName = "${manifest.taskName}"
  RuntimeEntryPoint = "${runtimeLauncherRelativePath}"
  RuntimeBridgeEntryPoint = "${runtimeBridgeRelativePath}"
  BundlePortable = $true
  StartupRegistryHive = "${startupRegistryHive}"
  StartupRegistryValueName = "${startupRegistryValueName}"
}
if ($Preview) {
  $installDefinition | ConvertTo-Json -Depth 4
  return
}
New-Item -ItemType Directory -Path $resolvedInstallRoot -Force | Out-Null
Copy-Item -Path (Join-Path $sourceRoot "*") -Destination $resolvedInstallRoot -Recurse -Force
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $resolvedInstallRoot "register-host-agent-startup.ps1")
Write-Host ("Installed host agent bundle to: {0}" -f $resolvedInstallRoot)
`;

  const removePs1 = `param(
  [switch]$Preview,
  [string]$InstallRoot = ""
)
$ErrorActionPreference = "Stop"
$sourceRoot = $PSScriptRoot
$defaultInstallRoot = Join-Path $env:ProgramData "ClawDesk\\HostAgents\\${targetId}"
$resolvedInstallRoot = if ([string]::IsNullOrWhiteSpace($InstallRoot)) { $defaultInstallRoot } else { [System.IO.Path]::GetFullPath($InstallRoot) }
$removeDefinition = [pscustomobject]@{
  SourceRoot = $sourceRoot
  InstallRoot = $resolvedInstallRoot
  InstallMode = "copy-bundle-and-register-startup"
  TaskName = "${manifest.taskName}"
  Action = "unregister-startup-and-remove-install-root"
  StartupRegistryHive = "${startupRegistryHive}"
  StartupRegistryValueName = "${startupRegistryValueName}"
}
if ($Preview) {
  $removeDefinition | ConvertTo-Json -Depth 4
  return
}
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $resolvedInstallRoot "unregister-host-agent-startup.ps1")
if (Test-Path $resolvedInstallRoot) {
  Remove-Item -LiteralPath $resolvedInstallRoot -Recurse -Force
}
Write-Host ("Removed host agent install root: {0}" -f $resolvedInstallRoot)
`;

  const registerStartupPs1 = `param(
  [switch]$Preview
)
$ErrorActionPreference = "Stop"
$startupKey = "${startupRegistryHive}"
$valueName = "${startupRegistryValueName}"
$launchScript = Join-Path $PSScriptRoot "launch-host-agent.ps1"
$command = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $launchScript + '"'
$startupDefinition = [pscustomobject]@{
  InstallMode = "copy-bundle-and-register-startup"
  StartupRegistryHive = $startupKey
  StartupRegistryValueName = $valueName
  Command = $command
}

if ($Preview) {
  $startupDefinition | ConvertTo-Json -Depth 4
  return
}

$null = New-Item -Path $startupKey -Force
New-ItemProperty -Path $startupKey -Name $valueName -Value $command -PropertyType String -Force | Out-Null
Write-Host ("Registered startup hook: {0} -> {1}" -f $valueName, $command)
`;

  const unregisterStartupPs1 = `param(
  [switch]$Preview
)
$ErrorActionPreference = "Stop"
$startupKey = "${startupRegistryHive}"
$valueName = "${startupRegistryValueName}"
$startupDefinition = [pscustomobject]@{
  InstallMode = "copy-bundle-and-register-startup"
  StartupRegistryHive = $startupKey
  StartupRegistryValueName = $valueName
  Action = "Remove-ItemProperty"
}
if ($Preview) {
  $startupDefinition | ConvertTo-Json -Depth 4
  return
}
if (Get-ItemProperty -Path $startupKey -Name $valueName -ErrorAction SilentlyContinue) {
  Remove-ItemProperty -Path $startupKey -Name $valueName -ErrorAction SilentlyContinue
  Write-Host ("Removed startup hook: {0}" -f $valueName)
} else {
  Write-Host ("Startup hook not found: {0}" -f $valueName)
}
`;

const uninstallPs1 = `param()
$ErrorActionPreference = "Stop"
$paths = @(
  (Join-Path $PSScriptRoot "${configRelativePath}"),
  (Join-Path $PSScriptRoot "${lockRelativePath}"),
  (Join-Path $PSScriptRoot "${statusRelativePath}")
)
foreach ($file in $paths) {
  if (Test-Path $file) { Remove-Item -LiteralPath $file -Force }
}
Write-Host "Removed host agent config, lock, and status files."
`;

  await writeText(path.join(outputDir, "README.md"), readme);
  await writeText(path.join(outputDir, "launch-host-agent.cmd"), launchCmd);
  await writeText(path.join(outputDir, "launch-host-agent.ps1"), launchPs1);
  await writeText(path.join(outputDir, "install-host-agent.ps1"), installPs1);
  await writeText(path.join(outputDir, "remove-host-agent.ps1"), removePs1);
  await writeText(path.join(outputDir, "register-host-agent-startup.ps1"), registerStartupPs1);
  await writeText(path.join(outputDir, "unregister-host-agent-startup.ps1"), unregisterStartupPs1);
  await writeText(path.join(outputDir, "register-host-agent.ps1"), registerStartupPs1);
  await writeText(path.join(outputDir, "unregister-host-agent.ps1"), unregisterStartupPs1);
  await writeText(path.join(outputDir, "uninstall-host-agent.ps1"), uninstallPs1);
  await writeText(path.join(outputDir, "host-agent-install.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  const configPreview = await readJsonIfExists(path.join(outputDir, configRelativePath));
  return {
    ...manifest,
    configPreview,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  prepareHostAgentInstallBundle(process.argv)
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.stack || error.message : String(error));
      process.exitCode = 1;
    });
}

export {
  parseArgs,
  prepareHostAgentInstallBundle,
  resolveOutputDir,
  shellQuote,
  buildLauncherArgs,
};
