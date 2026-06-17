param(
  [string]$ConfigPath = "D:/pulse-data/cloudflared-pulse.yml",
  [switch]$Foreground
)

$ErrorActionPreference = "Stop"

$configLeaf = [System.IO.Path]::GetFileName($ConfigPath)
$existing = Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -ieq "cloudflared.exe" -and
    $_.CommandLine -like "*$configLeaf*"
  }

if ($existing) {
  exit 0
}

$cloudflared = "C:/Program Files (x86)/cloudflared/cloudflared.exe"
if (-not (Test-Path -LiteralPath $cloudflared)) {
  $cloudflared = "cloudflared"
}

$logPath = "D:/pulse-data/cloudflared-pulse-live.log"
$errPath = "D:/pulse-data/cloudflared-pulse-live.err.log"
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $logPath) | Out-Null

if ($Foreground) {
  & $cloudflared tunnel --config $ConfigPath run *>> $logPath
  exit $LASTEXITCODE
}

$process = Start-Process -FilePath $cloudflared `
  -ArgumentList @("tunnel", "--config", $ConfigPath, "run") `
  -WindowStyle Hidden `
  -RedirectStandardOutput $logPath `
  -RedirectStandardError $errPath `
  -PassThru

Start-Sleep -Seconds 2
if ($process.HasExited) {
  throw "cloudflared exited immediately with code $($process.ExitCode); see $logPath and $errPath"
}

Write-Output ("cloudflared_started pid={0} config={1}" -f $process.Id, $ConfigPath)
