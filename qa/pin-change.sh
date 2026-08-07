#!/usr/bin/env bash
# Admin PIN change QA:
#  1) default/000000 gates the host.
#  2) change to a new PIN (with correct current PIN).
#  3) old PIN is now rejected everywhere, new PIN works.
#  4) new PIN survives a server restart (persisted to DB).
set -u
cd "$(dirname "$0")/.." || exit 1
ROOT="$(pwd)"
PORT=8095
DB="$ROOT/server/data/pinquiz.db"
rm -f "$DB"*
die() { echo "   ❌ $*"; exit 2; }
ok() { echo "   ✅ $*"; }

cd "$ROOT/server"
NODE_ENV=production DB_PATH=./data/pinquiz.db PORT=$PORT node src/index.js > "$ROOT/server/data/pinquiz.log" 2>&1 &
SRV=$!
for i in $(seq 1 25); do curl -sf -m1 localhost:$PORT/healthz >/dev/null 2>&1 && break; sleep 0.4; done

curl -sf -X POST localhost:$PORT/api/quizzes -H 'content-type: application/json' -H 'x-admin-pin: 000000' \
  -d '{"id":"pinquiz","title":"PIN","questions":[{"type":"mc","prompt":"Q","time_limit":5,"points":1000,"options":[{"text":"A","correct":true}]}]}' >/dev/null \
  && ok "1) default PIN 000000 gates the API" || die "default PIN did not work"

# wrong current PIN must be rejected
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST localhost:$PORT/api/admin/pin -H 'content-type: application/json' \
  -d '{"currentPin":"000000","newPin":"987654"}')
[ "$code" = "200" ] || die "change with correct current PIN failed (http $code)"
ok "2) changed PIN 000000 -> 987654"

# old PIN rejected now
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST localhost:$PORT/api/admin/pin -H 'content-type: application/json' \
  -d '{"currentPin":"000000","newPin":"111111"}')
[ "$code" = "401" ] || die "old PIN still worked (expected 401, got $code)"
ok "3) old PIN rejected: current-PIN check enforced"

# old PIN rejected on the API
code=$(curl -s -o /dev/null -w '%{http_code}' localhost:$PORT/api/quizzes -H 'x-admin-pin: 000000')
[ "$code" = "401" ] || die "old PIN accepted on API (expected 401)"
ok "4) hostAuth rejects old PIN"

# new PIN works on the API
code=$(curl -s -o /dev/null -w '%{http_code}' localhost:$PORT/api/quizzes -H 'x-admin-pin: 987654')
[ "$code" = "200" ] || die "new PIN rejected on API"
ok "5) hostAuth accepts new PIN"

kill $SRV 2>/dev/null; wait $SRV 2>/dev/null; sleep 0.5
# restart — PIN must persist
NODE_ENV=production DB_PATH=./data/pinquiz.db PORT=$PORT node src/index.js > "$ROOT/server/data/pinquiz2.log" 2>&1 &
SRV=$!
for i in $(seq 1 25); do curl -sf -m1 localhost:$PORT/healthz >/dev/null 2>&1 && break; sleep 0.4; done
code=$(curl -s -o /dev/null -w '%{http_code}' localhost:$PORT/api/quizzes -H 'x-admin-pin: 987654')
[ "$code" = "200" ] || die "new PIN did not survive restart"
ok "6) new PIN persists across server restart"
kill $SRV 2>/dev/null; wait $SRV 2>/dev/null

rm -f "$DB"*
echo "▶ admin-PIN QA: PASS ✓"