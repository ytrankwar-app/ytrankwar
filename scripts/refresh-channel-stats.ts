// Run locally with: npm run db:refresh-stats
//
// New channel submissions already use the real YouTube Data API
// automatically once YOUTUBE_API_KEY is set (see lib/youtube.ts) — but
// that lookup only ever happens once, at submission time. A channel added
// before the key was set (or before it was working) keeps its old mock
// data forever otherwise, since nothing re-fetches it later. This script
// re-fetches real data for every channel already in the database and
// updates it in place — names, handles, avatars, descriptions, and
// subscriber/view/video counts. Bids, verification status, and the
// referral_code are untouched.

import type Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { lookupChannel, YouTubeLookupError } from '../lib/youtube';

export interface RefreshResult {
  updated: number;
  failed: number;
  stoppedEarly: boolean;
}

/** The actual logic, factored out and exported so it can be exercised by a
 *  real test with a mocked fetch/db rather than only trusted by reading
 *  the code — see test/refresh-channel-stats.test.ts. */
export async function refreshAllChannelStats(
  db: Database.Database,
  log: (msg: string) => void = console.log
): Promise<RefreshResult> {
  const channels = db
    .prepare('SELECT id, youtube_channel_id as youtubeChannelId, name FROM channels')
    .all() as { id: string; youtubeChannelId: string; name: string }[];

  let updated = 0;
  let failed = 0;
  let stoppedEarly = false;

  for (const channel of channels) {
    try {
      // Look up by the permanent channel id directly — cheapest possible
      // call (1 quota unit) and unambiguous, unlike re-parsing a handle.
      const info = await lookupChannel(`https://youtube.com/channel/${channel.youtubeChannelId}`);

      const tx = db.transaction(() => {
        db.prepare(
          `UPDATE channels SET name = ?, handle = ?, avatar_url = ?, description = ? WHERE id = ?`
        ).run(info.name, info.handle, info.avatarUrl, info.description, channel.id);

        db.prepare(
          `UPDATE channel_stats SET subscribers = ?, total_views = ?, video_count = ?,
             channel_created_at = ?, fetched_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
           WHERE channel_id = ?`
        ).run(info.subscribers, info.totalViews, info.videoCount, info.channelCreatedAt, channel.id);
      });
      tx();

      log(`  ✅ ${channel.name} -> ${info.name} (${info.subscribers.toLocaleString()} subscribers)`);
      updated++;
    } catch (e) {
      const message = e instanceof YouTubeLookupError ? e.message : e instanceof Error ? e.message : String(e);
      log(`  ❌ ${channel.name}: ${message}`);
      failed++;
      // A quota/key error will fail identically for every remaining
      // channel — stop early instead of burning through all of them.
      if (message.toLowerCase().includes('quota') || message.toLowerCase().includes('api key')) {
        log('\nStopping early — this error will affect every remaining channel too.');
        stoppedEarly = true;
        break;
      }
    }
  }

  return { updated, failed, stoppedEarly };
}

async function main() {
  const { loadLocalEnv } = await import('./load-env');
  loadLocalEnv();

  if (!process.env.YOUTUBE_API_KEY) {
    console.log('YOUTUBE_API_KEY is not set in .env.local — there is nothing to refresh with.');
    console.log('Run `npm run check:youtube-key` first to confirm your key is set up correctly.');
    process.exitCode = 1;
    return;
  }

  const { db } = await import('../db/index');

  const count = (db.prepare('SELECT count(*) as n FROM channels').get() as { n: number }).n;
  if (count === 0) {
    console.log('No channels in the database yet — nothing to refresh.');
    return;
  }

  console.log(`Refreshing ${count} channel(s) from the real YouTube Data API...\n`);

  const result = await refreshAllChannelStats(db);

  console.log(`\nDone. ${result.updated} updated, ${result.failed} failed.`);
  if (result.failed > 0 && result.updated === 0) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
