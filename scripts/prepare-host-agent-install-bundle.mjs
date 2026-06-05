import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { defaultHostName, resolveConfigPath, resolveLockPath } from "../src/bridge/host-bridge-agent.mjs";
import { resolveStatusPath } from "../src/bridge/host-agent-launcher.mjs";

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
    shellQuote(path.resolve("src/bridge/host-agent-launcher.mjs")),
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

  const configPath = resolveConfigPath(path.join(outputDir, "host-agent.json"));
  const lockPath = resolveLockPath(path.join(outputDir, "host-agent.lock"));
  const statusPath = resolveStatusPath(path.join(outputDir, "host-agent-status.json"));

  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });

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
    runtimeEntryPoint: "src/bridge/host-agent-launcher.mjs",
    runtimeInstallMode: "service-friendly-launcher",
    files: [
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
- Config: \`${configPath}\`
- Lock: \`${lockPath}\`
- Status: \`${statusPath}\`

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

The launcher writes a lifecycle status file so a future Windows service or startup hook can supervise the runtime without changing the bridge contract.

## Scheduled Task

\`\`\`powershell
register-host-agent.ps1
\`\`\`

This creates a hidden logon task that launches the same runtime through the launcher entrypoint.
`;

  const launchCmd = `@echo off
setlocal
set "CLAWDESK_HOST_AGENT_STATUS_FILE=${statusPath}"
${launcherCommand}
endlocal
`;

  const launchPs1 = `param()
$ErrorActionPreference = "Stop"
$env:CLAWDESK_HOST_AGENT_STATUS_FILE = "${statusPath}"
& ${shellQuote(nodeExecutable)} ${launcherArgs.join(" ")}
`;

  const installPs1 = `param(
  [switch]$Preview
)
$ErrorActionPreference = "Stop"
$scriptPath = Join-Path $PSScriptRoot "register-host-agent.ps1"
$arguments = @()
if ($Preview) { $arguments += "-Preview" }
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $scriptPath @arguments
`;

  const removePs1 = `param(
  [switch]$Preview
)
$ErrorActionPreference = "Stop"
$scriptPath = Join-Path $PSScriptRoot "unregister-host-agent.ps1"
$arguments = @()
if ($Preview) { $arguments += "-Preview" }
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $scriptPath @arguments
`;

  const registerPs1 = `param(
  [switch]$Preview
)
$ErrorActionPreference = "Stop"
$taskName = "${manifest.taskName}"
$powershell = ${shellQuote("powershell.exe")}
$launchScript = ${shellQuote(path.join(outputDir, "launch-host-agent.ps1"))}
$statusFile = "${statusPath}"
$registerDefinition = [pscustomobject]@{
  TaskName = $taskName
  Execute = $powershell
  Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File $launchScript"
  Trigger = "AtLogOn"
  RunLevel = "LeastPrivilege"
  HiddenWindow = $true
}

if ($Preview) {
  $registerDefinition | ConvertTo-Json -Depth 4
  return
}

$action = New-ScheduledTaskAction -Execute $powershell -Argument ("-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File {0}" -f $launchScript)
$trigger = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel LeastPrivilege
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "ClawDesk host agent launcher"
Write-Host ("Registered scheduled task: {0}" -f $taskName)
`;

  const unregisterPs1 = `param(
  [switch]$Preview
)
$ErrorActionPreference = "Stop"
$taskName = "${manifest.taskName}"
$unregisterDefinition = [pscustomobject]@{
  TaskName = $taskName
  Action = "Unregister-ScheduledTask"
}
if ($Preview) {
  $unregisterDefinition | ConvertTo-Json -Depth 4
  return
}
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  Write-Host ("Unregistered scheduled task: {0}" -f $taskName)
} else {
  Write-Host ("Scheduled task not found: {0}" -f $taskName)
}
`;

  const uninstallPs1 = `param()
$ErrorActionPreference = "Stop"
$paths = @(
  "${configPath}",
  "${lockPath}",
  "${statusPath}"
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
  await writeText(path.join(outputDir, "register-host-agent.ps1"), registerPs1);
  await writeText(path.join(outputDir, "unregister-host-agent.ps1"), unregisterPs1);
  await writeText(path.join(outputDir, "uninstall-host-agent.ps1"), uninstallPs1);
  await writeText(path.join(outputDir, "host-agent-install.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  const configPreview = await readJsonIfExists(configPath);
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
