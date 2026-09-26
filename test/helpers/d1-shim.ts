import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type { D1Database } from '@cloudflare/workers-types';

/**
 * A minimal in-memory stand-in for the Cloudflare D1 API, backed by
 * better-sqlite3 (a devDependency used ONLY by the test suite — production
 * talks to real D1). It applies the exact SQL files in /migrations, so tests
 * exercise the real schema, and it mirrors D1's semantics where they matter:
 * `batch()` runs all statements in one transaction and rolls back on error.
 */
class Statement {
  constructor(
    private readonly db: Database.Database,
    readonly sql: string,
    private readonly params: unknown[] = []
  ) {}

  bind(...params: unknown[]) {
    return new Statement(this.db, this.sql, params.map((p) => (p === undefined ? null : p)));
  }

  // better-sqlite3 cannot bind a reused numbered placeholder (?1 ... ?1)
  // positionally, though D1/SQLite proper can. Rewrite ?N to a named
  // parameter so the same SQL runs unchanged in tests.
  private prepared(): { s: Database.Statement; args: unknown[] } {
    if (/\?\d+/.test(this.sql)) {
      const named: Record<string, unknown> = {};
      this.params.forEach((v, i) => (named[`p${i + 1}`] = v));
      return { s: this.db.prepare(this.sql.replace(/\?(\d+)/g, ':p$1')), args: [named] };
    }
    return { s: this.db.prepare(this.sql), args: this.params };
  }

  runSync() {
    const { s, args } = this.prepared();
    if (s.reader) {
      const results = s.all(...args);
      return { success: true, results, meta: { changes: 0, rows_read: results.length } };
    }
    const info = s.run(...args);
    return { success: true, results: [], meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } };
  }

  async all() {
    return this.runSync();
  }
  async run() {
    return this.runSync();
  }
  async first(col?: string) {
    const { s, args } = this.prepared();
    const row = s.get(...args) as Record<string, unknown> | undefined;
    if (!row) return null;
    return col ? row[col] ?? null : row;
  }
}

export function createTestD1(): { d1: D1Database; raw: Database.Database } {
  const raw = new Database(':memory:');
  raw.pragma('foreign_keys = ON');

  const dir = path.join(process.cwd(), 'migrations');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    raw.exec(fs.readFileSync(path.join(dir, file), 'utf-8'));
  }

  const d1 = {
    prepare: (sql: string) => new Statement(raw, sql),
    async batch(statements: Statement[]) {
      const tx = raw.transaction(() => statements.map((s) => s.runSync()));
      return tx();
    },
  };

  return { d1: d1 as unknown as D1Database, raw };
}
