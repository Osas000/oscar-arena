import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from the server/ directory first, then fall back to repo root.
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '.env') });

export const ENV = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: Number(process.env.PORT) || 8080,
  ADMIN_PIN: process.env.ADMIN_PIN || '000000',
  DB_PATH: path.isAbsolute(process.env.DB_PATH || '')
    ? process.env.DB_PATH
    : path.join(__dirname, '..', process.env.DB_PATH || './data/oscar-arena.db'),
};

export function generatePin(length = 6) {
  // crypto-random 0-9, rejecting leading-zero-collision concerns via simple loop
  let pin = '';
  for (let i = 0; i < length; i++) pin += crypto.randomInt(0, 10).toString();
  return pin;
}

export function uuid() {
  return crypto.randomUUID();
}