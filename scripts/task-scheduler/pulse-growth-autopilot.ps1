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
$toolPath = Join-Path $WorkspaceRoot "tools\growth-autopilot.js"
$outDir = Join-Path $WorkspaceRoot "output\growth-autopilot"
$stdoutPath = Join-Path $outDir "scheduled-stdout.log"
$stderrPath = Join-Path $outDir "scheduled-stderr.log"

New-Item -ItemType Directory -Path $outDir -Force | Out-Null

$process = Start-Process `
  -FilePath $nodePath `
  -ArgumentList @($toolPath) `
  -WorkingDirectory $WorkspaceRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutPath `
  -RedirectStandardError $stderrPath `
  -Wait `
  -PassThru

exit $process.ExitCode
