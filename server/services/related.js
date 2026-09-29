import { db, now } from '../db/index.js';
import { enqueue } from '../jobs/runner.js';

const setStatus = (sessionId, status) =>
  db.prepare('UPDATE sessions SET related_status = ?, updated_at = ? WHERE id = ?').run(status, now(), sessionId);

/** Queues related-reading generation unless it's already done or under way. */
export function ensureRelated(sessionId) {
  const row = db.prepare('SELECT related_status FROM sessions WHERE id = ?').get(sessionId);
  if (!row || row.related_status === 'pending' || row.related_status === 'ready') return;
  setStatus(sessionId, 'pending');
  enqueue('related_reading', { sessionId });
}

export function markRelatedFailed(sessionId) {
  setStatus(sessionId, 'failed');
}

export function saveRelated(sessionId, items) {
  const insert = db.prepare(`INSERT INTO related_items (session_id, position, title, category, why, queries, done)
                             VALUES (?, ?, ?, ?, ?, ?, 0)`);
  db.transaction(() => {
    db.prepare('DELETE FROM related_items WHERE session_id = ?').run(sessionId);
    items.forEach((it, i) => insert.run(sessionId, i + 1, it.title, it.category, it.why, JSON.stringify(it.queries)));
    setStatus(sessionId, 'ready');
  })();
}

export function listRelated(sessionId) {
  return db.prepare('SELECT id, position, title, category, why, queries, done FROM related_items WHERE session_id = ? ORDER BY position')
    .all(sessionId)
    .map((r) => ({ ...r, queries: JSON.parse(r.queries), done: Boolean(r.done) }));
}

export function setRelatedDone(sessionId, itemId, done) {
  return db.prepare('UPDATE related_items SET done = ? WHERE id = ? AND session_id = ?')
    .run(done ? 1 : 0, itemId, sessionId).changes > 0;
}
