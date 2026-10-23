import { Router } from 'express';
import { z } from 'zod';
import {
  lookup, addExamples, listTerms, getTerm, deleteTerm, buildQuiz, recordReview, boxCounts,
} from '../services/glossary.js';
import { GLOSSARY_SECTORS } from '../ai/schemas.js';

export const glossaryRouter = Router();
const Id = z.coerce.number().int().positive();

glossaryRouter.post('/lookup', async (req, res) => {
  const { term, session_id } = z.object({
    term: z.string().trim().min(1).max(80),
    session_id: z.number().int().positive().nullish(),
  }).parse(req.body);
  res.json(await lookup(req.user.id, term, session_id ?? null));
});

glossaryRouter.get('/', async (req, res) => {
  const { q, sort, sector } = z.object({
    q: z.string().trim().max(80).optional(),
    sort: z.enum(['az', 'count', 'newest']).optional(),
    sector: z.string().max(60).optional(),
  }).parse(req.query);
  const [terms, boxes] = await Promise.all([listTerms(req.user.id, { q, sort, sector }), boxCounts(req.user.id)]);
  res.json({ terms, boxes, sectors: GLOSSARY_SECTORS });
});

glossaryRouter.get('/quiz', async (req, res) => {
  const size = z.coerce.number().int().min(1).max(30).default(10).parse(req.query.size);
  res.json(await buildQuiz(req.user.id, size));
});

glossaryRouter.get('/:id', async (req, res) => res.json(await getTerm(req.user.id, Id.parse(req.params.id))));

glossaryRouter.post('/:id/more-examples', async (req, res) => {
  res.json(await addExamples(req.user.id, Id.parse(req.params.id)));
});

glossaryRouter.post('/:id/review', async (req, res) => {
  const { correct } = z.object({ correct: z.boolean() }).parse(req.body);
  res.json(await recordReview(req.user.id, Id.parse(req.params.id), correct));
});

glossaryRouter.delete('/:id', async (req, res) => {
  await deleteTerm(req.user.id, Id.parse(req.params.id));
  res.status(204).end();
});
