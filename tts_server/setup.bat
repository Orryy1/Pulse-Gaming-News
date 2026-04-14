@echo off
REM ============================================================
REM Pulse Gaming local TTS server - one-shot install
REM
REM Requires: Python 3.10 or 3.11 on PATH, NVIDIA driver, ffmpeg
REM Output:   .\venv with VoxCPM 2 + WhisperX ready to serve
REM ============================================================

setlocal enabledelayedexpansion

cd /d "%~dp0"

echo.
echo === [1/6] Checking Python ===
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python not on PATH. Install Python 3.10 or 3.11 first.
    exit /b 1
)
python --version

echo.
echo === [2/6] Creating venv ===
if not exist venv (
    python -m venv venv
    if errorlevel 1 (
        echo ERROR: venv creation failed
        exit /b 1
    )
)
call venv\Scripts\activate.bat

echo.
echo === [3/6] Upgrading pip ===
python -m pip install --upgrade pip wheel setuptools

echo.
echo === [4/6] Installing PyTorch (CUDA 12.1) ===
echo This downloads ~2.5 GB - takes a few minutes.
pip install torch==2.5.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cu121
if errorlevel 1 (
    echo ERROR: PyTorch install failed
    exit /b 1
)

echo.
echo === [5/6] Installing server dependencies ===
pip install -r requirements.txt
if errorlevel 1 (
    echo ERROR: requirements install failed
    exit /b 1
)

echo.
echo === [6/6] Installing VoxCPM 2 from GitHub ===
pip install git+https://github.com/OpenBMB/VoxCPM.git
if errorlevel 1 (
    echo WARNING: VoxCPM install failed - check GitHub repo for current install command
    echo Visit: https://github.com/OpenBMB/VoxCPM
)

echo.
echo === Verifying CUDA availability ===
python -c "import torch; print('CUDA available:', torch.cuda.is_available()); print('Device:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU only')"

echo.
echo === Setup complete ===
echo.
echo Next steps:
echo   1. (Optional) Drop a 6-30s reference voice clip at .\voices\main.wav
echo   2. Edit .env to set REF_VOICE_PATH or VOICE_PROMPT
echo   3. Run start.bat to launch the server on http://127.0.0.1:8765
echo   4. Set TTS_PROVIDER=local in pulse-gaming/.env to route audio.js here
echo.
endlocal
