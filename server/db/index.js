// SQLite access. Uses better-sqlite3 when its native binary loads, otherwise
// falls back to Node's built-in node:sqlite behind the same small interface:
//   db.prepare(sql).get/all/run(...params), db.exec(sql), db.transaction(fn)
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { paths } from '../config.js';

const require = createRequire(import.meta.url);

function openBetterSqlite(file) {
  const Database = require('better-sqlite3');
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.driver = 'better-sqlite3';
  return db;
}

function openNodeSqlite(file) {
  const { DatabaseSync } = require('node:sqlite');
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  let depth = 0;
  return {
    driver: 'node:sqlite',
    prepare: (sql) => raw.prepare(sql),
    exec: (sql) => raw.exec(sql),
    close: () => raw.close(),
    // Mirrors better-sqlite3's db.transaction(fn): returns a wrapped function.
    transaction: (fn) => (...args) => {
      const sp = `sp${depth++}`;
      raw.exec(depth === 1 ? 'BEGIN' : `SAVEPOINT ${sp}`);
      try {
        const result = fn(...args);
        raw.exec(depth === 1 ? 'COMMIT' : `RELEASE ${sp}`);
        return result;
      } catch (err) {
        raw.exec(depth === 1 ? 'ROLLBACK' : `ROLLBACK TO ${sp}`);
        throw err;
      } finally {
        depth--;
      }
    },
  };
}

function open(file) {
  try {
    return openBetterSqlite(file);
  } catch (err) {
    console.warn(`[db] better-sqlite3 unavailable (${err.message.split('\n')[0]}); using node:sqlite`);
    return openNodeSqlite(file);
  }
}

// Applies every migrations/NNN_name.sql not yet recorded, each in its own transaction.
function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const applied = new Set(db.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name));
  const files = readdirSync(paths.migrations).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(paths.migrations, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(file, new Date().toISOString());
    })();
    console.log(`[db] applied ${file}`);
  }
}

export const db = open(paths.db);
migrate(db);

export const now = () => new Date().toISOString();
