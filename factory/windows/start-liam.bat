@echo off
REM Starts the Codex "Liam" voice server (tts_server\, VoxCPM 2 + WhisperX alignment)
REM on the port the factory asks for: first argument, default 8766.
REM Port 8765 on this PC belongs to the old governed PulseGaming-VoxCPM service,
REM which answers /health but does not serve the /with-timestamps endpoint the
REM factory uses, so the factory runs its own copy on another port.
REM PULSE_TTS_DIR (from factory\.env) says where tts_server\ lives.
setlocal
set "TTS_DIR=%PULSE_TTS_DIR%"
if "%TTS_DIR%"=="" set "TTS_DIR=%USERPROFILE%\gaming-studio\pulse-gaming\tts_server"
set "PORT=%~1"
if "%PORT%"=="" set "PORT=8766"
cd /d "%TTS_DIR%" || exit /b 1
if not exist venv\Scripts\activate.bat (
    echo ERROR: venv not found in %TTS_DIR%. Run setup.bat there first.
    exit /b 1
)
call venv\Scripts\activate.bat
if not exist logs mkdir logs
python -m uvicorn server:app --host 127.0.0.1 --port %PORT% --log-level info >> "logs\server_%PORT%.log" 2>&1
