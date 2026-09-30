import { getDb } from '@/db';
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

export interface SubmitChannelResult {
  channelId: string;
  slug: string;
  name: string;
  /** PUBLIC — safe to share/post. */
  referralCode: string;
}

export async function submitChannel(params: {
  rawUrl: string;
  category?: string | null;
  country?: string | null;
}): Promise<SubmitChannelResult> {
  let info;
  try {
    info = await lookupChannel(params.rawUrl);
  } catch (e) {
    if (e instanceof YouTubeLookupError) throw new ChannelError('invalid_url', e.message);
    throw e;
  }

  const db = await getDb();

  const existing = await db.first<{ id: string }>('SELECT id FROM channels WHERE youtube_channel_id = ?', [
    info.youtubeChannelId,
  ]);
  if (existing) {
    throw new ChannelError('duplicate', 'This channel is already listed.');
  }

  const category = await validCategory(params.category);
  const country = await validCountry(params.country);

  const id = newId('ch');
  const baseSlug = slugify(info.name);
  const ownerUserId = newId('usr');

  // No login, no accounts, and no per-channel ownership credential anywhere
  // in this app. Every submission auto-creates a synthetic user row purely
  // so bids/payments/reports have a stable user_id to reference for audit
  // continuity — it is never used for authorization, since there is none.
  //
  // Everything is written in ONE atomic batch. Two channels with the same
  // display name race for the same slug; the UNIQUE constraint decides the
  // winner and the loser simply retries with the next suffix.
  for (let attempt = 1; attempt <= 6; attempt++) {
    // slugify() only emits [a-z0-9-], so the LIKE pattern needs no escaping.
    let slug = baseSlug;
    if (attempt > 1) {
      slug = `${baseSlug}-${newId('s').slice(2, 6).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`;
    } else if (await db.first('SELECT 1 as x FROM channels WHERE slug = ?', [slug])) {
      const used = new Set(
        (await db.all<{ slug: string }>('SELECT slug FROM channels WHERE slug LIKE ?', [`${baseSlug}-%`])).map(
          (r) => r.slug
        )
      );
      let n = 2;
      while (used.has(`${baseSlug}-${n}`)) n++;
      slug = `${baseSlug}-${n}`;
    }

    const referralCode = newReferralCode();
    try {
      await db.batch([
        {
          sql: 'INSERT INTO users (id, name, email) VALUES (?, ?, ?)',
          params: [ownerUserId, `Channel owner (${id})`, `${id}@channels.ytrankwar.internal`],
        },
        {
          sql: `INSERT INTO channels (id, youtube_channel_id, slug, name, handle, avatar_url, description, category_slug, country_code, owner_user_id, referral_code, verification_status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
          params: [
            id,
            info.youtubeChannelId,
            slug,
            info.name,
            info.handle,
            info.avatarUrl,
            info.description,
            category,
            country,
            ownerUserId,
            referralCode,
          ],
        },
        {
          sql: `INSERT INTO channel_stats (channel_id, subscribers, total_views, video_count, channel_created_at)
                VALUES (?, ?, ?, ?, ?)`,
          params: [id, info.subscribers, info.totalViews, info.videoCount, info.channelCreatedAt],
        },
        { sql: `INSERT INTO listings (channel_id, total_bid_cents) VALUES (?, 0)`, params: [id] },
        { sql: `INSERT INTO profile_views (channel_id, count) VALUES (?, 0)`, params: [id] },
        { sql: `INSERT INTO youtube_clicks (channel_id, count) VALUES (?, 0)`, params: [id] },
      ]);
      return { channelId: id, slug, name: info.name, referralCode };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/UNIQUE|constraint/i.test(msg)) {
        // Lost a race: either the same channel was added a moment ago, or the
        // slug/referral code collided. Re-check, then retry with a new slug.
        const dupe = await db.first('SELECT 1 as x FROM channels WHERE youtube_channel_id = ?', [
          info.youtubeChannelId,
        ]);
        if (dupe) throw new ChannelError('duplicate', 'This channel is already listed.');
        continue;
      }
      throw e;
    }
  }
  throw new ChannelError('conflict', 'We could not create a unique page for this channel. Please try again.');
}

/** Only accept a category / country that actually exists, so a bad value
 *  from the client can never trip the foreign-key constraint (a 500). */
async function validCategory(slug?: string | null): Promise<string | null> {
  if (!slug) return null;
  const db = await getDb();
  const row = await db.first('SELECT 1 as x FROM categories WHERE slug = ?', [slug]);
  return row ? slug : null;
}

async function validCountry(code?: string | null): Promise<string | null> {
  if (!code) return null;
  const db = await getDb();
  const row = await db.first('SELECT 1 as x FROM countries WHERE code = ?', [code]);
  return row ? code : null;
}

/**
 * MOCK instant-verify — the "Add & Take a Position" premium fast lane
 * skips the community-post flow entirely. Real production would still
 * require a genuine check even on this path.
 */
export async function mockVerifyChannel(channelId: string): Promise<void> {
  const db = await getDb();
  const channel = await db.first('SELECT id FROM channels WHERE id = ?', [channelId]);
  if (!channel) throw new ChannelError('not_found', "We couldn't find that channel.");
  await db.run(`UPDATE channels SET verification_status = 'verified' WHERE id = ?`, [channelId]);
}

export async function getChannelBySlug(slug: string) {
  const db = await getDb();
  return db.first(
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
       WHERE c.slug = ?`,
    [slug]
  );
}

export async function getChannelById(channelId: string) {
  const db = await getDb();
  return db.first(
      `SELECT c.id, c.slug, c.name, c.handle, c.avatar_url as avatarUrl,
              c.verification_status as verificationStatus,
              l.total_bid_cents as totalBidCents, l.current_rank as currentRank
       FROM channels c
       LEFT JOIN listings l ON l.channel_id = c.id
       WHERE c.id = ?`,
    [channelId]
  );
}
