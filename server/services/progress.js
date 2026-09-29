// Everything on the Progress dashboard, computed from the local database.
import { db } from '../db/index.js';
import { getSetting } from './settings.js';
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
const localDay = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const DAY = 86400000;

// ---------- Readiness index ----------
export const READINESS_FORMULA = [
  { key: 'scores', weight: 40, label: 'Recent scores', how: 'average overall score of your last 7 sessions × 10' },
  { key: 'difficulty', weight: 25, label: 'Difficulty level', how: 'current level × 10' },
  { key: 'coverage', weight: 20, label: 'Framework coverage', how: 'share of the 16 frameworks where you average 5+ over the last 30 days' },
  { key: 'consistency', weight: 15, label: 'Consistency', how: '100 − 20 × standard deviation of your last 7 overall scores' },
];

function readiness(scoredDesc) {
  const last7 = scoredDesc.slice(0, 7).map((s) => s.overall_score);
  const since = new Date(Date.now() - 30 * DAY).toISOString();
  // Coverage means competent coverage: frameworks averaging 5+ (a first-round pass).
  const covered = db.prepare(`SELECT COUNT(*) AS n FROM (
    SELECT q.framework FROM questions q JOIN question_sets qs ON qs.id = q.set_id
    WHERE qs.status = 'evaluated' AND qs.completed_at >= ? AND q.score IS NOT NULL
    GROUP BY q.framework HAVING AVG(q.score) >= 5)`).get(since).n;
  const parts = {
    scores: last7.length ? mean(last7) * 10 : 0,
    difficulty: getSetting('difficulty_level') * 10,
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
function streak(sessions) {
  const days = new Set(sessions.map((s) => localDay(s.created_at)));
  const d = new Date();
  // Today not read yet? The streak still counts up to yesterday.
  if (!days.has(localDay(d.toISOString()))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(localDay(d.toISOString()))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

// ---------- Windows ----------
// '7d' = last 7 days, '7a' = last 7 articles, 'all'. Each has a previous window for deltas.
function splitWindow(scoredAsc, win) {
  if (win === 'all') return { current: scoredAsc, previous: null };
  if (win === '7a') {
    return { current: scoredAsc.slice(-7), previous: scoredAsc.slice(-14, -7) };
  }
  const now = Date.now();
  const inRange = (s, from, to) => { const t = Date.parse(s.created_at); return t > from && t <= to; };
  return {
    current: scoredAsc.filter((s) => inRange(s, now - 7 * DAY, now)),
    previous: scoredAsc.filter((s) => inRange(s, now - 14 * DAY, now - 7 * DAY)),
  };
}

function windowStats(sessions) {
  if (!sessions) return null;
  const ids = sessions.map((s) => s.id);
  const sets = ids.length
    ? db.prepare(`SELECT timeouts, avg_seconds FROM question_sets
        WHERE kind = 'main' AND status = 'evaluated' AND session_id IN (${ids.map(() => '?').join(',')})`).all(...ids)
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
function frameworkStrength(sessionIds) {
  const where = sessionIds ? `AND qs.session_id IN (${sessionIds.map(() => '?').join(',') || 'NULL'})` : '';
  const rows = db.prepare(`SELECT q.framework, AVG(q.score) AS avg, COUNT(*) AS n FROM questions q
    JOIN question_sets qs ON qs.id = q.set_id
    WHERE qs.status = 'evaluated' AND q.score IS NOT NULL ${where}
    GROUP BY q.framework`).all(...(sessionIds ?? []));
  const by = new Map(rows.map((r) => [r.framework, r]));
  const all = FRAMEWORKS.map((f) => ({ framework: f, avg: round1(by.get(f)?.avg ?? null), n: by.get(f)?.n ?? 0 }));
  const weakest = all.filter((f) => f.n > 0).sort((a, b) => a.avg - b.avg || b.n - a.n).slice(0, 3);
  return { all, weakest };
}

export function getProgress(win = '7a') {
  const all = db.prepare('SELECT * FROM sessions ORDER BY created_at').all();
  const scoredAsc = all.filter((s) => s.overall_score != null);
  const scoredDesc = [...scoredAsc].reverse();
  const { current, previous } = splitWindow(scoredAsc, win);

  const last7 = scoredDesc.slice(0, 7).map((s) => s.overall_score);
  const prev7 = scoredDesc.slice(7, 14).map((s) => s.overall_score);

  // Sector coverage in the window; "never read" is all-time.
  const sectorOf = (s) => (s.tags ? JSON.parse(s.tags).sector : null);
  const winSessions = win === 'all' ? all : current;
  const sectorCounts = {};
  for (const s of winSessions) {
    const sec = sectorOf(s);
    if (sec) sectorCounts[sec] = (sectorCounts[sec] ?? 0) + 1;
  }
  const everRead = new Set(all.map(sectorOf).filter(Boolean));

  // Vocabulary growth (cumulative by day).
  const vocabRows = db.prepare('SELECT created_at FROM glossary_terms ORDER BY created_at').all();
  const vocab = [];
  vocabRows.forEach((r, i) => {
    const day = localDay(r.created_at);
    if (vocab.length && vocab[vocab.length - 1].day === day) vocab[vocab.length - 1].total = i + 1;
    else vocab.push({ day, total: i + 1 });
  });

  return {
    window: win,
    headline: {
      total_articles: all.length,
      streak: streak(all),
      avg_last7: round1(mean(last7)),
      avg_prev7: round1(mean(prev7)),
      difficulty: getSetting('difficulty_level'),
      glossary_size: vocabRows.length,
    },
    current: windowStats(current),
    previous: windowStats(previous),
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
    frameworks: frameworkStrength(win === 'all' ? null : current.map((s) => s.id)),
    difficulty_history: db.prepare('SELECT level, created_at FROM difficulty_history ORDER BY created_at').all(),
    sectors: {
      counts: Object.entries(sectorCounts).map(([sector, n]) => ({ sector, n })).sort((a, b) => b.n - a.n),
      never_read: SECTORS.filter((s) => s !== 'Other' && !everRead.has(s)),
    },
    vocab: { growth: vocab, boxes: boxCounts() },
    readiness: readiness(scoredDesc),
  };
}
