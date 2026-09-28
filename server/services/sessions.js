import { db, now } from '../db/index.js';
import { detectSource } from '../ai/taxonomy.js';
import { countWords } from './extract.js';
import { enqueue } from '../jobs/runner.js';

export const MIN_ARTICLE_WORDS = 300;

export function httpError(status, message, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra });
}

const insertSession = db.prepare(`
  INSERT INTO sessions (url, source, title, author, published_at, article_text, word_count, stage, created_at, updated_at)
  VALUES (@url, @source, @title, @author, @published_at, @article_text, @word_count, 'write', @created_at, @created_at)`);

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * Creates a session from captured article text and starts tagging in the background.
 * If the same URL was already captured today, returns that session instead.
 */
export function createSession({ url = null, title, author = null, published_at = null, text }) {
  const clean = String(text).replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (url) {
    const existing = db.prepare('SELECT id FROM sessions WHERE url = ? AND created_at >= ? ORDER BY id DESC LIMIT 1')
      .get(url, startOfToday());
    if (existing) return { id: existing.id, existing: true };
  }
  const row = {
    url,
    source: url ? detectSource(url) : 'other',
    title: String(title).trim().slice(0, 300) || 'Untitled article',
    author: author?.trim().slice(0, 200) || null,
    published_at: published_at?.trim().slice(0, 40) || null,
    article_text: clean,
    word_count: countWords(clean),
    created_at: now(),
  };
  const id = Number(insertSession.run(row).lastInsertRowid);
  enqueue('tag_article', { sessionId: id });
  return { id, existing: false };
}

const PUBLIC_COLUMNS = `id, url, source, title, author, published_at, word_count, tags, tags_status, stage,
  comprehension_text, comprehension_seconds, comprehension_submitted_at, comprehension_eval,
  comprehension_score, interview_score, overall_score, verdict, created_at, updated_at`;

function hydrate(row) {
  if (!row) return null;
  for (const k of ['tags', 'comprehension_eval', 'verdict']) row[k] = row[k] ? JSON.parse(row[k]) : null;
  return row;
}

// Article text is never sent to the browser: it only grounds the AI.
export function getSession(id) {
  return hydrate(db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM sessions WHERE id = ?`).get(id));
}

export function requireSession(id) {
  const s = getSession(id);
  if (!s) throw httpError(404, 'Session not found');
  return s;
}

export function listSessions({ since = null, limit = 200 } = {}) {
  const rows = since
    ? db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM sessions WHERE created_at >= ? ORDER BY created_at DESC LIMIT ?`).all(since, limit)
    : db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM sessions ORDER BY created_at DESC LIMIT ?`).all(limit);
  return rows.map(hydrate);
}

export const listToday = () => listSessions({ since: startOfToday() });

export function setTags(id, tags, status = 'ready') {
  db.prepare('UPDATE sessions SET tags = ?, tags_status = ?, updated_at = ? WHERE id = ?')
    .run(tags ? JSON.stringify(tags) : null, status, now(), id);
}

export function retryTagging(id) {
  requireSession(id);
  db.prepare("UPDATE sessions SET tags_status = 'pending', updated_at = ? WHERE id = ?").run(now(), id);
  enqueue('tag_article', { sessionId: id });
}

export function deleteSession(id) {
  requireSession(id);
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

export function getArticleText(id) {
  return db.prepare('SELECT article_text FROM sessions WHERE id = ?').get(id)?.article_text ?? '';
}
