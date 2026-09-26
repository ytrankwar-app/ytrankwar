import { db } from '@/db';

// A session counts as "live" if it pinged within this many seconds.
const LIVE_WINDOW_SECONDS = 60;

export function recordPing(sessionId: string): void {
  if (!sessionId || sessionId.length > 100) return;

  db.prepare(
    `INSERT INTO presence_pings (session_id, last_seen) VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(session_id) DO UPDATE SET last_seen = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
  ).run(sessionId);

  // Opportunistic cleanup so this table never grows unbounded — cheap
  // relative to the write above, and only ever removes long-stale rows.
  db.prepare(`DELETE FROM presence_pings WHERE last_seen < datetime('now', '-1 hour')`).run();
}

export function countLiveVisitors(): number {
  const row = db
    .prepare(
      `SELECT count(*) as n FROM presence_pings WHERE last_seen > datetime('now', ?)`
    )
    .get(`-${LIVE_WINDOW_SECONDS} seconds`) as { n: number };
  return row.n;
}

export function countTotalChannels(): number {
  const row = db.prepare('SELECT count(*) as n FROM channels').get() as { n: number };
  return row.n;
}
