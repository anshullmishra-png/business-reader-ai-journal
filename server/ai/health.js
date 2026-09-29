// Startup health check for Claude Code: installed? logged in? can it answer?
import { z } from 'zod';
import { findClaude } from './claudeExe.js';
import {
  runClaudeProcess, runTask, AiError, callsToday, queueStats, setSetupErrorHandler,
} from './claudeBridge.js';

/** @type {{status: 'checking'|'ready'|'not_installed'|'not_logged_in'|'error', [k: string]: any}} */
let state = { status: 'checking', checking: true };
let inflight = null;

export function getHealth() {
  return { ...state, calls_today: callsToday(), queue: queueStats() };
}

async function check() {
  state = { ...state, checking: true }; // keep the last known status while rechecking
  const exe = findClaude();
  if (!exe) {
    state = { status: 'not_installed', checked_at: new Date().toISOString() };
    return;
  }
  const base = { exe_path: exe.path };
  try {
    const ver = await runClaudeProcess(['--version'], { timeoutMs: 20000 });
    base.version = ver.stdout.trim().split(/\s+/)[0] || null;

    // Free and fast: reports login state without using the subscription.
    const auth = await runClaudeProcess(['auth', 'status'], { timeoutMs: 20000 });
    let info = {};
    try { info = JSON.parse(auth.stdout); } catch { /* older CLI: fall through to the test call */ }
    base.auth_method = info.authMethod ?? null;
    if (info.loggedIn === false) {
      state = { ...base, status: 'not_logged_in', checked_at: new Date().toISOString() };
      return;
    }
    // Logged in: usable now. The test call below confirms it end to end.
    if (info.loggedIn === true) state = { ...base, status: 'ready', checking: true };

    // One tiny real call proves the whole path works end to end.
    const res = await runTask({
      task: 'health_check',
      tier: 'light',
      system: 'You are a health check. Reply with JSON only.',
      prompt: 'Return {"ok": true}.',
      schema: z.object({ ok: z.boolean() }),
      timeoutMs: 60000,
    });
    state = {
      ...base,
      status: res.ok ? 'ready' : 'error',
      message: res.ok ? null : 'Test call returned an unexpected answer.',
      checked_at: new Date().toISOString(),
    };
  } catch (err) {
    const code = err instanceof AiError ? err.code : 'error';
    state = {
      ...base,
      status: code === 'not_installed' || code === 'not_logged_in' ? code : 'error',
      message: err.message,
      checked_at: new Date().toISOString(),
    };
  }
}

// Runs the check once at a time; callers share the same in-flight promise.
export function recheckHealth() {
  inflight ??= check().finally(() => { inflight = null; });
  return inflight;
}

// Any AI call that fails with "not logged in" updates the shared state immediately.
setSetupErrorHandler((err) => {
  state = { ...state, status: err.code, message: err.message, checked_at: new Date().toISOString() };
});
