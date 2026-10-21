# Downloads task-notify from GitHub and runs its installer.
# Works without git: only PowerShell and Node.js 18+ are required.
#
#   $s = irm https://raw.githubusercontent.com/duycutecun/opencode-task-notify/main/bootstrap.ps1
#   & ([scriptblock]::Create($s)) -Token "123456:ABC..." -ChatId "7152973094"
#
# Or save it first:
#   iwr https://raw.githubusercontent.com/duycutecun/opencode-task-notify/main/bootstrap.ps1 -OutFile "$env:TEMP\tn.ps1"
#   & "$env:TEMP\tn.ps1" -Token "123456:ABC..." -ChatId "7152973094"

param(
    [string]$Token,
    [string]$ChatId,
    [string]$ApiBase,
    [string]$ConfigDir,
    [switch]$NoOpenMontage,
    [switch]$DryRun,
    [string]$Ref = "main"
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Write-Step($text) { Write-Host "==> $text" }

Write-Step "Downloading opencode-task-notify ($Ref)"

$tmp = Join-Path ([IO.Path]::GetTempPath()) ("task-notify-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force $tmp | Out-Null

try {
    $zip = Join-Path $tmp "repo.zip"
    $url = "https://github.com/duycutecun/opencode-task-notify/archive/refs/heads/$Ref.zip"
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing

    Write-Step "Extracting"
    Expand-Archive -Path $zip -DestinationPath $tmp -Force

    $root = Get-ChildItem -Path $tmp -Directory | Select-Object -First 1
    if (-not $root) { throw "Could not find the extracted repository folder." }

    $installer = Join-Path $root.FullName "install.ps1"
    if (-not (Test-Path $installer)) { throw "install.ps1 not found in the downloaded archive." }

    $installArgs = @{}
    if ($Token) { $installArgs.Token = $Token }
    if ($ChatId) { $installArgs.ChatId = $ChatId }
    if ($ApiBase) { $installArgs.ApiBase = $ApiBase }
    if ($ConfigDir) { $installArgs.ConfigDir = $ConfigDir }
    if ($NoOpenMontage) { $installArgs.NoOpenMontage = $true }
    if ($DryRun) { $installArgs.DryRun = $true }

    Write-Step "Running installer"
    & $installer @installArgs
    if ($LASTEXITCODE -ne 0) { throw "Installer exited with code $LASTEXITCODE." }

    Write-Host ""
    Write-Host "Done. Restart OpenCode, then verify:"
    Write-Host '  node "$HOME/.config/opencode/skills/task-notify/notify.mjs" --whoami'
    Write-Host '  node "$HOME/.config/opencode/skills/task-notify/notify.mjs" --test'
}
finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
