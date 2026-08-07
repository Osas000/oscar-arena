#!/usr/bin/env bash
# QA gate: boot a throwaway PRODUCTION server (serves the built PWA client +
# Socket.IO on one process), run the full E2E game-cycle smoke against it,
# verify the PWA manifest + healthz, tear down. One self-contained call.
set -u
cd "$(dirname "$0")/.." || exit 1
ROOT="$(pwd)"
PORT="${QA_PORT:-8087}"
rm -f "$ROOT/server/data/qa-smoke.db"*

echo "▶ starting production server on :${PORT}"
cd "$ROOT/server"
NODE_ENV=production DB_PATH=./data/qa-smoke.db PORT=$PORT node src/index.js > "$ROOT/server/data/qa-server.log" 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT

for i in $(seq 1 30); do
  if curl -sf -m 1 "http://localhost:${PORT}/healthz" >/dev/null 2>&1; then echo "  ready (${i}s)"; break; fi
  sleep 0.5
done

echo "▶ manifest served?"
curl -sf -m 3 "http://localhost:${PORT}/manifest.webmanifest" | head -c 200; echo ""
echo "▶ service worker served?"
curl -sf -m 3 -o /dev/null -w "  sw.js HTTP %{http_code}, %{size_download} bytes\n" "http://localhost:${PORT}/sw.js"
echo "▶ icon served?"
curl -sf -m 3 -o /dev/null -w "  icon-192 HTTP %{http_code}, %{size_download} bytes\n" "http://localhost:${PORT}/icons/icon-192.png"

echo "▶ full E2E game cycle (join/answer/reveal/scoreboard/podium)"
cd "$ROOT"
OSCAR_URL="http://localhost:${PORT}" node server/test/e2e-smoke.js 2>&1
RC=$?
echo "▶ E2E exit = $RC"
kill $SRV 2>/dev/null
exit $RC