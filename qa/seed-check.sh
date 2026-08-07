#!/usr/bin/env bash
# Verify seed-on-empty: boot throwaway server on :8092, check the quizzes API
# returns the seeded starter quiz, tear down.
set -u
cd "$(dirname "$0")/.." || exit 1
ROOT="$(pwd)"
rm -f "$ROOT/server/data/seedtest.db"*
cd "$ROOT/server"
NODE_ENV=test DB_PATH=./data/seedtest.db PORT=8092 node src/index.js > /tmp/seedtest.log 2>&1 &
SRV=$!
for i in $(seq 1 30); do
  curl -sf -m 1 "http://localhost:8092/healthz" >/dev/null 2>&1 && break
  sleep 0.5
done
echo "--- server log ---"; cat /tmp/seedtest.log
echo "--- quizzes API (host PIN 000000) ---"
curl -s -m 2 -H "x-admin-pin: 000000" "http://localhost:8092/api/quizzes"
echo
kill $SRV 2>/dev/null
rm -f "$ROOT/server/data/seedtest.db"* /tmp/seedtest.log
