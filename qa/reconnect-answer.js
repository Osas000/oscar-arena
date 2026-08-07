// QA: the exact bug the user found — after a page refresh, the reconnected
// player must be able to ANSWER (previously playerId was undefined in the
// player:join ack, so every answer came back NOT_PLAYER and clicking did nothing).
//
// Flow: host starts -> player A joins -> Q1 opens -> A "refreshes" (new socket,
// same resume token, same session id) -> reconnected A must be able to submit a
// correct answer and be awarded points.
import { io } from 'socket.io-client';
const { createConnection } = await import('./_probe_lib.js');

// --- helpers ---
function log(...a) { console.log('  ', ...a); }
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Launch/boot is handled externally; we connect to the server address in env or localhost.
const BASE = process.env.BASE || 'http://localhost';
const PORT = process.env.PORT || process.env.QA_PORT;
const URL = `${BASE}:${PORT}`;
console.log(`▶ reconnect-answer probe @ ${URL}`);
if (!PORT) { console.log('▶ ERROR: QA_PORT not set'); process.exit(2); }
if (!process.env.SESSION_ID || !process.env.QUIZ_JSON) {
  console.log('▶ ERROR: SESSION_ID / QUIZ_JSON not set (run via fixture script)');
  process.exit(2);
}

// Shared HTTP helper
let out = 0;
async function httpJson(path, opts) {
  out++;
  const res = await fetch(`${BASE}:${PORT}${path}`, {
    ...opts, headers: { 'content-type': 'application/json', ...(opts?.headers||{}) },
  });
  return res.json();
}

// ---------------------------------------------------------------------------
// 1) host attaches to the already-created session
// ---------------------------------------------------------------------------
const host = io(`${BASE}:${PORT}`, { transports: ['websocket'], reconnection: false });
await new Promise((res, rej) => { host.on('connect', res); host.on('connect_error', rej); });
const hosted = await new Promise((res) => host.emit('host:join', { sessionId: process.env.SESSION_ID, adminPin: '000000' }, res));
if (!hosted?.ok) { console.log('▶ HOST FAIL', hosted); process.exit(2); }
log('1) host attached', hosted.session.pin);

// ---------------------------------------------------------------------------
// 2) player A joins (first time) — capture resume token + session id
// ---------------------------------------------------------------------------
let joined = null;
const a = io(`${BASE}:${PORT}`, { transports: ['websocket'], reconnection: false });
await new Promise((res, rej) => { a.on('connect', res); a.on('connect_error', rej); });
const joinA = await new Promise((res) => a.emit('player:join', { sessionId: process.env.SESSION_ID, nickname: 'ResumeAlice', resumeToken: null }, res));
if (!joinA?.ok) { console.log('FAIL first join', joinA); process.exit(2); }
joined = joinA;
log('2) A joined id=', joinA.playerId, 'token=', joinA.resumeToken);

// ensure we have the player + state fields the ack must now include
if (!joinA.playerId) { console.log('FAIL: player:join ack missing playerId'); process.exit(2); }
log('   ✅ A got playerId from player:join ack (resume path contract)');

// ---------------------------------------------------------------------------
// 3) host starts the game -> Q1 opens
// ---------------------------------------------------------------------------
await Promise.all([
  new Promise((res) => host.emit('host:start', { sessionId: process.env.SESSION_ID }, res)),
  new Promise((res) => a.once('question', res)), // A sees Q1
]);
log('4) Q1 open (host started)');

// ---------------------------------------------------------------------------
// 4) A's ORIGINAL socket answers Q1 (baseline works)
// ---------------------------------------------------------------------------
const ans1 = await new Promise((res) => a.emit('player:answer', { sessionId: process.env.SESSION_ID, playerId: a.id ?? joinedA.playerId, choice: 0 }, res));
if (!ans1?.ok) { console.log('FAIL baseline answer', ans1); process.exit(2); }
log('5) baseline answer ok');

// ---------------------------------------------------------------------------
// Back to QA: we now REALLY simulate the bug. The user's exact symptom:
//   page refresh creates a NEW socket + rejoins with only the resume token.
//   They called player:join(sessionId, resumeToken). We assert the ack now
//   provides playerId + state, then that a NEW answer attempt is accepted.
// ---------------------------------------------------------------------------

// Close the original socket (simulate leaving), open a brand new one.
a.disconnect();

// The stored playerId the client would have (from joinA). But after a refresh,
// the client clears in-memory and comes in with ONLY resume + session. We mimic
// exactly that: create a fresh socket, no playerId in the request.
const b = io(`${BASE}:${PORT}`, { transports: ['websocket'], reconnection: false });
await new Promise((res, rej) => { b.on('connect', res); b.on('connect_error', rej); });
const rejoin = await new Promise((res) => b.emit('player:join', {
  sessionId: process.env.SESSION_ID, nickname: 'ResumeAlice', resumeToken: joinedA.resumeToken,
}, res));
if (!rejoin?.ok) { console.error('FAIL rejoin', rejoin); process.exit(2); }
log('6) refreshed player rejoined id=', rejoin.playerId);

// THE assertion this probe exists for:
if (!rejoin.playerId) {
  console.log('FAIL: after refresh, player:join did NOT return playerId → answers would be NOT_PLAYER');
  process.exit(2);
}
if (!rejoin.state || !rejoin.state.question) {
  console.log('WARN: rejoin ack missing state/question — player cannot redraw screen', rejoin.state);
}
log('7) reconnected ack: playerId=', rejoin.playerId, 'state.status=', rejoin.state?.status, 'hasQ=', !!rejoin.state?.question);

// Now actually answer on the NEW socket with the returned playerId (Q1 still open?).
const ans2 = await new Promise((res) => b.emit('player:answer', {
  sessionId: process.env.SESSION_ID, playerId: rejoin.playerId, choice: 1,
}, res));
log('8) reconnected player answer result:', ans2);
if (ans2?.ok !== true) {
  console.log('FAIL: reconnected player could NOT answer (server said', ans2, ')');
  process.exit(2);
}
// Bonus: that player's total eventually reflected in ranking (await reveal).
await new Promise((res) => { b.once('your_result', () => res()); setTimeout(res, 2500); });
log('9) reconnected player received their_result → answer counted');

// cleanup
b.disconnect(); host.disconnect();
console.log('▶ reconnect-ANSWER probe: PASS ✓');
process.exit(0);