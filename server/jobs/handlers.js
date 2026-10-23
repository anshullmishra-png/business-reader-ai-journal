// Registers every background job type. Imported once by server/app.js.
// Every job carries the user it belongs to.
import { registerHandler } from './runner.js';
import { db } from '../db/index.js';
import { runTask } from '../ai/gemini.js';
import { tagArticle } from '../ai/prompts/tagArticle.js';
import { generateQuestions } from '../ai/prompts/generateQuestions.js';
import { relatedReading } from '../ai/prompts/relatedReading.js';
import { SOURCES } from '../ai/taxonomy.js';
import { getSession, getArticleText, setTags } from '../services/sessions.js';
import { getSet, saveQuestions, setGenStatus, recentHistory } from '../services/questions.js';
import { saveRelated, markRelatedFailed } from '../services/related.js';
import { evaluateSet, markEvaluationFailed } from '../services/evaluation.js';
import { writeReview } from '../services/reviews.js';

registerHandler('weekly_review', {
  run: (job) => writeReview(job.user_id, job.payload),
  fail: async () => {}, // the failed job row is enough; the next app open retries
});

// Main interview and extra rounds share the evaluator; only the prompt differs.
for (const task of ['evaluate_session', 'evaluate_extra']) {
  registerHandler(task, {
    run: (job) => evaluateSet(job.user_id, job.set_id),
    fail: (job) => markEvaluationFailed(job.set_id),
  });
}

registerHandler('related_reading', {
  async run(job) {
    const s = await getSession(job.user_id, job.session_id);
    if (!s) return;
    const { items } = await runTask({
      ...relatedReading({ title: s.title, source: SOURCES[s.source], text: await getArticleText(s.id) }),
      userId: job.user_id,
    });
    await saveRelated(s.id, items);
  },
  async fail(job) {
    if (await getSession(job.user_id, job.session_id)) await markRelatedFailed(job.session_id);
  },
});

registerHandler('tag_article', {
  async run(job) {
    const s = await getSession(job.user_id, job.session_id);
    if (!s) return; // deleted meanwhile
    const tags = await runTask({
      ...tagArticle({ title: s.title, source: SOURCES[s.source], text: await getArticleText(s.id) }),
      userId: job.user_id,
    });
    await setTags(job.user_id, s.id, tags, 'ready');
  },
  async fail(job) {
    if (await getSession(job.user_id, job.session_id)) await setTags(job.user_id, job.session_id, null, 'failed');
  },
});

registerHandler('generate_questions', {
  async run(job) {
    const s = await getSession(job.user_id, job.session_id);
    const set = await getSet(job.set_id);
    if (!s || !set) return;
    const [history, avoidRows, user] = await Promise.all([
      recentHistory(job.user_id, s.id),
      db.all(`SELECT q.prompt FROM questions q JOIN question_sets qs ON qs.id = q.set_id
              WHERE qs.session_id = ? AND qs.id != ?`, s.id, set.id),
      db.get('SELECT timer_seconds FROM users WHERE id = ?', job.user_id),
    ]);
    const { questions } = await runTask({
      ...generateQuestions({
        avoid: avoidRows.map((r) => r.prompt),
        task: set.kind === 'extra' ? 'generateExtraRound' : 'generateQuestions',
        title: s.title,
        source: SOURCES[s.source],
        text: await getArticleText(s.id),
        difficulty: set.difficulty_at_time,
        timerSeconds: user.timer_seconds,
        history,
      }),
      userId: job.user_id,
    });
    await saveQuestions(set.id, questions, { allowCrossArticle: history.length > 0 });
  },
  async fail(job) {
    if (await getSet(job.set_id)) await setGenStatus(job.set_id, 'failed');
  },
});
