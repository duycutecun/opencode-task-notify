#Requires -Version 5.1
<#
.SYNOPSIS
  Installs the OpenCode task-notify skill (Telegram notifications when a task or video finishes).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\install.ps1

.EXAMPLE
  .\install.ps1 -Token "123456:ABC..." -ChatId "987654321"

.EXAMPLE
  .\install.ps1 -Token "123456:ABC..." -ChatId "987654321" -Machine "PC-01"

.EXAMPLE
  .\install.ps1 -OpenMontage "D:\Tools\OpenMontage"
#>
[CmdletBinding()]
param(
    [string]$Token,
    [string]$ChatId,
    [string]$Machine,
    [string]$ApiBase,
    [string]$OpenMontage,
    [string]$ConfigDir,
    [switch]$NoOpenMontage,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "Node.js 18+ is required. Install it from https://nodejs.org and run this script again."
    exit 1
}

$arguments = @((Join-Path $PSScriptRoot "install.mjs"))

if ($Token) { $arguments += @("--token", $Token) }
if ($ChatId) { $arguments += @("--chat-id", $ChatId) }
if ($Machine) { $arguments += @("--machine", $Machine) }
if ($ApiBase) { $arguments += @("--api-base", $ApiBase) }
if ($OpenMontage) { $arguments += @("--openmontage", $OpenMontage) }
if ($ConfigDir) { $arguments += @("--config-dir", $ConfigDir) }
if ($NoOpenMontage) { $arguments += "--no-openmontage" }
if ($DryRun) { $arguments += "--dry-run" }

& node @arguments
exit $LASTEXITCODE
