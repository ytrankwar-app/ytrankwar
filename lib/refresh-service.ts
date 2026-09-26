import { all, batch, stmt } from './db';
import { lookupChannel, YouTubeLookupError } from './youtube';

export interface RefreshResult {
  updated: number;
  failed: number;
  stoppedEarly: boolean;
}

/**
 * Re-fetches real YouTube data (name, handle, avatar, description and
 * subscriber/view/video counts) for channels already stored in D1. Run
 * hourly by the Cron Trigger in worker.ts so page views never call the
 * YouTube API. Bids, verification status, manage_token and referral_code
 * are untouched.
 *
 * Oldest-fetched channels go first and at most `maxChannels` are processed
 * per run, which keeps a run inside the Workers subrequest limit and spreads
 * the API quota evenly over time.
 */
export async function refreshAllChannelStats(
  apiKey: string | undefined,
  opts: { maxChannels?: number; log?: (msg: string) => void } = {}
): Promise<RefreshResult> {
  const log = opts.log ?? (() => {});
  const maxChannels = opts.maxChannels ?? 40;

  const channels = await all<{ id: string; youtubeChannelId: string; name: string }>(
    `SELECT c.id, c.youtube_channel_id as youtubeChannelId, c.name
     FROM channels c LEFT JOIN channel_stats s ON s.channel_id = c.id
     ORDER BY COALESCE(s.fetched_at, '') ASC
     LIMIT ?`,
    maxChannels
  );

  let updated = 0;
  let failed = 0;
  let stoppedEarly = false;

  for (const channel of channels) {
    try {
      // Look up by the permanent channel id directly — cheapest possible
      // call (1 quota unit) and unambiguous, unlike re-parsing a handle.
      const info = await lookupChannel(`https://youtube.com/channel/${channel.youtubeChannelId}`, apiKey);

      await batch([
        stmt(
          `UPDATE channels SET name = ?, handle = ?, avatar_url = ?, description = ? WHERE id = ?`,
          info.name,
          info.handle,
          info.avatarUrl,
          info.description,
          channel.id
        ),
        stmt(
          `UPDATE channel_stats SET subscribers = ?, total_views = ?, video_count = ?,
             channel_created_at = ?, fetched_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
           WHERE channel_id = ?`,
          info.subscribers,
          info.totalViews,
          info.videoCount,
          info.channelCreatedAt,
          channel.id
        ),
      ]);

      log(`updated ${channel.name} -> ${info.name} (${info.subscribers} subscribers)`);
      updated++;
    } catch (e) {
      const message = e instanceof YouTubeLookupError ? e.message : e instanceof Error ? e.message : String(e);
      log(`failed ${channel.name}: ${message}`);
      failed++;
      // A quota/key error will fail identically for every remaining
      // channel — stop early instead of burning through all of them.
      if (message.toLowerCase().includes('quota') || message.toLowerCase().includes('api key')) {
        stoppedEarly = true;
        break;
      }
    }
  }

  return { updated, failed, stoppedEarly };
}
