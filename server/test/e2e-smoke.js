// Full E2E of the game cycle over real Socket.IO + HTTP.
// Run: NODE_ENV=test node test/e2e-smoke.js  (server must already be up)
import { io } from 'socket.io-client';

const BASE = process.env.OSCAR_URL || 'http://localhost:8080';
const QUIZ_ID = process.env.OSCAR_QUIZ_ID || '06c09f3a-fc36-4ee9-9942-acdc06138ff5';
const PASS = (m) => console.log('  ✓ ' + m);
const FAIL = (m) => { console.error('  ✗ ' + m); process.exit(1); };
let done = false;
const finish = (m) => { if (!done) { done = true; console.log(m); process.exit(0); } };

async function api(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-admin-pin': '000000' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
}

let playerIdA = null;
let joinedCount = 0;
let sawCountdown = false;

// Seed the quiz
await api('PUT', `/api/quizzes/${QUIZ_ID}`, {
  id: QUIZ_ID, title: 'Demo Quiz', questions: [
    { type: 'mc', prompt: 'What color is the sky on a clear day?', time_limit: 8, points: 1000,
      options: [{ text: 'Green', correct: false }, { text: 'Blue', correct: true }, { text: 'Red', correct: false }, { text: 'Purple', correct: false }] },
    { type: 'mc', prompt: 'Capital of Nigeria?', time_limit: 8, points: 1000,
      options: [{ text: 'Lagos', correct: false }, { text: 'Abuja', correct: true }] },
  ],
});
PASS('seeded 2-question quiz');

const sess = await api('POST', '/api/sessions', { quizId: QUIZ_ID });
if (!sess.pin) FAIL('session create: ' + JSON.stringify(sess));
PASS('session ready, PIN=' + sess.pin);

// --- Host connects first (drives the game) ---
const ph = io(BASE, { transports: ['websocket'], reconnection: false });
ph.on('connect', () => {
  ph.emit('host:join', { sessionId: sess.id, adminPin: '000000' }, (h) => {
    if (!h.ok) return FAIL('host join: ' + h.error);
    PASS('host attached');
    ph.on('answer_received', (a) => PASS(`host sees answers ${a.answeredCount}/${a.playerCount}`));
    ph.on('scoreboard', (sb) => PASS('host scoreboard: top1=' + (sb.top[0]?.nickname || 'none')));
    ph.on('done', (d) => finish('E2E-OK — ' + d.results.map((r) => r.nickname + '=' + r.total).join(', ')));
    ph.on('countdown', (c) => PASS('host sees countdown (deadline set)'));
    ph.on('phase', (p) => {
      if (p.phase === 'countdown') { sawCountdown = true; PASS('host phase → countdown'); }
      if (p.phase === 'scoreboard') setTimeout(() => ph.emit('host:next', { sessionId: sess.id }), 1200);
      if (p.phase === 'podium') setTimeout(() => ph.emit('host:end', { sessionId: sess.id }), 1500);
    });
  });
  // Wait for BOTH players to join before starting (NO_PLAYERS guard is real).
  const tryStart = () => {
    if (joinedCount >= 2) {
      ph.emit('host:start', { sessionId: sess.id }, (s2) => {
        if (!s2.ok) return FAIL('host start: ' + s2.error);
        PASS('host started game → countdown → Q1');
      });
    } else {
      setTimeout(tryStart, 200);
    }
  };
  setTimeout(tryStart, 800);
});

// --- Player A ---
const pa = io(BASE, { transports: ['websocket'], reconnection: false });
pa.on('connect', () => {
  pa.emit('player:join_pin', { pin: sess.pin, nickname: 'Alpha', resumeToken: null }, (a) => {
    if (!a.ok) return FAIL('join A: ' + a.error);
    playerIdA = a.playerId;
    joinedCount += 1;
    PASS('A joined: ' + a.nickname + ' id=' + playerIdA.slice(0, 6));
    pa.on('question', (q) => {
      PASS(`A sees Q${q.index + 1}/${q.total}: "${q.prompt}"`);
      // Correct answer on q1 is Blue(index 1), on q2 is Abuja(index 1)
      pa.emit('player:answer', { sessionId: sess.id, playerId: playerIdA, choice: q.index === 0 ? 1 : 1 });
    });
    pa.on('your_result', (r) => PASS(`A result: correct=${r.correct} pts=${r.points} total=${r.total}`));
    pa.on('podium', (p) => PASS('A podium: ' + p.top3.map((x) => x.nickname).join(', ')));
  });
});

// --- Player B (jointly) ---
const pb = io(BASE, { transports: ['websocket'], reconnection: false });
pb.on('connect', () => {
  pb.emit('player:join_pin', { pin: sess.pin, nickname: 'Bravo', resumeToken: null }, (b) => {
    if (!b.ok) return FAIL('join B: ' + b.error);
    joinedCount += 1;
    PASS('B joined: ' + b.nickname);
    pb.on('question', (q) => {
      pb.emit('player:answer', { sessionId: sess.id, playerId: b.playerId, choice: q.index === 0 ? 0 : 1 });
    });
    pb.on('your_result', (r) => PASS(`B result: correct=${r.correct} pts=${r.points}`));
    pb.on('podium', (d) => PASS('B podium: ' + d.top3.map((x) => x.nickname).join(', ')));
  });
});

setTimeout(() => FAIL(`TIMEOUT: no podium (sawCountdown=${sawCountdown})`), 60000);