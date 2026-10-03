/**
 * Load the Edo District Media Summit quiz into Oscar Arena.
 *
 * Written as a module rather than a script because the quiz has to go in
 * through the app's OWN saveQuiz, not hand-rolled SQL. The app owns the
 * schema; a second writer to its tables is how a database ends up with
 * rows the application cannot read back.
 *
 * Safe to run twice: it looks for the quiz by title first and replaces it
 * in place, so re-running after editing the questions updates the one
 * copy rather than filling the host's list with duplicates.
 *
 * Run: node --experimental-strip-types scripts/load-summit-quiz.mts
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const ARENA = process.env.ARENA_DIR ?? 'C:/Users/LENOVO/Pictures/RoyalRangersApp/quiz-arena';
const QUIZ_FILE = process.env.QUIZ_FILE ?? 'C:/Users/LENOVO/ag-media-os/_deck/quiz-questions.json';
const TITLE = process.env.QUIZ_TITLE ?? 'Do the Street Media Summit — LENS';
const TIME_LIMIT = 10;
const POINTS = 1000;

const require = createRequire(`${ARENA}/server/`);
// A Windows absolute path is not a valid ESM specifier; it needs a file:// URL.
const engine = await import(pathToFileURL(`${ARENA}/server/src/engine.js`).href);

const source = JSON.parse(readFileSync(QUIZ_FILE, 'utf8'));
if (!Array.isArray(source) || source.length === 0) {
  throw new Error(`No questions in ${QUIZ_FILE}`);
}

for (const [i, q] of source.entries()) {
  if (!q.question || !Array.isArray(q.options) || q.options.length !== 4) {
    throw new Error(`Question ${i + 1} is not a 4-option question`);
  }
  if (typeof q.correct !== 'number' || q.correct < 0 || q.correct > 3) {
    throw new Error(`Question ${i + 1} has an out-of-range correct index`);
  }
}

const questions = source.map((q) => ({
  type: 'mc',
  prompt: q.question,
  time_limit: TIME_LIMIT,
  points: POINTS,
  options: q.options.map((text, i) => ({ text, correct: i === q.correct })),
}));

/*
 * Every question having its answer in the same position is the single most
 * common way a multiple-choice quiz gets ruined, and it is invisible to a
 * read-through. Someone who taps the same tile twenty times takes the top
 * place. The engine has no opinion about this, so the check lives here.
 */
const spread = new Map();
for (const q of questions) {
  const at = q.options.findIndex((o) => o.correct);
  spread.set(at, (spread.get(at) ?? 0) + 1);
}
const worst = Math.max(...spread.values());
if (worst > Math.ceil(questions.length / 3)) {
  throw new Error(
    `Answer spread is too lopsided (${worst} of ${questions.length} on one position). ` +
      `Re-shuffle the source file before loading.`,
  );
}

const existing = engine.listQuizzes();
const prior = existing.find((q) => q.title === TITLE);
if (prior) {
  engine.deleteQuiz(prior.id);
  process.stdout.write(`removed the earlier copy "${prior.title}" (${prior.questionCount} questions)\n`);
}

engine.saveQuiz({ id: randomUUID(), title: TITLE, questions });

const after = engine.listQuizzes();
const saved = after.find((q) => q.title === TITLE);
if (!saved) throw new Error('The quiz did not appear after saving. The engine rejected it.');


const full = engine.getQuiz(saved.id);

process.stdout.write(`\nloaded "${saved.title}"\n`);
process.stdout.write(`  id           ${saved.id}\n`);
process.stdout.write(`  questions    ${full.questions.length}\n`);
process.stdout.write(`  time limit   ${full.questions.every((q) => q.time_limit === TIME_LIMIT) ? `${TIME_LIMIT}s on every question` : 'MISMATCH'}\n`);
process.stdout.write(`  points       ${full.questions.every((q) => q.points === POINTS) ? `${POINTS} on every question` : 'MISMATCH'}\n`);
process.stdout.write(`  one correct  ${full.questions.every((q) => q.options.filter((o) => o.correct).length === 1) ? 'yes, on every question' : 'MISMATCH'}\n`);
process.stdout.write(`  spread       ${[...spread.entries()].sort().map(([k, v]) => `ABCD'[k]=${v}`).join('  ')}\n\n`);

process.stdout.write(`quizzes now on the host screen:\n`);
for (const q of after) process.stdout.write(`  - ${q.title} (${q.questionCount} questions)\n`);