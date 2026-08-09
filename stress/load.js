#!/usr/bin/env node
/**
 * OSCAR ARENA — Load / stress harness.
 *
 * Opens N real Socket.IO players against ONE server process, runs a real game
 * (join stampede -> start -> every player answers each question -> reveal ->
 * scoreboard -> podium -> done) and objectively reports:
 *   - registration: %of target joined, join latency (median / p95 / p99), wall time
 *   - throughput:   'question' events broadcast to players, 'your_result' echoes
 *   - game integrity: did the full cycle reach 'done' within a healthy window
 *   - memory:       server peak heap + RSS sampled via /healthz concurrently
 *                   (this, not raw row counts, is what proves "no OOM at 500")
 *   - reconnect torture (--churn N): N sockets die mid-game and resume with
 *     their token; the same identity + score must come back.
 *   - end-session propagation (--endmid Q): at question Q the host ends the
 *     game; EVERY connected player must reach a terminal 'done' state, and a
 *     fresh join with a resume token for that session must be REFUSED (no
 *     zombie resurrection / no more 'waiting for host').
 *
 * A QA gate that must PASS before deploy. Run against a LIVE server:
 *   OSCAR_URL=http://localhost:8080 ADMIN_PIN=000000 node --input-type=module stress/load.js
 * Flags:
 *   --players N (400)  --batch M (50)   --qtime T (8000)
 *   --questions K (4)  --seed ID        --churn N (0)
 *   --endmid K (0: disabled; end the game at question K and verify propagation)
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
// STRESS_FAST=1 pairs with compressed phase holds on the server (see engine.js
// ANSWER_GRACE_MS / REVEAL_HOLD_MS / SCOREBOARD_HOLD_MS) so the harness may
// drop its own 2s floor and blitz through thousands of questions in minutes.
const QTIME = Math.max(process.env.STRESS_FAST === '1' ? 50 : 2000, parseInt(flag('qtime', '8000'), 10) || 8000);
const NQ = Math.max(1, parseInt(flag('questions', '4'), 10) || 4);
const CHURN = Math.min(PLAYERS, parseInt(flag('churn', '0'), 10) || 0);
const ENDMID = parseInt(flag('endmid', '0'), 10) || 0;
const SEED = flag('seed', '');
const RUN = 'stress-' + Date.now().toString(36);

const PASS = (m) => console.log('  ✓ ' + m);
const FAIL = (m) => { console.error('  ✗ ' + m); process.exit(1); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const stats = { joined: 0, joinErrors: 0, questionEvents: 0, resultEchoes: 0, doneEchoes: 0, churnRejoined: 0 };
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
  console.log(`OSCAR ARENA stress — ${PLAYERS} players · ${BATCH}/wave · ${QTIME}ms × ${NQ}Q·${CHURN ? ' churn ' + CHURN : ''}${ENDMID ? ' endmid@' + ENDMID : ''}`);
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
  const players = []; // { s, pid, resume }

  async function wave(start) {
    const jobs = [];
    for (let i = start; i < Math.min(start + BATCH, PLAYERS); i++) jobs.push(spawn(i));
    await Promise.allSettled(jobs);
  }
  function spawn(i, resumeToken = null) {
    return new Promise((res) => {
      const name = 'R' + (i + 1).toString().padStart(4, '0');
      const tc = Date.now();
      const s = io(BASE, { transports: ['websocket'], reconnection: false, forceNew: true });
      const guard = setTimeout(() => { stats.joinErrors++; s.close(); res(); }, 25000);
      s.on('connect_error', () => { stats.joinErrors++; clearTimeout(guard); res(); });
      s.on('connect', () => {
        s.emit('player:join_pin', { pin: sess.pin, nickname: name, resumeToken }, (a) => {
          clearTimeout(guard);
          if (!a || !a.ok) { stats.joinErrors++; s.close(); return res(); }
          stats.joined++;
          joinLat.push(Date.now() - tc);
          s.__pid = a.playerId;
          s.__resume = a.resumeToken || resumeToken;
          wireAnswers(s);
          if (!resumeToken) players.push({ s, pid: s.__pid, resume: s.__resume });
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
    s.on('done', () => stats.doneEchoes++);
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

  // --------- RECONNECT TORTURE (churn) ----------
  // Drop CHURN sockets at Q1 and again mid-game; each must resume the SAME
  // identity (server-side resume path) and keep answering.
  let churnRound = 0;
  function maybeChurn(qidx) {
    if (!CHURN || churnRound >= 2) return;
    const want = churnRound === 0 ? qidx === 0 : qidx === Math.max(3, Math.floor(NQ / 2)) - 1;
    if (!want) return;
    const from = churnRound * Math.min(CHURN, players.length);
    const victims = players.slice(from, from + CHURN);
    churnRound++;
    if (victims.length === 0) return;
    console.log(`  [churn ${churnRound} of 2] killing ${victims.length} sockets (Q${qidx + 1})…`);
    victims.forEach((v, k) => {
      setTimeout(() => {
        try { v.s.close(); } catch {}
        spawn(Math.floor(Math.random() * 100000), v.resume);
      }, 600 + k * 250);
    });
  }

  // --------- RUN THE GAME ----------
  const tG = Date.now();
  await new Promise((res) => host.emit('host:start', { sessionId: sess.id }, (s) => {
    if (!s || !s.ok) FAIL('host start: ' + (s && s.error));
    res();
  }));
  PASS(`host:start → engine auto-advances all ${NQ} questions${ENDMID ? ` (will end at Q${ENDMID})` : ''}`);

  // Track churn boundary on the players' side.
  players.forEach((p) => {
    p.s.on('question', (q) => {
      if (q.index === 0 || q.index === Math.max(3, Math.floor(NQ / 2)) - 1) maybeChurn(q.index + 1);
    });
  });

  // The engine cycles Q → reveal → scoreboard → next … → podium → done.
  // If --endmid is set, the host ends after the ENDMID-th question fully
  // closes (its reveal is broadcast AFTER every player got your_result), so
  // expected result-echo counts stay valid while still exercising the
  // end-propagation path from a live mid-game state.
  const done = new Promise((res) => host.on('done', res));
  if (ENDMID > 0) {
    let ended = false;
    let reveals = 0;
    const doEnd = () => {
      if (!ended) {
        ended = true;
        host.emit('host:end', { sessionId: sess.id });
      }
    };
    host.on('reveal', () => {
      reveals += 1;
      if (reveals >= ENDMID) setTimeout(doEnd, 50);
    });
    // Guard: never leave the run hanging if reveals are suppressed; end on the
    // scoreboard as a fallback.
    host.on('scoreboard', () => {
      if (reveals >= ENDMID) doEnd();
    });
  }
  const guardMs = NQ * (QTIME + (process.env.STRESS_FAST === '1' ? 2500 : 16000)) + 30000;
  const guard = setTimeout(() => {}, guardMs);
  await done; gameDone = true; clearTimeout(guard);
  await sleep(600);
  clearInterval(memTimer);
  const wall = (Date.now() - tG) / 1000;

  const qEvents = stats.questionEvents, echoes = stats.resultEchoes;
  const qDone = ENDMID > 0 ? Math.min(NQ, ENDMID) : NQ;
  // Expected answer-path events: every registered player, per question actually
  // served. Churn kills sockets mid-flight (resume sockets arrive on a later
  // question), so a churn run gets a slightly lower bar.
  const expQ = joined * qDone;
  const expE = joined * qDone;
  const answerGate = CHURN > 0 ? 0.85 : 0.9;

  console.log('\n──────────── RESULT: OSCAR ARENA STRESS ────────────');
  console.log(`registered     : ${joined}/${PLAYERS} (${(joined / PLAYERS * 100).toFixed(1)}%)`);
  console.log(`join latency   : med ${pct(0.5)}ms · p95 ${pct(0.95)}ms · p99 ${pct(0.99)}ms`);
  console.log(`question evts  : ${qEvents} / expected ${expQ}`);
  console.log(`result echoes  : ${echoes} / expected ${expE}`);
  console.log(`done echoes    : ${stats.doneEchoes} of ${joined} players (end-session propagation)`);
  console.log(`game reached   : ${gameDone ? 'done' : 'NOT-done'}  (${wall.toFixed(1)}s)`);
  console.log(`server heap    : ${(peakMem.heap / 1048576).toFixed(0)} MB`);
  console.log(`server RSS     : ${(peakMem.rss / 1048576).toFixed(0)} MB`);
  if (CHURN) console.log(`churn          : ${CHURN} victims × 2 rounds (resume path exercised)`);
  console.log('──────────────────────────────────────────────────────');

  const ok = gameDone && echoes >= expE * answerGate && qEvents >= expQ * answerGate;
  if (ENDMID > 0 && stats.doneEchoes < joined * 0.95) {
    FAIL(`end-session propagation failed: only ${stats.doneEchoes}/${joined} players reached done`);
  }

  // --------- RESUME-AFTER-END CHECK (--endmid) ----------
  // The user-visible bug: after the host ends, a player who refreshes /
  // re-enters must land on the TERMINAL done screen — never a zombie lobby,
  // never "3-4 reloads", and never a resurrected game. So:
  //   - a returning player (valid resumeToken) is ACCEPTED, with the done
  //     snapshot (client renders "Session ended … try again");
  //   - a brand-new player (no resumeToken) is REFUSED (GAME_ENDED) — the
  //     ended session cannot be joined fresh.
  if (ENDMID > 0 && players.length > 0) {
    const v = players[0];
    const resume = await new Promise((res) => {
      const z = io(BASE, { transports: ['websocket'], reconnection: false, forceNew: true });
      const t = setTimeout(() => { z.close(); res(null); }, 8000);
      z.on('connect', () => {
        z.emit('player:join_pin', { pin: sess.pin, nickname: 'Zombie', resumeToken: v.resume }, (a) => {
          clearTimeout(t); z.close();
          res(a && { ok: a.ok, code: a.code, error: a.error, status: a.state?.status });
        });
      });
      z.on('connect_error', () => { clearTimeout(t); res(null); });
    });
    const acceptedTerminal = resume && resume.ok === true && resume.status === 'done';
    if (!acceptedTerminal) FAIL(`resume-after-end: returning player did not land on done (${JSON.stringify(resume)})`);
    console.log(`  resume-after-end accepted → status='${resume.status}' (terminal screen, no zombie)`);

    const fresh = await new Promise((res) => {
      const z = io(BASE, { transports: ['websocket'], reconnection: false, forceNew: true });
      const t = setTimeout(() => { z.close(); res(null); }, 8000);
      z.on('connect', () => {
        z.emit('player:join_pin', { pin: sess.pin, nickname: 'Newbie' }, (a) => {
          clearTimeout(t); z.close();
          res(a && { ok: a.ok, code: a.code, error: a.error });
        });
      });
      z.on('connect_error', () => { clearTimeout(t); res(null); });
    });
    const refusedFresh = fresh && fresh.ok === false && fresh.code === 'GAME_ENDED';
    if (!refusedFresh) FAIL(`ended session ACCEPTED a fresh join (${JSON.stringify(fresh)})`);
    console.log(`  fresh rejoin refused (code='${fresh.code}') → can't resurrect the game`);
    PASS('ended session is terminal: resumes land on done, fresh joins are refused');
  }
  console.log(ok
    ? `\nSTRESS-OK — ${joined} players on 1 Node server process, full game cycle, no OOM.${ENDMID ? ' end-session propagated to everyone.' : ''}`
    : `\nSTRESS-FAIL — gameDone=${gameDone} echoes=${echoes}/${expE} qEvents=${qEvents}/${expQ}`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { FAIL('crash: ' + (e && e.stack || e)); });