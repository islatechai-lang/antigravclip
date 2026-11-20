#!/bin/bash
set -e

PORT="${PORT:-10000}"
BACKEND_PORT="${BACKEND_PORT:-8000}"

echo "🚀 [Render Cloud] Launching AntigravClip Autonomous Platform..."
echo "⚙️ [Engine] Starting Python FastAPI Clipper on internal port ${BACKEND_PORT}..."
python backend_server.py --port ${BACKEND_PORT} &
BACKEND_PID=$!

echo "🌐 [Dashboard] Starting Next.js Studio on public port ${PORT}..."
npx next start -p ${PORT} &
FRONTEND_PID=$!

trap "kill -TERM $BACKEND_PID $FRONTEND_PID 2>/dev/null" SIGTERM SIGINT

wait -n
exit $?
