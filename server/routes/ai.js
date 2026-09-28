import { Router } from 'express';
import { getHealth, recheckHealth } from '../ai/health.js';

export const aiRouter = Router();

aiRouter.get('/health', (_req, res) => {
  res.json(getHealth());
});

// Starts a recheck and returns immediately; the client polls GET /health.
aiRouter.post('/health/recheck', (_req, res) => {
  recheckHealth();
  res.json(getHealth());
});
