// Everything on the Progress dashboard, per user. Day boundaries use the
// reader's timezone offset (minutes, as from Date#getTimezoneOffset).
import { db } from '../db/index.js';
import { comprehensionWords } from './words.js';
import { FRAMEWORKS, SECTORS } from '../ai/taxonomy.js';
import { boxCounts } from './glossary.js';

const round1 = (n) => (n == null || Number.isNaN(n) ? null : Math.round(n * 10) / 10);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const stdev = (xs) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};
const DAY = 86400000;
/** YYYY-MM-DD of an instant in the reader's timezone. */
const localDay = (iso, tz) => new Date(Date.parse(iso) - tz * 60000).toISOString().slice(0, 10);
const inList = (ids) => ids.map(() => '?').join(',') || 'NULL';

// ---------- Readiness index ----------
export const READINESS_FORMULA = [
  { key: 'scores', weight: 40, label: 'Recent scores', how: 'average overall score of your last 7 sessions × 10' },
  { key: 'difficulty', weight: 25, label: 'Difficulty level', how: 'current level × 10' },
  { key: 'coverage', weight: 20, label: 'Framework coverage', how: 'share of the 16 frameworks where you average 5+ over the last 30 days' },
  { key: 'consistency', weight: 15, label: 'Consistency', how: '100 − 20 × standard deviation of your last 7 overall scores' },
];

async function readiness(userId, difficulty, scoredDesc) {
  const last7 = scoredDesc.slice(0, 7).map((s) => s.overall_score);
  const since = new Date(Date.now() - 30 * DAY).toISOString();
  // Coverage means competent coverage: frameworks averaging 5+ (a first-round pass).
  const { n: covered } = await db.get(`SELECT COUNT(*) AS n FROM (
    SELECT q.framework FROM questions q JOIN question_sets qs ON qs.id = q.set_id JOIN sessions s ON s.id = qs.session_id
    WHERE s.user_id = ? AND qs.status = 'evaluated' AND qs.completed_at >= ? AND q.score IS NOT NULL
    GROUP BY q.framework HAVING AVG(q.score) >= 5) AS covered`, userId, since);
  const parts = {
    scores: last7.length ? mean(last7) * 10 : 0,
    difficulty: difficulty * 10,
    coverage: (covered / FRAMEWORKS.length) * 100,
    consistency: last7.length >= 2 ? Math.max(0, Math.min(100, 100 - 20 * stdev(last7))) : 0,
  };
  const value = READINESS_FORMULA.reduce((sum, f) => sum + (f.weight / 100) * parts[f.key], 0);
  return {
    value: last7.length ? Math.round(value) : null,
    parts: READINESS_FORMULA.map((f) => ({ ...f, value: Math.round(parts[f.key]) })),
  };
}

// ---------- Streak (display only) ----------
function streak(sessions, tz) {
  const days = new Set(sessions.map((s) => localDay(s.created_at, tz)));
  let cursor = Date.now();
  // Today not read yet? The streak still counts up to yesterday.
  if (!days.has(localDay(new Date(cursor).toISOString(), tz))) cursor -= DAY;
  let n = 0;
  while (days.has(localDay(new Date(cursor).toISOString(), tz))) { n++; cursor -= DAY; }
  return n;
}

// ---------- Windows ----------
// '7d' = last 7 days, '7a' = last 7 articles, 'all'. Each has a previous window for deltas.
function splitWindow(scoredAsc, win) {
  if (win === 'all') return { current: scoredAsc, previous: null };
  if (win === '7a') return { current: scoredAsc.slice(-7), previous: scoredAsc.slice(-14, -7) };
  const t = Date.now();
  const inRange = (s, from, to) => { const x = Date.parse(s.created_at); return x > from && x <= to; };
  return {
    current: scoredAsc.filter((s) => inRange(s, t - 7 * DAY, t)),
    previous: scoredAsc.filter((s) => inRange(s, t - 14 * DAY, t - 7 * DAY)),
  };
}

async function windowStats(sessions) {
  if (!sessions) return null;
  const ids = sessions.map((s) => s.id);
  const sets = ids.length
    ? await db.all(`SELECT timeouts, avg_seconds FROM question_sets
        WHERE kind = 'main' AND status = 'evaluated' AND session_id IN (${inList(ids)})`, ...ids)
    : [];
  const answered = sets.length * 10;
  return {
    sessions: sessions.length,
    overall: round1(mean(sessions.map((s) => s.overall_score))),
    comprehension: round1(mean(sessions.map((s) => s.comprehension_score))),
    interview: round1(mean(sessions.map((s) => s.interview_score))),
    words: sessions.length ? Math.round(mean(sessions.map((s) => comprehensionWords(s.comprehension_text)))) : null,
    write_seconds: sessions.length ? Math.round(mean(sessions.map((s) => s.comprehension_seconds ?? 0))) : null,
    timeout_rate: answered ? round1((sets.reduce((a, s) => a + (s.timeouts ?? 0), 0) / answered) * 100) : null,
    avg_seconds: sets.length ? round1(mean(sets.map((s) => s.avg_seconds ?? 0))) : null,
  };
}

// ---------- Frameworks (main + extra rounds) ----------
async function frameworkStrength(userId, sessionIds) {
  const where = sessionIds ? `AND qs.session_id IN (${inList(sessionIds)})` : '';
  const rows = await db.all(`SELECT q.framework, AVG(q.score) AS avg, COUNT(*) AS n FROM questions q
    JOIN question_sets qs ON qs.id = q.set_id JOIN sessions s ON s.id = qs.session_id
    WHERE s.user_id = ? AND qs.status = 'evaluated' AND q.score IS NOT NULL ${where}
    GROUP BY q.framework`, userId, ...(sessionIds ?? []));
  const by = new Map(rows.map((r) => [r.framework, r]));
  const all = FRAMEWORKS.map((f) => ({ framework: f, avg: round1(by.get(f)?.avg ?? null), n: by.get(f)?.n ?? 0 }));
  const weakest = all.filter((f) => f.n > 0).sort((a, b) => a.avg - b.avg || b.n - a.n).slice(0, 3);
  return { all, weakest };
}

/** Small numbers for the Today page. "This week" starts on Monday. */
export async function getSummary(user, tz = 0) {
  const all = await db.all('SELECT id, title, stage, overall_score, created_at FROM sessions WHERE user_id = ? ORDER BY created_at', user.id);
  const today = localDay(new Date().toISOString(), tz);
  const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // 0 = Monday
  const monday = new Date(Date.parse(`${today}T00:00:00Z`) - dow * DAY).toISOString().slice(0, 10);

  // The last 30 days, oldest first: a plain record of which days had a session,
  // with that day's article for the hover popover.
  const byDay = new Map();
  for (const s of all) byDay.set(localDay(s.created_at, tz), s); // latest of the day wins
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const days = Array.from({ length: 30 }, (_, i) => {
    const date = new Date(todayMs - (29 - i) * DAY).toISOString().slice(0, 10);
    const s = byDay.get(date);
    return { date, read: Boolean(s), id: s?.id ?? null, title: s?.title ?? null, score: s?.overall_score ?? null };
  });

  // Today's most recent session, so Today can offer "Continue".
  const current = [...all].reverse().find((s) => localDay(s.created_at, tz) === today) ?? null;

  return {
    total: all.length,
    week: all.filter((s) => localDay(s.created_at, tz) >= monday).length,
    today: all.filter((s) => localDay(s.created_at, tz) === today).length,
    streak: streak(all, tz),
    difficulty: user.difficulty_level,
    first_at: all[0]?.created_at ?? null,
    days,
    current: current && { id: current.id, title: current.title, stage: current.stage, overall_score: current.overall_score },
  };
}

export async function getProgress(user, win = '7a', tz = 0) {
  const userId = user.id;
  const all = await db.all('SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at', userId);
  const scoredAsc = all.filter((s) => s.overall_score != null);
  const scoredDesc = [...scoredAsc].reverse();
  const { current, previous } = splitWindow(scoredAsc, win);

  const last7 = scoredDesc.slice(0, 7).map((s) => s.overall_score);
  const prev7 = scoredDesc.slice(7, 14).map((s) => s.overall_score);

  // Sector coverage in the window; "never read" is all-time.
  const sectorOf = (s) => (s.tags ? JSON.parse(s.tags).sector : null);
  const sectorCounts = {};
  for (const s of win === 'all' ? all : current) {
    const sec = sectorOf(s);
    if (sec) sectorCounts[sec] = (sectorCounts[sec] ?? 0) + 1;
  }
  const everRead = new Set(all.map(sectorOf).filter(Boolean));

  // Vocabulary growth (cumulative by day).
  const vocabRows = await db.all('SELECT created_at FROM glossary_terms WHERE user_id = ? ORDER BY created_at', userId);
  const vocab = [];
  vocabRows.forEach((r, i) => {
    const day = localDay(r.created_at, tz);
    if (vocab.length && vocab[vocab.length - 1].day === day) vocab[vocab.length - 1].total = i + 1;
    else vocab.push({ day, total: i + 1 });
  });

  const [cur, prev, frameworks, history, boxes, ready] = await Promise.all([
    windowStats(current),
    windowStats(previous),
    frameworkStrength(userId, win === 'all' ? null : current.map((s) => s.id)),
    db.all('SELECT level, created_at FROM difficulty_history WHERE user_id = ? ORDER BY created_at', userId),
    boxCounts(userId),
    readiness(userId, user.difficulty_level, scoredDesc),
  ]);

  return {
    window: win,
    headline: {
      total_articles: all.length,
      streak: streak(all, tz),
      avg_last7: round1(mean(last7)),
      avg_prev7: round1(mean(prev7)),
      difficulty: user.difficulty_level,
      glossary_size: vocabRows.length,
    },
    current: cur,
    previous: prev,
    trend: current.map((s) => ({
      id: s.id,
      date: s.created_at,
      title: s.title,
      overall: s.overall_score,
      comprehension: s.comprehension_score,
      interview: s.interview_score,
      clarity: (JSON.parse(s.comprehension_eval ?? '[]').find((c) => c.dimension === 'condensation') ?? {}).score ?? null,
      words: comprehensionWords(s.comprehension_text),
    })),
    frameworks,
    difficulty_history: history,
    sectors: {
      counts: Object.entries(sectorCounts).map(([sector, n]) => ({ sector, n })).sort((a, b) => b.n - a.n),
      never_read: SECTORS.filter((s) => s !== 'Other' && !everRead.has(s)),
    },
    vocab: { growth: vocab, boxes },
    readiness: ready,
  };
}
