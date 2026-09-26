import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

// In production on Cloudflare this file's queries are the same shape you'd
// run against D1 (also SQLite). Swap this module for a D1 binding-backed
// client and every service in /lib keeps working unchanged.

const DB_PATH = process.env.SQLITE_PATH || path.join(process.cwd(), 'data', 'app.db');

function ensureDir(p: string) {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

declare global {
  // eslint-disable-next-line no-var
  var __db: Database.Database | undefined;
}

function createConnection(): Database.Database {
  ensureDir(DB_PATH);
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const schema = fs.readFileSync(path.join(process.cwd(), 'db', 'schema.sql'), 'utf-8');

  try {
    db.exec(schema);
  } catch (err) {
    // This project has no real migration system (see README) — schema.sql
    // uses CREATE TABLE IF NOT EXISTS everywhere, which means re-applying it
    // against a database file created by an OLDER version of schema.sql
    // silently does nothing to already-existing tables. If a later version
    // added a column or an index on a new column, applying the schema then
    // fails right here, and every route that imports this module 500s with
    // a cryptic "no such column" error that gives no hint why.
    //
    // The fix is always the same: delete the stale local database file and
    // let it get recreated fresh. Fail loudly with that instruction instead
    // of leaving whoever hits this to reverse-engineer it from a raw SQLite
    // error, the way this exact failure had to be diagnosed once already.
    const message =
      `Failed to initialize the database at "${DB_PATH}".\n\n` +
      `This almost always means that file was created by an OLDER version of ` +
      `db/schema.sql and is missing a column, table, or index the current ` +
      `schema expects — this demo has no real migration system, so schema ` +
      `changes never retroactively alter an existing database file.\n\n` +
      `Fix: stop the server, delete the stale database file(s), then restart ` +
      `so it gets recreated from the current schema:\n\n` +
      `    rm -f "${DB_PATH}" "${DB_PATH}-wal" "${DB_PATH}-shm"\n\n` +
      `Original error: ${err instanceof Error ? err.message : String(err)}`;
    throw new Error(message);
  }

  return db;
}

// Reuse a single connection across hot-reloads in dev.
export const db = global.__db ?? createConnection();
if (process.env.NODE_ENV !== 'production') global.__db = db;
