// Database access: Postgres. Neon in production (DATABASE_URL), and PGlite
// (Postgres compiled to WebAssembly, stored in data/pglite) for local development,
// so both run the same SQL. Everything is async.
//   await db.get(sql, ...args)  -> first row or undefined
//   await db.all(sql, ...args)  -> rows
//   await db.run(sql, ...args)  -> { changes, lastInsertRowid }
//   await db.batch([[sql, ...args], ...])  -> atomic, all-or-nothing
//   await db.tx(async (t) => { await t.get(...); ... })  -> interactive transaction
// Queries are written with ? placeholders; they become $1, $2… here.
import { mkdirSync } from 'node:fs';
import { config } from '../config.js';
import { MIGRATIONS } from './schema.js';

// ---------- SQL adaptation ----------
/** `?` placeholders → `$1, $2…`, leaving anything inside quotes alone. */
function toPg(sql) {
  let n = 0;
  let quote = null;
  let out = '';
  for (const ch of sql) {
    if (quote) { out += ch; if (ch === quote) quote = null; continue; }
    if (ch === "'" || ch === '"') { quote = ch; out += ch; continue; }
    out += ch === '?' ? `$${++n}` : ch;
  }
  return out;
}

// Postgres is strict about types where SQLite wasn't: flags are 0/1 integers.
const param = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);

// Every table has an `id`; INSERTs hand it back as lastInsertRowid.
const withReturning = (sql) =>
  (/^\s*insert\b/i.test(sql) && !/\breturning\b/i.test(sql) ? `${sql.trimEnd()} RETURNING id` : sql);

// Counts and sums can come back as bigint or numeric strings; the app wants numbers.
const NUMERIC = /^-?\d+(\.\d+)?$/;
function plain(rows, fields) {
  const numericCols = new Set((fields ?? []).filter((f) => [20, 1700].includes(f.dataTypeID)).map((f) => f.name));
  return rows.map((row) => {
    const o = {};
    for (const [k, v] of Object.entries(row)) {
      o[k] = typeof v === 'bigint' ? Number(v)
        : numericCols.has(k) && typeof v === 'string' && NUMERIC.test(v) ? Number(v)
          : v;
    }
    return o;
  });
}

// ---------- Drivers: each exposes query(text, params) -> { rows, rowCount, fields } and transaction(fn) ----------
async function neonDriver(url) {
  const { default: pg } = await import('pg');
  pg.types.setTypeParser(20, (v) => Number(v));   // bigint (COUNT, SUM of integers)
  pg.types.setTypeParser(1700, (v) => Number(v)); // numeric (AVG)
  // TLS is set explicitly (verified certificate, channel binding as Neon asks),
  // so the URL's sslmode/channel_binding hints are dropped rather than reinterpreted.
  const local = /localhost|127\.0\.0\.1/.test(url);
  const u = new URL(url);
  u.searchParams.delete('sslmode');
  u.searchParams.delete('channel_binding');
  const pool = new pg.Pool({
    connectionString: u.toString(),
    max: config.isVercel ? 3 : 10,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
    ssl: local ? undefined : { rejectUnauthorized: true },
    enableChannelBinding: !local,
  });
  pool.on('error', (err) => console.error('[db] idle client error', err.message));
  return {
    query: (text, params) => pool.query(text, params),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn((text, params) => client.query(text, params));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

async function pgliteDriver(dir) {
  mkdirSync(dir, { recursive: true });
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = await PGlite.create(dir);
  const shape = (r) => ({ rows: r.rows, rowCount: r.affectedRows ?? r.rows.length, fields: r.fields });
  return {
    query: async (text, params) => shape(await pg.query(text, params)),
    transaction: (fn) => pg.transaction((tx) => fn(async (text, params) => shape(await tx.query(text, params)))),
  };
}

const driverReady = config.databaseUrl ? neonDriver(config.databaseUrl) : pgliteDriver(config.localDbDir);

// ---------- Transient connection failures ----------
// Neon pauses idle databases and a fresh Vercel instance has no warm connection, so
// the first connect can time out or be dropped. Getting a connection is always safe
// to retry; a statement that may have run is only retried if it just reads.
const CONNECT_FAILURE = /timeout exceeded when trying to connect|connection timeout|Connection terminated|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|Client has encountered a connection error/i;
const isReadOnly = (sql) => /^\s*(select|with)\b/i.test(sql);
async function withRetry(sql, attempt) {
  for (let i = 1; ; i++) {
    try {
      return await attempt();
    } catch (err) {
      const retriable = CONNECT_FAILURE.test(String(err?.message)) && (isReadOnly(sql) || /trying to connect|connection timeout/i.test(String(err?.message)));
      if (!retriable || i >= 3) throw err;
      console.warn(`[db] ${err.message}; retrying (${i})`);
      await new Promise((r) => setTimeout(r, 400 * i));
    }
  }
}

// ---------- The db object ----------
function wrap(exec) {
  const run = (sql, args) => withRetry(sql, () => exec(toPg(withReturning(sql)), args.map(param)));
  return {
    async get(sql, ...args) { const r = await run(sql, args); return plain(r.rows, r.fields)[0]; },
    async all(sql, ...args) { const r = await run(sql, args); return plain(r.rows, r.fields); },
    async run(sql, ...args) {
      const r = await run(sql, args);
      return { changes: r.rowCount ?? 0, lastInsertRowid: r.rows?.[0]?.id ?? null };
    },
  };
}

export const db = {
  ...wrap(async (text, params) => (await driverReady).query(text, params)),
  async batch(statements) {
    const driver = await driverReady;
    return driver.transaction(async (q) => {
      const t = wrap(q);
      const out = [];
      for (const [sql, ...args] of statements) out.push(await t.run(sql, ...args));
      return out;
    });
  },
  async tx(fn) {
    const driver = await driverReady;
    return driver.transaction((q) => fn(wrap(q)));
  },
};

export const now = () => new Date().toISOString();

// Applies pending migrations once per process. Several Vercel instances can start
// at once, so the work happens under an advisory lock and re-checks what's applied.
async function migrate() {
  const driver = await driverReady;
  await driver.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const appliedNames = async (q) => new Set((await q('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  const before = await withRetry('select', () => appliedNames(driver.query));
  if (MIGRATIONS.every((m) => before.has(m.name))) return;
  await driver.transaction(async (q) => {
    await q('SELECT pg_advisory_xact_lock(735412)');
    const applied = await appliedNames(q);
    for (const m of MIGRATIONS) {
      if (applied.has(m.name)) continue;
      for (const statement of m.sql.split(/;\s*$/m).map((s) => s.trim()).filter(Boolean)) await q(statement);
      await q('INSERT INTO schema_migrations (name, applied_at) VALUES ($1, $2)', [m.name, now()]);
      console.log(`[db] applied ${m.name}`);
    }
  });
}

// The database is ready once migrations ran. A failed attempt (say Neon was still
// waking up) is forgotten, so the next request tries again instead of the whole
// process crashing on an unhandled rejection.
let ready = null;
export function ensureDb() {
  ready ??= migrate().catch((err) => {
    ready = null;
    throw err;
  });
  return ready;
}
export const dbReady = ensureDb();
dbReady.catch((err) => console.error('[db] not ready yet:', err.message));
