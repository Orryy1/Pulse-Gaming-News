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
    if (git diff --name-only $before HEAD -- factory/package-lock.json) { npm ci --no-audit --no-fund *>> $log }
    npx tsc --noEmit -p . *>> $log
    if ($LASTEXITCODE -ne 0) {
      Log $log "update failed typecheck; rolling back to $before"
      Set-Location $repo; git reset --hard --quiet $before; Set-Location $factory
      npm ci --no-audit --no-fund *>> $log
      return
    }
    Log $log "updated $before -> $((git rev-parse HEAD).Trim())"
  } finally { Pop-Location }
}

while ($true) {
  $log = Join-Path $logs ("factory-" + (Get-Date -Format "yyyy-MM-dd") + ".log")
  Update-Factory $log
  Log $log "starting factory"
  & node --import tsx src/server.ts *>> $log
  Log $log "factory exited with $LASTEXITCODE; restarting in 30s"
  Start-Sleep -Seconds 30
}
