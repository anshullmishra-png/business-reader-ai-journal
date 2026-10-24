// Accounts: invite-gated sign-up, scrypt password hashes, and sign-in sessions
// in an httpOnly cookie (only a hash of the token is stored).
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { db, now } from '../db/index.js';
import { config } from '../config.js';

const scrypt = promisify(scryptCb);
export const COOKIE = 'brj_session';
const SESSION_DAYS = 30;

export function httpError(status, message, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra });
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function verifyPassword(password, stored) {
  const [, saltB64, keyB64] = String(stored).split('$');
  if (!saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(key, expected);
}

const sameText = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
export const newCaptureToken = () => randomBytes(24).toString('base64url');

export async function signUp({ name, email, password, invite }) {
  if (!config.inviteCode && !config.paidInviteCode) throw httpError(503, "Sign-up isn't open yet.");
  const plan = planForCode(invite);
  if (!plan) throw httpError(403, "That invite code isn't right.");
  const normalized = email.trim().toLowerCase();
  if (await db.get('SELECT 1 FROM users WHERE email = ?', normalized)) {
    throw httpError(409, 'An account with that email already exists. Sign in instead.');
  }
  const { lastInsertRowid } = await db.run(
    `INSERT INTO users (email, name, password_hash, capture_token, plan, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    normalized, name.trim(), await hashPassword(password), newCaptureToken(), plan, now());
  return createAuthSession(lastInsertRowid);
}

/** 'paid' for the paid code, 'free' for the free code, otherwise null. */
function planForCode(code) {
  const c = String(code ?? '').trim();
  if (config.paidInviteCode && sameText(c, config.paidInviteCode)) return 'paid';
  if (config.inviteCode && sameText(c, config.inviteCode)) return 'free';
  return null;
}

/** Moves an account to the paid plan when the paid code is entered. */
export async function redeemPaidCode(userId, code) {
  if (planForCode(code) !== 'paid') throw httpError(403, "That code isn't right.");
  await db.run("UPDATE users SET plan = 'paid' WHERE id = ?", userId);
}

export async function signIn({ email, password }) {
  const user = await db.get('SELECT id, password_hash FROM users WHERE email = ?', email.trim().toLowerCase());
  // Same work and message whether the email exists or not.
  const ok = user ? await verifyPassword(password, user.password_hash) : (await scrypt(password, 'x', 64), false);
  if (!ok) throw httpError(401, 'Wrong email or password.');
  return createAuthSession(user.id);
}

async function createAuthSession(userId) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await db.run('INSERT INTO auth_sessions (user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)',
    userId, sha256(token), now(), expires);
  return { token, expires };
}

export async function signOut(token) {
  if (token) await db.run('DELETE FROM auth_sessions WHERE token_hash = ?', sha256(token));
}

export async function userForToken(token) {
  if (!token) return null;
  return db.get(`SELECT u.id, u.email, u.name, u.timer_seconds, u.template_default, u.difficulty_level,
                        u.capture_token, u.extension_origin, u.plan
                 FROM auth_sessions a JOIN users u ON u.id = a.user_id
                 WHERE a.token_hash = ? AND a.expires_at > ?`, sha256(token), now());
}

export function readCookie(req, name = COOKIE) {
  const header = req.headers.cookie ?? '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function setSessionCookie(req, res, { token, expires }) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(expires).toUTCString()}${secure ? '; Secure' : ''}`);
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/** Express middleware: 401 unless signed in; sets req.user. */
export async function requireUser(req, res, next) {
  const user = await userForToken(readCookie(req));
  if (!user) return res.status(401).json({ error: 'Please sign in.', code: 'signed_out' });
  req.user = user;
  next();
}

// ---- Per-user settings (stored on the users row) ----
export function publicUser(u) {
  return {
    id: u.id, email: u.email, name: u.name, plan: u.plan,
    timer_seconds: u.timer_seconds, template_default: Boolean(u.template_default),
    difficulty_level: u.difficulty_level, capture_token: u.capture_token, extension_origin: u.extension_origin,
  };
}

export async function updateSettings(userId, patch) {
  const map = { name: 'name', timer_seconds: 'timer_seconds', template_default: 'template_default' };
  for (const [k, col] of Object.entries(map)) {
    if (patch[k] === undefined) continue;
    const v = typeof patch[k] === 'boolean' ? (patch[k] ? 1 : 0) : patch[k];
    await db.run(`UPDATE users SET ${col} = ? WHERE id = ?`, v, userId);
  }
}

export async function regenerateCaptureToken(userId) {
  const token = newCaptureToken();
  await db.run('UPDATE users SET capture_token = ?, extension_origin = NULL WHERE id = ?', token, userId);
  return token;
}
