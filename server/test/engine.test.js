import { test } from 'node:test';
import assert from 'node:assert/strict';

// Make the pre-question countdown near-instant in tests (set before import).
process.env.COUNTDOWN_MS = '30';

import { db, closeDb } from '../src/db.js';
import * as engine from '../src/engine.js';
import { computePoints } from '../src/engine.js';

const ADMIN = process.env.ADMIN_PIN || '000000';

// Wire a no-op emitter (tests assert on returned values, not socket events)
engine.setEmitter(() => {});

test('computePoints: instant answer = full points, late = half', () => {
  assert.equal(computePoints(1000, 0, 20000), 1000);
  assert.equal(computePoints(1000, 250, 20000), 1000);
  // at deadline -> 1000 * (1 - 0.5) = 500
  assert.equal(computePoints(1000, 20000, 20000), 500);
  // midpoint -> 1000 * (1 - 0.25) = 750
  assert.equal(computePoints(1000, 10000, 20000), 750);
});

test('quiz CRUD: create, save with questions, list, get', () => {
  const quiz = engine.createQuiz('Test Quiz');
  const saved = engine.saveQuiz({
    id: quiz.id,
    title: 'Test Quiz v2',
    questions: [
      { type: 'mc', prompt: 'Q1', time_limit: 20, points: 1000, options: [
        { text: 'A', correct: true }, { text: 'B', correct: false } ] },
      { type: 'tf', prompt: 'Q2', time_limit: 20, points: 1000, options: [
        { text: 'True', correct: false }, { text: 'False', correct: true } ] },
    ],
  });
  assert.equal(saved.title, 'Test Quiz v2');
  assert.equal(saved.questions.length, 2);
  assert.equal(saved.questions[0].options[0].correct, true);
  const listed = engine.listQuizzes();
  assert.ok(listed.some((q) => q.id === quiz.id));
  engine.deleteQuiz(quiz.id);
  assert.equal(engine.getQuiz(quiz.id), null);
});

test('full game flow: join -> start -> answer -> scoring -> rank', async () => {
  const quiz = engine.createQuiz('Flow Quiz');
  engine.saveQuiz({
    id: quiz.id,
    title: 'Flow Quiz',
    questions: [
      { type: 'mc', prompt: 'Capital of Nigeria?', time_limit: 20, points: 1000, options: [
        { text: 'Lagos', correct: false }, { text: 'Abuja', correct: true },
        { text: 'Kano', correct: false }, { text: 'Ibadan', correct: false } ] },
    ],
  });

  const session = engine.createSession({ quizId: quiz.id, hostId: null, adminPin: ADMIN });

  // two players join
  const p1 = engine.joinPlayer({ sessionId: session.id, nickname: 'Alpha', resumeToken: null, socketId: 's1' });
  const p2 = engine.joinPlayer({ sessionId: session.id, nickname: 'Bravo', resumeToken: null, socketId: 's2' });

  engine.startGame(session.id);
  // Start now enters a brief countdown phase, then auto-opens Q1.
  assert.equal(session.status, 'countdown');
  assert.ok(session.countdownDeadline > Date.now());
  await new Promise((r) => setTimeout(r, 80)); // let the countdown timer fire
  assert.equal(session.status, 'question');

  // p1 answers correctly and fast -> full points; p2 answers wrong
  const r1 = engine.submitAnswer(session.id, p1.player.id, 1);
  assert.equal(r1.ok, true);
  assert.equal(r1.correct, true);
  assert.equal(r1.points, 1000);

  const r2 = engine.submitAnswer(session.id, p2.player.id, 0);
  assert.equal(r2.ok, true);
  assert.equal(r2.correct, false);
  assert.equal(r2.points, 0);

  // duplicate answer rejected
  const dup = engine.submitAnswer(session.id, p1.player.id, 2);
  assert.equal(dup.ok, false);
  assert.equal(dup.reason, 'ALREADY_ANSWERED');

  // invalid choice rejected (use a fresh 3rd player who hasn't answered)
  const p3 = engine.joinPlayer({ sessionId: session.id, nickname: 'Charlie', resumeToken: null, socketId: 's4' });
  const bad = engine.submitAnswer(session.id, p3.player.id, 9);
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'BAD_CHOICE');

  // ranks: Alpha 1000, Bravo 0
  const rank = engine.ranking(session);
  assert.equal(rank[0].nickname, 'Alpha');
  assert.equal(rank[0].total, 1000);
  assert.equal(rank[1].nickname, 'Bravo');
  assert.equal(rank[1].total, 0);

  // rejoin with resumeToken restores identity + score
  const resumed = engine.joinPlayer({
    sessionId: session.id,
    nickname: 'SomethingElse',
    resumeToken: p1.player.resumeToken,
    socketId: 's3',
  });
  assert.equal(resumed.player.id, p1.player.id);
  assert.equal(session.playerStates.get(p1.player.id).total, 1000);

  engine.endSession(session.id);
  engine.deleteQuiz(quiz.id);
});

test('answer after deadline is rejected', async () => {
  const quiz = engine.createQuiz('Deadline Quiz');
  engine.saveQuiz({
    id: quiz.id,
    title: 'Deadline Quiz',
    questions: [
      { type: 'mc', prompt: 'Q', time_limit: 1, points: 1000, options: [
        { text: 'A', correct: true }, { text: 'B', correct: false } ] },
    ],
  });
  const session = engine.createSession({ quizId: quiz.id, hostId: null, adminPin: ADMIN });
  const p = engine.joinPlayer({ sessionId: session.id, nickname: 'Late', resumeToken: null, socketId: 's1' });
  engine.startGame(session.id);
  // time_limit=1 => deadline at ~1000ms, round auto-closes at ~1800ms.
  // Answer at ~1300ms is past the deadline but the round is still open => CLOSED.
  await new Promise((r) => setTimeout(r, 1300));
  const res = engine.submitAnswer(session.id, p.player.id, 0);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'CLOSED');
  engine.endSession(session.id);
  engine.deleteQuiz(quiz.id);
});

test.after(() => closeDb());
