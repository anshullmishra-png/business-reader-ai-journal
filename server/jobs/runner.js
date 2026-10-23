// Background AI jobs, stored in the `jobs` table. A job starts right after it's
// queued and keeps running after the HTTP response through Vercel's waitUntil
// (locally it's just a detached promise). If a job is cut off, the next status
// poll from that user picks it up again (resumeJobs).
import { waitUntil } from '@vercel/functions';
import { db, now } from '../db/index.js';

/** @type {Record<string, { run: (job) => Promise<void>, fail: (job, err) => Promise<void> }>} */
const handlers = {};
export function registerHandler(task, handler) { handlers[task] = handler; }

const MAX_ATTEMPTS = 3;
// A running job touches updated_at every HEARTBEAT_MS. One that goes quiet for
// STALE_MS lost its instance (crash, freeze or timeout) and is started again.
const HEARTBEAT_MS = 20_000;
const STALE_MS = 75_000;

function keepAlive(promise) {
  try { waitUntil(promise); } catch { /* not on Vercel: the promise just runs */ }
}

export async function enqueue(task, { userId, sessionId = null, setId = null, payload = null }) {
  const t = now();
  const { lastInsertRowid } = await db.run(
    `INSERT INTO jobs (user_id, task, session_id, set_id, payload, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)`, userId, task, sessionId, setId, payload ? JSON.stringify(payload) : null, t, t);
  start(lastInsertRowid);
  return lastInsertRowid;
}

// Background work must never surface as an unhandled rejection.
function start(id) {
  keepAlive(runJob(id).catch((err) => console.error(`[jobs] #${id} could not run: ${err.message}`)));
}

async function runJob(id) {
  const t = now();
  // Claim atomically, so two pollers never run the same job.
  const { changes } = await db.run(
    `UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ? AND status = 'queued'`, t, id);
  if (!changes) return;
  const job = await db.get('SELECT * FROM jobs WHERE id = ?', id);
  const handler = handlers[job.task];
  const parsed = { ...job, payload: job.payload ? JSON.parse(job.payload) : null };
  const heartbeat = setInterval(() => {
    db.run(`UPDATE jobs SET updated_at = ? WHERE id = ? AND status = 'running'`, now(), id).catch(() => {});
  }, HEARTBEAT_MS);
  try {
    if (!handler) throw new Error(`no handler for ${job.task}`);
    await handler.run(parsed);
    await db.run(`UPDATE jobs SET status = 'done', error = NULL, updated_at = ? WHERE id = ?`, now(), id);
  } catch (err) {
    console.warn(`[jobs] ${job.task} #${id} failed: ${err.message}`);
    await db.run(`UPDATE jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`, String(err.message).slice(0, 500), now(), id);
    try { await handler?.fail(parsed, err); } catch (e) { console.error(e); }
  } finally {
    clearInterval(heartbeat);
  }
}

/**
 * Restarts this user's queued jobs and any "running" job that has gone quiet
 * (its function was cut off). Called from the polling endpoints.
 */
export async function resumeJobs(userId) {
  const cutoff = new Date(Date.now() - STALE_MS).toISOString();
  await db.run(`UPDATE jobs SET status = 'queued', updated_at = ?
                WHERE user_id = ? AND status = 'running' AND updated_at < ? AND attempts < ?`, now(), userId, cutoff, MAX_ATTEMPTS);
  const stuck = await db.all(`SELECT id FROM jobs WHERE user_id = ? AND status = 'queued' AND updated_at < ?`,
    userId, new Date(Date.now() - 15_000).toISOString());
  for (const { id } of stuck) start(id);
}
