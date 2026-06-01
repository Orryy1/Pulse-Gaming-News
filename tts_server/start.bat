@echo off
setlocal
REM Launch the local TTS server without leaving a visible Python console open.

cd /d "%~dp0"

if not exist "venv\Scripts\python.exe" (
    echo ERROR: venv not found. Run setup.bat first.
    exit /b 1
)

set "TTS_HOST=127.0.0.1"
set "TTS_PORT=8765"
set "TTS_HEALTH_URL=http://127.0.0.1:8765/health"
set "TTS_ROOT=%~dp0"
set "TTS_LOG_DIR=%~dp0logs"
set "TTS_STDOUT=%TTS_LOG_DIR%\server_stdout.log"
set "TTS_STDERR=%TTS_LOG_DIR%\server_stderr.log"
set "TTS_START_LOCK=%TTS_LOG_DIR%\server_start.lock"
set "TTS_START_LOCK_TTL_MINUTES=30"

if not exist "%TTS_LOG_DIR%" mkdir "%TTS_LOG_DIR%"

powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri '%TTS_HEALTH_URL%' -TimeoutSec 2; if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { exit 0 } exit 1 } catch { exit 1 }"
if "%ERRORLEVEL%"=="0" (
    echo Local TTS server already running at %TTS_HEALTH_URL%.
    exit /b 0
)

powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "if (Test-Path $env:TTS_START_LOCK) { $age = (Get-Date) - (Get-Item $env:TTS_START_LOCK).LastWriteTime; if ($age.TotalMinutes -lt [double]$env:TTS_START_LOCK_TTL_MINUTES) { exit 0 } } exit 1"
if "%ERRORLEVEL%"=="0" (
    echo Local TTS server start already in progress. Check %TTS_STDOUT% and %TTS_STDERR%.
    exit /b 0
)

powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$cooldown = [double]$env:TTS_START_LOCK_TTL_MINUTES; if (Test-Path $env:TTS_STDERR) { $last = Select-String -LiteralPath $env:TTS_STDERR -SimpleMatch '[boot] pulse-gaming tts_server starting' | Select-Object -Last 1; if ($last -and $last.Line -match 'ts=([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.+-]+Z)') { $dt = [DateTimeOffset]::Parse($matches[1]).UtcDateTime; $age = (Get-Date).ToUniversalTime() - $dt; if ($age.TotalMinutes -lt $cooldown) { exit 0 } } } exit 1"
if "%ERRORLEVEL%"=="0" (
    echo Local TTS server was already started recently. Waiting for boot to finish before retrying.
    exit /b 0
)

powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$payload = @{ started_at = (Get-Date).ToUniversalTime().ToString('o'); pid = $null; launcher = 'start.bat' } | ConvertTo-Json -Compress; Set-Content -LiteralPath '%TTS_START_LOCK%' -Value $payload -Encoding ASCII"
if errorlevel 1 (
    echo ERROR: failed to write local TTS start lock.
    exit /b 1
)

set "TTS_PYTHON=%~dp0venv\Scripts\pythonw.exe"
set "TTS_ALLOW_CONSOLE="
if /I "%LOCAL_TTS_ALLOW_CONSOLE%"=="1" set "TTS_ALLOW_CONSOLE=1"
if /I "%LOCAL_TTS_ALLOW_CONSOLE%"=="true" set "TTS_ALLOW_CONSOLE=1"
if /I "%LOCAL_TTS_ALLOW_CONSOLE%"=="yes" set "TTS_ALLOW_CONSOLE=1"
if /I "%LOCAL_TTS_ALLOW_CONSOLE%"=="on" set "TTS_ALLOW_CONSOLE=1"
if not exist "%TTS_PYTHON%" (
    if defined TTS_ALLOW_CONSOLE (
        set "TTS_PYTHON=%~dp0venv\Scripts\python.exe"
    ) else (
        del "%TTS_START_LOCK%" >nul 2>nul
        echo ERROR: pythonw.exe not found. Refusing to open a visible local TTS console. Set LOCAL_TTS_ALLOW_CONSOLE=1 only for manual debugging.
        exit /b 1
    )
)

powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$argsList = @('-m','uvicorn','server:app','--host',$env:TTS_HOST,'--port',$env:TTS_PORT,'--log-level','info'); Start-Process -FilePath $env:TTS_PYTHON -ArgumentList $argsList -WorkingDirectory $env:TTS_ROOT -WindowStyle Hidden -RedirectStandardOutput $env:TTS_STDOUT -RedirectStandardError $env:TTS_STDERR"
if errorlevel 1 (
    del "%TTS_START_LOCK%" >nul 2>nul
    echo ERROR: failed to start local TTS server.
    exit /b 1
)

echo Local TTS server start requested at %TTS_HEALTH_URL%.
echo Logs: %TTS_STDOUT% and %TTS_STDERR%
exit /b 0
