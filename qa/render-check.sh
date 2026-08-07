#!/usr/bin/env bash
# Verify Render-mode startup: RENDER=true forces a tmp DB; confirm boot + seed.
set -u
cd "$(dirname "$0")/.." || exit 1
ROOT="$(pwd)"
cd "$ROOT/server"
RENDER=true DB_PATH=/tmp/oscar-render-test.db PORT=8093 node src/index.js > /tmp/render-test.log 2>&1 &
SRV=$!
for i in $(seq 1 30); do
  curl -sf -m 1 "http://localhost:8093/healthz" >/dev/null 2>&1 && break
  sleep 0.5
done
echo "--- log ---"; cat /tmp/render-test.log
echo "--- quizzes (PIN 000000) ---"
curl -s -m 2 -H "x-admin-pin: 000000" "http://localhost:8093/api/quizzes" | head -c 300
echo
kill $SRV 2>/dev/null
rm -f /tmp/oscar-render-test.db* /tmp/render-test.log