# Keeps the factory running and up to date. Started hidden at log-on by the
# "Pulse Factory" scheduled task. Before every (re)start it pulls the latest
# reviewed code for this branch (fast-forward only), reinstalls dependencies
# if they changed, and only switches over if the new code typechecks.
$ErrorActionPreference = "Continue"
# One launcher at a time: a second one (left behind by a restart) kept trying to start the factory every
# 30 s beside the running one and filled the log with "database is in use" (24 Oct 2026).
$others = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq "powershell.exe" -and $_.ProcessId -ne $PID -and $_.CommandLine -match "windows\\run\.ps1" }
if ($others) { exit 0 }
$factory = Split-Path -Parent $PSScriptRoot
$repo = Split-Path -Parent $factory
Set-Location $factory
$logs = Join-Path $factory "data\logs"
New-Item -ItemType Directory -Force -Path $logs | Out-Null

function Log($log, $msg) { "[$(Get-Date -Format o)] $msg" | Out-File -Append -Encoding utf8 $log }

# A release that typechecks but dies at boot: the launcher goes back to the last version that ran, marks
# the release bad so the next update does not re-apply it, and tells the owner. Only a newer commit on
# the branch is tried after that.
$badRelease = Join-Path $factory "data\admin\bad_release"
$script:updatedFrom = $null

function Notify($text) {
  try {
    $line = (Get-Content (Join-Path $factory ".env") -ErrorAction SilentlyContinue) | Where-Object { $_ -match '^DISCORD_WEBHOOK_URL=' } | Select-Object -First 1
    if (-not $line) { return }
    $url = $line.Substring("DISCORD_WEBHOOK_URL=".Length).Trim()
    if (-not $url) { return }
    Invoke-RestMethod -Method Post -Uri $url -ContentType "application/json" -Body (@{ content = $text } | ConvertTo-Json) -TimeoutSec 15 | Out-Null
  } catch {}
}

function Roll-Back($log, $to, $why) {
  Log $log "$why; rolling back to $to"
  Set-Location $repo
  # --keep moves back without touching uncommitted local edits (it refuses rather than overwrite them).
  git reset --keep --quiet $to
  Set-Location $factory
  & cmd /c "npm ci --no-audit --no-fund >> `"$log`" 2>&1"
}

function Update-Factory($log) {
  if (-not (Test-Path (Join-Path $repo ".git"))) { return }   # zip installs update via INSTALL.cmd
  if ((Get-Content (Join-Path $factory ".env") -ErrorAction SilentlyContinue) -match '^AUTO_UPDATE=false') { return }
  Push-Location $repo
  try {
    $before = (git rev-parse HEAD).Trim()
    git fetch --quiet origin 2>&1 | Out-Null
    $upstream = (git rev-parse "@{u}" 2>$null)
    if (-not $upstream) { $upstream = (git rev-parse "origin/claude/epic-pasteur-7s143q" 2>$null) }
    if (-not $upstream -or $upstream.Trim() -eq $before) { return }
    # A release that died at boot is not tried twice; the branch has to move past it.
    if ((Test-Path $badRelease) -and ((Get-Content $badRelease -ErrorAction SilentlyContinue | Select-Object -First 1) -eq $upstream.Trim())) { return }
    git merge --ff-only --quiet $upstream.Trim() 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { Log $log "update skipped: local changes prevent a fast-forward"; return }
    Set-Location $factory
    # Paths are repo-relative, so ask from the repo root.
    if (git -C $repo diff --name-only $before HEAD -- factory/package-lock.json) { & cmd /c "npm ci --no-audit --no-fund >> `"$log`" 2>&1" }
    & cmd /c "npx tsc --noEmit -p . >> `"$log`" 2>&1"
    if ($LASTEXITCODE -ne 0) {
      Roll-Back $log $before "update failed typecheck"
      return
    }
    $script:updatedFrom = $before
    Log $log "updated $before -> $((git rev-parse HEAD).Trim())"
  } finally { Pop-Location }
}

while ($true) {
  $log = Join-Path $logs ("factory-" + (Get-Date -Format "yyyy-MM-dd") + ".log")
  Update-Factory $log
  Log $log "starting factory"
  # cmd does the redirect so node's UTF-8 output lands in the log as plain text
  # (PowerShell's *>> writes UTF-16 and wraps stderr lines in NativeCommandError records).
  # Above-normal priority: the factory publishes the channel, and on a PC shared with After Effects it
  # could not even start (22 Oct 2026, 96% CPU). Windows does not pass this class to child processes,
  # so renders themselves still run at normal priority.
  $started = Get-Date
  & cmd /c "start `"pulse-factory`" /b /wait /abovenormal node --import tsx src/server.ts >> `"$log`" 2>&1"
  $ran = ((Get-Date) - $started).TotalSeconds
  $code = $LASTEXITCODE
  Log $log "factory exited with $code after $([int]$ran)s; restarting in 30s"
  # 75: the factory itself asked for a reload (data\admin\reload-requested, src/reload.ts) at an idle moment,
  # so it comes straight back with whatever the branch now holds. A 75 inside the first minute is treated like
  # any other exit (30 s pause, the bad-release check) so a stuck flag can never spin the launcher.
  if ($code -eq 75 -and $ran -ge 60) {
    Log $log "reload requested by the factory; restarting now"
    $script:updatedFrom = $null
    continue
  }
  if ($script:updatedFrom -and $ran -lt 180 -and $code -ne 75) {
    # Fresh code, and it died inside three minutes: back to the version that was running.
    $bad = (git -C $repo rev-parse HEAD).Trim()
    New-Item -ItemType Directory -Force -Path (Split-Path $badRelease) | Out-Null
    Set-Content -Path $badRelease -Value $bad -Encoding ascii
    Roll-Back $log $script:updatedFrom "release $bad died $([int]$ran)s after boot"
    Notify "⚠️ Pulse Factory: the update $($bad.Substring(0,9)) died $([int]$ran)s after starting, so I went back to the previous version $($script:updatedFrom.Substring(0,9)), which is running again. That update will not be tried again until the branch moves past it. The log has the error: data\logs\factory-$(Get-Date -Format 'yyyy-MM-dd').log"
  } elseif ($script:updatedFrom -and (Test-Path $badRelease)) {
    # The new code ran: whatever was marked bad before is behind us now.
    Remove-Item $badRelease -Force -ErrorAction SilentlyContinue
  }
  $script:updatedFrom = $null
  Start-Sleep -Seconds 30
}
