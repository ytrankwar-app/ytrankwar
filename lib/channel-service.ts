import { db } from '@/db';
import { newId, slugify } from './ids';
import { lookupChannel, YouTubeLookupError } from './youtube';
import { newReferralCode } from './verification-service';

export class ChannelError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * No login, no accounts, and no per-channel ownership credential anywhere
 * in this app. Every submission auto-creates a synthetic user row purely
 * so bids/payments/reports have a stable user_id to reference for audit
 * continuity — it is never used for authorization, since there is none.
 */
function createSyntheticOwner(channelId: string): string {
  const userId = newId('usr');
  db.prepare('INSERT INTO users (id, name, email) VALUES (?, ?, ?)').run(
    userId,
    `Channel owner (${channelId})`,
    `${channelId}@channels.ytrankwar.internal`
  );
  return userId;
}

export interface SubmitChannelResult {
  channelId: string;
  slug: string;
  name: string;
  /** PUBLIC — safe to share/post. */
  referralCode: string;
}

export async function submitChannel(params: {
  rawUrl: string;
  category?: string;
  country?: string;
}): Promise<SubmitChannelResult> {
  let info;
  try {
    info = await lookupChannel(params.rawUrl);
  } catch (e) {
    if (e instanceof YouTubeLookupError) throw new ChannelError('invalid_url', e.message);
    throw e;
  }

  const existing = db
    .prepare('SELECT id, slug FROM channels WHERE youtube_channel_id = ?')
    .get(info.youtubeChannelId) as { id: string; slug: string } | undefined;
  if (existing) {
    throw new ChannelError('duplicate', 'This channel is already listed.');
  }

  const id = newId('ch');
  const baseSlug = slugify(info.name);
  let slug = baseSlug;
  let n = 1;
  while (db.prepare('SELECT 1 FROM channels WHERE slug = ?').get(slug)) {
    slug = `${baseSlug}-${++n}`;
  }

  const referralCode = newReferralCode();

  const insert = db.transaction(() => {
    const ownerUserId = createSyntheticOwner(id);

    db.prepare(
      `INSERT INTO channels (id, youtube_channel_id, slug, name, handle, avatar_url, description, category_slug, country_code, owner_user_id, referral_code, verification_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
    ).run(
      id,
      info.youtubeChannelId,
      slug,
      info.name,
      info.handle,
      info.avatarUrl,
      info.description,
      params.category ?? null,
      params.country ?? null,
      ownerUserId,
      referralCode
    );

    db.prepare(
      `INSERT INTO channel_stats (channel_id, subscribers, total_views, video_count, channel_created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(id, info.subscribers, info.totalViews, info.videoCount, info.channelCreatedAt);

    db.prepare(`INSERT INTO listings (channel_id, total_bid_cents) VALUES (?, 0)`).run(id);
    db.prepare(`INSERT INTO profile_views (channel_id, count) VALUES (?, 0)`).run(id);
    db.prepare(`INSERT INTO youtube_clicks (channel_id, count) VALUES (?, 0)`).run(id);
  });
  insert();

  return { channelId: id, slug, name: info.name, referralCode };
}

/**
 * MOCK instant-verify — the "Add & Take a Position" premium fast lane
 * skips the community-post flow entirely. Real production would still
 * require a genuine check even on this path.
 */
export function mockVerifyChannel(channelId: string): void {
  const channel = db.prepare('SELECT id FROM channels WHERE id = ?').get(channelId);
  if (!channel) throw new ChannelError('not_found', "We couldn't find that channel.");
  db.prepare(`UPDATE channels SET verification_status = 'verified' WHERE id = ?`).run(channelId);
}

export function getChannelBySlug(slug: string) {
  return db
    .prepare(
      `SELECT c.id, c.youtube_channel_id as youtubeChannelId, c.slug, c.name, c.handle,
              c.avatar_url as avatarUrl, c.description, c.category_slug as categorySlug,
              c.country_code as countryCode,
              c.referral_code as referralCode, c.referred_visits as referredVisits,
              c.verification_status, c.moderation_status as moderationStatus,
              c.is_available as isAvailable, c.created_at as createdAt,
              s.subscribers, s.total_views as totalViews, s.video_count as videoCount, s.fetched_at as statsFetchedAt,
              l.total_bid_cents as totalBidCents, l.current_rank as currentRank, l.highest_rank as highestRank,
              l.lowest_rank as lowestRank, l.bid_count as bidCount
       FROM channels c
       LEFT JOIN channel_stats s ON s.channel_id = c.id
       LEFT JOIN listings l ON l.channel_id = c.id
       WHERE c.slug = ?`
    )
    .get(slug);
}

export function getChannelById(channelId: string) {
  return db
    .prepare(
      `SELECT c.id, c.slug, c.name, c.handle, c.avatar_url as avatarUrl,
              c.verification_status as verificationStatus,
              l.total_bid_cents as totalBidCents, l.current_rank as currentRank
       FROM channels c
       LEFT JOIN listings l ON l.channel_id = c.id
       WHERE c.id = ?`
    )
    .get(channelId);
}
