#!/usr/bin/env bash
# Reconnect QA: player joins, scores a point, "refreshes" (new socket, same
# resumeToken), and must come back as the SAME player with score preserved —
# and joining with a duplicate nickname while the original is "away" must NOT
# raise NAME_TAKEN (it resumes instead).
set -u
cd "$(dirname "$0")/.." || exit 1
ROOT="$(pwd)"
PORT=8092
rm -f "$ROOT/server/data/recon.db"*
cd "$ROOT/server"
NODE_ENV=production DB_PATH=./data/recon.db PORT=$PORT node src/index.js > "$ROOT/server/data/recon.log" 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
for i in $(seq 1 20); do curl -sf -m1 localhost:$PORT/healthz >/dev/null 2>&1 && break; sleep 0.4; done
echo "▶ server up; running reconnect probe"
cd "$ROOT"
OSCAR_URL="http://localhost:$PORT" node -e '
const { io } = require("socket.io-client");
const BASE = process.env.OSCAR_URL;
const QUIZ = "recon-quiz";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (m,p,b) => (await fetch(BASE+p, {method:m, headers:{"Content-Type":"application/json","x-admin-pin":"000000"}, body:b?JSON.stringify(b):undefined})).json();
(async () => {
  await api("PUT", `/api/quizzes/${QUIZ}`, { id:QUIZ, title:"Recon", questions:[{type:"mc",prompt:"Q1?", time_limit:6, points:1000, options:[{text:"A",correct:true},{text:"B",correct:false}]}]});
  const sess = await api("POST", "/api/sessions", { quizId: QUIZ });
  const host = io(BASE, { transports:["websocket"], reconnection:false });
  let token = null, pid = null, phase = "lobby";

  const joinPlayer = (nickname, resumeToken) => new Promise((resolve, reject) => {
    const p = io(BASE, { transports:["websocket"], reconnection:false });
    p.on("connect", () => {
      p.emit("player:join_pin", { pin:sess.pin, nickname, resumeToken }, (a) => {
        if (!a.ok) return reject(new Error("join: " + a.error));
        resolve({ socket: p, ack: a });
      });
    });
    p.on("connect_error", (e) => reject(e));
  });

  host.on("connect", () => {
    host.emit("host:join", { sessionId:sess.id, adminPin:"000000" }, async (h) => {
      if (!h.ok) throw new Error("host join " + h.error);
      console.log("1) host up");
      // Player joins, then host starts game
      const p1 = await joinPlayer("RangerOne", null);
      token = p1.ack.resumeToken; pid = p1.ack.playerId;
      console.log("2) first join -> id", pid.slice(0,6), "token", token.slice(0,6));
      host.emit("host:start", { sessionId:sess.id }, (r) => console.log("3) host:start ->", r.ok ? "ok" : JSON.stringify(r)));
      // Wait for question, answer correctly
      await new Promise((res) => { p1.socket.on("question", () => { p1.socket.emit("player:answer", { sessionId:sess.id, playerId: pid, choice:0 }, (r)=>console.log("4) answered ->", r.ok, r.points)); res(); }); });
      await sleep(600);
      // ---- SIMULATE PAGE REFRESH: disconnect, reopen with SAME token ----
      p1.socket.disconnect();
      console.log("5) player page refreshed (socket closed)");
      await sleep(300);
      const p2 = await joinPlayer("RangerOne", token);   // same nickname + token
      console.log("6) refresh-rejoin -> same id?", p2.ack.playerId === pid ? "YES ✓" : "NO ✗ ("+p2.ack.playerId+")", "| nickname:", p2.ack.nickname);
      if (p2.ack.playerId !== pid) { console.log("  RESUME FAILED: got a new player"); process.exit(1); }
      console.log("7) resumed snapshot total =", p2.ack.state.total, "(expect 1000)");
      if (p2.ack.state.total !== 1000) { console.log("  SCORE LOST ✗"); process.exit(1); }
      console.log("8) reconnect probe: PASS ✓");
      process.exit(0);
    });
  });
  setTimeout(()=>{ console.log("TIMEOUT"); process.exit(1); }, 20000);
})();
'
RC=$?
kill $SRV 2>/dev/null
exit $RC