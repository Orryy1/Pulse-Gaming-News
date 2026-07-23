param(
  [string]$WorkspaceRoot = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($WorkspaceRoot)) {
  $WorkspaceRoot = [System.IO.Path]::GetFullPath(
    (Join-Path $PSScriptRoot "..\..")
  )
}

$nodePath = (Get-Command node -ErrorAction Stop).Source
$toolPath = Join-Path $WorkspaceRoot "tools\oauth-uptime-maintenance.js"
$outputDirectory = Join-Path $WorkspaceRoot "output\oauth-uptime"
$stdoutPath = Join-Path $outputDirectory "sidecar.stdout.log"
$stderrPath = Join-Path $outputDirectory "sidecar.stderr.log"

New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

$process = Start-Process `
  -FilePath $nodePath `
  -ArgumentList @($toolPath, "--refresh") `
  -WorkingDirectory $WorkspaceRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutPath `
  -RedirectStandardError $stderrPath `
  -Wait `
  -PassThru

exit $process.ExitCode
