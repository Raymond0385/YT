@echo off
title Kadr - Backend AI Setup
cd /d "%~dp0backend"

echo ========================================================
echo   Kadr - Local AI & Media Engine Setup
echo ========================================================

python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Python was not found in PATH.
    echo     Please install Python 3.10+ from https://python.org or run 'winget install Python.Python.3.11'
    pause
    exit /b 1
)

echo [*] Creating Python Virtual Environment (venv)...
python -m venv venv
if %errorlevel% neq 0 (
    echo [!] Failed to create venv.
    pause
    exit /b 1
)

echo [*] Activating virtual environment...
call venv\Scripts\activate.bat

echo [*] Upgrading pip...
python -m pip install --upgrade pip

echo [*] Installing dependencies from requirements.txt...
echo     - faster-whisper (CTranslate2 inference)
echo     - fastapi and uvicorn
echo     - requests, pydantic, aiofiles
pip install -r requirements.txt

echo.
echo ========================================================
echo   Kadr Backend Setup Complete!
echo ========================================================
pause
