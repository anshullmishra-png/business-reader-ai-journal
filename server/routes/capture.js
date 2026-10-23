// POST /api/capture: called by the "Send to Readout" browser extension.
// The capture token (X-Capture-Token) identifies the user. CORS answers only
// browser-extension origins, and after a user's first valid capture only that
// one extension install (its origin is pinned until the token is regenerated).
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { createSession, httpError } from '../services/sessions.js';
import { countWords } from '../services/extract.js';

export const captureRouter = Router();

const isExtensionOrigin = (o) => /^(chrome|moz)-extension:\/\/[a-z0-9-]+$/i.test(o ?? '');

captureRouter.use((req, res, next) => {
  const origin = req.headers.origin;
  if (isExtensionOrigin(origin)) {
    res.set({
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Capture-Token, X-TZ-Offset',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    });
  }
  if (req.method === 'OPTIONS') return res.status(isExtensionOrigin(origin) ? 204 : 403).end();
  next();
});

const Capture = z.object({
  url: z.string().trim().url().max(2000),
  title: z.string().trim().min(1).max(300),
  author: z.string().trim().max(200).nullish(),
  published_at: z.string().trim().max(40).nullish(),
  text: z.string().min(1).max(200_000),
});

captureRouter.post('/', async (req, res) => {
  const token = String(req.get('X-Capture-Token') ?? '').trim();
  const user = token.length >= 20 ? await db.get('SELECT id, extension_origin FROM users WHERE capture_token = ?', token) : null;
  if (!user) {
    throw httpError(401, 'Missing or wrong capture token. Copy it from the journal: Settings → Browser extension.');
  }
  const origin = req.headers.origin;
  if (!isExtensionOrigin(origin)) throw httpError(403, 'Captures are only accepted from the Send to Readout extension.');
  if (user.extension_origin && user.extension_origin !== origin) {
    throw httpError(403, 'Your journal is paired with a different extension install. Generate a new token in Settings to re-pair.');
  }
  if (!user.extension_origin) await db.run('UPDATE users SET extension_origin = ? WHERE id = ?', origin, user.id);

  const body = Capture.parse(req.body);
  const words = countWords(body.text);
  if (words < 100) {
    throw httpError(422, `Only ${words} words were found on this page. Open the full article (logged in) and try again.`);
  }
  const { id, existing } = await createSession(user.id, body, { tzOffset: req.tz });
  const proto = req.headers['x-forwarded-proto'] ?? req.protocol;
  res.status(existing ? 200 : 201).json({ id, existing, words, open_url: `${proto}://${req.get('host')}/session/${id}` });
});
