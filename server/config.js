// Runtime configuration, all from environment variables.
// Locally they come from .env.local (loaded by server/local.js); on Vercel
// from the project's environment settings.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const env = process.env;

export const config = {
  // Turso in production; a local SQLite file for development. On Vercel without
  // Turso (a preview before the database is set up) only /tmp is writable, so
  // the data there is temporary.
  dbUrl: env.TURSO_DATABASE_URL
    || (env.VERCEL ? 'file:/tmp/brj-preview.db' : `file:${join(ROOT, 'data', 'dev.db').replace(/\\/g, '/')}`),
  dbAuthToken: env.TURSO_AUTH_TOKEN || undefined,

  gemini: {
    apiKey: env.GEMINI_API_KEY || '',
    models: {
      light: env.GEMINI_MODEL_LIGHT || 'gemini-2.5-flash-lite',
      strong: env.GEMINI_MODEL_STRONG || 'gemini-2.5-flash',
    },
    timeoutMs: { light: 90_000, strong: 180_000 },
  },

  // Sign-up needs this code, so strangers can't use the Gemini quota.
  inviteCode: env.INVITE_CODE || '',
  // New articles each person may start per day (each one runs ~5 AI calls).
  articlesPerDay: Number(env.ARTICLES_PER_DAY) || 1,
  // Safety ceiling on AI calls per person per day: one article, its retries,
  // dictionary lookups, an extra round and the weekly review fit well inside it.
  aiDailyLimit: Number(env.AI_DAILY_LIMIT) || 30,
  // What the whole app may spend on Gemini per UTC day, in US dollars. At about
  // $0.045 an article, $0.50 covers ~11 articles a day (you plus ten testers),
  // so $5 of prepaid credit lasts at least ten days of full use.
  appDailyBudgetUsd: Number(env.APP_DAILY_BUDGET_USD) || 0.5,

  isVercel: Boolean(env.VERCEL),
  port: Number(env.PORT) || 4317,
};

export const paths = {
  root: ROOT,
  public: join(ROOT, 'public'),
};
