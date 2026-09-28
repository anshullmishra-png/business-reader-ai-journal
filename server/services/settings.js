// Key/value settings with typed defaults.
import { randomBytes } from 'node:crypto';
import { db } from '../db/index.js';

const DEFAULTS = {
  name: '',
  timer_seconds: 60,
  template_default: false,
  difficulty_level: 3,
  capture_token: null,       // generated on first run
  extension_origin: null,    // pinned by the first valid capture request
};

const getStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
const setStmt = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value');

export function getSetting(key) {
  const row = getStmt.get(key);
  return row ? JSON.parse(row.value) : DEFAULTS[key];
}

export function setSetting(key, value) {
  if (!(key in DEFAULTS)) throw new Error(`Unknown setting: ${key}`);
  setStmt.run(key, JSON.stringify(value));
}

export function getAllSettings() {
  return Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, getSetting(k)]));
}

export function newCaptureToken() {
  const token = randomBytes(24).toString('base64url');
  setSetting('capture_token', token);
  return token;
}

// First-run initialisation.
if (!getSetting('capture_token')) newCaptureToken();
