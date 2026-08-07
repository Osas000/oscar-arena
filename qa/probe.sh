#!/usr/bin/env bash
# Quick live probe: boot server, exercise host:start + countdown over real sockets.
set -u
cd "$(dirname "$0")/.." || exit 1
ROOT="$(pwd)"
PORT=8091
rm -f "$ROOT/server/data/probe.db"*
cd "$ROOT/server"
NODE_ENV=production DB_PATH=./data/probe.db PORT=$PORT node src/index.js > "$ROOT/server/data/probe.log" 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
for i in $(seq 1 20); do curl -sf -m1 localhost:$PORT/healthz >/dev/null 2>&1 && break; sleep 0.4; done
echo "▶ server up; running probe"
cd "$ROOT"
OSCAR_URL="http://localhost:$PORT" node -e '
const { io } = require("socket.io-client");
const BASE = process.env.OSCAR_URL;
const QUIZ = "probe-quiz";
(async () => {
  const api = async (m,p,b) => (await fetch(BASE+p, {method:m, headers:{"Content-Type":"application/json","x-admin-pin":"000000"}, body:b?JSON.stringify(b):undefined})).json();
  await api("PUT", `/api/quizzes/${QUIZ}`, { id:QUIZ, title:"Probe", questions:[{type:"mc",prompt:"Q?", time_limit:6, points:1000, options:[{text:"A",correct:true},{text:"B",correct:false}]}]});
  const sess = await api("POST", "/api/sessions", { quizId: QUIZ });
  console.log("session pin =", sess.pin, "id =", sess.id);
  const host = io(BASE, { transports:["websocket"], reconnection:false });
  host.on("connect", () => {
    host.emit("host:join", { sessionId:sess.id, adminPin:"000000" }, (h) => {
      console.log("host:join ->", h.ok ? "ok" : h);
      // try starting with NO players -> expect NO_PLAYERS error
      host.emit("host:start", { sessionId:sess.id }, (r) => {
        console.log("host:start (0 players) ->", JSON.stringify(r));
        // now a player joins, then we start for real
        const P = io(BASE, { transports:["websocket"], reconnection:false });
        P.on("connect", () => {
          P.emit("player:join_pin", { pin:sess.pin, nickname:"Zed", resumeToken:null }, (a) => {
            console.log("player join ->", a.ok, a.error||"");
            host.emit("host:start", { sessionId:sess.id }, (r2) => {
              console.log("host:start (1 player) ->", JSON.stringify(r2));
              host.on("countdown", (c) => console.log("  HOST countdown deadline:", c.deadline));
              P.on("countdown", (c) => console.log("  PLAYER countdown deadline:", c.deadline));
              P.on("question", (q) => { console.log("  PLAYER Q opened:", q.prompt); process.kill(); });
              host.on("phase", (p) => console.log("  HOST phase:", p.phase));
            });
          });
        });
      });
    });
  });
  setTimeout(()=>{ console.log("TIMEOUT"); process.kill(); }, 15000);
})();
'
RC=$?
kill $SRV 2>/dev/null
exit $RC