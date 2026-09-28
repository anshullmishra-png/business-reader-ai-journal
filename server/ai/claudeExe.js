// Finds the Claude Code executable and works out how to spawn it on Windows
// without going through a shell (so long JSON arguments and paths with spaces
// are passed intact).
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, delimiter, resolve } from 'node:path';
import { homedir } from 'node:os';
import { config } from '../config.js';

const isWin = process.platform === 'win32';

function isFile(p) {
  try { return statSync(p).isFile(); } catch { return false; }
}

function searchPath() {
  const names = isWin ? ['claude.exe', 'claude.cmd', 'claude'] : ['claude'];
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const p = join(dir.replace(/^"|"$/g, ''), name);
      if (isFile(p)) return p;
    }
  }
  return null;
}

function knownLocations() {
  const home = homedir();
  const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
  return isWin
    ? [
        join(home, '.local', 'bin', 'claude.exe'),      // native installer
        join(appData, 'npm', 'claude.cmd'),             // npm -g
      ]
    : [join(home, '.local', 'bin', 'claude'), '/usr/local/bin/claude', '/opt/homebrew/bin/claude'];
}

// npm's claude.cmd is a shim that runs `node <cli.js>`. Spawning cmd.exe would
// re-parse our arguments (and mangle JSON quotes), so run the script with node directly.
function resolveCmdShim(cmdPath) {
  try {
    const text = readFileSync(cmdPath, 'utf8');
    const m = text.match(/"%(?:~dp0|dp0%)\\?([^"]+?\.(?:c?js|mjs))"/i) ?? text.match(/%~?dp0%?\\([^"\s]+?\.(?:c?js|mjs))/i);
    if (m) {
      const script = resolve(dirname(cmdPath), m[1].replace(/^\\/, ''));
      if (existsSync(script)) return script;
    }
  } catch { /* fall through */ }
  return null;
}

/**
 * @returns {{ path: string, command: string, prefixArgs: string[] } | null}
 * command + prefixArgs is what to pass to child_process.spawn.
 */
export function findClaude() {
  const candidates = [config.ai?.claudePath, searchPath(), ...knownLocations()].filter(Boolean);
  for (const p of candidates) {
    if (!isFile(p)) continue;
    if (/\.cmd$/i.test(p)) {
      const script = resolveCmdShim(p);
      if (script) return { path: p, command: process.execPath, prefixArgs: [script] };
      continue; // can't run a .cmd safely without a shell
    }
    return { path: p, command: p, prefixArgs: [] };
  }
  return null;
}

// Environment for the child process. Strips anything that could make Claude
// Code bill an API key instead of the subscription login, plus variables that
// leak from a parent Claude Code session. CLAUDE_CODE_OAUTH_TOKEN is kept:
// it's a subscription login (from `claude setup-token`), not an API key.
export function childEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    const k = key.toUpperCase();
    if (k === 'CLAUDE_CODE_OAUTH_TOKEN') continue;
    if (
      k === 'ANTHROPIC_API_KEY' ||
      k === 'ANTHROPIC_AUTH_TOKEN' ||
      k === 'ANTHROPIC_BASE_URL' ||
      k === 'CLAUDECODE' ||
      k.startsWith('CLAUDE_CODE_') ||
      k.startsWith('CLAUDE_AGENT_SDK')
    ) {
      delete env[key];
    }
  }
  return env;
}
