import express from 'express';
import { existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { spawn } from 'node:child_process';
import { ZodError } from 'zod';
import { config, paths } from './config.js';
import { db } from './db/index.js';
import { settingsRouter } from './routes/settings.js';
import { aiRouter } from './routes/ai.js';
import { sessionsRouter } from './routes/sessions.js';
import { captureRouter } from './routes/capture.js';
import { recheckHealth, getHealth } from './ai/health.js';
import { startJobs } from './jobs/runner.js';
import { SECTORS, COMPANY_STAGES, SOURCES } from './ai/taxonomy.js';
import './jobs/handlers.js';
import { fetchFonts } from '../scripts/fetch-fonts.js';

const app = express();
app.disable('x-powered-by');

// DNS-rebinding guard: only answer requests addressed to this machine's loopback.
// (Binding to 127.0.0.1 already keeps other devices on the network out.)
let boundPort = config.port;
app.use((req, res, next) => {
  const host = (req.headers.host ?? '').toLowerCase();
  if (host === `127.0.0.1:${boundPort}` || host === `localhost:${boundPort}`) return next();
  res.status(403).send('Forbidden');
});

app.use(express.json({ limit: '2mb' }));

// ---- API ----
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    demo: config.demo,
    dbDriver: db.driver,
    port: boundPort,
    extension_dir: join(paths.root, 'extension'),
  });
});
app.get('/api/meta', (_req, res) => {
  res.json({ sectors: SECTORS, company_stages: COMPANY_STAGES, sources: SOURCES });
});
app.use('/api/settings', settingsRouter);
app.use('/api/ai', aiRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/capture', captureRouter);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// ---- Static files + client-side routes ----
app.use(express.static(paths.public, { index: false }));
app.use((req, res, next) => {
  // Any extension-less GET is an app page; the client router renders it.
  if (req.method !== 'GET' || extname(req.path)) return next();
  res.sendFile(join(paths.public, 'index.html'));
});

// ---- Errors ----
app.use((err, _req, res, _next) => {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'Invalid input', issues: err.issues });
  }
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That article is too long.' });
  if (err.status) {
    const { status, message, code, title } = err;
    return res.status(status).json({ error: message, code, title });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

// Try the configured port, then the next ones, if it's taken.
function listen(port, attemptsLeft = 20) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, config.host);
    server.once('listening', () => resolve({ server, port }));
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
        resolve(listen(port + 1, attemptsLeft - 1));
      } else {
        reject(err);
      }
    });
  });
}

function openInBrowser(url) {
  // rundll32 opens the default browser on Windows without shell quoting issues.
  const [cmd, args] = process.platform === 'win32'
    ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
    : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]];
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
}

if (!existsSync(join(paths.public, 'fonts', 'Satoshi-400.woff2'))) {
  await fetchFonts();
}

const { port } = await listen(config.port);
boundPort = port;
const url = `http://127.0.0.1:${port}`;
console.log('');
console.log(`  Business Reads Journal${config.demo ? ' (DEMO)' : ''} is running at ${url}`);
if (port !== config.port) console.log(`  Port ${config.port} was busy, so it's using ${port} instead.`);
console.log(`  Database: ${paths.db} (${db.driver})`);
console.log('  Keep this window open while you use the app. Press Ctrl+C to stop.');
console.log('');
if (config.openBrowser) openInBrowser(url);

startJobs();

// Check Claude Code in the background; the UI shows a setup screen until it's ready.
recheckHealth().then(() => {
  const h = getHealth();
  const line = {
    ready: `  Claude Code ${h.version ?? ''} is ready.`,
    not_installed: "  Claude Code isn't installed. The app will show setup steps.",
    not_logged_in: "  Claude Code isn't logged in. Run: claude auth login",
    error: `  Claude Code check failed: ${h.message ?? 'unknown error'}`,
  }[h.status];
  if (line) console.log(line);
});
