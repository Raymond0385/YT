#!/usr/bin/env bash
# setup_backend.sh - Backend Virtual Environment and Dependency Installer for macOS & Linux
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/backend"

echo "========================================================"
echo "  Kadr - Local AI & Media Engine Setup (macOS/Linux)"
echo "========================================================"

# Check for python3 or python
if command -v python3 >/dev/null 2>&1; then
    PYTHON_CMD="python3"
elif command -v python >/dev/null 2>&1; then
    PYTHON_CMD="python"
else
    echo "[!] Python was not found in PATH."
    echo "    Please install Python 3.10+ (e.g., 'brew install python@3.11' on macOS)"
    exit 1
fi

echo "[*] Using Python: $($PYTHON_CMD --version)"

# Create virtual environment if missing
if [ ! -d "venv" ]; then
    echo "[*] Creating Python Virtual Environment (venv)..."
    $PYTHON_CMD -m venv venv
fi

echo "[*] Activating virtual environment..."
source venv/bin/activate

echo "[*] Upgrading pip..."
pip install --upgrade pip

echo "[*] Installing dependencies from requirements.txt..."
pip install -r requirements.txt

echo ""
echo "========================================================"
echo "  Kadr Backend Setup Complete!"
echo "========================================================"
