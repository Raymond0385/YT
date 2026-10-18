#!/usr/bin/env bash
# run_app.sh - Kadr Standalone Desktop AI Video Suite Launcher (macOS & Linux)
set -e

export PATH="$HOME/.bun/bin:/usr/local/bin:$PATH"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "======================================================================="
echo "    Kadr - Standalone Desktop AI Video Studio (Local-First)"
echo "======================================================================="

SPAWNED_BACKEND=0
SPAWNED_FRONTEND=0

# Clean shutdown function
cleanup() {
    echo ""
    echo "[*] Cleaning up Kadr processes..."
    if [ "$SPAWNED_BACKEND" -eq 1 ] && [ -n "$BACKEND_PID" ]; then
        echo "[*] Stopping AI backend daemon (PID $BACKEND_PID)..."
        kill "$BACKEND_PID" 2>/dev/null || true
    fi
    if [ "$SPAWNED_FRONTEND" -eq 1 ] && [ -n "$FRONTEND_PID" ]; then
        echo "[*] Stopping Frontend dev server (PID $FRONTEND_PID)..."
        kill "$FRONTEND_PID" 2>/dev/null || true
    fi
    exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# 1. Ensure Python AI Backend is running on port 8000
echo "[*] Checking Python AI Media Engine (port 8000)..."
if curl -s -f http://127.0.0.1:8000/api/health >/dev/null 2>&1; then
    echo "[✓] Python AI Media Engine is already running and healthy."
else
    echo "[*] Starting Local Python AI Media Engine..."
    cd "$SCRIPT_DIR/backend"
    if [ -f "venv/bin/activate" ]; then
        source venv/bin/activate
    fi
    if command -v python3 >/dev/null 2>&1; then
        PYTHON_BIN="python3"
    else
        PYTHON_BIN="python"
    fi
    $PYTHON_BIN engine.py >/dev/null 2>&1 &
    BACKEND_PID=$!
    SPAWNED_BACKEND=1
    cd "$SCRIPT_DIR"
fi

# 2. Ensure Vite Frontend Studio is running on port 5173
echo "[*] Checking Vite Studio Frontend (port 5173)..."
if curl -s -f http://localhost:5173 >/dev/null 2>&1; then
    echo "[✓] Frontend Studio is already running."
else
    echo "[*] Starting Vite Studio Frontend..."
    cd "$SCRIPT_DIR/frontend"
    if command -v bun >/dev/null 2>&1; then
        bun run dev >/dev/null 2>&1 &
        FRONTEND_PID=$!
        SPAWNED_FRONTEND=1
    elif command -v npm >/dev/null 2>&1; then
        npm run dev >/dev/null 2>&1 &
        FRONTEND_PID=$!
        SPAWNED_FRONTEND=1
    elif command -v pnpm >/dev/null 2>&1; then
        pnpm run dev >/dev/null 2>&1 &
        FRONTEND_PID=$!
        SPAWNED_FRONTEND=1
    else
        echo "[!] Node package manager not found. Please install Node.js."
    fi
    cd "$SCRIPT_DIR"
fi

# Wait for frontend and backend to be fully responsive
echo "[*] Waiting for services to be ready..."
for i in {1..20}; do
    if curl -s -f http://localhost:5173 >/dev/null 2>&1 && curl -s -f http://127.0.0.1:8000/api/health >/dev/null 2>&1; then
        break
    fi
    sleep 0.5
done

echo "[✓] Services online:"
echo "    - AI Backend: http://127.0.0.1:8000"
echo "    - Frontend:   http://localhost:5173"

# 3. Launch as Native Desktop Application Window
ELECTRON_EXE="$SCRIPT_DIR/frontend/node_modules/.bin/electron"

if [ -f "$ELECTRON_EXE" ] && [ -x "$ELECTRON_EXE" ]; then
    echo "[*] Launching Kadr Desktop Application (Electron)..."
    "$ELECTRON_EXE" "$SCRIPT_DIR/frontend/electron/main.cjs"
elif command -v electron >/dev/null 2>&1; then
    echo "[*] Launching Kadr Desktop Application (Electron)..."
    electron "$SCRIPT_DIR/frontend/electron/main.cjs"
else
    # Launch in Standalone App Window Mode (Frameless, no browser tabs or address bar)
    echo "[*] Launching Kadr Standalone Desktop App Window..."
    
    STANDALONE_LAUNCHED=0
    APP_PROFILE="/tmp/kadr_desktop_profile"
    mkdir -p "$APP_PROFILE"

    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS Application Window Mode
        if [ -d "/Applications/Google Chrome.app" ]; then
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
                --app="http://localhost:5173" \
                --window-size=1400,900 \
                --user-data-dir="$APP_PROFILE" &
            STANDALONE_LAUNCHED=1
        elif [ -d "/Applications/Microsoft Edge.app" ]; then
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
                --app="http://localhost:5173" \
                --window-size=1400,900 \
                --user-data-dir="$APP_PROFILE" &
            STANDALONE_LAUNCHED=1
        elif [ -d "/Applications/Brave Browser.app" ]; then
            "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" \
                --app="http://localhost:5173" \
                --window-size=1400,900 \
                --user-data-dir="$APP_PROFILE" &
            STANDALONE_LAUNCHED=1
        fi
    else
        # Linux Application Window Mode
        for browser in google-chrome google-chrome-stable chromium chromium-browser microsoft-edge-stable brave-browser; do
            if command -v "$browser" >/dev/null 2>&1; then
                "$browser" --app="http://localhost:5173" --window-size=1400,900 --user-data-dir="$APP_PROFILE" &
                STANDALONE_LAUNCHED=1
                break
            fi
        done
    fi

    # Fallback to system default if no Chromium engine found
    if [ "$STANDALONE_LAUNCHED" -eq 0 ]; then
        if command -v open >/dev/null 2>&1; then
            open "http://localhost:5173"
        elif command -v xdg-open >/dev/null 2>&1; then
            xdg-open "http://localhost:5173"
        fi
    fi

    echo "======================================================================="
    echo "  Kadr Studio is running in Standalone Desktop Window mode!"
    echo "  Press Ctrl+C in this terminal to quit."
    echo "======================================================================="
    wait
fi
