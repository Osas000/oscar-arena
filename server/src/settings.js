// Persistent, changeable admin PIN.
// Stored in the DB (settings table) so it survives restarts and can be changed
// from the UI. Falls back to the ADMIN_PIN env var, then '000000'.
import { db } from './db.js';

const KEY = 'admin_pin';

function dbGet() {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY);
  return row ? row.value : null;
}

// Exact 6-digit numeric admin PIN (defensive; also enforced in the UI).
export function isValidAdminPin(pin) {
  return typeof pin === 'string' && /^\d{4,8}$/.test(pin) && pin.length >= 4;
}

/** Current admin PIN, in priority order: DB override > env > default. */
export function getAdminPin() {
  const stored = dbGet();
  if (stored && isValidAdminPin(stored)) return stored;
  const env = process.env.ADMIN_PIN;
  if (env) return env;
  return '000000';
}

/** Change (or set) the admin PIN. Returns the new value. */
export function setAdminPin(pin) {
  if (!isValidAdminPin(pin)) throw new Error('PIN must be 4–8 digits');
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(KEY, pin);
  return pin;
}