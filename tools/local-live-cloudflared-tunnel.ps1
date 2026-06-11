param(
  [string]$ConfigPath = "D:/pulse-data/cloudflared-pulse.yml"
)

$ErrorActionPreference = "Stop"

$existing = Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -ieq "cloudflared.exe" -and
    $_.CommandLine -like "*cloudflared-pulse.yml*"
  }

if ($existing) {
  exit 0
}

$cloudflared = "C:/Program Files (x86)/cloudflared/cloudflared.exe"
if (-not (Test-Path -LiteralPath $cloudflared)) {
  $cloudflared = "cloudflared"
}

& $cloudflared tunnel --config $ConfigPath run
