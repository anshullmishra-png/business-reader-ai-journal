import { Router } from 'express';
import { z } from 'zod';
import { TagsEdit } from '../ai/schemas.js';
import { fetchArticle, ExtractError, countWords } from '../services/extract.js';
import {
  createSession, getSession, requireSession, listSessions, listToday, setTags, retryTagging,
  deleteSession, submitComprehension, startInterview, httpError, MIN_ARTICLE_WORDS,
} from '../services/sessions.js';
import { comprehensionWords, MIN_WORDS, MAX_WORDS } from '../services/words.js';
import { createMainSet, getMainSet, retryGeneration } from '../services/questions.js';
import { ensureRelated, listRelated, setRelatedDone } from '../services/related.js';

// Session plus related reading and the status of its main question set
// (never the questions themselves).
function sessionView(id) {
  let s = requireSession(id);
  if (s.related_status === 'none') {
    ensureRelated(id); // sessions captured before related reading existed
    s = requireSession(id);
  }
  const set = getMainSet(id);
  s.main_set = set ? { id: set.id, gen_status: set.gen_status, status: set.status } : null;
  s.related = s.related_status === 'ready' ? listRelated(id) : [];
  return s;
}

export const sessionsRouter = Router();

const Id = z.coerce.number().int().positive();
const MIN_PASTE_WORDS = 150;

sessionsRouter.get('/', (req, res) => {
  res.json(req.query.scope === 'today' ? listToday() : listSessions());
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

  if (body.mode === 'text') {
    if (countWords(body.text) < MIN_PASTE_WORDS) {
      throw httpError(422, `That's under ${MIN_PASTE_WORDS} words. Paste the full article text.`, { code: 'too_short' });
    }
    return res.status(201).json(createSession({ url: body.url ?? null, title: body.title, text: body.text }));
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
      'Use the Send to Journal extension from the article tab, or paste the text.',
      { code: 'too_short', title: article.title });
  }
  res.status(201).json(createSession({
    url: body.url, // keep the link the user pasted
    title: article.title,
    author: article.author,
    published_at: article.published_at,
    text: article.text,
  }));
});

sessionsRouter.get('/:id', (req, res) => {
  res.json(sessionView(Id.parse(req.params.id)));
});

// ---- Stage 2: Write ----
const Comprehension = z.object({
  text: z.string().max(5000),
  seconds: z.number().int().min(0).max(24 * 3600),
});

sessionsRouter.post('/:id/comprehension', (req, res) => {
  const id = Id.parse(req.params.id);
  const { text, seconds } = Comprehension.parse(req.body);
  const words = comprehensionWords(text);
  if (words < MIN_WORDS || words > MAX_WORDS) {
    throw httpError(422, `Your comprehension must be ${MIN_WORDS}–${MAX_WORDS} words. It's ${words}.`, { code: 'word_limit' });
  }
  // Question generation starts the moment the comprehension locks.
  submitComprehension(id, { text: text.trim(), seconds, onLocked: () => createMainSet(id) });
  res.json(sessionView(id));
});

// ---- Stage 3: Explore ----
sessionsRouter.patch('/:id/related/:itemId', (req, res) => {
  const id = Id.parse(req.params.id);
  const { done } = z.object({ done: z.boolean() }).parse(req.body);
  requireSession(id);
  if (!setRelatedDone(id, Id.parse(req.params.itemId), done)) throw httpError(404, 'Reading item not found');
  res.json(sessionView(id));
});

sessionsRouter.post('/:id/related/retry', (req, res) => {
  const id = Id.parse(req.params.id);
  requireSession(id);
  ensureRelated(id); // no-op unless it failed
  res.json(sessionView(id));
});

sessionsRouter.post('/:id/interview/start', (req, res) => {
  const id = Id.parse(req.params.id);
  startInterview(id);
  res.json(sessionView(id));
});

sessionsRouter.post('/:id/questions/retry', (req, res) => {
  const id = Id.parse(req.params.id);
  const set = getMainSet(id);
  if (!set) throw httpError(409, 'Questions are generated after you submit your comprehension.');
  retryGeneration(set.id);
  res.json(sessionView(id));
});

// Tags stay editable at every stage: they're metadata, not a graded answer.
sessionsRouter.put('/:id/tags', (req, res) => {
  const id = Id.parse(req.params.id);
  requireSession(id);
  setTags(id, TagsEdit.parse(req.body), 'ready');
  res.json(sessionView(id));
});

sessionsRouter.post('/:id/tags/retry', (req, res) => {
  const id = Id.parse(req.params.id);
  retryTagging(id);
  res.json(sessionView(id));
});

sessionsRouter.delete('/:id', (req, res) => {
  deleteSession(Id.parse(req.params.id));
  res.status(204).end();
});
