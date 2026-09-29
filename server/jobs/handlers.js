// Registers every background job type. Imported once by server/index.js.
import { registerHandler } from './runner.js';
import { db } from '../db/index.js';
import { runTask } from '../ai/claudeBridge.js';
import { tagArticle } from '../ai/prompts/tagArticle.js';
import { generateQuestions } from '../ai/prompts/generateQuestions.js';
import { SOURCES } from '../ai/taxonomy.js';
import { getSession, getArticleText, setTags } from '../services/sessions.js';
import { getSet, saveQuestions, setGenStatus, recentHistory } from '../services/questions.js';
import { getSetting } from '../services/settings.js';
import { relatedReading } from '../ai/prompts/relatedReading.js';
import { saveRelated, markRelatedFailed } from '../services/related.js';
import { evaluateSet, markEvaluationFailed } from '../services/evaluation.js';
import { writeReview } from '../services/reviews.js';

registerHandler('weekly_review', {
  run: (job) => writeReview(job.payload),
  fail: () => {}, // the failed job row is enough; the next app open retries
});

// Main interview and extra rounds share the evaluator; only the prompt differs.
for (const task of ['evaluate_session', 'evaluate_extra']) {
  registerHandler(task, {
    run: (job) => evaluateSet(job.set_id),
    fail: (job) => markEvaluationFailed(job.set_id),
  });
}

registerHandler('related_reading', {
  async run(job) {
    const s = getSession(job.session_id);
    if (!s) return;
    const { items } = await runTask(relatedReading({
      title: s.title,
      source: SOURCES[s.source],
      text: getArticleText(s.id),
    }));
    saveRelated(s.id, items);
  },
  fail(job) {
    if (getSession(job.session_id)) markRelatedFailed(job.session_id);
  },
});

registerHandler('tag_article', {
  async run(job) {
    const s = getSession(job.session_id);
    if (!s) return; // deleted meanwhile
    const tags = await runTask(tagArticle({
      title: s.title,
      source: SOURCES[s.source],
      text: getArticleText(s.id),
    }));
    setTags(s.id, tags, 'ready');
  },
  fail(job) {
    if (getSession(job.session_id)) setTags(job.session_id, null, 'failed');
  },
});

registerHandler('generate_questions', {
  async run(job) {
    const s = getSession(job.session_id);
    const set = getSet(job.set_id);
    if (!s || !set) return;
    const history = recentHistory(s.id);
    const avoid = db.prepare(`SELECT q.prompt FROM questions q JOIN question_sets qs ON qs.id = q.set_id
                              WHERE qs.session_id = ? AND qs.id != ?`).all(s.id, set.id).map((r) => r.prompt);
    const { questions } = await runTask(generateQuestions({
      avoid,
      task: set.kind === 'extra' ? 'generateExtraRound' : 'generateQuestions',
      title: s.title,
      source: SOURCES[s.source],
      text: getArticleText(s.id),
      difficulty: set.difficulty_at_time,
      timerSeconds: getSetting('timer_seconds'),
      history,
    }));
    saveQuestions(set.id, questions, { allowCrossArticle: history.length > 0 });
  },
  fail(job) {
    if (getSet(job.set_id)) setGenStatus(job.set_id, 'failed');
  },
});
