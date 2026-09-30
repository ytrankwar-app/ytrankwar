import { getDb, NOW_SQL } from '@/db';

// A session counts as "live" if it pinged within this many seconds.
const LIVE_WINDOW_SECONDS = 60;

export async function recordPing(sessionId: string): Promise<void> {
  if (!sessionId || sessionId.length > 100) return;
  const db = await getDb();

  await db.run(
    `INSERT INTO presence_pings (session_id, last_seen) VALUES (?, ${NOW_SQL})
     ON CONFLICT(session_id) DO UPDATE SET last_seen = ${NOW_SQL}`,
    [sessionId]
  );

  // Opportunistic cleanup so this table never grows unbounded. Only run on a
  // fraction of pings — it is cheap, but there is no need to pay for it on
  // every heartbeat from every visitor.
  if (Math.random() < 0.05) {
    await db.run(`DELETE FROM presence_pings WHERE last_seen < strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')`);
  }
}

export async function countLiveVisitors(): Promise<number> {
  const db = await getDb();
  // last_seen is stored as an ISO-8601 string with a 'T' separator, so it
  // must be compared against a string in the SAME format. (Comparing to a
  // bare datetime('now', ...) — which uses a space separator — would make
  // every row from "today" compare as newer, inflating the live count.)
  const row = await db.first<{ n: number }>(
    `SELECT count(*) as n FROM presence_pings
     WHERE last_seen > strftime('%Y-%m-%dT%H:%M:%fZ','now', ?)`,
    [`-${LIVE_WINDOW_SECONDS} seconds`]
  );
  return row?.n ?? 0;
}

export async function countTotalChannels(): Promise<number> {
  const db = await getDb();
  const row = await db.first<{ n: number }>('SELECT count(*) as n FROM channels');
  return row?.n ?? 0;
}
