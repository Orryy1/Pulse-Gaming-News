$ErrorActionPreference = "Continue"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$launcher = Join-Path $RepoRoot "tools/local-live-content-workers.ps1"
while ($true) {
  try {
    & $launcher -RepoRoot $RepoRoot
  } catch {
    # The next supervision cycle retries any lane that did not remain alive.
  }
  Start-Sleep -Seconds 15
}
