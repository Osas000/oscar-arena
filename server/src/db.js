import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { ENV } from './config.js';

// Ensure the data directory exists
fs.mkdirSync(path.dirname(ENV.DB_PATH), { recursive: true });

export const db = new Database(ENV.DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS quizzes (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS questions (
  id          TEXT PRIMARY KEY,
  quiz_id     TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  type        TEXT NOT NULL DEFAULT 'mc',          -- 'mc' | 'tf'
  prompt      TEXT NOT NULL,
  time_limit  INTEGER NOT NULL DEFAULT 20,          -- seconds
  points      INTEGER NOT NULL DEFAULT 1000,        -- max points for the question
  options     TEXT NOT NULL DEFAULT '[]',           -- JSON array [{text, correct}]
  UNIQUE (quiz_id, position)
);

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  quiz_id      TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  pin          TEXT NOT NULL UNIQUE,
  status       TEXT NOT NULL DEFAULT 'lobby',       -- lobby|question|reveal|scoreboard|podium|done
  question_index INTEGER NOT NULL DEFAULT -1,
  question_deadline INTEGER,                        -- unix ms when current question closes
  locked       INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  ended_at     INTEGER
);

CREATE TABLE IF NOT EXISTS players (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  nickname     TEXT NOT NULL,
  resume_token TEXT NOT NULL,
  connected    INTEGER NOT NULL DEFAULT 0,
  kicked       INTEGER NOT NULL DEFAULT 0,
  joined_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (session_id, nickname)
);

CREATE TABLE IF NOT EXISTS answers (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  player_id    TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  question_id  TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  question_index INTEGER NOT NULL,
  choice       INTEGER NOT NULL,
  correct      INTEGER NOT NULL,
  points_awarded INTEGER NOT NULL DEFAULT 0,
  responded_ms INTEGER NOT NULL,                    -- ms after question start
  streak       INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (session_id, player_id, question_index)
);

CREATE INDEX IF NOT EXISTS idx_players_session ON players(session_id);
CREATE INDEX IF NOT EXISTS idx_answers_session ON answers(session_id, question_index);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

export function closeDb() {
  db.close();
}