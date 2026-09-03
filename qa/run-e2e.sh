#!/usr/bin/env bash
# Windows/git-bash gate wrapper: boot the real server, health-wait, run the
# E2E smoke, tear the server down. (The agent bg-process tool kills long-lived
# node processes on this host — this run-and-teardown shape is the sanctioned
# alternative, see realtime-live-quiz-platform skill.)
set -u
cd "$(dirname "$0")/.." || exit 1
DB_PATH='C:/Users/LENOVO/AppData/Local/Temp/oscar-e2e5.db'
PORT=8080
LOG=/tmp/e2e-srv.log
rm -f "$DB_PATH" "$LOG"
NODE_ENV=production PORT=$PORT DB_PATH="$DB_PATH" node server/src/index.js > "$LOG" 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null; rm -f "$DB_PATH"' EXIT
for i in $(seq 1 30); do
  curl -s -m 2 "http://localhost:$PORT/healthz" > /dev/null && break
  kill -0 $SRV 2>/dev/null || { echo 'SERVER DIED'; tail -8 "$LOG"; exit 1; }
  sleep 0.5
done
echo "=== server up (pid $SRV), running E2E smoke ==="
node server/test/e2e-smoke.js
RC=$?
echo "E2E exit: $RC"
exit $RC