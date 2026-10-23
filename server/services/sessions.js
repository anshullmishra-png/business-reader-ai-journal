// Reading sessions. Every query is scoped to the signed-in user.
import { db, now } from '../db/index.js';
import { detectSource } from '../ai/taxonomy.js';
import { countWords } from './extract.js';
import { enqueue } from '../jobs/runner.js';
import { ensureRelated } from './related.js';
import { httpError } from './auth.js';

export { httpError };
export const MIN_ARTICLE_WORDS = 300;

/** Midnight in the reader's timezone (offset in minutes, as from Date#getTimezoneOffset). */
export function localMidnight(tzOffset = 0, daysAgo = 0) {
  const local = new Date(Date.now() - tzOffset * 60000);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() + tzOffset * 60000 - daysAgo * 86400000).toISOString();
}

/**
 * Creates a session from captured article text and starts tagging and related
 * reading in the background. The same URL captured twice in a day returns the
 * existing session.
 */
export async function createSession(userId, { url = null, title, author = null, published_at = null, text }, { tzOffset = 0 } = {}) {
  const clean = String(text).replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (url) {
    const existing = await db.get(
      'SELECT id FROM sessions WHERE user_id = ? AND url = ? AND created_at >= ? ORDER BY id DESC LIMIT 1',
      userId, url, localMidnight(tzOffset));
    if (existing) return { id: existing.id, existing: true };
  }
  const t = now();
  const { lastInsertRowid: id } = await db.run(`
    INSERT INTO sessions (user_id, url, source, title, author, published_at, article_text, word_count, stage, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'write', ?, ?)`,
    userId, url, url ? detectSource(url) : 'other',
    String(title).trim().slice(0, 300) || 'Untitled article',
    author?.trim().slice(0, 200) || null,
    published_at?.trim().slice(0, 40) || null,
    clean, countWords(clean), t, t);
  await enqueue('tag_article', { userId, sessionId: id });
  await ensureRelated(userId, id);
  return { id, existing: false };
}

const PUBLIC_COLUMNS = `id, url, source, title, author, published_at, word_count, tags, tags_status, related_status, stage,
  comprehension_text, comprehension_seconds, comprehension_submitted_at, comprehension_eval,
  comprehension_score, interview_score, overall_score, verdict, created_at, updated_at`;

function hydrate(row) {
  if (!row) return null;
  for (const k of ['tags', 'comprehension_eval', 'verdict']) row[k] = row[k] ? JSON.parse(row[k]) : null;
  return row;
}

// Article text is never sent to the browser: it only grounds the AI.
export async function getSession(userId, id) {
  return hydrate(await db.get(`SELECT ${PUBLIC_COLUMNS} FROM sessions WHERE id = ? AND user_id = ?`, id, userId));
}

export async function requireSession(userId, id) {
  const s = await getSession(userId, id);
  if (!s) throw httpError(404, 'Session not found');
  return s;
}

export async function listSessions(userId, { since = null, limit = 300 } = {}) {
  const rows = since
    ? await db.all(`SELECT ${PUBLIC_COLUMNS} FROM sessions WHERE user_id = ? AND created_at >= ? ORDER BY created_at DESC LIMIT ?`, userId, since, limit)
    : await db.all(`SELECT ${PUBLIC_COLUMNS} FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`, userId, limit);
  return rows.map(hydrate);
}

export async function setTags(userId, id, tags, status = 'ready') {
  await db.run('UPDATE sessions SET tags = ?, tags_status = ?, updated_at = ? WHERE id = ? AND user_id = ?',
    tags ? JSON.stringify(tags) : null, status, now(), id, userId);
}

export async function retryTagging(userId, id) {
  await requireSession(userId, id);
  await db.run("UPDATE sessions SET tags_status = 'pending', updated_at = ? WHERE id = ?", now(), id);
  await enqueue('tag_article', { userId, sessionId: id });
}

// Children are removed explicitly (foreign-key cascades aren't guaranteed on every libSQL connection).
export async function deleteSession(userId, id) {
  await requireSession(userId, id);
  await db.batch([
    ['DELETE FROM questions WHERE set_id IN (SELECT id FROM question_sets WHERE session_id = ?)', id],
    ['DELETE FROM question_sets WHERE session_id = ?', id],
    ['DELETE FROM related_items WHERE session_id = ?', id],
    ['DELETE FROM jobs WHERE session_id = ?', id],
    ['UPDATE glossary_terms SET first_session_id = NULL WHERE first_session_id = ?', id],
    ['UPDATE glossary_lookups SET session_id = NULL WHERE session_id = ?', id],
    ['UPDATE difficulty_history SET session_id = NULL WHERE session_id = ?', id],
    ['DELETE FROM sessions WHERE id = ? AND user_id = ?', id, userId],
  ]);
}

/**
 * Locks the comprehension and moves the session to Explore. The UPDATE only
 * matches while the session is still in the write stage, so a second submit
 * (or any later edit) gets 409.
 */
export async function submitComprehension(userId, id, { text, seconds }) {
  const t = now();
  const { changes } = await db.run(`
    UPDATE sessions SET comprehension_text = ?, comprehension_seconds = ?, comprehension_submitted_at = ?,
                        stage = 'explore', updated_at = ?
    WHERE id = ? AND user_id = ? AND stage = 'write'`, text, seconds, t, t, id, userId);
  if (changes === 0) {
    await requireSession(userId, id);
    throw httpError(409, 'Your comprehension is already submitted and locked.');
  }
}

/** Explore → Interview, only once the main question set is ready. */
export async function startInterview(userId, id) {
  const { stage } = await requireSession(userId, id);
  if (stage === 'write') throw httpError(409, 'Submit your comprehension first.');
  if (stage !== 'explore') throw httpError(409, 'The interview has already started.');
  const set = await db.get("SELECT id, gen_status FROM question_sets WHERE session_id = ? AND kind = 'main'", id);
  if (!set || set.gen_status !== 'ready') throw httpError(409, 'Your questions are still being prepared.');
  const t = now();
  const { changes } = await db.run(`UPDATE sessions SET stage = 'interview', updated_at = ? WHERE id = ? AND stage = 'explore'`, t, id);
  if (changes === 0) throw httpError(409, 'The interview has already started.');
  await db.run("UPDATE question_sets SET status = 'in_progress', started_at = ? WHERE id = ?", t, set.id);
}

export async function getArticleText(id) {
  return (await db.get('SELECT article_text FROM sessions WHERE id = ?', id))?.article_text ?? '';
}
