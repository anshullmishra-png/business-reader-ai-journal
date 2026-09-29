// Seeds data/demo.db with ~20 fictional sessions so the dashboard looks alive
// for screenshots. Never touches the real journal.
//   npm run demo         -> seeds automatically if the demo journal is empty
//   npm run demo:reset   -> wipes and reseeds the demo journal
import { rmSync } from 'node:fs';
import { ARTICLES, QUESTIONS, FEEDBACK, RELATED, GLOSSARY } from './demo-content.js';

const DAY = 86400000;

// Deterministic randomness, so screenshots are reproducible.
function rng(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fill = (tpl, a) => tpl.replaceAll('{c}', a.company).replaceAll('{r}', a.rival).replaceAll('{s}', a.sector).replaceAll('{m}', a.model.toLowerCase());
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const round1 = (n) => Math.round(n * 10) / 10;
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const words = (t) => (t.match(/\S+/g) ?? []).length;

const TYPE_PATTERN = ['mcq', 'short', 'structured', 'estimation', 'mcq', 'short', 'estimation', 'structured', 'mcq', 'short'];
const DIMENSIONS = ['accuracy', 'condensation', 'structure', 'insight', 'omissions'];
const CRITIQUES = {
  high: {
    accuracy: 'Every figure matches the article. Good.', condensation: 'Tight. Nothing wasted.',
    structure: 'Clean flow from event to money to decision.', insight: 'A real "so what", tied to the numbers.',
    omissions: 'You flagged what the article left out. Rare. Keep doing it.',
  },
  mid: {
    accuracy: 'Mostly accurate; one figure is rounded loosely.', condensation: 'Clear, but two sentences say the same thing.',
    structure: 'The template helps, but the take drifts from the money section.', insight: 'There is a view, but it is safe and generic.',
    omissions: 'You did not ask what the article left unsaid.',
  },
  low: {
    accuracy: 'You misstate the key number. Re-read before writing.', condensation: 'Padded. Half of this is filler.',
    structure: 'No clear order: event, money and opinion are tangled.', insight: 'No "so what". It is a summary, not a view.',
    omissions: 'Nothing on what is missing. Interviewers will notice.',
  },
};
const band = (s) => (s >= 6.5 ? 'high' : s >= 4.5 ? 'mid' : 'low');

/** @param {{ db: object, normalize: (term: string) => string, now?: number }} o */
export function seedDemo({ db, normalize, now = Date.now() }) {
  const rand = rng(42);
  const iso = (ms) => new Date(ms).toISOString();
  const insert = (sql, ...args) => Number(db.prepare(sql).run(...args).lastInsertRowid);

  let level = 3;
  const recent = [];
  const scored = [];
  const n = ARTICLES.length;

  db.transaction(() => {
    ARTICLES.forEach((a, i) => {
      const progress = i / (n - 1);
      // The last two sessions are today: one mid-explore, one just captured.
      // Earlier sessions every other day, the last week daily (so the streak is real).
      // Anchored to local mornings, so no session slips across midnight.
      const daysAgo = i >= n - 9 ? n - 2 - i : 7 + (n - 9 - i) * 2;
      const midnight = new Date(now);
      midnight.setHours(0, 0, 0, 0);
      const created = i >= n - 2
        ? Math.max(midnight.getTime() + (i - n + 3) * 60000, now - (n - i) * 40 * 60000) // earlier today
        : midnight.getTime() - daysAgo * DAY + (7.5 + rand() * 2) * 3600000;
      const stage = i === n - 1 ? 'write' : i === n - 2 ? 'explore' : 'verdict';
      const tags = {
        companies: [a.company, a.rival], sector: a.sector, business_model: a.model,
        company_stage: a.stage, geography: a.geo, themes: a.themes,
      };
      const article = `${a.happened} ${a.why}\n\n${a.money} Analysts say the next two quarters will show whether ${a.company}'s approach holds as ${a.rival} responds.\n\n(Fictional article for demo mode.)`;
      const comprehension = `What happened:\n${a.happened}\n\nWhy it matters:\n${a.why}\n\nHow the money works:\n${a.money}\n\nMy take (what I'd do as the founder):\n${a.take}`;
      const compWords = words([a.happened, a.why, a.money, a.take].join(' '));
      if (compWords < 100 || compWords > 200) throw new Error(`Demo comprehension for ${a.company} is ${compWords} words`);

      const sessionId = insert(`INSERT INTO sessions (url, source, title, article_text, word_count, tags, tags_status, related_status, stage,
          comprehension_text, comprehension_seconds, comprehension_submitted_at, created_at, updated_at)
        VALUES (NULL, ?, ?, ?, ?, ?, 'ready', 'ready', ?, ?, ?, ?, ?, ?)`,
        a.source, a.title, article, words(article), JSON.stringify(tags), stage,
        stage === 'write' ? null : comprehension,
        stage === 'write' ? null : Math.round(420 - progress * 170 + rand() * 90),
        stage === 'write' ? null : iso(created + 20 * 60000),
        iso(created), iso(created));

      RELATED.forEach((r, k) => {
        insert(`INSERT INTO related_items (session_id, position, title, category, why, queries, done) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          sessionId, k + 1, fill(r.title, a), r.category, fill(r.why, a), JSON.stringify(r.q.map((q) => fill(q, a))),
          stage === 'verdict' && rand() < 0.7 ? 1 : 0);
      });
      if (stage === 'write') return;

      // ---- Main question set ----
      const setStart = created + 35 * 60000;
      const setId = insert(`INSERT INTO question_sets (session_id, kind, difficulty_at_time, gen_status, status, eval_status, created_at, started_at)
        VALUES (?, 'main', ?, 'ready', ?, ?, ?, ?)`, sessionId, level,
        stage === 'explore' ? 'not_started' : 'evaluated', stage === 'explore' ? null : 'ready',
        iso(created + 21 * 60000), stage === 'explore' ? null : iso(setStart));

      const base = clamp(4.6 + 3.6 * progress + (rand() - 0.5) * 1.2, 1.5, 8.8);
      const qScores = [];
      const qRows = [];
      TYPE_PATTERN.forEach((type, pos) => {
        const pool = QUESTIONS[type];
        const t = pool[(i + pos) % pool.length];
        const timedOut = stage === 'verdict' && rand() < 0.22 - 0.17 * progress;
        let score = null;
        let answer = null;
        let feedback = null;
        let modelAnswer;
        let options = null;
        let correct = null;
        if (type === 'mcq') {
          // Rotate the options so the right answer isn't always in the same place.
          const shift = (i + pos) % 4;
          options = t.options.map((_, k) => fill(t.options[(k + shift) % 4], a));
          correct = (t.correct - shift + 4) % 4;
          modelAnswer = fill(t.why, a);
          if (stage === 'verdict') {
            const right = !timedOut && rand() < 0.55 + 0.35 * progress;
            answer = timedOut ? null : String(right ? correct : (correct + 1 + Math.floor(rand() * 3)) % 4);
            score = right ? 10 : 0;
            feedback = right ? 'Correct.' : timedOut ? 'No answer.' : 'Wrong.';
          }
        } else {
          modelAnswer = fill(t.model, a);
          if (stage === 'verdict') {
            score = timedOut ? 0 : clamp(Math.round(base + (rand() - 0.5) * 3), 1, 9);
            answer = timedOut ? null : fill(score >= 5 ? t.good : t.weak, a);
            const b = score >= 7 ? 'strong' : score >= 5 ? 'mid' : 'weak';
            feedback = timedOut ? 'No answer. You ran out of time; bank the easy points first.' : FEEDBACK[b][(i + pos) % 3];
          }
        }
        if (score != null) qScores.push(score);
        qRows.push({ pos, type, t, options, correct, answer, score, feedback, modelAnswer, timedOut });
      });

      for (const q of qRows) {
        const qStart = setStart + q.pos * 62000;
        const secs = q.timedOut ? 60 : Math.round(24 + rand() * 30);
        insert(`INSERT INTO questions (set_id, position, type, framework, prompt, options, correct_option, cross_article,
            started_at, user_answer, seconds_used, timed_out, answered_at, score, feedback, model_answer)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          setId, q.pos + 1, q.type, q.t.fw, fill(q.t.prompt, a), q.options ? JSON.stringify(q.options) : null, q.correct,
          i > 2 && q.pos === 5 ? 1 : 0,
          stage === 'verdict' ? iso(qStart) : null, q.answer, stage === 'verdict' ? secs : null, q.timedOut ? 1 : 0,
          stage === 'verdict' ? iso(qStart + secs * 1000) : null, q.score, q.feedback, q.modelAnswer);
      }
      if (stage !== 'verdict') return;

      // ---- Scores, verdict, difficulty ----
      const dims = DIMENSIONS.map((d) => {
        const s = clamp(Math.round(base + 0.3 + (rand() - 0.5) * 2.4), 1, 9);
        return { dimension: d, score: s, critique: CRITIQUES[band(s)][d] };
      });
      const comp = round1(mean(dims.map((d) => d.score)));
      const interview = round1(mean(qScores));
      const overall = round1(0.4 * comp + 0.6 * interview);
      const timeouts = qRows.filter((q) => q.timedOut).length;
      const avgSecs = round1(mean(qRows.map(() => 24 + rand() * 30)));

      const byFw = {};
      for (const q of qRows) (byFw[q.t.fw] ??= []).push(q.score);
      const weakestFw = Object.entries(byFw).map(([fw, s]) => [fw, mean(s)]).sort((x, y) => x[1] - y[1])[0][0];
      const weakestDim = [...dims].sort((x, y) => x.score - y.score)[0];
      const summary = overall >= 6.5
        ? `Solid session. Numbers where they mattered and a clear view on ${a.company}. ${weakestFw} is still the soft spot.`
        : overall >= 4.5
          ? `Acceptable for a first round, not more. The structure is there; the specifics on ${a.company} are thin.`
          : `Not ready. Vague answers, missing numbers, and ${weakestFw} fell apart under the clock.`;
      const verdict = {
        summary,
        work_on_next: [
          { title: `Drill ${weakestFw}`, detail: `Do three ${weakestFw.toLowerCase()} questions on this week's articles, each with a number and one stated assumption.`, target: weakestFw },
          { title: `Fix "${weakestDim.critique.split('.')[0].toLowerCase()}"`, detail: 'Rewrite this comprehension in 120 words, then compare line by line with the article.', target: `Comprehension: ${weakestDim.dimension}` },
        ],
      };
      const done = setStart + 11 * 60000;
      db.prepare(`UPDATE question_sets SET score = ?, timeouts = ?, avg_seconds = ?, completed_at = ? WHERE id = ?`)
        .run(interview, timeouts, avgSecs, iso(done), setId);
      db.prepare(`UPDATE sessions SET comprehension_eval = ?, comprehension_score = ?, interview_score = ?, overall_score = ?, verdict = ?, updated_at = ?
        WHERE id = ?`).run(JSON.stringify(dims), comp, interview, overall, JSON.stringify(verdict), iso(done), sessionId);

      // Same rule as server/services/difficulty.js.
      recent.unshift(interview);
      const last5 = recent.slice(0, 5);
      if (last5.length === 5) {
        const avg = mean(last5);
        if (avg >= 7) level = Math.min(10, level + 1);
        else if (avg <= 4) level = Math.max(1, level - 1);
      }
      insert('INSERT INTO difficulty_history (level, session_id, created_at) VALUES (?, ?, ?)', level, sessionId, iso(done + 1000));
      scored.push({ id: sessionId, created, done, overall, comp, interview, timeouts, avgSecs, sector: a.sector, title: a.title });

      // One extra round midway, for framework analytics.
      if (i === 9) {
        const xs = insert(`INSERT INTO question_sets (session_id, kind, level, difficulty_at_time, gen_status, status, eval_status, score, timeouts, avg_seconds, created_at, started_at, completed_at, verdict)
          VALUES (?, 'extra', 'hard', 7, 'ready', 'evaluated', 'ready', ?, 1, 41, ?, ?, ?, ?)`, sessionId, 4.6, iso(done + 60000), iso(done + 120000), iso(done + 900000),
          JSON.stringify({ summary: 'Hard round, honest result: the estimates hold up, the structures do not.', work_on_next: verdict.work_on_next }));
        TYPE_PATTERN.forEach((type, pos) => {
          const t = QUESTIONS[type][(i + pos + 2) % QUESTIONS[type].length];
          const s = type === 'mcq' ? (pos % 2 ? 10 : 0) : clamp(Math.round(4.6 + (rand() - 0.5) * 3), 1, 8);
          insert(`INSERT INTO questions (set_id, position, type, framework, prompt, options, correct_option, user_answer, seconds_used, timed_out, started_at, answered_at, score, feedback, model_answer)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 45, 0, ?, ?, ?, ?, ?)`, xs, pos + 1, type, t.fw, fill(t.prompt, a),
            t.options ? JSON.stringify(t.options.map((o) => fill(o, a))) : null, t.options ? t.correct : null,
            t.options ? String(pos % 2 ? t.correct : (t.correct + 1) % 4) : fill(s >= 5 ? t.good : t.weak, a),
            iso(done + 120000 + pos * 60000), iso(done + 165000 + pos * 60000), s,
            t.options ? (pos % 2 ? 'Correct.' : 'Wrong.') : FEEDBACK[s >= 7 ? 'strong' : s >= 5 ? 'mid' : 'weak'][pos % 3],
            fill(t.options ? t.why : t.model, a));
        });
      }
    });

    // ---- Glossary ----
    const scoredIds = scored.map((s) => s.id);
    GLOSSARY.forEach(([term, sector, definition, formula, [company, example], why, related], k) => {
      const created = now - (26 - k * 1.3) * DAY;
      const box = clamp(1 + Math.floor(rand() * 4 + k / 9), 1, 5);
      const count = 1 + Math.floor(rand() * 5);
      const sessionId = scoredIds[Math.min(scoredIds.length - 1, Math.floor(k * 0.9))];
      const entry = {
        definition, formula,
        examples: [{ company, example }, { company: 'Industry-wide', example: `Commonly used when analysts compare companies in ${sector === 'General business' ? 'any sector' : sector}.` }],
        why_it_matters: why, related,
      };
      const termId = insert(`INSERT INTO glossary_terms (term_normalized, display_term, entry, sector, lookup_count, first_session_id, leitner_box, last_reviewed_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, normalize(term), term, JSON.stringify(entry), sector,
        count, sessionId, box, box > 1 ? iso(now - rand() * 5 * DAY) : null, iso(created));
      for (let c = 0; c < count; c++) {
        insert('INSERT INTO glossary_lookups (term_id, session_id, created_at) VALUES (?, ?, ?)', termId, sessionId, iso(created + c * 3 * DAY));
      }
    });

    // ---- Two weekly reviews, from the seeded numbers ----
    const stats = (list) => ({
      sessions: list.length,
      overall: round1(mean(list.map((s) => s.overall))),
      comprehension: round1(mean(list.map((s) => s.comp))),
      interview: round1(mean(list.map((s) => s.interview))),
      timeout_rate: round1((list.reduce((x, s) => x + s.timeouts, 0) / (list.length * 10)) * 100),
      avg_seconds: round1(mean(list.map((s) => s.avgSecs))),
      words: 132,
    });
    const w1 = scored.slice(0, 7);
    const w2 = scored.slice(7, 14);
    const s1 = stats(w1);
    const s2 = stats(w2);
    const reviews = [
      [w1, s1, null, {
        headline: `Seven sessions, overall ${s1.overall}. Competent summaries, soft interviews.`,
        improved: [{ point: 'You finish on time more often.', evidence: `Timeout rate ${s1.timeout_rate}% across ${s1.sessions} sessions, falling in the second half of the week.` }],
        still_weak: [
          { point: 'Interview answers lack numbers.', evidence: `Interview average ${s1.interview} against comprehension ${s1.comprehension}.` },
          { point: 'Structured answers overlap.', evidence: 'MECE and issue-tree questions averaged below 5.' },
        ],
        patterns: ['You read consumer and fintech stories and avoid industrials and policy.', 'Estimation answers skip the assumptions line.'],
        goals: [`Lift interview average from ${s1.interview} to 5.5.`, 'State one assumption in every estimation answer.', 'Read one article outside consumer tech each week.'],
        verdict: 'You can summarise. Now learn to argue with numbers.',
      }],
      [w2, s2, s1, {
        headline: `Overall ${s2.overall}, up from ${s1.overall}. The numbers are starting to show up.`,
        improved: [
          { point: 'Interview scores rose.', evidence: `Interview ${s2.interview} vs ${s1.interview} the previous week.` },
          { point: 'Fewer timeouts.', evidence: `Timeout rate ${s2.timeout_rate}% vs ${s1.timeout_rate}%.` },
        ],
        still_weak: [{ point: '2x2 and value-chain answers are still thin.', evidence: 'Both frameworks averaged under 5 this week.' }],
        patterns: ['Your takes are sharper when the article has hard numbers.', 'Comprehension insight lags accuracy: you report well but rarely say what is missing.'],
        goals: [`Hold overall above ${s2.overall} for seven sessions.`, 'Name one thing each article leaves out.', 'Do the Hard extra round on two sessions.'],
        verdict: 'Better. Not good yet. Keep the numbers coming.',
      }],
    ];
    for (const [list, st, prev, content] of reviews) {
      insert('INSERT INTO weekly_reviews (period_start, period_end, session_ids, content, created_at) VALUES (?, ?, ?, ?, ?)',
        iso(list[0].created), iso(list[list.length - 1].done), JSON.stringify(list.map((s) => s.id)),
        JSON.stringify({ ...content, stats: st, previous: prev }), iso(list[list.length - 1].done + 3600000));
    }

    const set = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value');
    set.run('name', JSON.stringify('Demo Reader'));
    set.run('difficulty_level', JSON.stringify(level));
  })();

  return { sessions: ARTICLES.length, scored: scored.length, terms: GLOSSARY.length, level };
}

// CLI: node scripts/seed-demo.js [--reset]
if (process.argv[1]?.endsWith('seed-demo.js')) {
  process.argv.push('--demo');
  const { paths } = await import('../server/config.js');
  if (!paths.db.endsWith('demo.db')) throw new Error('Refusing to seed anything but the demo journal');
  if (process.argv.includes('--reset')) {
    for (const f of [paths.db, `${paths.db}-wal`, `${paths.db}-shm`, `${paths.db}.restore-pending`]) rmSync(f, { force: true });
  }
  const { db } = await import('../server/db/index.js');
  const { normalizeTerm } = await import('../server/services/glossary.js');
  const has = db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n;
  if (has) {
    console.log(`[demo] demo journal already has ${has} sessions (use npm run demo:reset to rebuild)`);
  } else {
    const r = seedDemo({ db, normalize: normalizeTerm });
    console.log(`[demo] seeded ${r.sessions} sessions (${r.scored} scored), ${r.terms} glossary terms, difficulty level ${r.level}`);
  }
}
