// Sign-up, sign-in, sign-out, and the signed-in user's settings and data export.
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { callsToday, appSpendToday } from '../ai/gemini.js';
import { articlesToday } from '../services/sessions.js';
import {
  signUp, signIn, signOut, readCookie, setSessionCookie, clearSessionCookie, requireUser,
  publicUser, updateSettings, regenerateCaptureToken,
} from '../services/auth.js';

export const authRouter = Router();
export const meRouter = Router();

const SignUp = z.object({
  name: z.string().trim().min(1, 'Enter your name.').max(60),
  email: z.string().trim().email('Enter a valid email.').max(200),
  password: z.string().min(8, 'Use at least 8 characters.').max(200),
  invite: z.string().trim().min(1, 'Enter the invite code.').max(100),
});

authRouter.post('/signup', async (req, res) => {
  const body = SignUp.parse(req.body);
  setSessionCookie(req, res, await signUp(body));
  res.status(201).json({ ok: true });
});

authRouter.post('/signin', async (req, res) => {
  const body = z.object({ email: z.string().trim().max(200), password: z.string().max(200) }).parse(req.body);
  setSessionCookie(req, res, await signIn(body));
  res.json({ ok: true });
});

authRouter.post('/signout', async (req, res) => {
  await signOut(readCookie(req));
  clearSessionCookie(res);
  res.json({ ok: true });
});

// ---- The signed-in user ----
meRouter.use(requireUser);

meRouter.get('/', async (req, res) => {
  const [today, articles, appSpend] = await Promise.all([
    callsToday(req.user.id), articlesToday(req.user.id, req.tz), appSpendToday(),
  ]);
  res.json({
    ...publicUser(req.user),
    ai: {
      configured: Boolean(config.gemini.apiKey),
      articles_today: articles,
      articles_per_day: config.articlesPerDay,
      calls_today: today.total,
      daily_limit: config.aiDailyLimit,
      input_tokens_today: today.input_tokens,
      output_tokens_today: today.output_tokens,
      cost_today_usd: today.cost_usd,
      app_spend_today_usd: appSpend,
      app_budget_usd: config.appDailyBudgetUsd,
    },
  });
});

const Patch = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  timer_seconds: z.number().int().min(20).max(300).optional(),
  template_default: z.boolean().optional(),
}).strict();

meRouter.patch('/settings', async (req, res) => {
  await updateSettings(req.user.id, Patch.parse(req.body ?? {}));
  const u = await db.get('SELECT * FROM users WHERE id = ?', req.user.id);
  res.json(publicUser(u));
});

meRouter.post('/capture-token', async (req, res) => {
  res.json({ capture_token: await regenerateCaptureToken(req.user.id) });
});

// Everything the user has written, as one JSON file (article text excluded).
meRouter.get('/export', async (req, res) => {
  const id = req.user.id;
  const sessions = await db.all(`SELECT id, url, source, title, author, published_at, word_count, tags, stage,
    comprehension_text, comprehension_seconds, comprehension_eval, comprehension_score, interview_score, overall_score,
    verdict, created_at FROM sessions WHERE user_id = ? ORDER BY created_at`, id);
  const ids = sessions.map((s) => s.id);
  const inList = ids.map(() => '?').join(',') || 'NULL';
  const [sets, questions, glossary, reviews] = await Promise.all([
    db.all(`SELECT * FROM question_sets WHERE session_id IN (${inList})`, ...ids),
    db.all(`SELECT q.* FROM questions q JOIN question_sets qs ON qs.id = q.set_id WHERE qs.session_id IN (${inList})`, ...ids),
    db.all('SELECT display_term, entry, extra_examples, sector, lookup_count, leitner_box, created_at FROM glossary_terms WHERE user_id = ?', id),
    db.all('SELECT period_start, period_end, content, created_at FROM weekly_reviews WHERE user_id = ?', id),
  ]);
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Disposition', `attachment; filename="readout-${stamp}.json"`);
  res.json({ exported_at: new Date().toISOString(), user: { name: req.user.name, email: req.user.email }, sessions, question_sets: sets, questions, glossary, weekly_reviews: reviews });
});
