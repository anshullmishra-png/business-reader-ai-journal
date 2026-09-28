import { Router } from 'express';
import { z } from 'zod';
import { TagsEdit } from '../ai/schemas.js';
import { fetchArticle, ExtractError, countWords } from '../services/extract.js';
import {
  createSession, getSession, requireSession, listSessions, listToday, setTags, retryTagging,
  deleteSession, httpError, MIN_ARTICLE_WORDS,
} from '../services/sessions.js';

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
  res.json(requireSession(Id.parse(req.params.id)));
});

// Tags stay editable at every stage: they're metadata, not a graded answer.
sessionsRouter.put('/:id/tags', (req, res) => {
  const id = Id.parse(req.params.id);
  requireSession(id);
  setTags(id, TagsEdit.parse(req.body), 'ready');
  res.json(getSession(id));
});

sessionsRouter.post('/:id/tags/retry', (req, res) => {
  const id = Id.parse(req.params.id);
  retryTagging(id);
  res.json(getSession(id));
});

sessionsRouter.delete('/:id', (req, res) => {
  deleteSession(Id.parse(req.params.id));
  res.status(204).end();
});
