// Node-only SQLite implementation of the Db interface, backed by Node's
// built-in `node:sqlite` (Node >= 22.5). It exists for unit tests and local
// scripts; app code never imports it (it cannot run on Workers).
//
// It mirrors D1's semantics where they matter: foreign keys are enforced and
// batch() is all-or-nothing.

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import type { Db, SqlParam, Statement } from './index';

export interface SqliteDb extends Db {
  raw: DatabaseSync;
  close(): void;
}

export function migrationsDir(): string {
  return path.join(process.cwd(), 'migrations');
}

export function createSqliteDb(file = ':memory:', opts: { migrate?: boolean } = {}): SqliteDb {
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA foreign_keys = ON;');

  if (opts.migrate !== false) {
    const files = fs
      .readdirSync(migrationsDir())
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const f of files) raw.exec(fs.readFileSync(path.join(migrationsDir(), f), 'utf-8'));
  }

  const rows = (sql: string, params: SqlParam[] = []) => raw.prepare(sql).all(...params) as unknown[];

  const adapter: SqliteDb = {
    raw,
    close: () => raw.close(),
    async all<T>(sql: string, params?: SqlParam[]) {
      return rows(sql, params) as T[];
    },
    async first<T>(sql: string, params?: SqlParam[]) {
      return (rows(sql, params)[0] ?? null) as T | null;
    },
    async run(sql: string, params: SqlParam[] = []) {
      const r = raw.prepare(sql).run(...params);
      return { changes: Number(r.changes) };
    },
    async batch(statements: Statement[]) {
      raw.exec('BEGIN');
      try {
        const out = statements.map((s) => {
          const r = raw.prepare(s.sql).run(...(s.params ?? []));
          return { changes: Number(r.changes) };
        });
        raw.exec('COMMIT');
        return out;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return adapter;
}
