// Weekly reviews. A review is due once 7 new scored sessions exist, or 7 days
// have passed since the last one (with at least one new session), whichever
// comes first. Checked when the app opens; there are no notifications.
import { db, now } from '../db/index.js';
import { enqueue } from '../jobs/runner.js';
import { runTask } from '../ai/claudeBridge.js';
import { weeklyReview } from '../ai/prompts/weeklyReview.js';
import { FRAMEWORKS } from '../ai/taxonomy.js';
import { COMPREHENSION_DIMENSIONS } from '../ai/schemas.js';
import { comprehensionWords } from './words.js';

const DAY = 86400000;
const round1 = (n) => (n == null ? null : Math.round(n * 10) / 10);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

const lastReview = () => db.prepare('SELECT * FROM weekly_reviews ORDER BY period_end DESC LIMIT 1').get();

// A session "completes" when its main set is scored.
function scoredSince(since) {
  return db.prepare(`SELECT s.*, qs.completed_at AS finished_at, qs.timeouts, qs.avg_seconds, qs.id AS set_id
    FROM sessions s JOIN question_sets qs ON qs.session_id = s.id AND qs.kind = 'main'
    WHERE s.overall_score IS NOT NULL AND qs.completed_at > ? ORDER BY qs.completed_at`).all(since ?? '');
}

const reviewPending = () => Boolean(db.prepare(
  "SELECT 1 FROM jobs WHERE task = 'weekly_review' AND status IN ('queued', 'running')").get());

export function reviewStatus() {
  return { pending: reviewPending() };
}

/** Called when the app opens. Queues a review if one is due. */
export function checkWeeklyReview() {
  if (reviewPending()) return { queued: false, pending: true };
  const last = lastReview();
  const since = last?.period_end ?? null;
  const fresh = scoredSince(since);
  if (!fresh.length) return { queued: false, pending: false };
  const anchor = Date.parse(since ?? fresh[0].finished_at);
  const due = fresh.length >= 7 || Date.now() - anchor >= 7 * DAY;
  if (!due) return { queued: false, pending: false, sessions_so_far: fresh.length };
  // Cap at 7 sessions; anything newer waits for the next review.
  const batch = fresh.slice(0, 7);
  enqueue('weekly_review', { payload: { since, until: batch[batch.length - 1].finished_at } });
  return { queued: true, pending: true };
}

function stats(sessions) {
  if (!sessions.length) return null;
  return {
    sessions: sessions.length,
    overall: round1(mean(sessions.map((s) => s.overall_score))),
    comprehension: round1(mean(sessions.map((s) => s.comprehension_score))),
    interview: round1(mean(sessions.map((s) => s.interview_score))),
    timeout_rate: round1((sessions.reduce((a, s) => a + (s.timeouts ?? 0), 0) / (sessions.length * 10)) * 100),
    avg_seconds: round1(mean(sessions.map((s) => s.avg_seconds ?? 0))),
    words: Math.round(mean(sessions.map((s) => comprehensionWords(s.comprehension_text)))),
  };
}

export async function writeReview({ since, until }) {
  const sessions = scoredSince(since).filter((s) => s.finished_at <= until);
  if (!sessions.length) return;

  // Previous period: the same number of sessions just before this one.
  const before = db.prepare(`SELECT s.*, qs.timeouts, qs.avg_seconds FROM sessions s
    JOIN question_sets qs ON qs.session_id = s.id AND qs.kind = 'main'
    WHERE s.overall_score IS NOT NULL AND qs.completed_at <= ? ORDER BY qs.completed_at DESC LIMIT ?`)
    .all(since ?? '', sessions.length);

  const ids = sessions.map((s) => s.id);
  const fwRows = db.prepare(`SELECT q.framework, AVG(q.score) avg, COUNT(*) n FROM questions q
    JOIN question_sets qs ON qs.id = q.set_id
    WHERE qs.status = 'evaluated' AND qs.session_id IN (${ids.map(() => '?').join(',')}) GROUP BY q.framework`).all(...ids);
  const frameworks = FRAMEWORKS.map((f) => {
    const r = fwRows.find((x) => x.framework === f);
    return { framework: f, avg: r ? round1(r.avg) : null, n: r?.n ?? 0 };
  });

  const levels = db.prepare(`SELECT level FROM difficulty_history WHERE session_id IN (${ids.map(() => '?').join(',')})
    ORDER BY created_at`).all(...ids).map((r) => r.level);
  const startLevel = db.prepare('SELECT level FROM difficulty_history WHERE created_at < ? ORDER BY created_at DESC LIMIT 1')
    .get(sessions[0].finished_at)?.level ?? levels[0] ?? 3;

  const compact = sessions.map((s) => {
    const dims = JSON.parse(s.comprehension_eval ?? '[]');
    const weakest = dims.sort((a, b) => a.score - b.score)[0];
    const verdict = JSON.parse(s.verdict ?? '{}');
    return {
      date: s.created_at.slice(0, 10),
      title: s.title,
      sector: s.tags ? JSON.parse(s.tags).sector : null,
      overall: s.overall_score,
      comprehension: s.comprehension_score,
      interview: s.interview_score,
      timeouts: s.timeouts ?? 0,
      weakest_dimension: weakest ? `${COMPREHENSION_DIMENSIONS[weakest.dimension]} (${weakest.score})` : null,
      work_on_next: (verdict.work_on_next ?? []).map((w) => w.title),
    };
  });

  const periodStart = sessions[0].created_at;
  const periodEnd = sessions[sessions.length - 1].finished_at;
  const content = await runTask(weeklyReview({
    periodLabel: `${periodStart.slice(0, 10)} to ${periodEnd.slice(0, 10)}`,
    sessions: compact,
    stats: stats(sessions),
    previousStats: stats(before),
    frameworks,
    difficulty: { from: startLevel, to: levels[levels.length - 1] ?? startLevel },
  }));

  db.prepare(`INSERT INTO weekly_reviews (period_start, period_end, session_ids, content, created_at)
              VALUES (?, ?, ?, ?, ?)`).run(periodStart, periodEnd, JSON.stringify(ids),
    JSON.stringify({ ...content, stats: stats(sessions), previous: stats(before) }), now());
}

export function listReviews() {
  return db.prepare('SELECT * FROM weekly_reviews ORDER BY period_end DESC').all().map((r) => ({
    id: r.id,
    period_start: r.period_start,
    period_end: r.period_end,
    session_ids: JSON.parse(r.session_ids),
    content: JSON.parse(r.content),
    created_at: r.created_at,
  }));
}

export function lastFailedReview() {
  return db.prepare("SELECT error, updated_at FROM jobs WHERE task = 'weekly_review' ORDER BY id DESC LIMIT 1").get();
}
