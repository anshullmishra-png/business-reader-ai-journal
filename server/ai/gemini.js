// The only way the app talks to an AI: Gemini, via @google/genai. Every
// feature calls runTask() with a zod schema; the schema is sent as the
// response JSON schema and the reply is validated again before use.
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { config } from '../config.js';
import { db, now } from '../db/index.js';

export class AiError extends Error {
  /** @param {'not_configured'|'quota'|'budget'|'timeout'|'invalid_output'|'failed'} code */
  constructor(code, message, detail) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

const FRIENDLY = {
  not_configured: "The AI isn't configured on the server yet.",
  quota: "You've reached today's AI limit. It resets at midnight UTC.",
  budget: "Readout has used up today's AI budget. It resets at midnight UTC.",
  timeout: 'The AI took too long to answer. Try again.',
  invalid_output: "The AI's answer wasn't in the expected format. Try again.",
  failed: 'The AI call failed. Try again.',
};
export const friendlyMessage = (err) => (err instanceof AiError ? FRIENDLY[err.code] : null) ?? FRIENDLY.failed;

let ai = null;
const client = () => {
  if (!config.gemini.apiKey) throw new AiError('not_configured', 'GEMINI_API_KEY is not set');
  ai ??= new GoogleGenAI({ apiKey: config.gemini.apiKey });
  return ai;
};

// Never let a key travel upward in an error message.
const redact = (msg) => (config.gemini.apiKey ? String(msg).split(config.gemini.apiKey).join('[key]') : String(msg));

// Paid-tier prices in USD per 1M tokens (ai.google.dev/gemini-api/docs/pricing).
// Thinking tokens are billed as output.
const PRICES = {
  'gemini-2.5-flash': { input: 0.30, output: 2.50 },
  'gemini-2.5-flash-lite': { input: 0.10, output: 0.40 },
};
const FALLBACK_PRICE = PRICES['gemini-2.5-flash']; // unknown model: assume the dearer one

function usageOf(model, meta) {
  const input = meta?.promptTokenCount ?? 0;
  const output = meta?.candidatesTokenCount ?? 0;
  const thinking = meta?.thoughtsTokenCount ?? 0;
  const p = PRICES[model] ?? FALLBACK_PRICE;
  return { input, output, thinking, cost: (input * p.input + (output + thinking) * p.output) / 1e6 };
}

async function logCall(userId, task, model, ms, ok, error, usage = null) {
  const u = usage ?? { input: 0, output: 0, thinking: 0, cost: 0 };
  await db.run(`INSERT INTO ai_calls (user_id, task, model, duration_ms, success, error,
      input_tokens, output_tokens, thinking_tokens, cost_usd, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  userId, task, model, Math.round(ms), ok ? 1 : 0, error ? String(error).slice(0, 500) : null,
  u.input, u.output, u.thinking, u.cost, now()).catch(() => {});
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

/** What the whole app has spent on Gemini since UTC midnight, in USD. */
export async function appSpendToday() {
  const r = await db.get('SELECT COALESCE(SUM(cost_usd), 0) AS cost FROM ai_calls WHERE created_at >= ?', utcMidnight());
  return r.cost;
}

function extractJson(text) {
  const unfenced = String(text).replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  try { return JSON.parse(unfenced); } catch { /* try the outermost object */ }
  const a = unfenced.indexOf('{');
  const b = unfenced.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(unfenced.slice(a, b + 1));
  throw new SyntaxError('no JSON object in response');
}

async function attempt({ userId, task, model, system, prompt, jsonSchema, timeoutMs }) {
  const t0 = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let usage = null; // tokens are billed even when the reply can't be parsed
  try {
    const res = await client().models.generateContent({
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
    await logCall(userId, task, model, performance.now() - t0, true, null, usage);
    return data;
  } catch (err) {
    let e = err;
    if (!(err instanceof AiError)) {
      e = controller.signal.aborted ? new AiError('timeout', `timed out after ${timeoutMs}ms`)
        : err instanceof SyntaxError ? new AiError('invalid_output', err.message)
          : new AiError('failed', redact(err?.message ?? err));
    }
    await logCall(userId, task, model, performance.now() - t0, false, `${e.code}: ${e.message}`, usage);
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
  if (!config.gemini.apiKey) throw new AiError('not_configured', 'GEMINI_API_KEY is not set');
  if (await appSpendToday() >= config.appDailyBudgetUsd) throw new AiError('budget', 'app daily AI budget reached');
  if (userId != null) {
    const today = await callsToday(userId);
    if (today.total >= config.aiDailyLimit) throw new AiError('quota', 'daily AI limit reached');
  }
  const model = config.gemini.models[tier] ?? tier;
  const jsonSchema = z.toJSONSchema(schema, { target: 'draft-7' });
  delete jsonSchema.$schema;
  const base = { userId, task, model, system, jsonSchema, timeoutMs: config.gemini.timeoutMs[tier] ?? 120_000 };

  let retriedTransport = false;
  let repaired = false;
  let currentPrompt = prompt;
  for (;;) {
    let raw;
    try {
      raw = await attempt({ ...base, prompt: currentPrompt });
    } catch (err) {
      if (['not_configured', 'quota', 'budget'].includes(err.code) || retriedTransport) throw err;
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
