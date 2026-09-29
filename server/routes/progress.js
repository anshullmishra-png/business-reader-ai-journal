import { Router } from 'express';
import { z } from 'zod';
import { getProgress, getSummary } from '../services/progress.js';
import { checkWeeklyReview, listReviews, reviewStatus, lastFailedReview } from '../services/reviews.js';

export const progressRouter = Router();

progressRouter.get('/summary', (_req, res) => {
  res.json(getSummary());
});

progressRouter.get('/progress', (req, res) => {
  const win = z.enum(['7d', '7a', 'all']).default('7a').parse(req.query.window);
  res.json(getProgress(win));
});

// Called once when the app opens: queues a weekly review if one is due.
progressRouter.post('/reviews/check', (_req, res) => {
  res.json(checkWeeklyReview());
});

progressRouter.get('/reviews', (_req, res) => {
  const last = lastFailedReview();
  res.json({
    reviews: listReviews(),
    ...reviewStatus(),
    last_failed: last?.error && !reviewStatus().pending ? last.updated_at : null,
  });
});
