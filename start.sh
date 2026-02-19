#!/bin/bash
# Data Scout - Start both backend and frontend

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "═══════════════════════════════════════"
echo "  Data Scout"
echo "═══════════════════════════════════════"
echo ""

# Check Python deps
echo "→ Checking Python dependencies..."
pip install -q --break-system-packages -r "$SCRIPT_DIR/backend/requirements.txt" 2>/dev/null

# Check Node deps
echo "→ Checking Node dependencies..."
cd "$SCRIPT_DIR/frontend"
if [ ! -d "node_modules" ]; then
  npm install --silent
fi

# Start backend
echo "→ Starting backend (port 8000)..."
cd "$SCRIPT_DIR/backend"
uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!

# Start frontend
echo "→ Starting frontend (port 3000)..."
cd "$SCRIPT_DIR/frontend"
npm run dev &
FRONTEND_PID=$!

echo ""
echo "═══════════════════════════════════════"
echo "  Open http://localhost:3000"
echo "  API at http://localhost:8000/docs"
echo "═══════════════════════════════════════"
echo ""
echo "Press Ctrl+C to stop both servers."

# Cleanup on exit
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
wait
