# Manual prewarm helper for the local inference server.
#
# Purpose:
#   Load the VoxCPM 2 __default__ engine, or a specific voice, before Node
#   jobs start claiming GPU work. This pays the cold-start cost outside the
#   normal inference timeout budget.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\prewarm-infer.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\prewarm-infer.ps1 -VoiceId "TX3LPaxmHKxFdv7VOQHJ"
#
# Exit codes:
#   0  prewarm succeeded
#   1  server unreachable
#   2  HTTP or unexpected error
#   3  timeout before engine loaded

[CmdletBinding()]
param(
    [string]$BaseUrl = "http://127.0.0.1:8765",
    [string]$VoiceId = "__default__",
    [int]$TimeoutSec = 900
)

$ErrorActionPreference = "Stop"
$started = Get-Date

Write-Host "[prewarm] target=$BaseUrl voice_id=$VoiceId timeout=${TimeoutSec}s" -ForegroundColor Cyan

try {
    $health = Invoke-RestMethod -Uri "$BaseUrl/health" -Method GET -TimeoutSec 5
    Write-Host "[prewarm] /health OK: engine_count=$($health.engine_count) voices=$($health.voices.Count)" -ForegroundColor Green
} catch {
    Write-Host "[prewarm] FATAL: /health unreachable at $BaseUrl - is uvicorn running?" -ForegroundColor Red
    Write-Host "[prewarm] error: $_" -ForegroundColor Red
    exit 1
}

$body = @{ voice_id = $VoiceId } | ConvertTo-Json -Compress
try {
    $resp = Invoke-RestMethod `
        -Uri "$BaseUrl/v1/prewarm" `
        -Method POST `
        -ContentType "application/json" `
        -Body $body `
        -TimeoutSec $TimeoutSec
} catch [System.Net.WebException] {
    $elapsed = (Get-Date) - $started
    if ($_.Exception.Status -eq "Timeout") {
        Write-Host "[prewarm] TIMEOUT after $([int]$elapsed.TotalSeconds)s - engine still loading. Raise -TimeoutSec and retry." -ForegroundColor Yellow
        exit 3
    }
    Write-Host "[prewarm] HTTP error after $([int]$elapsed.TotalSeconds)s: $_" -ForegroundColor Red
    exit 2
} catch {
    Write-Host "[prewarm] unexpected error: $_" -ForegroundColor Red
    exit 2
}

$elapsed = (Get-Date) - $started
Write-Host ""
Write-Host "[prewarm] DONE voice_id=$($resp.voice_id) loaded_ms=$($resp.loaded_ms) engine_count=$($resp.engine_count) reused=$($resp.reused)" -ForegroundColor Green
Write-Host "[prewarm] wall_elapsed_s=$([int]$elapsed.TotalSeconds)" -ForegroundColor Green
exit 0
