import { Router } from 'express';
import { z } from 'zod';
import { getAllSettings, setSetting, newCaptureToken } from '../services/settings.js';

export const settingsRouter = Router();

const Patch = z.object({
  name: z.string().trim().max(60).optional(),
  timer_seconds: z.number().int().min(20).max(300).optional(),
  template_default: z.boolean().optional(),
}).strict();

settingsRouter.get('/', (_req, res) => {
  res.json(getAllSettings());
});

settingsRouter.patch('/', (req, res) => {
  const patch = Patch.parse(req.body ?? {});
  for (const [k, v] of Object.entries(patch)) setSetting(k, v);
  res.json(getAllSettings());
});

settingsRouter.post('/capture-token/regenerate', (_req, res) => {
  const token = newCaptureToken();
  setSetting('extension_origin', null); // re-pair the extension with the new token
  res.json({ capture_token: token });
});
