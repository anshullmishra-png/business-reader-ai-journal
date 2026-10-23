// The only way the app talks to an AI: Gemini, via @google/genai. Every
// feature calls runTask() with a zod schema; the schema is sent as the
// response JSON schema and the reply is validated again before use.
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { config } from '../config.js';
import { db, now } from '../db/index.js';

export class AiError extends Error {
  /** @param {'not_configured'|'quota'|'busy'|'budget'|'credit'|'timeout'|'invalid_output'|'failed'} code */
  constructor(code, message, detail) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

const FRIENDLY = {
  not_configured: "The AI isn't configured on the server yet.",
  quota: "You've reached today's AI limit. It resets at midnight UTC.",
  busy: "The free AI has hit Google's usage limit for now. Try again in a while.",
  budget: "Readout has used up today's AI budget. It resets at midnight UTC.",
  credit: 'Readout has used its AI credit. AI features are paused until it is topped up.',
  timeout: 'The AI took too long to answer. Try again.',
  invalid_output: "The AI's answer wasn't in the expected format. Try again.",
  failed: 'The AI call failed. Try again.',
};
export const friendlyMessage = (err) => (err instanceof AiError ? FRIENDLY[err.code] : null) ?? FRIENDLY.failed;

const keyOf = (keyTier) => (keyTier === 'paid' ? config.gemini.apiKey : config.gemini.freeApiKey);
const clients = {};
const client = (keyTier) => {
  const apiKey = keyOf(keyTier);
  if (!apiKey) throw new AiError('not_configured', `no ${keyTier} Gemini key`);
  clients[keyTier] ??= new GoogleGenAI({ apiKey });
  return clients[keyTier];
};

// Never let a key travel upward in an error message.
const redact = (msg) => [config.gemini.apiKey, config.gemini.freeApiKey]
  .filter(Boolean).reduce((m, k) => m.split(k).join('[key]'), String(msg));

// Paid-tier text prices in USD per 1M tokens (ai.google.dev/gemini-api/docs/pricing).
// Thinking tokens are billed as output. 3.6/3.8 Flash double on 1 Jan 2027.
const FLASH_2026 = { input: 0.75, output: 3.75 };
const FLASH_2027 = { input: 1.50, output: 7.50 };
const PRICES = {
  'gemini-3.8-flash': [FLASH_2026, FLASH_2027],
  'gemini-3.6-flash': [FLASH_2026, FLASH_2027],
  'gemini-3.5-flash-lite': { input: 0.30, output: 2.50 },
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.50 },
  'gemini-2.5-flash': { input: 0.30, output: 2.50 },
  'gemini-2.5-flash-lite': { input: 0.10, output: 0.40 },
};
const PRICE_CHANGE = '2027-01-01T00:00:00.000Z';
// Unknown model: assume the dearest current price, so the budgets err on the safe side.
const priceOf = (model) => {
  const p = PRICES[model] ?? [FLASH_2026, FLASH_2027];
  return Array.isArray(p) ? p[new Date().toISOString() >= PRICE_CHANGE ? 1 : 0] : p;
};

function usageOf(model, meta) {
  const input = meta?.promptTokenCount ?? 0;
  const output = meta?.candidatesTokenCount ?? 0;
  const thinking = meta?.thoughtsTokenCount ?? 0;
  const p = priceOf(model);
  return { input, output, thinking, cost: (input * p.input + (output + thinking) * p.output) / 1e6 };
}

// Tokens are logged for both keys; only the paid key's calls carry a cost.
async function logCall(userId, task, model, keyTier, ms, ok, error, usage = null) {
  const u = usage ?? { input: 0, output: 0, thinking: 0, cost: 0 };
  await db.run(`INSERT INTO ai_calls (user_id, task, model, key_tier, duration_ms, success, error,
      input_tokens, output_tokens, thinking_tokens, cost_usd, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  userId, task, model, keyTier, Math.round(ms), ok ? 1 : 0, error ? String(error).slice(0, 500) : null,
  u.input, u.output, u.thinking, keyTier === 'paid' ? u.cost : 0, now()).catch(() => {});
}

const utcMidnight = () => `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;

/** One user's AI use since UTC midnight. */
export async function callsToday(userId) {
  return db.get(`SELECT COUNT(*) AS total, COALESCE(SUM(success), 0) AS ok,
      COALESCE(SUM(input_tokens), 0) AS input_tokens,
      COALESCE(SUM(output_tokens + thinking_tokens), 0) AS output_tokens,
      COALESCE(SUM(cost_usd), 0) AS cost_usd
    FROM ai_calls WHERE user_id = ? AND created_at >= ?`, userId, utcMidnight());
}

/** What the whole app has ever spent on Gemini, in USD. */
export async function appSpendTotal() {
  const r = await db.get("SELECT COALESCE(SUM(cost_usd), 0) AS cost FROM ai_calls WHERE key_tier = 'paid'");
  return r.cost;
}

/** What the whole app has spent on Gemini since UTC midnight, in USD. */
export async function appSpendToday() {
  const r = await db.get("SELECT COALESCE(SUM(cost_usd), 0) AS cost FROM ai_calls WHERE key_tier = 'paid' AND created_at >= ?", utcMidnight());
  return r.cost;
}

/**
 * Which Gemini key a user's next AI work runs on: 'paid' or 'free'.
 * Free-plan accounts only ever use the free key. Paid-plan accounts use the paid
 * key while the daily and lifetime budgets have room (`margin` reserves room for
 * a whole article), then fall back to the free key.
 */
export async function keyFor(userId, margin = 0) {
  const user = userId != null ? await db.get('SELECT plan FROM users WHERE id = ?', userId) : null;
  const hasFree = Boolean(config.gemini.freeApiKey);
  if (user?.plan === 'paid' && config.gemini.apiKey) {
    const [total, today] = await Promise.all([appSpendTotal(), appSpendToday()]);
    const creditLeft = total + margin < config.lifetimeBudgetUsd;
    if (creditLeft && today + margin < config.appDailyBudgetUsd) return 'paid';
    if (hasFree) return 'free';
    throw creditLeft ? new AiError('budget', 'app daily AI budget reached') : new AiError('credit', 'lifetime AI budget reached');
  }
  if (hasFree) return 'free';
  throw new AiError('not_configured', user?.plan === 'paid' ? 'no Gemini key set' : 'no free-tier Gemini key set');
}

function extractJson(text) {
  const unfenced = String(text).replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  try { return JSON.parse(unfenced); } catch { /* try the outermost object */ }
  const a = unfenced.indexOf('{');
  const b = unfenced.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(unfenced.slice(a, b + 1));
  throw new SyntaxError('no JSON object in response');
}

// Google answers 429 / RESOURCE_EXHAUSTED when a key's rate or quota limit is hit.
const isRateLimited = (err) => err?.status === 429 || /RESOURCE_EXHAUSTED|\b429\b|quota/i.test(String(err?.message ?? ''));

async function attempt({ userId, task, model, keyTier, system, prompt, jsonSchema, timeoutMs }) {
  const t0 = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let usage = null; // tokens are billed even when the reply can't be parsed
  try {
    const res = await client(keyTier).models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction: system,
        temperature: 0.4,
        responseMimeType: 'application/json',
        responseJsonSchema: jsonSchema,
        abortSignal: controller.signal,
      },
    });
    usage = usageOf(model, res.usageMetadata);
    const data = extractJson(res.text ?? '');
    await logCall(userId, task, model, keyTier, performance.now() - t0, true, null, usage);
    return data;
  } catch (err) {
    let e = err;
    if (!(err instanceof AiError)) {
      e = controller.signal.aborted ? new AiError('timeout', `timed out after ${timeoutMs}ms`)
        : err instanceof SyntaxError ? new AiError('invalid_output', err.message)
          : isRateLimited(err) ? new AiError('busy', redact(err?.message ?? err))
            : new AiError('failed', redact(err?.message ?? err));
    }
    await logCall(userId, task, model, keyTier, performance.now() - t0, false, `${e.code}: ${e.message}`, usage);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs one AI task for a user and returns zod-validated data.
 * One retry on transport errors, one "return valid JSON only" repair on schema errors.
 * @param {{ userId:number, task:string, tier:'light'|'strong', system:string, prompt:string, schema:import('zod').ZodType }} o
 */
export async function runTask({ userId, task, tier = 'light', system, prompt, schema }) {
  const keyTier = await keyFor(userId);
  if (userId != null) {
    const today = await callsToday(userId);
    if (today.total >= config.aiDailyLimit) throw new AiError('quota', 'daily AI limit reached');
  }
  const model = config.gemini.models[tier] ?? tier;
  const jsonSchema = z.toJSONSchema(schema, { target: 'draft-7' });
  delete jsonSchema.$schema;
  const base = { userId, task, model, keyTier, system, jsonSchema, timeoutMs: config.gemini.timeoutMs[tier] ?? 120_000 };

  let retriedTransport = false;
  let repaired = false;
  let currentPrompt = prompt;
  for (;;) {
    let raw;
    try {
      raw = await attempt({ ...base, prompt: currentPrompt });
    } catch (err) {
      if (['not_configured', 'quota', 'busy', 'budget', 'credit'].includes(err.code) || retriedTransport) throw err;
      retriedTransport = true;
      continue;
    }
    const parsed = schema.safeParse(raw);
    if (parsed.success) return parsed.data;
    if (repaired) throw new AiError('invalid_output', 'response failed validation', parsed.error.issues.slice(0, 5));
    repaired = true;
    currentPrompt = `${prompt}\n\n---\nYour previous answer did not match the required JSON schema:\n${z.prettifyError(parsed.error)}\n\nReturn valid JSON only, matching the schema exactly.`;
  }
}
