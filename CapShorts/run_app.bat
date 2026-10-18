@echo off
title Kadr - Desktop AI Video Suite Launcher
cd /d "%~dp0"

echo =======================================================================
echo     Kadr - Standalone Desktop AI Video Suite (Local-First)
echo =======================================================================
echo [*] Starting Local Python AI Media Engine (port 8000)...

cd backend
if exist "venv\Scripts\activate.bat" (
    start "Kadr AI Engine" /min cmd /c "call venv\Scripts\activate.bat && python engine.py"
) else (
    start "Kadr AI Engine" /min cmd /c "python engine.py"
)
cd ..

echo [*] Starting Vite Frontend Studio (port 5173)...
cd frontend
if exist "node_modules" (
    start "Kadr UI" /min cmd /c "npm run dev"
) else (
    echo [*] Installing frontend packages...
    call npm install
    start "Kadr UI" /min cmd /c "npm run dev"
)
cd ..

echo [*] Waiting for services to initialize...
timeout /t 4 >nul

if exist "frontend\node_modules\.bin\electron.cmd" (
    echo [*] Launching Kadr Desktop Application (Electron)...
    call "frontend\node_modules\.bin\electron.cmd" frontend\electron\main.cjs
) else (
    echo [*] Launching Kadr Standalone Desktop Application Window...
    where msedge >nul 2>&1
    if %errorlevel% equ 0 (
        start msedge --app="http://localhost:5173" --window-size=1400,900
    ) else (
        where chrome >nul 2>&1
        if %errorlevel% equ 0 (
            start chrome --app="http://localhost:5173" --window-size=1400,900
        ) else (
            start http://localhost:5173
        )
    )
)

echo =======================================================================
echo   Kadr is now running!
echo   - Frontend: http://localhost:5173
echo   - AI Backend API: http://127.0.0.1:8000
echo   - Close this console when you finish your editing session.
echo =======================================================================
pause
