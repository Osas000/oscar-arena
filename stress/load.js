#!/usr/bin/env node
/**
 * OSCAR ARENA — Load / stress harness.
 *
 * Opens N real Socket.IO players against ONE server process, runs a real game
 * (join stampede -> start -> every player answers each question -> reveal ->
 * scoreboard -> podium -> done) and objectively reports:
 *   - registration: %of target joined, join latency (median / p95 / p99), wall time
 *   - throughput:   'question' events broadcast to players, 'your_result' echoes
 *   - game integrity: did the full cycle reach 'done'
 *   - memory:       server peak heap + RSS sampled via /healthz concurrently
 *                   (this, not raw row counts, is what proves "no OOM at 500")
 *
 * A QA gate that must PASS before deploy. Run against a LIVE server:
 *   OSCAR_URL=http://localhost:8080 ADMIN_PIN=000000 node --input-type=module stress/load.js
 * Flags: --players N (default 400) --batch M (50) --qtime T (8000)
 *        --questions K (4) --seed ID
 */
import { io } from 'socket.io-client';

const BASE = process.env.OSCAR_URL || 'http://localhost:8080';
const PIN = process.env.ADMIN_PIN || '000000';

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf('--' + n);
  return i >= 0 && args[i + 1] && !String(args[i + 1]).startsWith('--') ? args[i + 1] : d;
};
const PLAYERS = Math.min(1000, parseInt(flag('players', '400'), 10) || 400);
const BATCH = Math.max(5, parseInt(flag('batch', '50'), 10) || 50);
const QTIME = Math.max(2000, parseInt(flag('qtime', '8000'), 10) || 8000);
const NQ = Math.max(1, parseInt(flag('questions', '4'), 10) || 4);
const SEED = flag('seed', '');
const RUN = 'stress-' + Date.now().toString(36);

const PASS = (m) => console.log('  ✓ ' + m);
const FAIL = (m) => { console.error('  ✗ ' + m); process.exit(1); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const stats = { joined: 0, joinErrors: 0, questionEvents: 0, resultEchoes: 0 };
const joinLat = [];
const peakMem = { heap: 0, rss: 0 };
let gameDone = false;

const api = async (method, path, body) => {
  const r = await fetch(BASE + path, {
    method, headers: { 'Content-Type': 'application/json', 'x-admin-pin': PIN },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
};

// Sample server memory concurrently with the load.
const memTimer = setInterval(() => {
  fetch(BASE + '/healthz').then((r) => r.json()).then((h) => {
    if (h && typeof h.heap === 'number') {
      peakMem.heap = Math.max(peakMem.heap, h.heap);
      peakMem.rss = Math.max(peakMem.rss, h.rss || 0);
    }
  }).catch(() => {});
}, 400);

async function seedQuiz() {
  const questions = [];
  for (let k = 0; k < NQ; k++) {
    questions.push({
      type: 'mc', prompt: `Load Q${k + 1}: pick the alpha`, time_limit: (QTIME / 1000).toFixed(1),
      points: 1000,
      options: [
        { text: 'Alpha (correct)', correct: true },
        { text: 'Bravo', correct: false },
        { text: 'Charlie', correct: false },
      ],
    });
  }
  const id = SEED || RUN;
  const quiz = await api('PUT', `/api/quizzes/${id}`, { id, title: 'Load ' + RUN, questions });
  if (!quiz || !quiz.id) FAIL('seed: ' + JSON.stringify(quiz));
  return quiz.id;
}

async function main() {
  console.log(`OSCAR ARENA stress — ${PLAYERS} players · ${BATCH}/wave · ${QTIME}ms × ${NQ}Q`);
  console.log(`target ${BASE}\n`);

  const quizId = await seedQuiz();
  PASS(`seeded ${NQ}-question sample quiz`);

  const sess = await api('POST', '/api/sessions', { quizId });
  if (!sess.pin) FAIL('session: ' + JSON.stringify(sess));
  PASS(`session ready, PIN=${sess.pin} (${PLAYERS} player target)`);

  // ------------ HOST ------------
  const host = io(BASE, { transports: ['websocket'], reconnection: false });
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('host connect timeout')), 8000);
    host.on('connect', () => { clearTimeout(t); res(); });
    host.on('connect_error', rej);
  });
  await new Promise((res) => {
    host.emit('host:join', { sessionId: sess.id, adminPin: PIN }, (h) => {
      if (!h.ok) FAIL('host join: ' + h.error);
      res();
    });
  });
  host.on('done', () => { gameDone = true; });
  PASS('host attached');

  // --------- PLAYER STAMPEDE ----------
  const t0 = Date.now();
  console.log(`\nopening ${PLAYERS} sockets (${BATCH}/wave)...`);
  async function wave(start) {
    const jobs = [];
    for (let i = start; i < Math.min(start + BATCH, PLAYERS); i++) jobs.push(spawn(i));
    await Promise.allSettled(jobs);
  }
  function spawn(i) {
    return new Promise((res) => {
      const name = 'R' + (i + 1).toString().padStart(4, '0');
      const tc = Date.now();
      const s = io(BASE, { transports: ['websocket'], reconnection: false });
      const guard = setTimeout(() => { stats.joinErrors++; s.close(); res(); }, 25000);
      s.on('connect_error', () => { stats.joinErrors++; clearTimeout(guard); res(); });
      s.on('connect', () => {
        s.emit('player:join_pin', { pin: sess.pin, nickname: name, resumeToken: null }, (a) => {
          clearTimeout(guard);
          if (!a || !a.ok) { stats.joinErrors++; s.close(); return res(); }
          stats.joined++;
          joinLat.push(Date.now() - tc);
          s.__pid = a.playerId;          // store player id for answering
          wireAnswers(s);
          res();
        });
      });
    });
  }
  function wireAnswers(s) {
    // Stravestamp the DB write path: every player answers every question.
    s.on('question', (q) => {
      stats.questionEvents++;
      s.emit('player:answer', { sessionId: sess.id, playerId: s.__pid, choice: 0 });
    });
    s.on('your_result', () => stats.resultEchoes++);
  }

  for (let w = 0; w < PLAYERS; w += BATCH) {
    await wave(w);
    const n = Math.min(w + BATCH, PLAYERS);
    if (n % 200 === 0 || n === PLAYERS) console.log(`  ${n}/${PLAYERS} joined`);
  }
  const regMs = Date.now() - t0;
  const joined = stats.joined;
  const sort = joinLat.slice().sort((a, b) => a - b);
  const pct = (q) => sort[Math.min(sort.length - 1, Math.floor(sort.length * q))];
  console.log(`\n  registered ${joined}/${PLAYERS} in ${(regMs / 1000).toFixed(1)}s (${stats.joinErrors} failed)`);
  console.log(`  join latency: median ${pct(0.5)}ms · p95 ${pct(0.95)}ms · p99 ${pct(0.99)}ms`);
  if (joined < PLAYERS * 0.97) FAIL(`degraded join: ${joined}/${PLAYERS}`);
  PASS(`${joined} players fully joined`);

  // --------- RUN THE GAME ----------
  const tG = Date.now();
  await new Promise((res) => host.emit('host:start', { sessionId: sess.id }, (s) => {
    if (!s || !s.ok) FAIL('host start: ' + (s && s.error));
    res();
  }));
  PASS(`host:start → engine auto-advances all ${NQ} questions`);

  // The engine cycles Q → reveal → scoreboard → next … → podium → done on its own.
  const done = new Promise((res) => host.on('done', res));
  const guard = setTimeout(() => {}, NQ * (QTIME + 16000) + 10000);
  await done; gameDone = true; clearTimeout(guard);
  await sleep(400);
  clearInterval(memTimer);
  const wall = (Date.now() - tG) / 1000;

  const qEvents = stats.questionEvents, echoes = stats.resultEchoes;
  const expQ = joined * NQ;
  const expE = joined * NQ;

  console.log('\n──────────── RESULT: OSCAR ARENA STRESS ────────────');
  console.log(`registered     : ${joined}/${PLAYERS} (${(joined / PLAYERS * 100).toFixed(1)}%)`);
  console.log(`join latency   : med ${pct(0.5)}ms · p95 ${pct(0.95)}ms · p99 ${pct(0.99)}ms`);
  console.log(`question evts  : ${qEvents} / expected ${expQ}`);
  console.log(`result echoes  : ${echoes} / expected ${expE}`);
  console.log(`game reached   : ${gameDone ? 'done' : 'NOT-done'}  (${wall.toFixed(1)}s)`);
  console.log(`server heap    : ${(peakMem.heap / 1048576).toFixed(0)} MB`);
  console.log(`server RSS     : ${(peakMem.rss / 1048576).toFixed(0)} MB`);
  console.log('──────────────────────────────────────────────────────');

  const ok = gameDone && echoes >= expE * 0.9 && qEvents >= expQ * 0.9;
  console.log(ok
    ? `\nSTRESS-OK — ${joined} players on 1 Node process, full game cycle, no OOM.`
    : `\nSTRESS-DEGRADED — echoes ${echoes}/${expE}, done=${gameDone}`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('\n✗ fatal:', e); process.exit(1); });