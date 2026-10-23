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
    // Two keys: the paid key (prepaid credit, capped below) and a free-tier key
    // from a Google project without billing. Accounts on the free plan only ever
    // use the free key; paid accounts fall back to it once the paid caps are hit.
    apiKey: env.GEMINI_API_KEY || '',
    freeApiKey: env.GEMINI_API_KEY_FREE || '',
    models: {
      // Gemini 2.5 is closed to new users; these are the current models with a free tier.
      light: env.GEMINI_MODEL_LIGHT || 'gemini-3.1-flash-lite',
      strong: env.GEMINI_MODEL_STRONG || 'gemini-3.6-flash',
    },
    // When a model is overloaded (503) or rate-limited (429) after a retry, the
    // task moves to this model instead of failing. Free-tier limits are per model.
    fallbacks: {
      light: env.GEMINI_MODEL_LIGHT_FALLBACK || 'gemini-3.5-flash-lite',
      strong: env.GEMINI_MODEL_STRONG_FALLBACK || 'gemini-3.5-flash-lite',
    },
    timeoutMs: { light: 90_000, strong: 180_000 },
  },

  // Sign-up needs one of these codes, so strangers can't use the Gemini quota.
  // INVITE_CODE makes a free-plan account; INVITE_CODE_PAID a paid-plan one
  // (and upgrades an existing account when entered in Settings).
  inviteCode: env.INVITE_CODE || '',
  paidInviteCode: env.INVITE_CODE_PAID || '',
  // New articles each person may start per day (each one runs ~5 AI calls).
  articlesPerDay: Number(env.ARTICLES_PER_DAY) || 1,
  // Safety ceiling on AI calls per person per day: one article, its retries,
  // dictionary lookups, an extra round and the weekly review fit well inside it.
  aiDailyLimit: Number(env.AI_DAILY_LIMIT) || 30,
  // What the paid key may spend per UTC day, in US dollars. At about $0.075 an
  // article (Gemini 3.6 Flash, 2026 prices), $0.50 covers ~6 paid articles a day,
  // so $5 of prepaid credit lasts at least ten days of full use.
  appDailyBudgetUsd: Number(env.APP_DAILY_BUDGET_USD) || 0.5,
  // All-time Gemini spend cap in USD. The app can't read the Google balance, so this
  // stops new AI work just before $5 of prepaid credit runs out. Raise it after a top-up.
  lifetimeBudgetUsd: Number(env.LIFETIME_BUDGET_USD) || 4.8,

  isVercel: Boolean(env.VERCEL),
  port: Number(env.PORT) || 4317,
};

export const paths = {
  root: ROOT,
  public: join(ROOT, 'public'),
};
