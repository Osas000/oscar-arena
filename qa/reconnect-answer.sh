#!/usr/bin/env bash
# reconnect-answer QA: exercises the EXACT refresh path the user hit.
# A real refresh makes the client call player:join with sessionId + resumeToken
# (NOT the pin path). Bug: that ack did NOT return playerId + state, so the
# reconnected player had playerId=undefined and could NOT answer. This probe
# asserts player:join returns playerId+state AND the reconnected player can
# successfully answer and have it counted.
set -u
cd "$(dirname "$0")/.." || exit 1
ROOT="$(pwd)"
PORT=8094
rm -f "$ROOT/server/data/recans.db"*
cd "$ROOT/server"
NODE_ENV=production DB_PATH=./data/recans.db PORT=$PORT node src/index.js > "$ROOT/server/data/recans.log" 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
for i in $(seq 1 25); do curl -sf -m1 localhost:$PORT/healthz >/dev/null 2>&1 && break; sleep 0.4; done
echo "▶ server up; running reconnect-ANSWER probe"
cd "$ROOT"
COUNTDOWN_MS=400 OSCAR_URL="http://localhost:$PORT" node -e '
const { io } = require("socket.io-client");
const BASE = process.env.OSCAR_URL;
const QUIZ = "recans-quiz";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (m,p,b) => (await fetch(BASE+p, {method:m, headers:{"Content-Type":"application/json","x-admin-pin":"000000"}, body:b?JSON.stringify(b):undefined})).json();
(async () => {
  await api("PUT", `/api/quizzes/${QUIZ}`, { id:QUIZ, title:"ReconAns", questions:[
    {type:"mc",prompt:"Q1?", time_limit:6, points:1000, options:[{text:"A",correct:false},{text:"B",correct:true}]}
  ]});
  const sess = await api("POST", "/api/sessions", { quizId: QUIZ });
  const ok = (...a) => console.log("   ✅", ...a);
  const bad = (...a) => { console.log("   ❌", ...a); process.exit(2); };

  const host = io(BASE, { transports:["websocket"], reconnection:false });
  await new Promise((r,j)=>{ host.on("connect",r); host.on("connect_error",j); });
  const h = await new Promise((r)=>host.emit("host:join",{ sessionId:sess.id, adminPin:"000000" },r));
  if (!h.ok) bad("host join", h);
  ok("host attached");

  const a = io(BASE, { transports:["websocket"], reconnection:false });
  await new Promise((r,j)=>{ a.on("connect",r); a.on("connect_error",j); });
  const joinA = await new Promise((r)=>a.emit("player:join",{ sessionId:sess.id, nickname:"Alice", resumeToken:null },r));
  if (!joinA.ok) bad("first join", joinA);
  const token = joinA.resumeToken;
  ok("A joined, token=", token);
  if (!joinA.playerId) bad("first player:join ack missing playerId", joinA);

  // register listener BEFORE starting so we catch Q1
  const q1 = new Promise((r)=>a.once("question", r));
  await new Promise((r)=>host.emit("host:start",{ sessionId:sess.id }, r));
  await q1;
  ok("A sees Q1");

  // ---- THE BUG REPRO ----
  a.disconnect();                 // simulate the page being torn down (refresh)
  const b = io(BASE, { transports:["websocket"], reconnection:false });
  await new Promise((r,j)=>{ b.on("connect",r); b.on("connect_error",j); });
  const rejoin = await new Promise((r)=>b.emit("player:join",{ sessionId:sess.id, nickname:"Alice", resumeToken:token },r));
  if (!rejoin.ok) bad("rejoin after refresh", rejoin);
  ok("rejoined, id=", rejoin.playerId, " status=", rejoin.state?.status, " hasQ=", !!rejoin.state?.question);

  // ASSERT 1: player:join must return playerId + question snapshot
  if (!rejoin.playerId) bad("player:join ack MISSING playerId");
  if (!rejoin.state || rejoin.state.status !== "question" || !rejoin.state.question)
    bad("rejoin ack MISSING question snapshot", rejoin.state);
  else {
    // snapshot has the question open; the UI would have shown answering tiles
    const closed = rejoin.state.question.deadline < Date.now();
    if (closed) bad("rejoins mid-question but deadline already passed — reconnect timing bug", rejoin.state);
    ok("player:join returns playerId + live question snapshot (screen drawable)");
  }

  // ASSESS 2: reconnected player can answer
  const ans = await new Promise((r)=>b.emit("player:answer",{ sessionId:sess.id, playerId:rejoin.playerId, choice:1 },r));
  if (!ans.ok) bad("reconnected player could NOT answer:", ans);
  ok("reconnected player answered -> ok:", ans);

  // ASSESS 3: answer is then counted (they receive your_result on reveal).
  // Reveal fires after the question limit (6s) + 800ms grace.
  const got = await Promise.race([ new Promise((r)=>b.once("your_result", r)), sleep(9000).then(()=>null) ]);
  if (!got) bad("reconnected player never received your_result");
  ok("answer counted: correct=", got.correct, " total=", got.total);

  b.disconnect(); host.disconnect();
  console.log("▶ reconnect-ANSWER probe: PASS ✓ (refreshed player can answer)");
  process.exit(0);
})().catch((e)=>{ console.error("probe crashed:", e); process.exit(2); });
'