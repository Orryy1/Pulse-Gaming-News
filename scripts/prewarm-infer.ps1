# Manual prewarm helper for the local inference server.
#
# Purpose:
#   Load the VoxCPM 2 __default__ engine (or a specific voice) BEFORE the
#   Node jobs-runner starts claiming GPU jobs. Pays the cold-start cost
#   (2-5 min on a Windows box with cached HF weights, up to 10 min on a
#   cold cache) outside the INFER_TIMEOUT_MS budget so real jobs never
#   trip the abort.
#
# Usage:
#   # Default engine:
#   pwsh scripts/prewarm-infer.ps1
#
#   # Specific voice id (must exist in voices.json or fall back to default):
#   pwsh scripts/prewarm-infer.ps1 -VoiceId "TX3LPaxmHKxFdv7VOQHJ"
#
#   # Non-default host:
#   pwsh scripts/prewarm-infer.ps1 -BaseUrl "http://127.0.0.1:8765"
#
# Expected behaviour:
#   - First call blocks for 2-5 min while weights + AudioVAE + denoiser
#     load. Returns 200 with { voice_id, loaded_ms, engine_count, reused: false }.
#   - Subsequent calls return instantly with reused: true.
#
# Exit codes:
#   0  prewarm succeeded (engine resident when script exits)
#   1  server unreachable (uvicorn not running, wrong port, firewall)
#   2  HTTP error from /v1/prewarm (see body for details)
#   3  timeout before engine loaded (raise -TimeoutSec and retry)

[CmdletBinding()]
param(
    [string]$BaseUrl = "http://127.0.0.1:8765",
    [string]$VoiceId = "__default__",
    [int]$TimeoutSec = 900
)

$ErrorActionPreference = "Stop"
$started = Get-Date

Write-Host "[prewarm] target=$BaseUrl voice_id=$VoiceId timeout=${TimeoutSec}s" -ForegroundColor Cyan

# Health probe first — fail fast if the server isn't up.
try {
    $health = Invoke-RestMethod -Uri "$BaseUrl/health" -Method GET -TimeoutSec 5
    Write-Host "[prewarm] /health OK: engine_count=$($health.engine_count) voices=$($health.voices.Count)" -ForegroundColor Green
} catch {
    Write-Host "[prewarm] FATAL: /health unreachable at $BaseUrl — is uvicorn running?" -ForegroundColor Red
    Write-Host "[prewarm] error: $_" -ForegroundColor Red
    exit 1
}

# Prewarm call — this is the blocking one.
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
        Write-Host "[prewarm] TIMEOUT after $([int]$elapsed.TotalSeconds)s — engine still loading. Raise -TimeoutSec and retry." -ForegroundColor Yellow
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
