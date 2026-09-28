// POST /api/capture: called by the "Send to Journal" browser extension.
// Requires the capture token (X-Capture-Token header). CORS answers only
// browser-extension origins, and after the first valid capture only that one
// extension (its origin is pinned in settings until the token is regenerated).
import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { getSetting, setSetting } from '../services/settings.js';
import { createSession, httpError } from '../services/sessions.js';
import { countWords } from '../services/extract.js';

export const captureRouter = Router();

const isExtensionOrigin = (o) => /^(chrome|moz)-extension:\/\/[a-z0-9-]+$/i.test(o ?? '');

function originAllowed(origin) {
  if (!isExtensionOrigin(origin)) return false;
  const pinned = getSetting('extension_origin');
  return !pinned || pinned === origin;
}

function tokenMatches(given) {
  const expected = getSetting('capture_token');
  if (!given || !expected) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

captureRouter.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && originAllowed(origin)) {
    res.set({
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Capture-Token',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    });
  }
  if (req.method === 'OPTIONS') return res.status(origin && originAllowed(origin) ? 204 : 403).end();
  next();
});

const Capture = z.object({
  url: z.string().trim().url().max(2000),
  title: z.string().trim().min(1).max(300),
  author: z.string().trim().max(200).nullish(),
  published_at: z.string().trim().max(40).nullish(),
  text: z.string().min(1).max(200_000),
});

captureRouter.post('/', (req, res) => {
  if (!tokenMatches(req.get('X-Capture-Token'))) {
    throw httpError(401, 'Missing or wrong capture token. Copy it from the journal: Settings → Browser extension.');
  }
  const origin = req.headers.origin;
  if (!originAllowed(origin)) {
    throw httpError(403, isExtensionOrigin(origin)
      ? 'This journal is paired with a different extension. Generate a new token in Settings to re-pair.'
      : 'Captures are only accepted from the Send to Journal extension.');
  }
  if (!getSetting('extension_origin')) setSetting('extension_origin', origin);

  const body = Capture.parse(req.body);
  const words = countWords(body.text);
  if (words < 100) {
    throw httpError(422, `Only ${words} words were found on this page. Open the full article (logged in) and try again.`);
  }
  const { id, existing } = createSession(body);
  const host = req.get('host');
  res.status(existing ? 200 : 201).json({ id, existing, words, open_url: `http://${host}/session/${id}` });
});
