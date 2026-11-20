#!/bin/bash
set -e

# Render assigns external web traffic to $PORT
PORT="${PORT:-10000}"

# Ensure Python backend uses a separate internal port that NEVER collides with public $PORT
if [ "$PORT" = "8000" ]; then
  BACKEND_PORT="8001"
elif [ "$PORT" = "8001" ]; then
  BACKEND_PORT="8002"
else
  BACKEND_PORT="${BACKEND_PORT:-8001}"
fi

export BACKEND_PORT
export BACKEND_API_URL="http://127.0.0.1:${BACKEND_PORT}"

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
