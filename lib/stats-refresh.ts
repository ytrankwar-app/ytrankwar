// Refreshes cached YouTube statistics for channels already in the database.
// Shared by the hourly Cloudflare Cron Trigger (worker.ts) and the local
// script (scripts/refresh-channel-stats.ts). Never called on a page request.

import type { Db } from '@/db';
import { NOW_SQL } from '@/db';
import { lookupChannel, YouTubeLookupError } from './youtube';

export interface RefreshResult {
  updated: number;
  failed: number;
  stoppedEarly: boolean;
}

export async function refreshChannelStats(
  db: Db,
  opts: { limit?: number; log?: (msg: string) => void } = {}
): Promise<RefreshResult> {
  const log = opts.log ?? (() => {});
  const limit = Math.max(1, Math.floor(opts.limit ?? 1_000_000));

  // Least-recently-refreshed first, so a limited run per hour still cycles
  // through every channel over time and stays inside the YouTube quota.
  const channels = await db.all<{ id: string; youtubeChannelId: string; name: string }>(
    `SELECT c.id as id, c.youtube_channel_id as youtubeChannelId, c.name as name
     FROM channels c LEFT JOIN channel_stats s ON s.channel_id = c.id
     ORDER BY COALESCE(s.fetched_at, '') ASC
     LIMIT ?`,
    [limit]
  );

  let updated = 0;
  let failed = 0;
  let stoppedEarly = false;

  for (const channel of channels) {
    try {
      // Look up by the permanent channel id: cheapest call (1 quota unit)
      // and unambiguous, unlike re-parsing a handle.
      const info = await lookupChannel(`https://youtube.com/channel/${channel.youtubeChannelId}`);

      await db.batch([
        {
          sql: `UPDATE channels SET name = ?, handle = ?, avatar_url = ?, description = ? WHERE id = ?`,
          params: [info.name, info.handle, info.avatarUrl, info.description, channel.id],
        },
        {
          sql: `UPDATE channel_stats SET subscribers = ?, total_views = ?, video_count = ?,
                  channel_created_at = ?, fetched_at = ${NOW_SQL}
                WHERE channel_id = ?`,
          params: [info.subscribers, info.totalViews, info.videoCount, info.channelCreatedAt, channel.id],
        },
      ]);

      log(`  ✅ ${channel.name} -> ${info.name} (${info.subscribers.toLocaleString()} subscribers)`);
      updated++;
    } catch (e) {
      const message = e instanceof YouTubeLookupError ? e.message : e instanceof Error ? e.message : String(e);
      log(`  ❌ ${channel.name}: ${message}`);
      failed++;
      // A quota/key error fails identically for every remaining channel.
      if (message.toLowerCase().includes('quota') || message.toLowerCase().includes('api key')) {
        log('\nStopping early — this error will affect every remaining channel too.');
        stoppedEarly = true;
        break;
      }
    }
  }

  return { updated, failed, stoppedEarly };
}
