@echo off
REM Launch the local TTS server. Run setup.bat first.

cd /d "%~dp0"

if not exist venv\Scripts\activate.bat (
    echo ERROR: venv not found. Run setup.bat first.
    exit /b 1
)

call venv\Scripts\activate.bat

REM Use uvicorn with auto-reload OFF for production
python -m uvicorn server:app --host 127.0.0.1 --port 8765 --log-level info
