#!/usr/bin/env bash
# One-shot stress runner: boot a throwaway test server, hit it with the load
# harness, tear it down, print a verdict. Self-contained (no background layer).
set -u
cd "$(dirname "$0")/.." || exit 1
ROOT="$(pwd)"
PORT="${STRESS_PORT:-8088}"
PLAYERS="${STRESS_PLAYERS:-400}"
rm -f "$ROOT/server/data/stress-test.db"*

echo "▶ starting throwaway server on :${PORT} (players=${PLAYERS})"
cd "$ROOT/server"
NODE_ENV=test DB_PATH=./data/stress-test.db PORT=$PORT node src/index.js > "$ROOT/server/data/stress-server.log" 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT

# wait for readiness
for i in $(seq 1 30); do
  if curl -sf -m 1 "http://localhost:${PORT}/healthz" >/dev/null 2>&1; then
    echo "  server ready after ${i}s"; break
  fi
  if ! kill -0 $SRV 2>/dev/null; then echo "  ✗ server died early:"; cat "$ROOT/server/data/stress-server.log"; exit 1; fi
  sleep 0.5
done

echo "▶ running stress harness"
cd "$ROOT"
OSCAR_URL="http://localhost:${PORT}" ADMIN_PIN=000000 node stress/load.js --players "$PLAYERS"
RC=$?
echo "▶ stress exit code = $RC"
echo "--- server tail ---"; tail -5 "$ROOT/server/data/stress-server.log"
kill $SRV 2>/dev/null
exit $RC