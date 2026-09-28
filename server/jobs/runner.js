// Background AI jobs, stored in the `jobs` table so they survive a restart.
// Jobs start as soon as they're queued; the Claude bridge's own queue keeps
// at most N calls running at once.
import { db, now } from '../db/index.js';

/** @type {Record<string, { run: (job) => Promise<void>, fail: (job, err) => void }>} */
const handlers = {};

export function registerHandler(task, handler) {
  handlers[task] = handler;
}

const insert = db.prepare(`INSERT INTO jobs (task, session_id, set_id, payload, status, created_at, updated_at)
                           VALUES (?, ?, ?, ?, 'queued', ?, ?)`);
const claim = db.prepare(`UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = ?
                          WHERE id = ? AND status = 'queued'`);
const finish = db.prepare('UPDATE jobs SET status = ?, error = ?, updated_at = ? WHERE id = ?');
const queued = db.prepare("SELECT * FROM jobs WHERE status = 'queued' ORDER BY id");

export function enqueue(task, { sessionId = null, setId = null, payload = null } = {}) {
  const t = now();
  const { lastInsertRowid } = insert.run(task, sessionId, setId, payload ? JSON.stringify(payload) : null, t, t);
  setImmediate(pump);
  return Number(lastInsertRowid);
}

function pump() {
  for (const job of queued.all()) {
    const handler = handlers[job.task];
    if (!handler) continue;
    if (claim.run(now(), job.id).changes === 0) continue; // someone else took it
    const parsed = { ...job, payload: job.payload ? JSON.parse(job.payload) : null };
    handler.run(parsed).then(
      () => finish.run('done', null, now(), job.id),
      (err) => {
        console.warn(`[jobs] ${job.task} #${job.id} failed: ${err.message}`);
        finish.run('failed', String(err.message).slice(0, 500), now(), job.id);
        try { handler.fail(parsed, err); } catch (e) { console.error(e); }
      },
    );
  }
}

// Call once at startup, after all handlers are registered.
export function startJobs() {
  // Anything "running" when the app last stopped never finished: run it again.
  db.prepare("UPDATE jobs SET status = 'queued', updated_at = ? WHERE status = 'running'").run(now());
  pump();
}
