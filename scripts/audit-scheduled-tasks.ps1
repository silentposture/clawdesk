[CmdletBinding()]
param(
  [string[]]$TaskNamePatterns = @("^Studio_", "^OpenClaw", "^NaviaWorks"),
  [switch]$AllowListAll,
  [switch]$Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$envPatternRaw = [string]$env:CLAWDESK_TASK_AUDIT_PATTERNS
if (-not [string]::IsNullOrWhiteSpace($envPatternRaw)) {
  $parsed = $envPatternRaw.Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" }
  if (@($parsed).Count -gt 0) {
    $TaskNamePatterns = @($parsed)
  }
}

function Test-HiddenRule {
  param(
    [string]$Execute,
    [string]$Arguments
  )

  $exec = ([string]$Execute).Trim().ToLowerInvariant()
  $args = ([string]$Arguments).Trim()
  $argsLower = $args.ToLowerInvariant()

  if ($exec -match "wscript(\.exe)?$" -and $argsLower -match "//b") {
    return $true
  }

  if ($exec -match "powershell(\.exe)?$" -and $argsLower -match "-windowstyle\s+hidden") {
    return $true
  }

  if ($argsLower -match "launch-.*-hidden\.vbs") {
    return $true
  }

  return $false
}

$allTasks = Get-ScheduledTask
$targetTasks = $allTasks | Where-Object {
  $name = [string]$_.TaskName
  foreach ($pattern in $TaskNamePatterns) {
    if ($name -match $pattern) { return $true }
  }
  return $false
}

$rows = foreach ($task in $targetTasks) {
  $action = $task.Actions | Select-Object -First 1
  $exec = [string]$action.Execute
  $args = [string]$action.Arguments
  [pscustomobject]@{
    TaskName = [string]$task.TaskName
    Execute = $exec
    Arguments = $args
    HiddenRule = (Test-HiddenRule -Execute $exec -Arguments $args)
  }
}

$violations = $rows | Where-Object { -not $_.HiddenRule }

if ($Json) {
  $report = [pscustomobject]@{
    checkedAt = (Get-Date).ToString("s")
    total = @($rows).Count
    violations = @($violations).Count
    rows = @($rows)
  }
  $report | ConvertTo-Json -Depth 5
} else {
  Write-Host ("Checked tasks: {0}" -f @($rows).Count)
  if (@($violations).Count -eq 0) {
    Write-Host "PASS hidden-window rule"
  } else {
    Write-Host ("FAIL hidden-window rule violations: {0}" -f @($violations).Count) -ForegroundColor Red
    $violations | Sort-Object TaskName | Format-Table -AutoSize
  }
}

if (-not $AllowListAll -and @($violations).Count -gt 0) {
  exit 1
}
