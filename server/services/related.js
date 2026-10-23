// Related reading (Explore stage). Callers check session ownership first.
import { db, now } from '../db/index.js';
import { enqueue } from '../jobs/runner.js';

const setStatus = (sessionId, status) =>
  db.run('UPDATE sessions SET related_status = ?, updated_at = ? WHERE id = ?', status, now(), sessionId);

/** Queues related-reading generation unless it's already done or under way. */
export async function ensureRelated(userId, sessionId) {
  const row = await db.get('SELECT related_status FROM sessions WHERE id = ?', sessionId);
  if (!row || row.related_status === 'pending' || row.related_status === 'ready') return;
  await setStatus(sessionId, 'pending');
  await enqueue('related_reading', { userId, sessionId });
}

export const markRelatedFailed = (sessionId) => setStatus(sessionId, 'failed');

export async function saveRelated(sessionId, items) {
  await db.batch([
    ['DELETE FROM related_items WHERE session_id = ?', sessionId],
    ...items.map((it, i) => [`INSERT INTO related_items (session_id, position, title, category, why, queries, done)
                              VALUES (?, ?, ?, ?, ?, ?, 0)`, sessionId, i + 1, it.title, it.category, it.why, JSON.stringify(it.queries)]),
    ['UPDATE sessions SET related_status = ?, updated_at = ? WHERE id = ?', 'ready', now(), sessionId],
  ]);
}

export async function listRelated(sessionId) {
  const rows = await db.all('SELECT id, position, title, category, why, queries, done FROM related_items WHERE session_id = ? ORDER BY position', sessionId);
  return rows.map((r) => ({ ...r, queries: JSON.parse(r.queries), done: Boolean(r.done) }));
}

export async function setRelatedDone(sessionId, itemId, done) {
  const { changes } = await db.run('UPDATE related_items SET done = ? WHERE id = ? AND session_id = ?', done ? 1 : 0, itemId, sessionId);
  return changes > 0;
}
