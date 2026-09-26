import { getCloudflareContext } from '@opennextjs/cloudflare';
import type { D1Database, D1PreparedStatement, D1Result } from '@cloudflare/workers-types';

/**
 * Thin helper layer over the Cloudflare D1 binding (`env.DB`, declared in
 * wrangler.jsonc). Every query in this app goes through here.
 *
 * - Inside a request (route handler / server component) the binding comes
 *   from OpenNext's `getCloudflareContext()`.
 * - Outside a request (the Cron Trigger in worker.ts, and the test suite)
 *   the database is injected explicitly with `setDatabase()`.
 *
 * D1 has no interactive transactions. Anything that must be atomic is built
 * as a list of statements and sent through `batch()`, which D1 runs as a
 * single implicit transaction (all succeed or all roll back).
 */

let injected: D1Database | null = null;

export function setDatabase(db: D1Database | null): void {
  injected = db;
}

export function getDb(): D1Database {
  if (injected) return injected;
  const env = getCloudflareContext().env as { DB?: D1Database };
  if (!env.DB) {
    throw new Error(
      'D1 binding "DB" is missing. Check the d1_databases entry in wrangler.jsonc and that the database exists (npm run d1:create).'
    );
  }
  return env.DB;
}

export function stmt(sql: string, ...params: unknown[]): D1PreparedStatement {
  return getDb().prepare(sql).bind(...params);
}

export async function all<T>(sql: string, ...params: unknown[]): Promise<T[]> {
  const res = await stmt(sql, ...params).all<T>();
  return res.results ?? [];
}

export async function first<T>(sql: string, ...params: unknown[]): Promise<T | null> {
  return stmt(sql, ...params).first<T>();
}

export async function run(sql: string, ...params: unknown[]): Promise<D1Result> {
  return stmt(sql, ...params).run();
}

export async function batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
  if (statements.length === 0) return [];
  return getDb().batch(statements);
}

/** SQLite timestamp expression used everywhere a "now" is stored. */
export const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
