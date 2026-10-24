// The Express app (API only). Vercel serves it through api/index.js; locally,
// server/local.js adds static files and listens on a port.
import express from 'express';
import { ZodError } from 'zod';
import { ensureDb } from './db/index.js';
import { requireUser } from './services/auth.js';
import { authRouter, meRouter } from './routes/account.js';
import { sessionsRouter } from './routes/sessions.js';
import { captureRouter } from './routes/capture.js';
import { glossaryRouter } from './routes/glossary.js';
import { progressRouter } from './routes/progress.js';
import { AiError, friendlyMessage } from './ai/gemini.js';
import { SECTORS, COMPANY_STAGES, SOURCES } from './ai/taxonomy.js';
import './jobs/handlers.js';

export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    'Cache-Control': 'no-store',
  });
  // The reader's timezone (minutes, as Date#getTimezoneOffset), for "today" and streaks.
  const tz = Number(req.get('X-TZ-Offset'));
  req.tz = Number.isFinite(tz) && Math.abs(tz) <= 840 ? tz : 0;
  next();
});

// Migrations run once per cold start; every request waits for them.
app.use(async (_req, _res, next) => {
  try {
    await ensureDb();
    next();
  } catch (err) {
    next(err);
  }
});

// A stray rejected promise (say, a background job losing its connection) must not
// take the whole server down with the requests it is serving.
process.on('unhandledRejection', (err) => console.error('[unhandled]', err?.message ?? err));
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/meta', (_req, res) => res.json({ sectors: SECTORS, company_stages: COMPANY_STAGES, sources: SOURCES }));

app.use('/api/auth', authRouter);
app.use('/api/capture', captureRouter); // authenticates by capture token, not cookie
app.use('/api/me', meRouter);
app.use('/api/sessions', requireUser, sessionsRouter);
app.use('/api/glossary', requireUser, glossaryRouter);
app.use('/api', requireUser, progressRouter);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// ---- Errors ----
app.use((err, _req, res, _next) => {
  if (err instanceof ZodError) {
    const first = err.issues[0];
    return res.status(400).json({ error: first?.message && !/^Invalid/.test(first.message) ? first.message : 'Check what you entered and try again.', issues: err.issues });
  }
  if (err instanceof AiError) return res.status(['quota', 'busy', 'budget', 'credit'].includes(err.code) ? 429 : 503).json({ error: friendlyMessage(err), code: err.code });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That article is too long.' });
  if (err.status) {
    const { status, message, code, title } = err;
    return res.status(status).json({ error: message, code, title });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});
