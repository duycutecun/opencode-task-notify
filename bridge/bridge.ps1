#Requires -Version 5.1
<#
.SYNOPSIS
  Install, start, stop and inspect the Telegram <-> OpenCode bridge.

.EXAMPLE
  .\bridge.ps1 install -OwnerId 7152973094
  .\bridge.ps1 start
  .\bridge.ps1 status
  .\bridge.ps1 logs
#>
param(
    [ValidateSet("install", "start", "stop", "restart", "status", "logs")]
    [string]$Action = "status",
    [string]$OwnerId,
    [string]$WorkDir,
    [switch]$Autostart
)

$ErrorActionPreference = "Stop"

$scriptDir = $PSScriptRoot
$bridgeScript = Join-Path $scriptDir "bridge.mjs"
$configDir = Join-Path $HOME ".config\opencode"
$configFile = Join-Path $configDir "bridge.json"
$pidFile = Join-Path $configDir "bridge.pid"
$logFile = Join-Path $configDir "bridge.log"
$errFile = Join-Path $configDir "bridge.err.log"

function Get-BridgeProcess {
    if (-not (Test-Path $pidFile)) { return $null }
    $savedPid = (Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    if (-not $savedPid) { return $null }
    return Get-Process -Id ([int]$savedPid) -ErrorAction SilentlyContinue
}

function Show-Tail($lines = 12) {
    if (Test-Path $logFile) {
        Write-Host "--- last log lines ---"
        Get-Content $logFile -Tail $lines
    }
    if ((Test-Path $errFile) -and (Get-Item $errFile).Length -gt 0) {
        Write-Host "--- stderr ---"
        Get-Content $errFile -Tail 10
    }
}

function Install-Bridge {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        throw "Node.js 18+ is required."
    }
    if (-not (Test-Path $configFile)) {
        $token = ""
        $notify = Join-Path $configDir "notify.json"
        if (Test-Path $notify) {
            $token = (Get-Content $notify -Raw | ConvertFrom-Json).bot_token
        }
        $owner = $OwnerId
        if (-not $owner) {
            $chatId = ""
            if (Test-Path $notify) { $chatId = (Get-Content $notify -Raw | ConvertFrom-Json).chat_id }
            if ($chatId -and [int64]$chatId -gt 0) { $owner = [string]$chatId }
        }
        if (-not $owner) {
            throw "Pass -OwnerId <your numeric Telegram user id> so only you can command the bot."
        }
        $dir = if ($WorkDir) { $WorkDir } else { Join-Path $HOME "opencode-workspace" }
        $config = [ordered]@{
            bot_token              = $token
            allowed_user_ids       = @($owner)
            workdir                = $dir
            auto_approve           = $true
            require_mention_in_groups = $true
            max_minutes            = 15
        }
        New-Item -ItemType Directory -Force $configDir | Out-Null
        $config | ConvertTo-Json -Depth 5 | Set-Content $configFile -Encoding UTF8
        New-Item -ItemType Directory -Force $dir | Out-Null
        Write-Host "Wrote $configFile"
    } else {
        Write-Host "Config already exists: $configFile"
    }

    if ($Autostart) {
        $startup = [Environment]::GetFolderPath("Startup")
        $shortcutPath = Join-Path $startup "OpenCode Telegram Bridge.lnk"
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = "powershell.exe"
        $shortcut.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSCommandPath`" start"
        $shortcut.WorkingDirectory = $scriptDir
        $shortcut.Save()
        Write-Host "Autostart shortcut: $shortcutPath"
    }

    Write-Host ""
    Write-Host "Next:"
    Write-Host "  1. In a group, the bot only sees messages that mention it or start with /. If plain messages do not work,"
    Write-Host "     open @BotFather -> /setprivacy -> select the bot -> Disable, then remove/re-add the bot to the group."
    Write-Host "  2. Start it:  .\bridge.ps1 start"
    Write-Host "  3. Message the bot or the group:  /status"
}

function Start-Bridge {
    $running = Get-BridgeProcess
    if ($running) {
        Write-Host "Already running (PID $($running.Id))."
        return
    }
    if (-not (Test-Path $configFile)) {
        throw "No config yet. Run: .\bridge.ps1 install -OwnerId <your id>"
    }
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        throw "Node.js 18+ is required."
    }
    if (Test-Path $logFile) {
        Move-Item $logFile "$logFile.1" -Force -ErrorAction SilentlyContinue
    }
    $nodePath = (Get-Command node).Source
    $commandLine = "`"$nodePath`" `"$bridgeScript`""
    $created = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
        CommandLine      = $commandLine
        CurrentDirectory = $scriptDir
    }
    if ($created.ReturnValue -ne 0) {
        throw "Could not start node (Win32_Process.Create returned $($created.ReturnValue))."
    }
    $processId = [int]$created.ProcessId
    Set-Content -Path $pidFile -Value $processId -Encoding ASCII
    Start-Sleep -Seconds 3
    $alive = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if (-not $alive) {
        Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
        Write-Host "Bridge exited immediately."
        Show-Tail 20
        throw "Bridge failed to start."
    }
    Write-Host "Started bridge (PID $processId)."
    Show-Tail 5
}

function Stop-Bridge {
    $running = Get-BridgeProcess
    if (-not $running) {
        Write-Host "Not running."
        Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
        return
    }
    & taskkill.exe /PID $running.Id /T /F | Out-Null
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    Write-Host "Stopped PID $($running.Id)."
}

function Show-Status {
    $running = Get-BridgeProcess
    if ($running) {
        Write-Host "Bridge running (PID $($running.Id))."
    } else {
        Write-Host "Bridge not running."
    }
    if (Test-Path $configFile) {
        $config = Get-Content $configFile -Raw | ConvertFrom-Json
        Write-Host "Workdir: $($config.workdir)"
        Write-Host "Allowed users: $($config.allowed_user_ids -join ', ')"
        $token = $config.bot_token
        if (-not $token) {
            $notify = Join-Path $configDir "notify.json"
            if (Test-Path $notify) { $token = (Get-Content $notify -Raw | ConvertFrom-Json).bot_token }
        }
        if ($token) { Write-Host "Bot token: configured" } else { Write-Host "Bot token: MISSING" }
    } else {
        Write-Host "No config: $configFile"
    }
    Show-Tail 10
}

switch ($Action) {
    "install" { Install-Bridge }
    "start" { Start-Bridge }
    "stop" { Stop-Bridge }
    "restart" { Stop-Bridge; Start-Sleep -Seconds 1; Start-Bridge }
    "status" { Show-Status }
    "logs" { Show-Tail 40 }
}
