// Loads config.json (committed defaults) merged with config.local.json
// (gitignored personal overrides), plus command-line flags.
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function readJson(path) {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf8'));
}

function merge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(base[k] ?? {}, v) : v;
  }
  return out;
}

const args = new Set(process.argv.slice(2));
const file = merge(readJson(join(ROOT, 'config.json')), readJson(join(ROOT, 'config.local.json')));

export const config = {
  ...file,
  // Never bind to anything but loopback, whatever the config says.
  host: '127.0.0.1',
  port: Number(process.env.PORT) || file.port || 4317,
  demo: args.has('--demo'),
  openBrowser: args.has('--open'),
};

export const paths = {
  root: ROOT,
  public: join(ROOT, 'public'),
  migrations: join(ROOT, 'migrations'),
  data: join(ROOT, 'data'),
  tmpAi: join(ROOT, 'tmp-ai'),
  db: join(ROOT, 'data', config.demo ? 'demo.db' : 'journal.db'),
};

mkdirSync(paths.data, { recursive: true });
mkdirSync(paths.tmpAi, { recursive: true });
