import { Router } from 'express';
import { z } from 'zod';
import { getProgress, getSummary } from '../services/progress.js';
import { checkWeeklyReview, listReviews, reviewStatus, lastReviewJob } from '../services/reviews.js';
import { resumeJobs } from '../jobs/runner.js';

export const progressRouter = Router();

progressRouter.get('/summary', async (req, res) => {
  res.json(await getSummary(req.user, req.tz));
});

progressRouter.get('/progress', async (req, res) => {
  const win = z.enum(['7d', '7a', 'all']).default('7a').parse(req.query.window);
  res.json(await getProgress(req.user, win, req.tz));
});

// Called once when the app opens: queues a weekly review if one is due.
progressRouter.post('/reviews/check', async (req, res) => {
  res.json(await checkWeeklyReview(req.user.id));
});

progressRouter.get('/reviews', async (req, res) => {
  await resumeJobs(req.user.id);
  const [reviews, status, last] = await Promise.all([listReviews(req.user.id), reviewStatus(req.user.id), lastReviewJob(req.user.id)]);
  res.json({
    reviews,
    ...status,
    last_failed: last?.status === 'failed' && !status.pending ? last.updated_at : null,
  });
});
