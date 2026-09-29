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
  res.json(await lookup(term, session_id ?? null));
});

glossaryRouter.get('/', (req, res) => {
  const { q, sort, sector } = z.object({
    q: z.string().trim().max(80).optional(),
    sort: z.enum(['az', 'count', 'newest']).optional(),
    sector: z.string().max(60).optional(),
  }).parse(req.query);
  res.json({ terms: listTerms({ q, sort, sector }), boxes: boxCounts(), sectors: GLOSSARY_SECTORS });
});

glossaryRouter.get('/quiz', (req, res) => {
  const size = z.coerce.number().int().min(1).max(30).default(10).parse(req.query.size);
  res.json(buildQuiz(size));
});

glossaryRouter.get('/:id', (req, res) => res.json(getTerm(Id.parse(req.params.id))));

glossaryRouter.post('/:id/more-examples', async (req, res) => {
  res.json(await addExamples(Id.parse(req.params.id)));
});

glossaryRouter.post('/:id/review', (req, res) => {
  const { correct } = z.object({ correct: z.boolean() }).parse(req.body);
  res.json(recordReview(Id.parse(req.params.id), correct));
});

glossaryRouter.delete('/:id', (req, res) => {
  deleteTerm(Id.parse(req.params.id));
  res.status(204).end();
});
