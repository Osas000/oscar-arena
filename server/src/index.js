import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import dotenv from 'dotenv';

import { ENV, uuid } from './config.js';
import * as engine from './engine.js';
import { closeDb } from './db.js';
import { getAdminPin, setAdminPin } from './settings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  transports: ['websocket', 'polling'], // polling fallback for networks that drop WS
  pingTimeout: 30000,
  pingInterval: 20000,
});

// Wire the emitter so the engine can push to rooms. Targeting:
//   target 'all'            -> `session:<id>`
//   target 'host'           -> `session-h:<id>`
//   target 'player:<pid>'   -> socket(s) registered to that player
engine.setEmitter((sessionId, target, event, payload) => {
  if (target === 'all') {
    io.to(`session:${sessionId}`).emit(event, payload);
  } else if (target === 'host') {
    io.to(`session-h:${sessionId}`).emit(event, payload);
  } else if (target && target.startsWith('player:')) {
    const playerId = target.slice('player:'.length);
    io.to(`player:${playerId}:${sessionId}`).emit(event, payload);
  }
});

// ------------------------- HTTP API (quiz + host auth) ---------------------
app.get('/healthz', (_req, res) => res.json({ ok: true, heap: process.memoryUsage().heapUsed, rss: process.memoryUsage().rss }));

// Player identity exposed to the client (no resumeToken in the brief; the token
// is returned separately on join and stored by the client for reconnection).
const publicPlayerBrief = (p) => ({ id: p.id, nickname: p.nickname, kicked: p.kicked });

// Host admin auth — a shared PIN gates the builder + hosting.
const hostAuth = (req, res, next) => {
  const pin = req.headers['x-admin-pin'];
  if (pin === getAdminPin()) return next();
  return res.status(401).json({ error: 'Unauthorized' });
};

// Change the admin PIN (must present the CURRENT pin; returns the new one).
app.post('/api/admin/pin', (req, res) => {
  const { currentPin, newPin } = req.body || {};
  if (currentPin !== getAdminPin()) {
    return res.status(401).json({ error: 'Current PIN is incorrect' });
  }
  try {
    setAdminPin(String(newPin || '').trim());
    res.json({ ok: true, message: 'Admin PIN updated' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/quizzes', hostAuth, (_req, res) => {
  res.json(engine.listQuizzes());
});

app.post('/api/quizzes', hostAuth, (req, res) => {
  const { title } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'title required' });
  res.json(engine.createQuiz(String(title).trim()));
});

app.get('/api/quizzes/:id', hostAuth, (req, res) => {
  const quiz = engine.getQuiz(req.params.id);
  if (!quiz) return res.status(404).json({ error: 'Not found' });
  res.json(quiz);
});

// saveQuiz writes a full replacement; body = { id, title, questions:[...] }
app.put('/api/quizzes/:id', hostAuth, (req, res) => {
  const body = req.body || {};
  if (!body.title) return res.status(400).json({ error: 'title required' });
  const quiz = engine.saveQuiz({
    id: req.params.id,
    title: String(body.title).trim(),
    questions: Array.isArray(body.questions) ? body.questions : [],
  });
  res.json(quiz);
});

app.delete('/api/quizzes/:id', hostAuth, (req, res) => {
  engine.deleteQuiz(req.params.id);
  res.json({ ok: true });
});

// Session create/join via HTTP keeps it simple + lets the Socket.IO handshake
// pass through a verifiable id/resumeToken.
app.post('/api/sessions', hostAuth, (req, res) => {
  const { quizId } = req.body || {};
  try {
    const session = engine.createSession({ quizId, hostId: null, adminPin: getAdminPin() });
    res.json(engine.sessionSummary(session.id));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ------------------------------- Socket.IO --------------------------------
io.on('connection', (socket) => {
  // ---- session/host/player joins (this is THE identity exchange) ----
  socket.on('session:summary', ({ sessionId }, ack) => {
    const s = engine.sessionSummary(sessionId);
    ack(s ? { ok: true, session: s } : { ok: false, error: 'No session' });
  });

  socket.on('host:join', ({ sessionId, adminPin }, ack) => {
    try {
      engine.hostAttach(sessionId, socket.id, adminPin ?? getAdminPin());
      socket.join(`session:${sessionId}`);
      socket.join(`session-h:${sessionId}`);
      const s = engine.getLive(sessionId);
      const live = s ? liveState(s) : null;
      ack({ ok: true, session: engine.sessionSummary(sessionId), state: live, live: liveStateFull(s) });
    } catch (e) {
      ack({ ok: false, error: e.message });
    }
  });

  socket.on('player:join', ({ sessionId, nickname, resumeToken }, ack) => {
    try {
      const res = engine.joinPlayer({ sessionId, nickname, resumeToken, socketId: socket.id });
      socket.join(`session:${sessionId}`);
      socket.join(`player:${res.player.id}:${sessionId}`);
      ack({
        ok: true,
        playerId: res.player.id,
        player: publicPlayerBrief(res.player),
        resumeToken: res.player.resumeToken,
        session: engine.sessionSummary(sessionId),
        // Critical for resume-after-refresh: return the live snapshot so the
        // client can restore the current phase/question and their answer state.
        // Without playerId + state, a reconnected player was stranded mid-game
        // (playerId was undefined -> every answer rejected as NOT_PLAYER).
        state: engine.playerStateSnapshot(engine.getLive(sessionId), res.player.id),
      });
    } catch (e) {
      ack({ ok: false, error: e.message, code: e.code });
    }
  });

  // Players join by the 6-digit PIN shown on the host screen (the Kahoot model).
  socket.on('player:join_pin', ({ pin, nickname, resumeToken }, ack) => {
    try {
      const session = engine.getSessionByPin(String(pin || '').trim());
      if (!session) return ack({ ok: false, error: 'No game found for that PIN', code: 'NO_GAME' });
      const res = engine.joinPlayer({
        sessionId: session.id, nickname, resumeToken, socketId: socket.id,
      });
      socket.join(`session:${session.id}`);
      socket.join(`player:${res.player.id}:${session.id}`);
      ack({
        ok: true,
        playerId: res.player.id,
        nickname: res.player.nickname,
        resumeToken: res.player.resumeToken,
        session: engine.sessionSummary(session.id),
        state: engine.playerStateSnapshot(session, res.player.id),
      });
    } catch (e) {
      ack({ ok: false, error: e.message, code: e.code });
    }
  });

  // ---- host controls ----
  socket.on('host:start', ({ sessionId }, ack) => {
    try {
      engine.startGame(sessionId);
      ack && ack({ ok: true });
    } catch (e) {
      ack && ack({ ok: false, error: e.message });
    }
  });

  socket.on('host:next', ({ sessionId }, ack) => {
    try {
      engine.nextQuestion(sessionId);
      ack && ack({ ok: true });
    } catch (e) {
      ack && ack({ ok: false, error: e.message });
    }
  });

  socket.on('host:kick', ({ sessionId, playerId }, ack) => {
    const s = engine.getLive(sessionId);
    const player = s && s.players.get(playerId);
    engine.kickPlayer(sessionId, playerId);
    if (player) socket.to(`player:${playerId}:${sessionId}`).emit('kicked');
    // Ack'd so the host UI always gets an answer — a fire-and-forget kick can
    // vanish into a reconnecting socket and leave the host clicking twice.
    ack && ack({ ok: true });
  });

  socket.on('host:lock', ({ sessionId, locked }, ack) => {
    engine.setLobbyLocked(sessionId, Boolean(locked));
    ack && ack({ ok: true });
  });

  socket.on('host:end', ({ sessionId }, ack) => {
    engine.endSession(sessionId);
    ack && ack({ ok: true });
  });

  // 'Finish & Show Results' from a natural podium — the game already
  // concluded; this only skips the podium hold. It must NOT mark the game
  // host-ended (that would show players 'Session Ended / try again' instead
  // of the champion + FULL RESULTS on a completed game).
  socket.on('host:finish', ({ sessionId }, ack) => {
    engine.finishPodium(sessionId);
    ack && ack({ ok: true });
  });

  // ---- player answer ----
  socket.on('player:answer', ({ sessionId, playerId, choice }, ack) => {
    const res = engine.submitAnswer(sessionId, playerId, choice);
    ack && ack({ ok: res.ok, reason: res.reason });
  });

  // ---- cleanup on disconnect ----
  socket.on('disconnect', () => {
    // We don't know which session a socket belonged to without tracking; the
    // engine's maps hold socketId->role, so scan live sessions lightly.
    engine.playerDisconnectAny(socket.id);
  });
});

function liveState(s) {
  if (!s) return null;
  return {
    status: s.status,
    questionIndex: s.questionIndex,
    playerCount: s.players.size,
    pin: s.pin,
    players: [...s.players.values()].map((p) => ({ id: p.id, nickname: p.nickname })),
  };
}

// Full phase detail for a reconnecting host (mirrors the event stream).
function liveStateFull(s) {
  if (!s) return null;
  const out = liveState(s);
  const q = s.questionIndex >= 0 ? s.quiz.questions[s.questionIndex] : null;
  out.totalQuestions = s.quiz.questions.length;
  out.quizTitle = s.quiz.title;
  // Fresh server clock so a resumed/refreshed host recalibrates its offset
  // (adoptHostState without this rendered the countdown on the RAW device
  // clock — a laptop behind the server showed "6,5,4…" instead of "5,4,3…").
  out.serverTime = Date.now();
  if (s.status === 'countdown') {
    out.countdownDeadline = s.countdownDeadline;
    out.countdownDuration = engine.countdownDurationMs();
  }
  if (s.status === 'question' && s.liveRound && q) {
    out.question = {
      index: s.questionIndex, total: s.quiz.questions.length,
      type: q.type, prompt: q.prompt, timeLimit: q.time_limit,
      deadline: s.liveRound.deadline,
      options: q.options.map((o, i) => ({ id: i, text: o.text })),
    };
    out.answeredCount = s.liveRound.answered.size;
  }
  if (s.status === 'reveal' && s.liveRound && q) {
    const distribution = [0, 0, 0, 0, 0, 0];
    for (const a of s.liveRound.answered.values()) if (a.choice >= 0) distribution[a.choice] += 1;
    out.correctChoice = q.options.findIndex((o) => o.correct);
    out.distribution = distribution;
    out.answeredCount = s.liveRound.answered.size;
  }
  if (s.status === 'scoreboard') {
    out.correctChoice = q ? q.options.findIndex((o) => o.correct) : -1;
    out.scoreboard = { top: engine.ranking(s).slice(0, 5), full: engine.ranking(s) };
  }
  if (s.status === 'podium') out.podium = { top3: engine.ranking(s).slice(0, 3) };
  if (s.status === 'done') out.done = { results: engine.ranking(s), ended: s.doneReason === 'host', reason: s.doneReason || undefined };
  return out;
}

// ---------------- Static client (production) ----------------
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist, { maxAge: '1y', etag: true, setHeaders: (res, p) => {
    if (p.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  }}));
  app.use((_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

httpServer.listen(ENV.PORT, () => {
  console.log(`OSCAR ARENA server listening on :${ENV.PORT} (${ENV.NODE_ENV})`);
  try {
    const { seeded } = engine.seedQuizzesIfEmpty();
    if (seeded > 0) console.log(`Seeded ${seeded} starter quiz(zes) into empty DB`);
  } catch (err) {
    console.warn('Seed skipped:', err.message);
  }
});

function shutdown() {
  closeDb();
  httpServer.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Test hook: let an in-process suite (node --test) shut the server down so
// the runner's event loop can drain — an open listener (or lingering socket.io
// connections after a failed assert) otherwise hangs the suite forever.
export function closeServerForTests() {
  closeDb();
  try { io.close(); } catch { /* already closed */ }
  httpServer.close();
  // Force-drain any connections that a failed test left open.
  if (typeof httpServer.closeAllConnections === 'function') {
    setTimeout(() => httpServer.closeAllConnections(), 30);
  }
}