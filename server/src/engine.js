import fs from 'node:fs';
import { db } from './db.js';
import { uuid, generatePin } from './config.js';
import { getAdminPin } from './settings.js';

// ---------------------------------------------------------------------------
// OSCAR ARENA — server-authoritative game engine
// ---------------------------------------------------------------------------
// The server owns: session lifecycle, question timing (single clock), scoring,
// streak tracking, ranking, and phase transitions. Clients are thin renderers.
//
// State machine:
//   lobby -> question -> reveal -> scoreboard -> (question ...) -> podium -> done
//
// Phase events emitted to sockets:
//   phase        { phase }                                   (everyone)
//   question     { index, total, type, prompt, timeLimit, deadline, options }  (everyone)
//   answer_received { playerCount, answeredCount }           (host room)
//   reveal       { correctChoice, distribution, ... }        (everyone; host gets more)
//   scoreboard   { top: [...] }                              (everyone; host gets full)
//   podium       { top3: [...] }                             (everyone)
//   done         { results }                                 (host)
//   player_joined / player_left / player_kicked              (host room)
// ---------------------------------------------------------------------------

const liveSessions = new Map(); // id -> session state
let emit = () => {};            // wired in by index.js: (sessionId, room, event, payload)

export function setEmitter(fn) {
  emit = fn;
}

export function getLive(id) {
  return liveSessions.get(id);
}

export function publish(session, target, event, payload) {
  emit(session.id, target, event, payload);
}

// ------------------------------- Scoring -----------------------------------
/**
 * Kahoot-style speed-weighted score for a correct answer:
 *   maxPoints * (1 - ((respondedMs / totalMs) / 2)), rounded.
 * Instant (< 250ms) -> full points; answering at the deadline -> ~half.
 */
export function computePoints(maxPoints, respondedMs, totalMs) {
  if (respondedMs <= 250) return maxPoints;
  const fraction = Math.min(respondedMs / totalMs, 1);
  return Math.round(maxPoints * (1 - fraction / 2));
}

// ------------------------------ Quiz CRUD ----------------------------------
export function createQuiz(title) {
  const id = uuid();
  db.prepare('INSERT INTO quizzes (id, title) VALUES (?, ?)').run(id, title);
  return { id, title };
}

/**
 * Seed quizzes from seed-quizzes.json if the DB is empty.
 *
 * Render's free tier has no persistent disk, so the SQLite file resets each time
 * the service sleeps/redeploys and the DB would otherwise be blank. This makes
 * the app self-healing: on boot, if there are no quizzes yet, load the bundled
 * starter quizzes so a host always has questions ready.
 */
export function seedQuizzesIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM quizzes').get().n;
  if (count > 0) return { seeded: 0 };
  const quotes = JSON.parse(
    fs.readFileSync(new URL('./seed-quizzes.json', import.meta.url), 'utf8')
  );
  let seeded = 0;
  for (const quiz of quotes) {
    saveQuiz({ id: uuid(), title: quiz.title, questions: quiz.questions });
    seeded++;
  }
  return { seeded };
}

export function getQuiz(id) {
  const quiz = db.prepare('SELECT * FROM quizzes WHERE id = ?').get(id);
  if (!quiz) return null;
  const questions = db
    .prepare('SELECT * FROM questions WHERE quiz_id = ? ORDER BY position')
    .all(id)
    .map((q) => ({ ...q, options: JSON.parse(q.options) }));
  return { ...quiz, questions };
}

export function listQuizzes() {
  return db
    .prepare(
      `SELECT q.id, q.title, q.created_at, q.updated_at,
              (SELECT COUNT(*) FROM questions x WHERE x.quiz_id = q.id) AS questionCount
       FROM quizzes q ORDER BY q.updated_at DESC`
    )
    .all();
}

export function deleteQuiz(id) {
  db.prepare('DELETE FROM quizzes WHERE id = ?').run(id);
}

/** Upsert a quiz and replace its questions atomically. */
export function saveQuiz(quiz) {
  const run = db.transaction((q) => {
    db.prepare(
      `INSERT INTO quizzes (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at`
    ).run(q.id, q.title, Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000));
    db.prepare('DELETE FROM questions WHERE quiz_id = ?').run(q.id);
    q.questions.forEach((question, i) => {
      db.prepare(
        `INSERT INTO questions (id, quiz_id, position, type, prompt, time_limit, points, options)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        question.id || uuid(),
        q.id,
        i,
        question.type,
        question.prompt,
        question.time_limit,
        question.points,
        JSON.stringify(question.options)
      );
    });
  });
  run(quiz);
  return getQuiz(quiz.id);
}

// Compare against the live admin PIN (DB override > env > default), so the two
// auth paths never diverge and a changed PIN takes effect everywhere at once.
const expectedAdminPin = () => getAdminPin();

// ---------------------------- Session lifecycle ----------------------------
export function createSession({ quizId, hostId, adminPin }) {
  const quiz = getQuiz(quizId);
  if (!quiz) throw new Error('Quiz not found');
  if (adminPin !== expectedAdminPin()) throw new Error('Invalid admin PIN');

  let pin = generatePin(6);
  while (
    db.prepare('SELECT 1 FROM sessions WHERE pin = ?').get(pin) ||
    [...liveSessions.values()].some((s) => s.pin === pin)
  ) {
    pin = generatePin(6);
  }

  const id = uuid();
  db.prepare(
    `INSERT INTO sessions (id, quiz_id, pin, status, question_index, locked)
     VALUES (?, ?, ?, 'lobby', -1, 0)`
  ).run(id, quizId, pin);

  const session = {
    id,
    quiz,
    pin,
    status: 'lobby',
    questionIndex: -1,
    questionDeadline: null,
    locked: false,
    hostId,
    hostSocketId: null,          // current host socket
    sockets: new Map(),          // socketId -> { role: 'host'|'player', playerId? }
    players: new Map(),          // playerId -> player record
    playerStates: new Map(),     // playerId -> { total, correct } cumulative
    liveRound: null,             // active question round
    timers: new Set(),           // all pending setTimeout ids for cleanup
  };
  liveSessions.set(id, session);
  return session;
}

/** Register a timer and track it so it can be cleaned up on shutdown. */
function defer(session, ms, fn) {
  const t = setTimeout(() => {
    session.timers.delete(t);
    fn();
  }, ms);
  session.timers.add(t);
  return t;
}

function clearSessionTimers(session) {
  for (const t of session.timers) clearTimeout(t);
  session.timers.clear();
}

export function getSessionByPin(pin) {
  return [...liveSessions.values()].find((s) => s.pin === pin) || null;
}

/** Host attaches. Called on host connect with a session id. */
export function hostAttach(sessionId, socketId, adminPin) {
  const session = liveSessions.get(sessionId);
  if (!session) throw new Error('Session not found');
  if (adminPin !== expectedAdminPin()) throw new Error('Invalid admin PIN');
  cancelHostLostEnd(sessionId);
  session.hostSocketId = socketId;
  session.sockets.set(socketId, { role: 'host' });
  return session;
}

export function hostDetach(sessionId, socketId) {
  const session = liveSessions.get(sessionId);
  if (!session) return;
  if (session.hostSocketId === socketId) session.hostSocketId = null;
  session.sockets.delete(socketId);
}

// ---------------------------------------------------------------------------
// Host-loss auto-end: if the host's socket dies (tab closed / app killed) the
// session must NOT linger as a zombie. Schedule an end; a reconnecting host
// (host:join) cancels it within the grace window.
// ---------------------------------------------------------------------------
const hostLostTimers = new Map(); // sessionId -> timer id
const HOST_LOST_GRACE_MS = () => Number(process.env.HOST_LOST_GRACE_MS) || 30000;

export function scheduleHostLostEnd(sessionId) {
  const session = liveSessions.get(sessionId);
  if (!session || session.status === 'done') return;
  cancelHostLostEnd(sessionId);
  const t = setTimeout(() => {
    hostLostTimers.delete(sessionId);
    const s = liveSessions.get(sessionId);
    // Only auto-end if it's still mid-flight; a done session is already ended.
    if (s && s.status !== 'done' && !s.hostSocketId) endSession(sessionId);
  }, HOST_LOST_GRACE_MS());
  hostLostTimers.set(sessionId, t);
}

export function cancelHostLostEnd(sessionId) {
  const t = hostLostTimers.get(sessionId);
  if (t) { clearTimeout(t); hostLostTimers.delete(sessionId); }
}

// ------------------------------ Player join --------------------------------
/**
 * Join or resume. If `resumeToken` matches an existing player in the session,
 * re-attach that identity (score preserved). Otherwise create a new player.
 */
export function joinPlayer({ sessionId, nickname, resumeToken, socketId }) {
  const session = liveSessions.get(sessionId);
  if (!session) throw Object.assign(new Error('Game not found'), { code: 'NO_GAME' });
  // Kahoot-style: join is allowed while the game is LIVE (lobby, countdown,
  // question, reveal, scoreboard). A late joiner simply hasn't answered the
  // already-closed questions. Only the finished phases reject NEW players.
  // EXCEPTION: a resumeToken for an EXISTING player is always honoured — a
  // returning/refreshing player of a DONE session must land on the terminal
  // "session ended" screen, not on an error/join screen (the zombie report:
  // "host ended, but their phone kept waiting/restarting for 3-4 reloads").
  const joinable = ['lobby', 'countdown', 'question', 'reveal', 'scoreboard'].includes(session.status);
  const preexisting = resumeToken
    ? [...session.players.values()].find((p) => p.resumeToken === resumeToken && !p.kicked) || null
    : null;
  if (!joinable && !preexisting) {
    if (session.status === 'done') {
      throw Object.assign(new Error('This game has ended'), { code: 'GAME_ENDED' });
    }
    throw Object.assign(new Error('Game already started'), { code: 'GAME_STARTED' });
  }

  let player = preexisting;
  const cleanName = String(nickname || '').trim().slice(0, 24);

  if (!player && resumeToken) {
    player = [...session.players.values()].find((p) => p.resumeToken === resumeToken && !p.kicked);
  }

  if (!player) {
    if (session.locked) {
      throw Object.assign(new Error('Lobby locked'), { code: 'LOCKED' });
    }
    if (!cleanName) throw Object.assign(new Error('Nickname required'), { code: 'NO_NAME' });
    const taken = [...session.players.values()].some(
      (p) => p.nickname.toLowerCase() === cleanName.toLowerCase() && !p.kicked
    );
    if (taken) throw Object.assign(new Error('Nickname already taken'), { code: 'NAME_TAKEN' });

    const playerId = uuid();
    const token = uuid();
    db.prepare(
      'INSERT INTO players (id, session_id, nickname, resume_token) VALUES (?, ?, ?, ?)'
    ).run(playerId, sessionId, cleanName, token);
    player = {
      id: playerId,
      nickname: cleanName,
      resumeToken: token,
      kicked: false,
    };
    session.players.set(playerId, player);
    session.playerStates.set(playerId, { total: 0, correct: 0 });
    publish(session, 'host', 'player_joined', { player: publicPlayer(player) });
  }

  session.sockets.set(socketId, { role: 'player', playerId: player.id });
  publish(session, 'host', 'player_count', { count: session.players.size });

  return { player, session };
}

export function playerDisconnect(sessionId, socketId) {
  const session = liveSessions.get(sessionId);
  if (!session) return;
  const entry = session.sockets.get(socketId);
  session.sockets.delete(socketId);
  if (entry?.role === 'host' && session.hostSocketId === socketId) session.hostSocketId = null;
  publish(session, 'host', 'player_count', { count: session.players.size });
}

/** Find which live session a socket belonged to and detach it. */
export function playerDisconnectAny(socketId) {
  for (const session of liveSessions.values()) {
    if (session.sockets.has(socketId)) {
      const entry = session.sockets.get(socketId);
      playerDisconnect(session.id, socketId);
      // A dead host socket must not leave the session to rot: auto-end after a
      // grace window so every connected player gets a terminal state instead
      // of an eternal 'waiting for the host…'. A rejoin cancels it (hostAttach).
      if (entry?.role === 'host' && session.status !== 'done') {
        scheduleHostLostEnd(session.id);
      }
      return; // a socket belongs to exactly one session
    }
  }
}

export function publicPlayer(player) {
  return { id: player.id, nickname: player.nickname, resumeToken: player.resumeToken, kicked: player.kicked };
}

export function kickPlayer(sessionId, playerId) {
  const session = liveSessions.get(sessionId);
  if (!session) return;
  const player = session.players.get(playerId);
  if (!player) return;
  player.kicked = true;
  db.prepare('UPDATE players SET kicked = 1 WHERE id = ?').run(playerId);
  publish(session, 'host', 'player_kicked', { playerId });
  // The player's own socket(s) get kicked via a targeted emit by index.js
  return player;
}

export function setLobbyLocked(sessionId, locked) {
  const session = liveSessions.get(sessionId);
  if (!session) return;
  session.locked = Boolean(locked);
  publish(session, 'host', 'lobby_locked', { locked: session.locked });
}

// Countdown shown to everyone before the FIRST question after the host hits
// Start. (Between-question transitions stay instant for pace.)
// Read lazily so tests can override it after import.
// Phase hold durations (ms). Env-tunable so the stress harness can compress a
// 2500-question marathon to minutes without touching production defaults.
const holdMs = (env, def) => {
  const v = Number(process.env[env]);
  return Number.isFinite(v) && v > 0 ? v : def;
};
const revealHoldMs = () => holdMs('REVEAL_HOLD_MS', 4000);
const scoreboardHoldMs = () => holdMs('SCOREBOARD_HOLD_MS', 8000);
const podiumHoldMs = () => holdMs('PODIUM_HOLD_MS', 20000);

const countdownMs = () => Number(process.env.COUNTDOWN_MS) || 5000;
export const countdownDurationMs = () => countdownMs();

export function startGame(sessionId) {
  const session = liveSessions.get(sessionId);
  if (!session) throw new Error('Session not found');
  if (session.quiz.questions.length === 0) throw new Error('Quiz has no questions');
  if (session.players.size === 0) {
    throw Object.assign(new Error('No players have joined yet'), { code: 'NO_PLAYERS' });
  }
  // Idempotent: a double-clicked Start (or a reconnect replaying the emit)
  // must NOT reset the countdown deadline or re-emit — that was the root of
  // "the countdown restarts / jumps straight into the question".
  if (session.status !== 'lobby') return session;
  session.questionIndex = 0;
  session.status = 'countdown';
  session.questionDeadline = null;
  session.countdownDeadline = Date.now() + countdownMs();

  publish(session, 'all', 'phase', { phase: 'countdown' });
  // `duration` lets clients hard-clamp their countdown so skew/jitter can
  // NEVER render a value above the real countdown (the old "it starts at 6"
  // report: un-clamped ceil on a clock-skewed device).
  publish(session, 'all', 'countdown', {
    deadline: session.countdownDeadline,
    serverTime: Date.now(),
    duration: countdownMs(),
  });

  // Auto-open Q1 after the countdown. Guard so a manual end/next doesn't race.
  defer(session, countdownMs(), () => {
    const cur = liveSessions.get(session.id);
    if (cur && cur.status === 'countdown') openQuestion(cur);
  });
  return session;
}

export function nextQuestion(sessionId) {
  const session = liveSessions.get(sessionId);
  if (!session) throw new Error('Session not found');
  // A question that is LIVE must never be skipped by a stray/double Next —
  // players are mid-answer. Only reveal/scoreboard are safe advance points
  // (the auto-chain calls this from scoreboard; the host fast-forwards from
  // reveal). This was the "clicking Next skipped a whole question" class of
  // bug when a double-click landed twice.
  if (session.status !== 'reveal' && session.status !== 'scoreboard') return session;
  if (session.questionIndex + 1 >= session.quiz.questions.length) {
    finishGame(session);
    return session;
  }
  session.questionIndex += 1;
  openQuestion(session);
  return session;
}

function openQuestion(session) {
  const q = session.quiz.questions[session.questionIndex];
  const totalMs = q.time_limit * 1000;
  session.status = 'question';
  session.liveRound = {
    questionId: q.id,
    startedAt: Date.now(),
    totalMs,
    deadline: Date.now() + totalMs,
    answered: new Map(), // playerId -> { choice, correct, points, streak, respondedMs }
  };
  session.questionDeadline = session.liveRound.deadline;

  publish(session, 'all', 'phase', { phase: 'question' });
  publish(session, 'all', 'question', {
    index: session.questionIndex,
    total: session.quiz.questions.length,
    type: q.type,
    prompt: q.prompt,
    timeLimit: q.time_limit,
    deadline: session.liveRound.deadline,
    serverTime: session.liveRound.startedAt,
    options: q.options.map((o, i) => ({ id: i, text: o.text })),
  });

  // The deadline is authoritative; this timer just closes the round for everyone
  // (including clients whose network stalled). The +grace keeps the question
  // briefly open after the deadline so slow clients' answers still count
  // (network jitter is not cheating). Env-tunable for the stress marathon.
  const answerGraceMs = () => holdMs('ANSWER_GRACE_MS', 800);
  defer(session, totalMs + answerGraceMs(), () => {
    const cur = liveSessions.get(session.id);
    if (cur && cur.liveRound?.questionId === q.id && cur.status === 'question') {
      closeQuestion(session);
    }
  });
}

export function submitAnswer(sessionId, playerId, choice) {
  const session = liveSessions.get(sessionId);
  if (!session) return { ok: false, reason: 'NO_GAME' };
  if (session.status !== 'question' || !session.liveRound) {
    return { ok: false, reason: 'NO_QUESTION' };
  }
  if (!session.players.has(playerId)) return { ok: false, reason: 'NOT_PLAYER' };
  if (session.liveRound.answered.has(playerId)) return { ok: false, reason: 'ALREADY_ANSWERED' };

  const now = Date.now();
  if (now > session.liveRound.deadline) return { ok: false, reason: 'CLOSED' };

  const q = session.quiz.questions[session.questionIndex];
  const opt = q.options[choice];
  if (!opt) return { ok: false, reason: 'BAD_CHOICE' };

  const correct = Boolean(opt.correct);
  const respondedMs = now - session.liveRound.startedAt;
  const points = correct
    ? computePoints(q.points, respondedMs, session.liveRound.totalMs)
    : 0;
  const prevStreak = [...session.liveRound.answered.values()].reduce(
    (acc, a) => Math.max(acc, a.streak), 0
  );
  const streak = correct ? prevStreak + 1 : 0;

  const state = session.playerStates.get(playerId);
  state.total += points;
  if (correct) state.correct += 1;

  session.liveRound.answered.set(playerId, {
    choice, correct, points, streak, respondedMs,
  });

  // ARCHIVE INSERT IS WRITE-BEHIND (scale fix): the answers table is archival —
  // every live computation (scores, streaks, distribution, ranking) uses the
  // in-memory round state above. A synchronous INSERT per answer makes the
  // single event loop stall through an answer burst (measured ceiling end of
  // the 3000-player marathon). Queue and flush in one SQLite TRANSACTION
  // shortly after the burst; closeQuestion flushes synchronously once, which
  // keeps the archive complete per question.
  queueAnswer([uuid(), session.id, playerId, q.id, session.questionIndex,
    choice, correct ? 1 : 0, points, respondedMs, streak]);

  publish(session, 'host', 'answer_received', {
    answeredCount: session.liveRound.answered.size,
    playerCount: session.players.size,
  });
  return { ok: true, correct, points, streak };
}

// --------------------- write-behind answer archive ------------------------
const answerQueue = [];
let answerFlushTimer = null;

function queueAnswer(row) {
  answerQueue.push(row);
  if (answerFlushTimer) return;
  // 50ms window: answers from one burst collect into a single transaction.
  answerFlushTimer = setTimeout(() => {
    answerFlushTimer = null;
    flushAnswers();
  }, 50);
}

let flushRunning = false;
export function flushAnswers() {
  if (flushRunning || answerQueue.length === 0) return;
  flushRunning = true;
  try {
    const rows = answerQueue.splice(0, answerQueue.length);
    const insert = db.prepare(
      `INSERT INTO answers (id, session_id, player_id, question_id, question_index, choice, correct, points_awarded, responded_ms, streak)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    // ONE commit for the whole batch — thousands of individual commits is the
    // exact stall that capped a single process around 2500-3000 players.
    db.transaction((all) => { for (const r of all) insert.run(r); })(rows);
    // Don't reschedule inside the transaction; the next queueAnswer does.
  } finally {
    flushRunning = false;
  }
}

function closeQuestion(session) {
  const round = session.liveRound;
  const q = session.quiz.questions[session.questionIndex];

  // Durability: the round is over — land every queued answer in ONE commit
  // before the reveal leaves this question behind (scores are in-memory, but
  // the archive must stay question-complete for results/export).
  flushAnswers();

  // Per-player verdict + cumulative totals (players get their own only).
  const distribution = [0, 0, 0, 0, 0, 0];
  for (const a of round.answered.values()) {
    if (a.choice >= 0 && a.choice < distribution.length) distribution[a.choice] += 1;
  }
  const correctChoice = q.options.findIndex((o) => o.correct);

  session.status = 'reveal';
  publish(session, 'all', 'phase', { phase: 'reveal' });
  publish(session, 'all', 'reveal', {
    correctChoice,
    distribution,
    answeredCount: round.answered.size,
    playerCount: session.players.size,
    yourResult: null, // per-player handled in targeted emit below
  });

  // Targeted per-player reveal (score/streak) + host full detail.
  for (const [playerId, a] of round.answered.entries()) {
    const state = session.playerStates.get(playerId);
    publish(session, 'player:' + playerId, 'your_result', {
      correct: a.correct,
      choice: a.choice,
      correctChoice,
      points: a.points,
      streak: a.streak,
      total: state.total,
    });
  }
  for (const [playerId] of session.players.entries()) {
    if (!round.answered.has(playerId)) {
      publish(session, 'player:' + playerId, 'your_result', {
        correct: false, choice: null, correctChoice,
        points: 0, streak: 0, total: session.playerStates.get(playerId).total,
      });
    }
  }

  // Hold reveal ~4s first so the host sees the answer distribution and players
  // see their own result before the leaderboard replaces it.
  defer(session, revealHoldMs(), () => {
    const cur = liveSessions.get(session.id);
    if (cur && cur.status === 'reveal') {
      cur.status = 'scoreboard';
      const top = ranking(cur).slice(0, 5);
      publish(cur, 'host', 'scoreboard', { top, full: ranking(cur) });
      publish(cur, 'all', 'scoreboard', { top });
      publish(cur, 'all', 'phase', { phase: 'scoreboard' });
      // Auto-advance after a beat so the host can also click Next manually.
      defer(cur, scoreboardHoldMs(), () => {
        const s2 = liveSessions.get(session.id);
        if (s2 && s2.status === 'scoreboard') {
          if (s2.questionIndex + 1 < s2.quiz.questions.length) {
            nextQuestion(s2.id);
          } else {
            finishGame(s2);
          }
        }
      });
    }
  });
}

export function finishGame(session) {
  session.status = 'podium';
  session.doneReason = null;
  const top3 = ranking(session).slice(0, 3);
  publish(session, 'all', 'podium', { top3 });
  publish(session, 'all', 'phase', { phase: 'podium' });
  db.prepare('UPDATE sessions SET status = ?, ended_at = ? WHERE id = ?').run(
    'done', Math.floor(Date.now() / 1000), session.id
  );

  clearSessionTimers(session);
  defer(session, podiumHoldMs(), () => {
    const cur = liveSessions.get(session.id);
    if (cur && cur.status === 'podium') {
      revealResults(cur);
    }
  });
}

// 'Finish & Show Results' on the podium: the game already CONCLUDED naturally
// (doneReason=null) — this just skips the podium hold and shows the final
// results. It is NOT a host-end: players must see the champion + FULL RESULTS,
// never 'Session Ended / try again'. (Regression: the button used to call
// endSession, which set doneReason='host' and flipped the player's terminal
// page to the aborted-game wording on a completed game.)
export function finishPodium(sessionId) {
  const session = liveSessions.get(sessionId);
  if (session && session.status === 'podium') {
    clearSessionTimers(session);
    revealResults(session);
  }
  return session;
}

function revealResults(session) {
  const cur = liveSessions.get(session.id);
  if (!cur || cur.status !== 'podium') return;
  finishDone(cur);
}

// Player-safe 'done' payload: rank + total only. The FULL results array goes
// ONLY to the host room. At 2000+ players a full ranking (~170KB) pushed to
// every phone × 2000 sockets = a ~350MB fan-out right after the podium — it
// floods the venue network and phones stall on 'done' (measured: 154/2100
// received it pre-fix). Players only ever render their own rank.
function doneForPlayer(session, playerId) {
  const results = ranking(session);
  const idx = results.findIndex((r) => r.playerId === playerId);
  return {
    rank: idx >= 0 ? idx + 1 : null,
    totalPlayers: results.length,
    ended: session.doneReason === 'host',
    reason: session.doneReason || undefined,
  };
}

/** Terminal broadcast: host gets the full ranking, each player just their rank. */
function finishDone(cur) {
  cur.status = 'done';
  // Land any queued archive rows (e.g. host ended mid-burst) before teardown.
  flushAnswers();
  const ended = cur.doneReason === 'host';
  const reason = cur.doneReason || undefined;
  // ONE ranking (not one per player — ranking() is O(n log n), and a
  // per-player loop was the hidden stall: the host's done fired while the
  // server was still grinding through 2100×sort for the player payloads).
  const results = ranking(cur);
  const rankByPlayer = new Map(results.map((r, i) => [r.playerId, i + 1]));
  const payloads = new Map();
  for (const pid of cur.players.keys()) {
    payloads.set(pid, { rank: rankByPlayer.get(pid) ?? null, totalPlayers: results.length, ended, reason });
  }
  publish(cur, 'host', 'done', { results, ended, reason });
  for (const [pid, payload] of payloads) {
    publish(cur, 'player:' + pid, 'done', payload);
  }
  publish(cur, 'all', 'phase', { phase: 'done' });
}

export function ranking(session) {
  return [...session.playerStates.entries()]
    .map(([playerId, st]) => ({
      playerId,
      nickname: session.players.get(playerId)?.nickname || 'Unknown',
      total: st.total,
      correct: st.correct,
    }))
    .filter((r) => !session.players.get(r.playerId)?.kicked)
    .sort((a, b) => b.total - a.total || a.correct - b.correct);
}

export function endSession(sessionId) {
  const session = liveSessions.get(sessionId);
  if (!session) return;
  cancelHostLostEnd(sessionId);
  clearSessionTimers(session);
  session.status = 'done';
  session.doneReason = 'host';
  db.prepare('UPDATE sessions SET status = ?, ended_at = ? WHERE id = ?').run(
    'done', Math.floor(Date.now() / 1000), session.id
  );
  // Payload FIRST, then the phase — clients render the done block atomically.
  // Player-safe payloads (rank, not the full table) so 2000 phones don't each
  // download the whole ranking at the worst moment.
  finishDone(session);
}

/** Snapshot of everything a reconnecting player needs to redraw the UI. */
export function playerStateSnapshot(session, playerId) {
  const state = session.playerStates.get(playerId);
  const round = session.liveRound;
  const answered = round?.answered.get(playerId) || null;
  const myAnswer = answered
    ? { choice: answered.choice, correct: answered.correct, points: answered.points, streak: answered.streak }
    : null;

  // The current question is relevant for question AND reveal (the reveal screen
  // re-renders the tiles), so include it whenever a question has been opened.
  let question = null;
  if (session.questionIndex >= 0 && session.status !== 'lobby' && session.status !== 'countdown') {
    const q = session.quiz.questions[session.questionIndex];
    if (q) {
      question = {
        index: session.questionIndex,
        total: session.quiz.questions.length,
        type: q.type,
        prompt: q.prompt,
        timeLimit: q.time_limit,
        deadline: round?.deadline ?? 0,
        serverTime: round?.startedAt ?? 0,
        options: q.options.map((o, i) => ({ id: i, text: o.text })),
      };
    }
  }

  return {
    status: session.status,
    // Fresh server clock so a resumed client can (re)calibrate its offset
    // against NOW, not against the round's startedAt (a stale offset made the
    // reveal gate fire early/late for reconnecting players).
    serverTime: Date.now(),
    pin: session.pin,
    quizTitle: session.quiz.title,
    questionIndex: session.questionIndex,
    totalQuestions: session.quiz.questions.length,
    countdownDeadline: session.status === 'countdown' ? session.countdownDeadline : undefined,
    countdownDuration: session.status === 'countdown' ? countdownMs() : undefined,
    myAnswer,
    total: state?.total || 0,
    correctCount: state?.correct || 0,
    answeredCount: round?.answered.size || 0,
    playerCount: session.players.size,
    question,
    correctChoice: session.status === 'reveal' || session.status === 'scoreboard'
      ? session.quiz.questions[session.questionIndex]?.options.findIndex((o) => o.correct)
      : undefined,
    // Extra data so a reconnect mid-scoreboard/podium/done redraws fully.
    scoreboardTop: session.status === 'scoreboard' ? ranking(session).slice(0, 5) : undefined,
    podium: session.status === 'podium' ? { top3: ranking(session).slice(0, 3) } : undefined,
    // 'done' carries the same shape as the live done event so a resumed/refreshed
    // player lands on the SAME terminal screen (host-ended vs. natural finish):
    // with `reason: 'host'` the client shows a professional "session ended"
    // screen instead of the champion rank (the game was never concluded).
    // Player-safe: rank + total, never the full ranking table (scale fix).
    done: session.status === 'done' ? doneForPlayer(session, playerId) : undefined,
  };
}

export function sessionSummary(sessionId) {
  const session = liveSessions.get(sessionId);
  if (!session) return null;
  return {
    id: session.id,
    pin: session.pin,
    status: session.status,
    questionIndex: session.questionIndex,
    locked: session.locked,
    quizTitle: session.quiz.title,
    playerCount: session.players.size,
    players: [...session.players.values()].map(publicPlayer),
  };
}
