// Local development server: loads .env.local, serves the static frontend and
// the API on http://localhost:4317. Production runs on Vercel instead.
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');

// Minimal .env.local loader (KEY=value lines), before anything reads config.
const envFile = join(root, '.env.local');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const express = (await import('express')).default;
const { app } = await import('./app.js');
const { config, paths } = await import('./config.js');

const server = express();
server.use(app);
server.use(express.static(paths.public, { index: false }));
// Same routing as vercel.json: reports are their own page; everything else is the app shell.
server.get(/^\/print\//, (_req, res) => res.sendFile(join(paths.public, 'print.html')));
server.use((req, res, next) => {
  if (req.method !== 'GET' || extname(req.path)) return next();
  res.sendFile(join(paths.public, 'index.html'));
});

server.listen(config.port, '127.0.0.1', () => {
  console.log(`\n  Readout (development) at http://localhost:${config.port}`);
  console.log(`  Database: ${config.databaseUrl ? 'Neon Postgres' : `PGlite (${config.localDbDir})`}`);
  const keys = [config.gemini.freeApiKey && 'free key', config.gemini.apiKey && 'paid key'].filter(Boolean);
  console.log(`  AI: ${keys.length ? `Gemini (${keys.join(' + ')})` : 'not configured (set GEMINI_API_KEY_FREE in .env.local)'}\n`);
});
