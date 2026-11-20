# Registers a hidden "Pulse Tunnel" start-up task that keeps the Cloudflare
# tunnel pulse.orryy.com -> http://localhost:8080 running, so the Discord
# Approve / Reject links work from a phone. Safe to re-run.
#
# Needs: cloudflared installed, the tunnel credentials in %USERPROFILE%\.cloudflared,
# and a config file (default D:\pulse-data\cloudflared-pulse.yml) whose ingress
# points at http://localhost:8080. PUBLIC_URL in factory\.env must match the hostname.
param(
  [string]$Config = "D:\pulse-data\cloudflared-pulse.yml",
  [string]$Cloudflared = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
)
$ErrorActionPreference = "Stop"
if (-not (Test-Path $Cloudflared)) { throw "cloudflared not found at $Cloudflared" }
if (-not (Test-Path $Config)) { throw "tunnel config not found at $Config" }
if (-not ((Get-Content $Config) -match 'localhost:8080')) { throw "$Config does not point at localhost:8080" }

$action = New-ScheduledTaskAction -Execute $Cloudflared -Argument "tunnel --config `"$Config`" --no-autoupdate run" -WorkingDirectory (Split-Path -Parent $Config)
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -Hidden
Stop-ScheduledTask -TaskName "Pulse Tunnel" -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName "Pulse Tunnel" -Action $action -Trigger $trigger -Settings $settings `
  -Description "Cloudflare tunnel for the Pulse Factory dashboard and approval links" -Force | Out-Null
Start-ScheduledTask -TaskName "Pulse Tunnel"
Start-Sleep -Seconds 8
Write-Host "Pulse Tunnel task: $((Get-ScheduledTask -TaskName 'Pulse Tunnel').State)"
try { $r = Invoke-WebRequest -Uri "https://pulse.orryy.com/health" -UseBasicParsing -TimeoutSec 15; Write-Host "pulse.orryy.com/health -> $($r.StatusCode) $($r.Content)" -ForegroundColor Green }
catch { Write-Host "pulse.orryy.com not reachable yet: $($_.Exception.Message)" -ForegroundColor Yellow }
