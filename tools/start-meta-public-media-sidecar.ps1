param(
  [Parameter(Mandatory = $true)][string]$StoryId,
  [Parameter(Mandatory = $true)][string]$VideoPath,
  [Parameter(Mandatory = $true)][string]$Sha256,
  [int]$Port = 3002,
  [string]$RepoRoot = ""
)

$ErrorActionPreference = "Stop"

if (-not $RepoRoot) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
} else {
  $RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
}
$VideoPath = (Resolve-Path -LiteralPath $VideoPath).Path
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
  throw "Meta media sidecar port $Port is already in use."
}

$runtimeDir = Join-Path $RepoRoot "output/runtime"
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
$sidecarStdout = Join-Path $runtimeDir "meta-media-sidecar.stdout.log"
$sidecarStderr = Join-Path $runtimeDir "meta-media-sidecar.stderr.log"
$tunnelStdout = Join-Path $runtimeDir "meta-media-tunnel.stdout.log"
$tunnelStderr = Join-Path $runtimeDir "meta-media-tunnel.stderr.log"
$tunnelConfig = Join-Path $runtimeDir "meta-media-quick-tunnel.yml"
$statePath = Join-Path $runtimeDir "meta-media-sidecar-state.json"
Remove-Item -LiteralPath $sidecarStdout, $sidecarStderr, $tunnelStdout, $tunnelStderr -Force -ErrorAction SilentlyContinue
@(
  "protocol: http2"
  "no-autoupdate: true"
) | Set-Content -LiteralPath $tunnelConfig -Encoding ASCII

$node = (Get-Command node.exe -ErrorAction Stop).Source
$sidecar = Start-Process -FilePath $node `
  -ArgumentList @(
    "tools/meta-public-media-sidecar.js",
    "--story-id", $StoryId,
    "--video", $VideoPath,
    "--sha256", $Sha256,
    "--port", [string]$Port
  ) `
  -WorkingDirectory $RepoRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $sidecarStdout `
  -RedirectStandardError $sidecarStderr `
  -PassThru

$sidecarDeadline = (Get-Date).AddSeconds(20)
$sidecarHealth = $null
do {
  Start-Sleep -Milliseconds 500
  try {
    $sidecarHealth = Invoke-RestMethod `
      -UseBasicParsing `
      -Uri ("http://127.0.0.1:{0}/health" -f $Port) `
      -TimeoutSec 2
  } catch {
    $sidecarHealth = $null
  }
} while (
  (Get-Date) -lt $sidecarDeadline -and
  (-not $sidecarHealth -or $sidecarHealth.status -ne "ok")
)
if (-not $sidecarHealth -or $sidecarHealth.status -ne "ok") {
  Stop-Process -Id $sidecar.Id -Force -ErrorAction SilentlyContinue
  $details = Get-Content -LiteralPath $sidecarStderr -Raw -ErrorAction SilentlyContinue
  throw "Meta media sidecar failed to become healthy. $details"
}

$cloudflared = "C:/Program Files (x86)/cloudflared/cloudflared.exe"
if (-not (Test-Path -LiteralPath $cloudflared -PathType Leaf)) {
  $cloudflared = (Get-Command cloudflared.exe -ErrorAction Stop).Source
}
$tunnel = Start-Process -FilePath $cloudflared `
  -ArgumentList @(
    "tunnel",
    "--config", $tunnelConfig,
    "--url", ("http://127.0.0.1:{0}" -f $Port),
    "--no-autoupdate"
  ) `
  -WorkingDirectory $RepoRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $tunnelStdout `
  -RedirectStandardError $tunnelStderr `
  -PassThru

$publicUrl = $null
$tunnelDeadline = (Get-Date).AddSeconds(45)
do {
  Start-Sleep -Seconds 1
  $tunnelText = (
    (Get-Content -LiteralPath $tunnelStdout -Raw -ErrorAction SilentlyContinue) +
    "`n" +
    (Get-Content -LiteralPath $tunnelStderr -Raw -ErrorAction SilentlyContinue)
  )
  if ($tunnelText -match "https://[a-z0-9-]+\.trycloudflare\.com") {
    $publicUrl = [string]$Matches[0]
    break
  }
  $tunnel.Refresh()
  if ($tunnel.HasExited) { break }
} while ((Get-Date) -lt $tunnelDeadline)

if (-not $publicUrl) {
  Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue
  Stop-Process -Id $sidecar.Id -Force -ErrorAction SilentlyContinue
  throw "Meta media quick tunnel failed to start. $tunnelText"
}

$state = [ordered]@{
  schema_version = 1
  sidecar_pid = $sidecar.Id
  tunnel_pid = $tunnel.Id
  port = $Port
  public_url = $publicUrl
  story_id = $StoryId
  sha256 = $Sha256
  started_at_utc = [DateTimeOffset]::UtcNow.ToString("o")
}
$state | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
$state | ConvertTo-Json -Compress
