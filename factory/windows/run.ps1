# Keeps the factory running: restarts it if it ever exits. Started hidden at
# log-on by the "Pulse Factory" scheduled task.
$ErrorActionPreference = "Continue"
$factory = Split-Path -Parent $PSScriptRoot
Set-Location $factory
$logs = Join-Path $factory "data\logs"
New-Item -ItemType Directory -Force -Path $logs | Out-Null
while ($true) {
  $log = Join-Path $logs ("factory-" + (Get-Date -Format "yyyy-MM-dd") + ".log")
  "[$(Get-Date -Format o)] starting factory" | Out-File -Append -Encoding utf8 $log
  & node --import tsx src/server.ts *>> $log
  "[$(Get-Date -Format o)] factory exited with $LASTEXITCODE; restarting in 30s" | Out-File -Append -Encoding utf8 $log
  Start-Sleep -Seconds 30
}
