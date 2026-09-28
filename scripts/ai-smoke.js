// Checks the Claude Code bridge end to end. Run: npm run ai:smoke
//   1. ANTHROPIC_API_KEY never reaches the child process
//   2. the executable is found and logged in
//   3. a 20,000-character prompt goes through stdin (Windows has an ~8k/32k
//      command-line limit, so this fails if the prompt were an argument)
import { z } from 'zod';

process.env.ANTHROPIC_API_KEY = 'sk-ant-smoke-test-should-never-be-forwarded';

const { childEnv, findClaude } = await import('../server/ai/claudeExe.js');
const { runTask, runClaudeProcess, callsToday } = await import('../server/ai/claudeBridge.js');

let failed = false;
const pass = (m) => console.log(`  PASS  ${m}`);
const fail = (m) => { failed = true; console.log(`  FAIL  ${m}`); };

console.log('\nClaude Code bridge smoke test\n');

const env = childEnv();
if (!('ANTHROPIC_API_KEY' in env) && !Object.keys(env).some((k) => k.toUpperCase() === 'ANTHROPIC_API_KEY')) {
  pass('ANTHROPIC_API_KEY is stripped from the child environment');
} else {
  fail('ANTHROPIC_API_KEY leaked into the child environment');
}

const exe = findClaude();
if (!exe) {
  fail('Claude Code executable not found');
  process.exit(1);
}
pass(`found ${exe.path}`);

const auth = await runClaudeProcess(['auth', 'status'], { timeoutMs: 20000 });
let loggedIn = false;
try { loggedIn = JSON.parse(auth.stdout).loggedIn === true; } catch { /* ignore */ }
if (!loggedIn) {
  fail('Claude Code is not logged in. Run `claude auth login`, then re-run this test.');
  process.exit(1);
}
pass('logged in');

// A long prompt with a marker near the end the model must read back.
const marker = `ZEBRA-${Math.floor(Math.random() * 9000 + 1000)}`;
const filler = 'Quick commerce firms burn cash to win dense urban clusters before unit economics turn. ';
let article = '';
while (article.length < 20000) article += filler;
const prompt = `${article}\n\nThe secret code is ${marker}.\n\nReturn JSON with "code" set to the secret code and "chars" set to roughly how long this message is.`;

const t0 = Date.now();
try {
  const out = await runTask({
    task: 'smoke_test',
    tier: 'light',
    system: 'You are a test harness. Reply with JSON only.',
    prompt,
    schema: z.object({ code: z.string(), chars: z.number() }),
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (out.code === marker) pass(`${prompt.length.toLocaleString()}-character prompt sent via stdin and read back (${secs}s)`);
  else fail(`model returned code "${out.code}", expected "${marker}"`);
} catch (err) {
  fail(`long-prompt call failed: ${err.code ?? ''} ${err.message}`);
}

const today = callsToday();
console.log(`\n  AI calls logged today: ${today.total} (${today.ok} succeeded)\n`);
process.exit(failed ? 1 : 0);
