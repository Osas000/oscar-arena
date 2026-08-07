#!/usr/bin/env bash
# Detach a persistent local Oscar Arena server so it survives the calling shell
# (the Hermes background harness kills long-lived children on this host).
# Usage: bash scripts/serve-local.sh   -> starts on :8080, prints PID & URL.
set -u
cd "$(dirname "$0")/.." || exit 1
ROOT="$(pwd)"
PORT="${PORT:-8080}"
DB="$ROOT/server/data/arena-local.db"
LOG="$ROOT/server/data/arena-local.log"
mkdir -p "$(dirname "$DB")"

# Kill any straggler on our port first.
netstat -ano 2>/dev/null | grep ":${PORT}" | grep LISTEN | awk '{print $5}' | sort -u | while read p; do
  taskkill //PID "$p" //F >/dev/null 2>&1
done

# nohup detaches; disown + </dev/null keep it alive after this shell exits.
cd "$ROOT"
NODE_ENV=production DB_PATH="$DB" PORT=$PORT nohup node server/src/index.js > "$LOG" 2>&1 &
PID=$!
disown
echo "started oscar-arena on http://localhost:${PORT}  (pid ${PID})"
echo "log: $LOG"
for i in $(seq 1 20); do
  if curl -sf -m1 "http://localhost:${PORT}/healthz" >/dev/null 2>&1; then
    echo "READY after ${i}s"; echo "healthz: $(curl -sf -m1 http://localhost:${PORT}/healthz)"; exit 0
  fi
  sleep 0.5
done
echo "NOT ready — log tail:"; tail -5 "$LOG"; exit 1