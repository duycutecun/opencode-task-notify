#Requires -Version 5.1
<#
.SYNOPSIS
  Runs a local Telegram Bot API server so videos up to 2 GB can be sent unmodified.

.EXAMPLE
  .\server.ps1 install -Download
  .\server.ps1 start
  .\server.ps1 status
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet("install", "start", "stop", "status", "logs")]
    [string]$Action = "status",

    [switch]$Download,
    [string]$ExePath,
    [int]$Port = 8081
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$dataDir = Join-Path $root "data"
$binDir = Join-Path $root "bin"
$logFile = Join-Path $root "server.log"
$pidFile = Join-Path $root "server.pid"
$envFile = Join-Path $root ".env"

function Read-DotEnv {
    if (-not (Test-Path $envFile)) {
        throw "Missing $envFile. Copy .env.example to .env and fill in TELEGRAM_API_ID / TELEGRAM_API_HASH."
    }
    $values = @{}
    foreach ($line in Get-Content $envFile) {
        if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
        $name, $value = $line -split '=', 2
        $values[$name.Trim()] = $value.Trim().Trim('"')
    }
    if (-not $values["TELEGRAM_API_ID"] -or -not $values["TELEGRAM_API_HASH"]) {
        throw "TELEGRAM_API_ID and TELEGRAM_API_HASH must be set in $envFile."
    }
    return $values
}

function Test-Docker {
    return [bool](Get-Command docker -ErrorAction SilentlyContinue)
}

function Get-ServerExe {
    if ($ExePath) { return (Resolve-Path $ExePath).Path }
    $candidate = Get-ChildItem -Path $binDir -Filter "telegram-bot-api.exe" -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($candidate) { return $candidate.FullName }
    return $null
}

function Install-Binary {
    if (-not $Download) {
        throw "No telegram-bot-api.exe found. Run '.\server.ps1 install -Download' to fetch a Windows build, or pass -ExePath <path>."
    }
    Write-Host "Fetching the latest Windows build from Bezdarnost01/telegram-bot-api-windows ..."
    $release = gh api repos/Bezdarnost01/telegram-bot-api-windows/releases/latest | ConvertFrom-Json
    $asset = $release.assets | Where-Object { $_.name -match '\.zip$' } | Select-Object -First 1
    if (-not $asset) { throw "No .zip asset in the latest release." }

    New-Item -ItemType Directory -Force $binDir | Out-Null
    $archive = Join-Path $binDir $asset.name
    Write-Host "Downloading $($asset.name) ..."
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $archive

    if ($asset.name -match '\.7z$') {
        if (Get-Command 7z -ErrorAction SilentlyContinue) {
            & 7z x -y "-o$binDir" $archive | Out-Null
        } elseif (Get-Command python -ErrorAction SilentlyContinue) {
            & python -m py7zr x $archive $binDir
        } else {
            throw "A .7z archive needs 7-Zip or Python's py7zr (pip install py7zr)."
        }
    } else {
        Expand-Archive -Path $archive -DestinationPath $binDir -Force
    }
    Remove-Item $archive
    $exe = Get-ChildItem -Path $binDir -Filter "telegram-bot-api.exe" -Recurse | Select-Object -First 1
    if ($exe) {
        $hash = (Get-FileHash $exe.FullName -Algorithm SHA256).Hash
        Write-Host "Installed $($exe.FullName)"
        Write-Host "SHA256 $hash"
    }
    Write-Host "Third-party build — review the source before trusting it."
}

function Start-Docker($values) {
    $compose = Join-Path $root "docker-compose.yml"
    $env:TELEGRAM_API_ID = $values["TELEGRAM_API_ID"]
    $env:TELEGRAM_API_HASH = $values["TELEGRAM_API_HASH"]
    $env:TELEGRAM_API_PORT = "$Port"
    docker compose -f $compose up -d
    Write-Host "Docker container started on port $Port."
}

function Start-Binary($values) {
    $exe = Get-ServerExe
    if (-not $exe) {
        throw "No telegram-bot-api.exe found. Run '.\server.ps1 install -Download' or pass -ExePath <path>."
    }
    if (Test-Path $pidFile) {
        $existing = Get-Process -Id (Get-Content $pidFile) -ErrorAction SilentlyContinue
        if ($existing) { Write-Host "Already running (PID $($existing.Id))."; return }
    }
    New-Item -ItemType Directory -Force $dataDir | Out-Null
    $arguments = @(
        "--local",
        "--api-id=$($values['TELEGRAM_API_ID'])",
        "--api-hash=$($values['TELEGRAM_API_HASH'])",
        "--http-port=$Port",
        "--dir=$dataDir",
        "--log=$logFile",
        "--verbosity=1"
    )
    $process = Start-Process -FilePath $exe -ArgumentList $arguments -WorkingDirectory $root -WindowStyle Hidden -PassThru
    Set-Content -Path $pidFile -Value $process.Id
    Write-Host "Started telegram-bot-api.exe (PID $($process.Id)) on port $Port."
    Write-Host "Log: $logFile"
}

$values = $null
if ($Action -eq "start") { $values = Read-DotEnv }

switch ($Action) {
    "install" {
        if (Test-Docker) { Write-Host "Docker found — '.\server.ps1 start' will use docker compose." }
        else { Install-Binary }
    }
    "start" {
        if (Test-Docker) { Start-Docker $values }
        else { Start-Binary $values }
        Start-Sleep -Seconds 2
        & $PSCommandPath status
    }
    "stop" {
        if (Test-Docker) {
            docker compose -f (Join-Path $root "docker-compose.yml") down
        }
        if (Test-Path $pidFile) {
            $id = Get-Content $pidFile
            Stop-Process -Id $id -ErrorAction SilentlyContinue
            Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
            Write-Host "Stopped PID $id."
        }
    }
    "logs" {
        if (Test-Path $logFile) { Get-Content $logFile -Tail 50 }
        else { Write-Host "No log file yet ($logFile)." }
    }
    "status" {
        $token = ""
        $configFile = Join-Path (Join-Path $HOME ".config\opencode") "notify.json"
        if (Test-Path $configFile) {
            try { $token = (Get-Content $configFile -Raw | ConvertFrom-Json).bot_token } catch { }
        }
        if (-not $token) {
            Write-Host "No bot token in $configFile — cannot verify the bot."
            return
        }
        try {
            $response = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/bot$token/getMe" -TimeoutSec 5
            Write-Host "Server OK on port $Port — bot @$($response.result.username)"
            Write-Host "Add to notify.json:  `"api_base`": `"http://127.0.0.1:$Port`""
        } catch {
            Write-Host "Server not responding on port $Port ($($_.Exception.Message))."
            Write-Host "Reminder: call logOut on the cloud API before switching the bot to this server."
        }
    }
}
