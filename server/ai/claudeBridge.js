// The only way the app talks to an AI: Claude Code in headless mode, using the
// user's own subscription login. Every feature calls runTask().
//
//   claude -p --output-format json --model <m> --system-prompt-file <f>
//          --tools "" --strict-mcp-config --setting-sources "" --no-session-persistence
//          --json-schema <schema>          (prompt text goes in on stdin)
//
// Not --bare: bare mode only accepts API keys and never reads the subscription login.
import { spawn } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { config, paths } from '../config.js';
import { db, now } from '../db/index.js';
import { findClaude, childEnv } from './claudeExe.js';

export class AiError extends Error {
  /** @param {'not_installed'|'not_logged_in'|'timeout'|'invalid_output'|'failed'} code */
  constructor(code, message, detail) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

const FRIENDLY = {
  not_installed: "Claude Code isn't installed, or the app can't find it.",
  not_logged_in: "Claude Code isn't logged in. Run `claude auth login` in a terminal, then try again.",
  timeout: 'The AI took too long to answer. Try again.',
  invalid_output: "The AI's answer wasn't in the expected format. Try again.",
  failed: 'The AI call failed. Try again.',
};
export const friendlyMessage = (err) =>
  (err instanceof AiError ? FRIENDLY[err.code] : null) ?? FRIENDLY.failed;

// health.js registers here so a mid-session logout flips the app to the setup screen.
let onSetupError = () => {};
export const setSetupErrorHandler = (fn) => { onSetupError = fn; };

// ---------- Concurrency queue (max N calls at once) ----------
const queue = [];
let running = 0;

function schedule(fn) {
  return new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    pump();
  });
}
function pump() {
  const max = config.ai?.maxConcurrent ?? 2;
  while (running < max && queue.length) {
    const { fn, resolve, reject } = queue.shift();
    running++;
    fn().then(resolve, reject).finally(() => { running--; pump(); });
  }
}
export const queueStats = () => ({ running, waiting: queue.length });

// ---------- Low-level process runner ----------
function killTree(child) {
  if (process.platform === 'win32' && child.pid) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGKILL');
  }
}

/** Runs the CLI with args, writes `input` to stdin. Resolves { code, stdout, stderr }. */
export function runClaudeProcess(args, { input = '', timeoutMs = 30000 } = {}) {
  const exe = findClaude();
  if (!exe) return Promise.reject(new AiError('not_installed', 'claude executable not found'));

  return new Promise((resolve, reject) => {
    const child = spawn(exe.command, [...exe.prefixArgs, ...args], {
      cwd: paths.tmpAi,          // empty folder: no project files as context
      env: childEnv(),           // no ANTHROPIC_API_KEY, ever
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d) => { stdout += d; });
    child.stderr.setEncoding('utf8').on('data', (d) => { stderr += d; });

    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new AiError(err.code === 'ENOENT' ? 'not_installed' : 'failed', err.message));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new AiError('timeout', `timed out after ${timeoutMs}ms`));
      resolve({ code, stdout, stderr });
    });

    child.stdin.on('error', () => { /* child exited early; reported via close */ });
    child.stdin.end(input, 'utf8');
  });
}

// ---------- Output parsing ----------
function parseEnvelope(stdout) {
  const text = stdout.trim();
  // --output-format json prints one JSON object; tolerate stray lines before it.
  const start = text.indexOf('{');
  try {
    return JSON.parse(start > 0 ? text.slice(start) : text);
  } catch {
    throw new AiError('failed', 'could not parse Claude Code output', text.slice(0, 500));
  }
}

function extractJson(text) {
  const unfenced = String(text).replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  try { return JSON.parse(unfenced); } catch { /* try the outermost object */ }
  const a = unfenced.indexOf('{');
  const b = unfenced.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(unfenced.slice(a, b + 1));
  throw new SyntaxError('no JSON object in response');
}

// ---------- Logging ----------
const logStmt = db.prepare(
  'INSERT INTO ai_calls (task, model, duration_ms, success, error, created_at) VALUES (?, ?, ?, ?, ?, ?)');
function logCall(task, model, ms, ok, error) {
  logStmt.run(task, model, Math.round(ms), ok ? 1 : 0, error ? String(error).slice(0, 500) : null, now());
}

export function callsToday() {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  return db.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(success), 0) AS ok
                     FROM ai_calls WHERE created_at >= ?`).get(since.toISOString());
}

// ---------- One attempt ----------
async function attempt({ task, model, system, prompt, jsonSchema, timeoutMs }) {
  const sysFile = join(paths.tmpAi, `system-${randomUUID()}.txt`);
  writeFileSync(sysFile, system, 'utf8');
  const args = [
    '-p',
    '--output-format', 'json',
    '--model', model,
    '--system-prompt-file', sysFile,
    '--tools', '',
    '--strict-mcp-config',
    '--setting-sources', '',
    '--no-session-persistence',
    '--json-schema', JSON.stringify(jsonSchema),
  ];
  const t0 = performance.now();
  try {
    const { code, stdout, stderr } = await runClaudeProcess(args, { input: prompt, timeoutMs });
    const env = stdout.trim() ? parseEnvelope(stdout) : null;
    if (!env) throw new AiError('failed', `exit ${code}: ${stderr.trim().slice(0, 300) || 'no output'}`);
    if (env.is_error) {
      const msg = String(env.result ?? env.subtype ?? 'error');
      throw new AiError(/log ?in|\/login|auth/i.test(msg) ? 'not_logged_in' : 'failed', msg);
    }
    const payload = env.structured_output ?? env.result;
    const data = typeof payload === 'string' ? extractJson(payload) : payload;
    logCall(task, model, performance.now() - t0, true);
    return data;
  } catch (err) {
    const e = err instanceof AiError ? err : new AiError('invalid_output', err.message);
    logCall(task, model, performance.now() - t0, false, `${e.code}: ${e.message}`);
    if (e.code === 'not_logged_in' || e.code === 'not_installed') onSetupError(e);
    throw e;
  } finally {
    rmSync(sysFile, { force: true });
  }
}

/**
 * Runs one AI task and returns zod-validated data.
 * @param {object} o
 * @param {string} o.task       name for the ai_calls log
 * @param {'light'|'strong'} o.tier  model tier from config.ai.models
 * @param {string} o.system     system prompt
 * @param {string} o.prompt     user prompt (sent via stdin; any length)
 * @param {import('zod').ZodType} o.schema  expected output shape
 */
export function runTask({ task, tier = 'light', system, prompt, schema, timeoutMs }) {
  const model = config.ai?.models?.[tier] ?? tier;
  const jsonSchema = z.toJSONSchema(schema, { target: 'draft-7' });
  const base = { task, model, system, jsonSchema, timeoutMs: timeoutMs ?? config.ai?.timeoutMs ?? 120000 };

  return schedule(async () => {
    let retriedTransport = false;
    let repaired = false;
    let currentPrompt = prompt;
    for (;;) {
      let raw;
      try {
        raw = await attempt({ ...base, prompt: currentPrompt });
      } catch (err) {
        // Auth/installation problems won't fix themselves on retry.
        if (err.code === 'not_installed' || err.code === 'not_logged_in' || retriedTransport) throw err;
        retriedTransport = true;
        continue;
      }
      const parsed = schema.safeParse(raw);
      if (parsed.success) return parsed.data;
      if (repaired) {
        throw new AiError('invalid_output', 'response failed validation', parsed.error.issues.slice(0, 5));
      }
      repaired = true;
      currentPrompt = `${prompt}\n\n---\nYour previous answer did not match the required JSON schema:\n` +
        `${z.prettifyError(parsed.error)}\n\nReturn valid JSON only, matching the schema exactly. No prose, no code fences.`;
    }
  });
}
