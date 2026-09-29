import { EVALUATOR } from '../persona.js';
import { WeeklyReview } from '../schemas.js';

const fmt = (n) => (n == null ? 'n/a' : Number(n).toFixed(1));

function statsLine(label, s) {
  if (!s || !s.sessions) return `${label}: no sessions.`;
  return `${label}: ${s.sessions} sessions · overall ${fmt(s.overall)} · comprehension ${fmt(s.comprehension)} · interview ${fmt(s.interview)} · timeout rate ${fmt(s.timeout_rate)}% · avg ${fmt(s.avg_seconds)}s per question · avg ${s.words ?? 'n/a'} words written`;
}

/**
 * @param {object} o
 * @param {Array} o.sessions  this period's sessions (compact)
 * @param {object} o.stats    this period's averages
 * @param {object|null} o.previousStats  the previous period's averages
 * @param {Array} o.frameworks  per-framework average this period
 * @param {Array} o.difficulty  [{from, to}]
 */
export function weeklyReview({ periodLabel, sessions, stats, previousStats, frameworks, difficulty }) {
  const lines = sessions.map((s, i) => `${i + 1}. ${s.date} · ${s.title} [${s.sector ?? 'unknown sector'}] · overall ${fmt(s.overall)} (comp ${fmt(s.comprehension)}, interview ${fmt(s.interview)}) · ${s.timeouts} timeouts
   weakest comprehension dimension: ${s.weakest_dimension ?? 'n/a'}
   work on next was: ${s.work_on_next.join(' | ') || 'n/a'}`);

  return {
    task: 'weeklyReview',
    tier: 'strong',
    system: EVALUATOR,
    schema: WeeklyReview,
    prompt: `Write the weekly review for a candidate practising for Chief of Staff interviews. Period: ${periodLabel}.

NUMBERS
${statsLine('This period', stats)}
${statsLine('Previous period', previousStats)}
Difficulty level: ${difficulty.from} → ${difficulty.to}

Framework averages this period (0-10, number of questions):
${frameworks.filter((f) => f.n).map((f) => `- ${f.framework}: ${fmt(f.avg)} (${f.n})`).join('\n') || '- none'}

SESSIONS
${lines.join('\n')}

Return:
- headline: one blunt line.
- improved: 1-3 things that got better, each with evidence (quote the numbers). If nothing improved, say what held steady and don't invent progress.
- still_weak: 1-3 weaknesses, each with evidence.
- patterns: 1-3 patterns across the articles and answers (sectors avoided, recurring mistakes, time management, repeated "work on next" items that weren't fixed).
- goals: exactly 3 specific, measurable goals for next week.
- verdict: a closing line in your voice.

Only use numbers given above. Do not invent statistics.
Sessions are listed in date order. Only call something a trend ("rose", "fell") if it moves the same way across that order.`,
  };
}
