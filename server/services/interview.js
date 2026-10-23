// The timed interview. The server owns the clock: each question's started_at
// is stamped when it's first served, so reloading the page never buys time.
// Callers check session ownership first.
import { db, now } from '../db/index.js';
import { httpError } from './auth.js';
import { enqueue } from '../jobs/runner.js';

// Network and render slack before a late answer counts as timed out.
const GRACE_MS = 3000;

async function loadSet(sessionId, setId) {
  const set = await db.get('SELECT * FROM question_sets WHERE id = ? AND session_id = ?', setId, sessionId);
  if (!set) throw httpError(404, 'Question set not found');
  if (set.gen_status !== 'ready') throw httpError(409, 'These questions are not ready yet.');
  if (set.status === 'not_started') throw httpError(409, 'This interview has not started.');
  return set;
}

const firstUnanswered = (setId) =>
  db.get('SELECT * FROM questions WHERE set_id = ? AND answered_at IS NULL ORDER BY position LIMIT 1', setId);

// What the candidate may see: never the correct option, explanation or model answer.
async function publicQuestion(q, setId, timerSeconds) {
  const { n } = await db.get('SELECT COUNT(*) AS n FROM questions WHERE set_id = ?', setId);
  return {
    id: q.id,
    position: q.position,
    total: n,
    type: q.type,
    framework: q.framework,
    prompt: q.prompt,
    options: q.options ? JSON.parse(q.options) : null,
    cross_article: Boolean(q.cross_article),
    timer_seconds: timerSeconds,
    started_at: q.started_at,
    deadline: new Date(Date.parse(q.started_at) + timerSeconds * 1000).toISOString(),
    server_now: new Date().toISOString(),
  };
}

/** Current question (stamping its start time on first view), or { done: true }. */
export async function currentQuestion(user, sessionId, setId) {
  const set = await loadSet(sessionId, setId);
  const q = await firstUnanswered(setId);
  if (!q) return { done: true, set_status: set.status };
  if (!q.started_at) {
    const t = now();
    await db.run('UPDATE questions SET started_at = ? WHERE id = ? AND started_at IS NULL', t, q.id);
    q.started_at = (await db.get('SELECT started_at FROM questions WHERE id = ?', q.id)).started_at;
  }
  return publicQuestion(q, setId, user.timer_seconds);
}

/**
 * Locks one answer. Only the current question can be answered, and only once.
 * @param {{questionId:number, answer:string|null, autoSubmitted:boolean}} a
 */
export async function answerQuestion(user, sessionId, setId, { questionId, answer, autoSubmitted }) {
  const set = await loadSet(sessionId, setId);
  if (set.status !== 'in_progress') throw httpError(409, 'This interview is already finished.');
  const timer = user.timer_seconds;

  const q = await firstUnanswered(setId);
  if (!q || q.id !== questionId) throw httpError(409, 'That question is already answered. No going back.');
  if (!q.started_at) throw httpError(409, 'That question has not been shown yet.');
  if (q.type === 'mcq' && answer != null && !/^[0-3]$/.test(answer)) throw httpError(400, 'Pick one of the four options.');

  const elapsedMs = Date.now() - Date.parse(q.started_at);
  const timedOut = autoSubmitted || elapsedMs > timer * 1000 + GRACE_MS;
  const secondsUsed = Math.min(timer, Math.round(elapsedMs / 1000));
  const text = answer == null || String(answer).trim() === '' ? null : String(answer).trim();

  const { changes } = await db.run(`UPDATE questions SET user_answer = ?, seconds_used = ?, timed_out = ?, answered_at = ?
                                    WHERE id = ? AND answered_at IS NULL`, text, secondsUsed, timedOut ? 1 : 0, now(), q.id);
  if (changes === 0) throw httpError(409, 'That question is already answered.');

  if (!(await firstUnanswered(setId))) await finishSet(user.id, set);
  return { timed_out: timedOut };
}

// After the last answer: summary stats, then hand over to evaluation (once).
async function finishSet(userId, set) {
  const stats = await db.get('SELECT SUM(timed_out) AS timeouts, AVG(seconds_used) AS avg_seconds FROM questions WHERE set_id = ?', set.id);
  const t = now();
  const { changes } = await db.run(`UPDATE question_sets SET status = 'answered', eval_status = 'pending', timeouts = ?, avg_seconds = ?,
                                    completed_at = ? WHERE id = ? AND status = 'in_progress'`,
    stats.timeouts ?? 0, stats.avg_seconds ?? 0, t, set.id);
  if (!changes) return;
  if (set.kind === 'main') {
    await db.run("UPDATE sessions SET stage = 'verdict', updated_at = ? WHERE id = ? AND stage = 'interview'", t, set.session_id);
  }
  await enqueue(set.kind === 'main' ? 'evaluate_session' : 'evaluate_extra', { userId, sessionId: set.session_id, setId: set.id });
}
