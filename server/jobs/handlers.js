// Registers every background job type. Imported once by server/index.js.
import { registerHandler } from './runner.js';
import { runTask } from '../ai/claudeBridge.js';
import { tagArticle } from '../ai/prompts/tagArticle.js';
import { SOURCES } from '../ai/taxonomy.js';
import { getSession, getArticleText, setTags } from '../services/sessions.js';

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
