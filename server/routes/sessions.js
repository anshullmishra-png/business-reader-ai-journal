import { Router } from 'express';
import { z } from 'zod';
import { TagsEdit } from '../ai/schemas.js';
import { fetchArticle, ExtractError, countWords } from '../services/extract.js';
import {
  createSession, requireSession, listSessions, localMidnight, setTags, retryTagging,
  deleteSession, submitComprehension, startInterview, httpError, MIN_ARTICLE_WORDS, getArticleText,
} from '../services/sessions.js';
import { comprehensionWords, MIN_WORDS, MAX_WORDS } from '../services/words.js';
import { createMainSet, getMainSet, retryGeneration } from '../services/questions.js';
import { ensureRelated, listRelated, setRelatedDone } from '../services/related.js';
import { currentQuestion, answerQuestion } from '../services/interview.js';
import { getResults, createExtraSet, startExtraSet, EXTRA_LEVELS } from '../services/results.js';
import { retryEvaluation } from '../services/evaluation.js';
import { resumeJobs } from '../jobs/runner.js';

// Session plus related reading and the status of its main question set
// (never the questions themselves). Polling here also restarts any of the
// user's background jobs that were cut off.
async function sessionView(user, id) {
  await resumeJobs(user.id);
  let s = await requireSession(user.id, id);
  if (s.related_status === 'none') {
    await ensureRelated(user.id, id);
    s = await requireSession(user.id, id);
  }
  let set = await getMainSet(id);
  if (!set && s.stage !== 'write') {
    await createMainSet(user.id, id); // self-heal if the set was never created
    set = await getMainSet(id);
  }
  s.main_set = set ? { id: set.id, gen_status: set.gen_status, status: set.status } : null;
  s.related = s.related_status === 'ready' ? await listRelated(id) : [];
  return s;
}

export const sessionsRouter = Router();

const Id = z.coerce.number().int().positive();
const MIN_PASTE_WORDS = 150;

sessionsRouter.get('/', async (req, res) => {
  const since = req.query.scope === 'today' ? localMidnight(req.tz) : null;
  res.json(await listSessions(req.user.id, { since }));
});

const Create = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('url'), url: z.string().trim().url().max(2000) }),
  z.object({
    mode: z.literal('text'),
    title: z.string().trim().min(1).max(300),
    text: z.string().min(1).max(200_000),
    url: z.string().trim().url().max(2000).optional().or(z.literal('').transform(() => undefined)),
  }),
]);

sessionsRouter.post('/', async (req, res) => {
  const body = Create.parse(req.body);
  const opts = { tzOffset: req.tz };

  if (body.mode === 'text') {
    if (countWords(body.text) < MIN_PASTE_WORDS) {
      throw httpError(422, `That's under ${MIN_PASTE_WORDS} words. Paste the full article text.`, { code: 'too_short' });
    }
    return res.status(201).json(await createSession(req.user.id, { url: body.url ?? null, title: body.title, text: body.text }, opts));
  }

  let article;
  try {
    article = await fetchArticle(body.url);
  } catch (err) {
    if (err instanceof ExtractError) throw httpError(422, err.message, { code: err.code });
    throw err;
  }
  if (article.word_count < MIN_ARTICLE_WORDS) {
    throw httpError(422,
      `Only ${article.word_count} words came through, so this is probably a paywall or a teaser. ` +
      'Use the Send to Readout extension from the article tab, or paste the text.',
      { code: 'too_short', title: article.title });
  }
  res.status(201).json(await createSession(req.user.id, {
    url: body.url, // keep the link the user pasted
    title: article.title,
    author: article.author,
    published_at: article.published_at,
    text: article.text,
  }, opts));
});

sessionsRouter.get('/:id', async (req, res) => {
  res.json(await sessionView(req.user, Id.parse(req.params.id)));
});

// The article text, for articles the reader pasted themselves (no original page to
// go back to). Linked articles are read on their own site. Hidden during the interview.
sessionsRouter.get('/:id/article', async (req, res) => {
  const id = Id.parse(req.params.id);
  const s = await requireSession(req.user.id, id);
  if (s.url) throw httpError(404, 'Read this article on its original site.');
  if (s.stage === 'interview') throw httpError(409, 'The article is hidden during the interview.');
  res.json({ text: await getArticleText(id) });
});

// ---- Stage 2: Write ----
const Comprehension = z.object({
  text: z.string().max(5000),
  seconds: z.number().int().min(0).max(24 * 3600),
});

sessionsRouter.post('/:id/comprehension', async (req, res) => {
  const id = Id.parse(req.params.id);
  const { text, seconds } = Comprehension.parse(req.body);
  const words = comprehensionWords(text);
  if (words < MIN_WORDS || words > MAX_WORDS) {
    throw httpError(422, `Your comprehension must be ${MIN_WORDS}–${MAX_WORDS} words. It's ${words}.`, { code: 'word_limit' });
  }
  await submitComprehension(req.user.id, id, { text: text.trim(), seconds });
  // Question generation starts the moment the comprehension locks.
  await createMainSet(req.user.id, id);
  res.json(await sessionView(req.user, id));
});

// ---- Stage 3: Explore ----
sessionsRouter.patch('/:id/related/:itemId', async (req, res) => {
  const id = Id.parse(req.params.id);
  const { done } = z.object({ done: z.boolean() }).parse(req.body);
  await requireSession(req.user.id, id);
  if (!(await setRelatedDone(id, Id.parse(req.params.itemId), done))) throw httpError(404, 'Reading item not found');
  res.json(await sessionView(req.user, id));
});

sessionsRouter.post('/:id/related/retry', async (req, res) => {
  const id = Id.parse(req.params.id);
  await requireSession(req.user.id, id);
  await ensureRelated(req.user.id, id); // no-op unless it failed
  res.json(await sessionView(req.user, id));
});

sessionsRouter.post('/:id/interview/start', async (req, res) => {
  const id = Id.parse(req.params.id);
  await startInterview(req.user.id, id);
  res.json(await sessionView(req.user, id));
});

// ---- Stage 4: Interview (also used by extra rounds) ----
sessionsRouter.get('/:id/sets/:setId/current', async (req, res) => {
  const id = Id.parse(req.params.id);
  await requireSession(req.user.id, id);
  res.json(await currentQuestion(req.user, id, Id.parse(req.params.setId)));
});

const Answer = z.object({
  question_id: z.number().int().positive(),
  answer: z.string().max(3000).nullable(),
  auto_submitted: z.boolean().default(false),
});

sessionsRouter.post('/:id/sets/:setId/answer', async (req, res) => {
  const id = Id.parse(req.params.id);
  const setId = Id.parse(req.params.setId);
  await requireSession(req.user.id, id);
  const a = Answer.parse(req.body);
  const result = await answerQuestion(req.user, id, setId, { questionId: a.question_id, answer: a.answer, autoSubmitted: a.auto_submitted });
  res.json({ ...result, next: await currentQuestion(req.user, id, setId) });
});

// ---- Stage 5: Verdict, and Stage 6: extra rounds ----
sessionsRouter.get('/:id/results', async (req, res) => {
  await resumeJobs(req.user.id);
  res.json(await getResults(req.user.id, Id.parse(req.params.id)));
});

sessionsRouter.post('/:id/sets/:setId/evaluation/retry', async (req, res) => {
  const id = Id.parse(req.params.id);
  await requireSession(req.user.id, id);
  await retryEvaluation(req.user.id, Id.parse(req.params.setId));
  res.json(await getResults(req.user.id, id));
});

sessionsRouter.post('/:id/extra', async (req, res) => {
  const id = Id.parse(req.params.id);
  const { level } = z.object({ level: z.enum(EXTRA_LEVELS) }).parse(req.body);
  await createExtraSet(req.user.id, id, level);
  res.status(201).json(await getResults(req.user.id, id));
});

sessionsRouter.post('/:id/sets/:setId/start', async (req, res) => {
  const id = Id.parse(req.params.id);
  await startExtraSet(req.user.id, id, Id.parse(req.params.setId));
  res.json(await getResults(req.user.id, id));
});

sessionsRouter.post('/:id/questions/retry', async (req, res) => {
  const id = Id.parse(req.params.id);
  await requireSession(req.user.id, id);
  const set = await getMainSet(id);
  if (!set) throw httpError(409, 'Questions are generated after you submit your comprehension.');
  await retryGeneration(req.user.id, set.id);
  res.json(await sessionView(req.user, id));
});

// Tags stay editable at every stage: they're metadata, not a graded answer.
sessionsRouter.put('/:id/tags', async (req, res) => {
  const id = Id.parse(req.params.id);
  await requireSession(req.user.id, id);
  await setTags(req.user.id, id, TagsEdit.parse(req.body), 'ready');
  res.json(await sessionView(req.user, id));
});

sessionsRouter.post('/:id/tags/retry', async (req, res) => {
  const id = Id.parse(req.params.id);
  await retryTagging(req.user.id, id);
  res.json(await sessionView(req.user, id));
});

sessionsRouter.delete('/:id', async (req, res) => {
  await deleteSession(req.user.id, Id.parse(req.params.id));
  res.status(204).end();
});
