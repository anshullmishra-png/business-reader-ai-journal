// Backups: a consistent copy of the live database (VACUUM INTO), and a staged
// restore that is swapped in on the next start, before the database opens.
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createRequire } from 'node:module';
import { paths } from '../config.js';

const require = createRequire(import.meta.url);
export const backupsDir = join(paths.data, 'backups');
export const pendingRestorePath = `${paths.db}.restore-pending`;

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
const dbName = () => basename(paths.db, '.db'); // "journal" or "demo"

/** Writes a timestamped, self-contained copy of the live database. */
export function createBackup(db, prefix = dbName()) {
  mkdirSync(backupsDir, { recursive: true });
  const file = join(backupsDir, `${prefix}-${stamp()}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return { name: basename(file), path: file };
}

export function listBackups() {
  if (!existsSync(backupsDir)) return [];
  return readdirSync(backupsDir).filter((f) => f.endsWith('.db')).map((f) => {
    const st = statSync(join(backupsDir, f));
    return { name: f, bytes: st.size, created_at: st.mtime.toISOString() };
  }).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** Checks an uploaded file really is a journal database. Returns counts for the confirmation. */
export function inspectBackup(buf) {
  if (buf.length < 100 || buf.subarray(0, 16).toString('latin1') !== 'SQLite format 3\0') {
    throw Object.assign(new Error("That file isn't a journal backup (.db)."), { status: 400 });
  }
  const tmp = join(paths.tmpAi, `restore-check-${Date.now()}.db`);
  writeFileSync(tmp, buf);
  let check;
  try {
    const Database = require('better-sqlite3');
    check = new Database(tmp, { readonly: true, fileMustExist: true });
  } catch {
    const { DatabaseSync } = require('node:sqlite');
    check = new DatabaseSync(tmp, { readOnly: true });
  }
  try {
    const tables = new Set(check.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
    for (const t of ['schema_migrations', 'settings', 'sessions']) {
      if (!tables.has(t)) throw Object.assign(new Error("That database isn't a Business Reads Journal backup."), { status: 400 });
    }
    const ok = check.prepare('PRAGMA integrity_check').get();
    if (Object.values(ok)[0] !== 'ok') throw Object.assign(new Error('That backup file is damaged.'), { status: 400 });
    return {
      sessions: check.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,
      terms: tables.has('glossary_terms') ? check.prepare('SELECT COUNT(*) AS n FROM glossary_terms').get().n : 0,
    };
  } finally {
    check.close();
    rmSync(tmp, { force: true });
  }
}

export function stageRestore(buf) {
  writeFileSync(pendingRestorePath, buf);
}

/**
 * Runs at startup before the database opens. Keeps a safety copy of the
 * current journal, then puts the staged backup in its place.
 */
export function applyPendingRestore() {
  if (!existsSync(pendingRestorePath)) return null;
  mkdirSync(backupsDir, { recursive: true });
  let safety = null;
  if (existsSync(paths.db)) {
    // Fold the WAL into the main file so the safety copy is complete.
    try {
      const Database = require('better-sqlite3');
      const cur = new Database(paths.db);
      safety = createBackup(cur, `${dbName()}-before-restore`).name;
      cur.close();
    } catch {
      const { DatabaseSync } = require('node:sqlite');
      const cur = new DatabaseSync(paths.db);
      safety = createBackup(cur, `${dbName()}-before-restore`).name;
      cur.close();
    }
  }
  for (const f of [paths.db, `${paths.db}-wal`, `${paths.db}-shm`]) rmSync(f, { force: true });
  writeFileSync(paths.db, readFileSync(pendingRestorePath));
  rmSync(pendingRestorePath, { force: true });
  return { safety };
}
