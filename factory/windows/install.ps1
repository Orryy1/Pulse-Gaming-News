# Pulse Factory installer for Windows. Safe to re-run: it updates in place.
#  1. makes sure Node.js 22+ is installed
#  2. installs dependencies and the render browser
#  3. writes factory\.env, reusing keys and the YouTube login the Codex
#     pipeline already has on this PC (asks only for anything missing)
#  4. registers a hidden "Pulse Factory" task that starts at log-on and keeps
#     the factory running, then starts it and opens the dashboard

$ErrorActionPreference = "Stop"
$factory = Split-Path -Parent $PSScriptRoot
$repo = Split-Path -Parent $factory
Set-Location $factory
function Say($msg) { Write-Host "`n== $msg" -ForegroundColor Cyan }

# ---------------------------------------------------------------- Node.js
Say "Checking Node.js"
$nodeOk = $false
try { $nodeOk = ([int]((node -v) -replace '^v(\d+).*', '$1')) -ge 22 } catch { }
if (-not $nodeOk) {
  Write-Host "Installing Node.js LTS with winget..."
  winget install -e --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}
node -v

# ----------------------------------------------------------- dependencies
Say "Installing dependencies (first run takes a few minutes)"
npm ci --no-audit --no-fund
npx remotion browser ensure

# ------------------------------------------------------------------- .env
Say "Configuring"
$envFile = Join-Path $factory ".env"
$values = [ordered]@{}
if (Test-Path $envFile) {
  foreach ($line in Get-Content $envFile) {
    if ($line -match '^\s*([A-Z0-9_]+)\s*=\s*(.*)$') { $values[$matches[1]] = $matches[2] }
  }
}

# Existing Codex installs: newest first. Keys found there are reused.
$candidates = @(
  "D:\pulse-runtime\pulse-production",
  "C:\Pulse\runtime\pulse-v1",
  "$env:USERPROFILE\gaming-studio\pulse-gaming",
  $repo
) + (Get-ChildItem "$env:USERPROFILE\.codex\worktrees\*\pulse-gaming" -Directory -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | ForEach-Object { $_.FullName })
$legacy = @{}
$legacyRoot = $null
foreach ($root in $candidates) {
  $f = Join-Path $root ".env"
  if (-not (Test-Path $f)) { continue }
  if (-not $legacyRoot) { $legacyRoot = $root }
  foreach ($line in Get-Content $f) {
    if ($line -match '^\s*([A-Z0-9_]+)\s*=\s*"?([^"#]*)"?') {
      if (-not $legacy.ContainsKey($matches[1]) -and $matches[2].Trim()) { $legacy[$matches[1]] = $matches[2].Trim() }
    }
  }
}
if ($legacyRoot) { Write-Host "Reusing settings from the Codex install at $legacyRoot" }

function Take($key, $prompt, [switch]$optional, $fallbackKey) {
  if ($values[$key]) { return }
  $v = $legacy[$key]
  if (-not $v -and $fallbackKey) { $v = $legacy[$fallbackKey] }
  if (-not $v) {
    $suffix = if ($optional) { " (Enter to skip)" } else { "" }
    $v = Read-Host "$prompt$suffix"
  }
  if ($v) { $values[$key] = $v.Trim() }
}
function NewSecret { -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 40 | ForEach-Object { [char]$_ }) }

if (-not $values["APP_SECRET"]) { $values["APP_SECRET"] = NewSecret }
if (-not $values["ADMIN_TOKEN"]) { $values["ADMIN_TOKEN"] = NewSecret }
Take "ANTHROPIC_API_KEY" "Anthropic API key"
Take "DISCORD_WEBHOOK_URL" "Discord webhook URL for approvals and alerts" -optional
Take "ELEVENLABS_API_KEY" "ElevenLabs API key (fallback voice only)" -optional
Take "ELEVENLABS_VOICE_ID" "ElevenLabs voice ID (fallback voice only)" -optional

# YouTube: reuse the Codex login (tokens\youtube_credentials.json + youtube_token.json).
if (-not $values["PULSE_TOKEN_DIR"]) {
  foreach ($root in $candidates) {
    $t = Join-Path $root "tokens"
    if (Test-Path (Join-Path $t "youtube_token.json")) { $values["PULSE_TOKEN_DIR"] = $t; break }
  }
}
if ($values["PULSE_TOKEN_DIR"]) { Write-Host "YouTube login: reusing $($values['PULSE_TOKEN_DIR'])" }
else { Write-Host "YouTube login not found; connect it later from the dashboard (/oauth/start)." -ForegroundColor Yellow }

# Local voice server (the Codex VoxCPM "Liam" voice, tts_server\ on port 8765).
# "auto" = local voice first, ElevenLabs only if the local one is down AND
# the plan has enough credits left for the script.
if (-not $values["VOICE_PROVIDER"]) { $values["VOICE_PROVIDER"] = "auto" }
if (-not $values["LOCAL_TTS_URL"]) { $values["LOCAL_TTS_URL"] = if ($legacy["LOCAL_TTS_URL"]) { $legacy["LOCAL_TTS_URL"] } else { "http://127.0.0.1:8765" } }
if (-not $values["PULSE_TTS_DIR"]) {
  foreach ($root in $candidates) {
    $dir = Join-Path $root "tts_server"
    if ((Test-Path (Join-Path $dir "start.bat")) -and (Test-Path (Join-Path $dir "venv"))) { $values["PULSE_TTS_DIR"] = $dir; break }
  }
}
# windows\start-liam.bat starts that tts_server on whatever port LOCAL_TTS_URL names,
# so the factory keeps its own copy away from the old governed service on 8765.
if ($values["PULSE_TTS_DIR"] -and -not $values["LOCAL_TTS_START"]) { $values["LOCAL_TTS_START"] = Join-Path $PSScriptRoot "start-liam.bat" }
if ($values["LOCAL_TTS_START"]) { Write-Host "Liam voice server: $($values['LOCAL_TTS_START']) (tts_server at $($values['PULSE_TTS_DIR']))" }
else { Write-Host "No installed Liam voice server found (tts_server\venv). Run tts_server\setup.bat in the Codex checkout, then re-run this installer." -ForegroundColor Yellow }

# Sensible defaults for an unattended daily channel.
$defaults = [ordered]@{
  APPROVAL_MODE = "timeout"; APPROVAL_TIMEOUT_MINUTES = "60"; DAILY_TARGET = "1"
  PUBLIC_URL = "http://localhost:8080"; PORT = "8080"; DATA_DIR = (Join-Path $factory "data")
  MUSIC_BED = "true"; VISION_QA = "true"; INCLUDE_RUMOURS = "false"
  REMOTION_GL = "angle"; REMOTION_CONCURRENCY = "8"   # GPU render: ~5x faster than swangle on the RTX 4090
}
foreach ($k in $defaults.Keys) { if (-not $values[$k]) { $values[$k] = $defaults[$k] } }

if (-not $values.Contains("DRY_RUN")) {
  $live = Read-Host "Publish to YouTube for real now? Type YES to go live, or Enter for a safe dry run first"
  $values["DRY_RUN"] = if ($live -eq "YES") { "false" } else { "true" }
}

$lines = @("# Pulse Factory settings. Written by windows\install.ps1; safe to edit.")
foreach ($k in $values.Keys) { $lines += "$k=$($values[$k])" }
Set-Content -Path $envFile -Value $lines -Encoding utf8
Write-Host "Saved $envFile"

# ------------------------------------------------------------ auto-start
Say "Registering the Pulse Factory start-up task"
$run = Join-Path $PSScriptRoot "run.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$run`"" -WorkingDirectory $factory
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
& (Join-Path $PSScriptRoot "uninstall.ps1") *> $null   # stop any old copy first
Register-ScheduledTask -TaskName "Pulse Factory" -Action $action -Trigger $trigger -Settings $settings `
  -Description "Pulse Gaming News daily Shorts factory" -Force | Out-Null
Start-ScheduledTask -TaskName "Pulse Factory"

Say "Done"
Start-Sleep -Seconds 20
$dash = "http://localhost:8080/episodes?key=$($values['ADMIN_TOKEN'])"
try { Invoke-RestMethod "http://localhost:8080/health" | Out-Null; Write-Host "Factory is running." -ForegroundColor Green }
catch { Write-Host "Factory is still starting; logs are in $factory\data\logs" -ForegroundColor Yellow }
Write-Host "Dashboard: $dash"
Start-Process $dash
