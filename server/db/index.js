// Database access through libSQL: Turso in production, a local SQLite file in
// development. Everything is async.
//   await db.get(sql, ...args)  -> first row or undefined
//   await db.all(sql, ...args)  -> rows
//   await db.run(sql, ...args)  -> { changes, lastInsertRowid }
//   await db.batch([[sql, ...args], ...])  -> atomic, all-or-nothing
//   await db.tx(async (t) => { await t.get(...); ... })  -> interactive transaction
import { createClient } from '@libsql/client';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config, ROOT } from '../config.js';
import { MIGRATIONS } from './schema.js';

if (config.dbUrl.startsWith('file:')) mkdirSync(join(ROOT, 'data'), { recursive: true });

const client = createClient({ url: config.dbUrl, authToken: config.dbAuthToken });

// libSQL rows are array-like; turn them into plain objects.
const plain = (rs) => rs.rows.map((row) => {
  const o = {};
  rs.columns.forEach((c, i) => {
    const v = row[i];
    o[c] = typeof v === 'bigint' ? Number(v) : v;
  });
  return o;
});

function wrap(exec) {
  return {
    async get(sql, ...args) { return plain(await exec({ sql, args }))[0]; },
    async all(sql, ...args) { return plain(await exec({ sql, args })); },
    async run(sql, ...args) {
      const rs = await exec({ sql, args });
      return { changes: rs.rowsAffected, lastInsertRowid: rs.lastInsertRowid == null ? null : Number(rs.lastInsertRowid) };
    },
  };
}

export const db = {
  ...wrap((stmt) => client.execute(stmt)),
  async batch(statements) {
    const rs = await client.batch(statements.map(([sql, ...args]) => ({ sql, args })), 'write');
    return rs.map((r) => ({ changes: r.rowsAffected, lastInsertRowid: r.lastInsertRowid == null ? null : Number(r.lastInsertRowid) }));
  },
  async tx(fn) {
    const t = await client.transaction('write');
    try {
      const result = await fn(wrap((stmt) => t.execute(stmt)));
      await t.commit();
      return result;
    } catch (err) {
      await t.rollback().catch(() => {});
      throw err;
    } finally {
      t.close();
    }
  },
};

export const now = () => new Date().toISOString();

// Applies pending migrations once per process (every cold start checks).
async function migrate() {
  await client.execute('PRAGMA foreign_keys = ON');
  await client.execute(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const applied = new Set((await db.all('SELECT name FROM schema_migrations')).map((r) => r.name));
  for (const m of MIGRATIONS) {
    if (applied.has(m.name)) continue;
    const statements = m.sql.split(/;\s*$/m).map((s) => s.trim()).filter(Boolean);
    await client.batch([
      ...statements,
      { sql: 'INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)', args: [m.name, now()] },
    ], 'write');
    console.log(`[db] applied ${m.name}`);
  }
}

export const dbReady = migrate();
