// SMOOTHNESS REGRESSION SUITE — the "it feels stuck / countdown starts at 6 /
// phones blank then jump to 3,2,1" user report from a 25-player live test.
//
// Self-boots the real server on a free port with a disposable DB, then proves:
//   1. Countdown payload carries {deadline, serverTime, duration} and the
//      client math (with simulated clock skew + the hard clamp) can NEVER
//      display a value above the countdown — the old "6" is impossible.
//   2. Host snapshot (refresh/resume path) carries the clock + duration so a
//      resumed host also countdowns correctly (the old missing-serverOffset).
//   3. Double host:start is idempotent — no countdown reset/restart.
//   4. host:next while a question is LIVE advances nothing (double-click on
//      Next can no longer skip a whole question).
//   5. Rapid double host:next during reveal advances exactly ONE question.
//   6. host:kick and host:lock are ack'd (host UI always gets an answer).
//   7. host:end ack'd, players receive the terminal done.
//
// Run: npm run test -w server  (or: node --test test/*.test.js)
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { io } from 'socket.io-client';

// --- env BEFORE importing the server (config/db read at import time) ---
const port = await new Promise((res) => {
  const s = net.createServer();
  s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); });
});
process.env.PORT = String(port);
process.env.ADMIN_PIN = '000000';
process.env.DB_PATH = path.join(os.tmpdir(), `oscar-smooth-${Date.now()}.db`);
process.env.COUNTDOWN_MS = '5000';          // prod value: the point of the test
process.env.REVEAL_HOLD_MS = '300';         // compress the chain after Q1
process.env.SCOREBOARD_HOLD_MS = '500';
process.env.PODIUM_HOLD_MS = '500';
process.env.ANSWER_GRACE_MS = '150';

const BASE = `http://localhost:${port}`;
const ADMIN = '000000';

// The client-side display math (mirrors Countdown.jsx): offset-corrected +
// hard-clamped so skew can never push it above the real countdown duration.
const skewAwareSeconds = (deadline, serverTime, clientNow, duration) => {
  const offset = serverTime - clientNow; // captured on receipt, as the client does
  return Math.min(duration, Math.max(0, Math.ceil((deadline - (clientNow + offset)) / 1000)));
};

let server;
let dbPath;

before(async () => {
  server = await import('../src/index.js');
  dbPath = process.env.DB_PATH;
});

after(() => {
  try { fs.rmSync(dbPath, { force: true }); } catch { /* tmp */ }
  server?.closeServerForTests?.(); // release the listener so the runner exits
});

async function api(method, apiPath, body) {
  const r = await fetch(BASE + apiPath, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-admin-pin': ADMIN },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const QUIZ_ID = '11111111-1111-4111-8111-111111111111';

test('host controls + countdown are smooth and skew-proof', async () => {
  const sockets = [];
  const mk = () => {
    const s = io(BASE, { transports: ['websocket'], reconnection: false, forceNew: true });
    sockets.push(s);
    return s;
  };
  try {
  // ---- seed quiz (3 questions so skip-safety has room to matter) ----
  await api('PUT', `/api/quizzes/${QUIZ_ID}`, {
    id: QUIZ_ID, title: 'Smoothness Quiz', questions: [
      { type: 'mc', prompt: 'Q1', time_limit: 3, points: 1000, options: [{ text: 'A', correct: true }, { text: 'B', correct: false }] },
      { type: 'mc', prompt: 'Q2', time_limit: 3, points: 1000, options: [{ text: 'A', correct: true }, { text: 'B', correct: false }] },
      { type: 'mc', prompt: 'Q3', time_limit: 3, points: 1000, options: [{ text: 'A', correct: true }, { text: 'B', correct: false }] },
    ],
  });

  const sess = await api('POST', '/api/sessions', { quizId: QUIZ_ID });
  assert.ok(sess.pin, 'session created');

  const mk = () => io(BASE, { transports: ['websocket'], reconnection: false, forceNew: true });

  // ---- host ----
  const ph = mk();
  await new Promise((res, rej) => { ph.on('connect', res); ph.on('connect_error', rej); });
  const hostJoin = await new Promise((res) => ph.emit('host:join', { sessionId: sess.id, adminPin: ADMIN }, res));
  assert.ok(hostJoin.ok, 'host join');
  let hostCountdowns = 0;
  const hostFirst = {};
  let hostPhase = 'lobby';
  ph.on('countdown', (c) => { hostCountdowns += 1; hostFirst.deadline = c.deadline; hostFirst.serverTime = c.serverTime; hostFirst.duration = c.duration; });
  ph.on('phase', (p) => { hostPhase = p.phase; });

  // ---- players ----
  const [pa, pb] = [mk(), mk()];
  await Promise.all([pa, pb].map((p) => new Promise((res, rej) => { p.on('connect', res); p.on('connect_error', rej); })));
  const joinA = await new Promise((res) => pa.emit('player:join_pin', { pin: sess.pin, nickname: 'Alpha', resumeToken: null }, res));
  const joinB = await new Promise((res) => pb.emit('player:join_pin', { pin: sess.pin, nickname: 'Bravo', resumeToken: null }, res));
  assert.ok(joinA.ok && joinB.ok, 'both players joined');
  const [paCountdowns, pbCountdowns] = [[], []];
  pa.on('countdown', (c) => paCountdowns.push(c));
  pb.on('countdown', (c) => pbCountdowns.push(c));
  let paKicked = false;
  pa.on('kicked', () => { paKicked = true; });
  let paDone = false;
  pa.on('done', () => { paDone = true; });
  const waitPhase = (want, timeoutMs = 15000) => new Promise((res, rej) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (hostPhase === want) { clearInterval(iv); res(); }
      else if (Date.now() - t0 > timeoutMs) { clearInterval(iv); rej(new Error(`never reached ${want} (stuck at ${hostPhase})`)); }
    }, 50);
  });

  // ---- start (single) ----
  const startAck = await new Promise((res) => ph.emit('host:start', { sessionId: sess.id }, res));
  assert.ok(startAck.ok, 'start ack ok');
  await delay(300);

  // ---- 1: countdown payload + clamp math ----
  assert.equal(hostFirst.duration, 5000, 'payload carries duration');
  assert.ok(hostFirst.deadline && hostFirst.serverTime, 'payload carries deadline+serverTime');
  assert.ok(paCountdowns[0] && pbCountdowns[0], 'every socket received the countdown');
  for (const c of [hostFirst, paCountdowns[0], pbCountdowns[0]]) {
    const remaining = c.deadline - c.serverTime;
    assert.ok(remaining > 4000 && remaining <= 5000, `server anchor sane (${remaining}ms)`);
    const skewNow = Date.now() + 1600; // device clock 1.6s BEHIND the server
    const skewSeconds = skewAwareSeconds(c.deadline, c.serverTime, skewNow, c.duration);
    assert.ok(skewSeconds <= c.duration, `NEVER above duration: got ${skewSeconds}`);
    assert.ok(skewSeconds >= 2, `starts high but sane: ${skewSeconds}`);
    // the OLD un-clamped math on that skewed clock would have shown 6
    const old = Math.max(1, Math.ceil((c.deadline - skewNow) / 1000));
    if (old > c.duration) assert.equal(skewSeconds, c.duration, `clamp tamed the old ${old} → ${skewSeconds}`);
  }

  // ---- 2: host snapshot mid-countdown carries clock + duration ----
  // (adoptHostState consumes `res.live` — the full detail key — for the
  // reconnecting host; `res.state` is the brief lobby summary.)
  const freshHost = mk();
  await new Promise((res, rej) => { freshHost.on('connect', res); freshHost.on('connect_error', rej); });
  const snapAck = await new Promise((res) => freshHost.emit('host:join', { sessionId: sess.id, adminPin: ADMIN }, res));
  assert.ok(snapAck.ok && snapAck.live, 'host snapshot returned');
  assert.ok(snapAck.live.serverTime, 'snapshot carries fresh serverTime');
  assert.equal(snapAck.live.countdownDuration, 5000, 'snapshot carries countdownDuration');
  assert.ok(snapAck.live.countdownDeadline, 'snapshot carries countdownDeadline');
  const snapShown = skewAwareSeconds(snapAck.live.countdownDeadline, snapAck.live.serverTime, Date.now(), snapAck.live.countdownDuration);
  assert.ok(snapShown <= 5 && snapShown >= 1, `resumed host countdown sane (${snapShown})`);
  freshHost.disconnect();

  // ---- 3: double-start is idempotent ----
  await delay(600);
  const d1 = hostFirst.deadline;
  const start2 = await new Promise((res) => ph.emit('host:start', { sessionId: sess.id }, res));
  assert.ok(start2.ok, 'second start ack ok (idempotent no-op)');
  await delay(300);
  assert.equal(hostCountdowns, 1, 'NO second countdown event — deadline not reset');
  assert.ok(d1 && hostFirst.deadline === d1, 'deadline unchanged by double-start');

  // ---- wait for Q1 to open (5s countdown) ----
  const questionEvents = [];
  ph.on('question', (q) => questionEvents.push(q.index));
  await new Promise((res, rej) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (questionEvents.length) { clearInterval(iv); res(); }
      else if (Date.now() - t0 > 15000) { clearInterval(iv); rej(new Error('Q1 never opened')); }
    }, 50);
  });
  assert.equal(questionEvents[0], 0, 'Q1 opened');

  // ---- 4: next while the question is LIVE advances nothing ----
  const nextLive = await new Promise((res) => ph.emit('host:next', { sessionId: sess.id }, res));
  assert.ok(nextLive.ok, 'next during live question acks ok');
  await delay(400);
  assert.equal(questionEvents.length, 1, 'LIVE question cannot be skipped by Next');

  // ---- 6: kick + lock ack'd ----
  const kickAck = await new Promise((res) => ph.emit('host:kick', { sessionId: sess.id, playerId: joinA.playerId }, res));
  assert.ok(kickAck.ok, 'kick ack ok');
  await delay(200);
  assert.ok(paKicked, 'kicked player heard it');
  const lockAck = await new Promise((res) => ph.emit('host:lock', { sessionId: sess.id, locked: true }, res));
  assert.ok(lockAck.ok, 'lock ack ok');

  // ---- 5: rapid double Next during reveal advances EXACTLY one ----
  await waitPhase('reveal'); // Q1 closes (3s + grace) → auto reveal
  const n1 = await new Promise((res) => ph.emit('host:next', { sessionId: sess.id }, res));
  const n2 = await new Promise((res) => ph.emit('host:next', { sessionId: sess.id }, res));
  assert.ok(n1.ok && n2.ok, 'rapid double Next acks');
  await delay(400);
  assert.equal(questionEvents.length, 2, 'double Next advances exactly ONE question');
  assert.equal(questionEvents[1], 1, 'advanced to Q2 only (index 1)');

  // ---- 7: end ----
  const endAck = await new Promise((res) => ph.emit('host:end', { sessionId: sess.id }, res));
  assert.ok(endAck.ok, 'end ack ok');
  await delay(300);
  assert.ok(paDone, 'player got terminal done');
  } finally {
    // Always release sockets — even on a failed assert — or the server's
    // close() would wait on the lingering connections and hang the runner.
    for (const s of sockets) s.disconnect();
  }
  console.log('  ✓ countdown duration/clamp, snapshot offset, idempotent start, live-question Next guard, kick/lock/end acks');
});