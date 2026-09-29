// Registers every background job type. Imported once by server/index.js.
import { registerHandler } from './runner.js';
import { runTask } from '../ai/claudeBridge.js';
import { tagArticle } from '../ai/prompts/tagArticle.js';
import { generateQuestions } from '../ai/prompts/generateQuestions.js';
import { SOURCES } from '../ai/taxonomy.js';
import { getSession, getArticleText, setTags } from '../services/sessions.js';
import { getSet, saveQuestions, setGenStatus, recentHistory } from '../services/questions.js';
import { getSetting } from '../services/settings.js';
import { relatedReading } from '../ai/prompts/relatedReading.js';
import { saveRelated, markRelatedFailed } from '../services/related.js';

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
    const { questions } = await runTask(generateQuestions({
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
