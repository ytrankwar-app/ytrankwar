// Database access layer.
//
// The app runs on Cloudflare Workers (via OpenNext) against a D1 database,
// both in production and in `next dev` / `npm run preview` (where the D1
// binding is emulated locally by Wrangler — see initOpenNextCloudflareForDev
// in next.config.mjs). There is exactly one code path, so what works locally
// is what runs on the main domain.
//
// This module deliberately imports NOTHING Node-specific, so it is safe to
// bundle into the Worker. Unit tests inject a Node-side SQLite adapter with
// setDb() (see db/sqlite-adapter.ts, which is only ever imported by tests
// and local scripts — never by app code).

export type SqlParam = string | number | null;

export interface Statement {
  sql: string;
  params?: SqlParam[];
}

export interface Db {
  /** All rows of a query. */
  all<T = Record<string, unknown>>(sql: string, params?: SqlParam[]): Promise<T[]>;
  /** First row of a query, or null. */
  first<T = Record<string, unknown>>(sql: string, params?: SqlParam[]): Promise<T | null>;
  /** Run a write statement. `changes` is the number of rows affected. */
  run(sql: string, params?: SqlParam[]): Promise<{ changes: number }>;
  /**
   * Run several statements as ONE atomic unit: either every statement is
   * applied or none is. D1 has no interactive transactions, so this (plus
   * conditional SQL — see lib/bidding-service.ts) is how money-critical
   * writes stay consistent.
   */
  batch(statements: Statement[]): Promise<{ changes: number }[]>;
}

// Minimal structural types for the parts of D1 we use, so this file does not
// depend on (or conflict with) the global Workers type definitions.
interface D1PreparedLike {
  bind(...values: unknown[]): D1PreparedLike;
  all(): Promise<{ results?: unknown[] }>;
  first(): Promise<unknown | null>;
  run(): Promise<{ meta?: { changes?: number } }>;
}
export interface D1Like {
  prepare(sql: string): D1PreparedLike;
  batch(statements: D1PreparedLike[]): Promise<{ meta?: { changes?: number } }[]>;
}

export function d1Adapter(d1: D1Like): Db {
  const prep = (sql: string, params: SqlParam[] = []) => d1.prepare(sql).bind(...params);
  return {
    async all<T>(sql: string, params?: SqlParam[]) {
      const res = await prep(sql, params).all();
      return (res.results ?? []) as T[];
    },
    async first<T>(sql: string, params?: SqlParam[]) {
      return ((await prep(sql, params).first()) ?? null) as T | null;
    },
    async run(sql: string, params?: SqlParam[]) {
      const res = await prep(sql, params).run();
      return { changes: res.meta?.changes ?? 0 };
    },
    async batch(statements: Statement[]) {
      const res = await d1.batch(statements.map((s) => prep(s.sql, s.params)));
      return res.map((r) => ({ changes: r.meta?.changes ?? 0 }));
    },
  };
}

let override: Db | null = null;

/** Tests / local scripts only: use this Db instead of the Cloudflare binding. */
export function setDb(db: Db | null): void {
  override = db;
}

export async function getDb(): Promise<Db> {
  if (override) return override;
  const { getCloudflareContext } = await import('@opennextjs/cloudflare');
  const { env } = await getCloudflareContext({ async: true });
  const binding = (env as unknown as { DB?: D1Like }).DB;
  if (!binding) {
    throw new Error(
      'The D1 database binding "DB" is missing. Check the [[d1_databases]] block in wrangler.toml ' +
        '(binding = "DB") and that the database has been created and migrated.'
    );
  }
  return d1Adapter(binding);
}

/** Current time in the same ISO format the schema uses for defaults. */
export const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
