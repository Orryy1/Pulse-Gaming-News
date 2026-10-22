# Keeps the factory running and up to date. Started hidden at log-on by the
# "Pulse Factory" scheduled task. Before every (re)start it pulls the latest
# reviewed code for this branch (fast-forward only), reinstalls dependencies
# if they changed, and only switches over if the new code typechecks.
$ErrorActionPreference = "Continue"
$factory = Split-Path -Parent $PSScriptRoot
$repo = Split-Path -Parent $factory
Set-Location $factory
$logs = Join-Path $factory "data\logs"
New-Item -ItemType Directory -Force -Path $logs | Out-Null

function Log($log, $msg) { "[$(Get-Date -Format o)] $msg" | Out-File -Append -Encoding utf8 $log }

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
    git merge --ff-only --quiet $upstream.Trim() 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { Log $log "update skipped: local changes prevent a fast-forward"; return }
    Set-Location $factory
    # Paths are repo-relative, so ask from the repo root.
    if (git -C $repo diff --name-only $before HEAD -- factory/package-lock.json) { & cmd /c "npm ci --no-audit --no-fund >> `"$log`" 2>&1" }
    & cmd /c "npx tsc --noEmit -p . >> `"$log`" 2>&1"
    if ($LASTEXITCODE -ne 0) {
      Log $log "update failed typecheck; rolling back to $before"
      # --keep moves back without touching uncommitted local edits (it refuses rather than overwrite them).
      Set-Location $repo; git reset --keep --quiet $before; Set-Location $factory
      & cmd /c "npm ci --no-audit --no-fund >> `"$log`" 2>&1"
      return
    }
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
  & cmd /c "start `"pulse-factory`" /b /wait /abovenormal node --import tsx src/server.ts >> `"$log`" 2>&1"
  Log $log "factory exited with $LASTEXITCODE; restarting in 30s"
  Start-Sleep -Seconds 30
}
