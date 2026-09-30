import { getDb, type SqlParam } from '@/db';
import { newId } from './ids';
import { minIncrementCents, minBidCents } from './settings';

export interface LeaderboardEntry {
  channelId: string;
  name: string;
  handle: string | null;
  slug: string;
  avatarUrl: string | null;
  youtubeChannelId: string;
  categorySlug: string | null;
  countryCode: string | null;
  verificationStatus: string;
  createdAt: string;
  subscribers: number;
  totalViews: number;
  clickCount: number;
  totalBidCents: number;
  bidCount: number;
  lastBidAt: string;
  /** What it costs right now to overtake this exact row — $25 minimum if
   *  it's still free ($0), otherwise its current total + the configured
   *  increment. Computed once, here, so every caller (display and pricing)
   *  agrees on the same number — see computeClaimPrice. */
  requiredToClaimCents: number;
  rank: number;
}

export interface LeaderboardFilter {
  category?: string;
  country?: string;
  limit?: number;
  offset?: number;
}

// Every channel appears on the leaderboard — free (never-bid, $0) listings
// included — per the product decision that everyone gets a rank, paid
// position is just what determines WHICH rank. Previously this filtered to
// `total_bid_cents > 0`, which hid free listings entirely; that's the one
// thing this query deliberately no longer does.
const BASE_QUERY = `
  SELECT
    c.id as channelId, c.name, c.handle, c.slug, c.avatar_url as avatarUrl,
    c.youtube_channel_id as youtubeChannelId,
    c.category_slug as categorySlug, c.country_code as countryCode,
    c.verification_status as verificationStatus,
    c.created_at as createdAt,
    COALESCE(s.subscribers, 0) as subscribers,
    COALESCE(s.total_views, 0) as totalViews,
    COALESCE(yc.count, 0) as clickCount,
    l.total_bid_cents as totalBidCents,
    l.bid_count as bidCount,
    l.updated_at as lastBidAt
  FROM listings l
  JOIN channels c ON c.id = l.channel_id
  LEFT JOIN channel_stats s ON s.channel_id = c.id
  LEFT JOIN youtube_clicks yc ON yc.channel_id = c.id
  WHERE c.moderation_status = 'approved'
    AND c.is_available = 1
`;

/** The floor/increment rule, in exactly one place. A still-free ($0)
 *  listing costs the $25 minimum to claim; an already-paid one costs its
 *  current total plus the configured minimum increment ($1 by default).
 *  Used both for display (every leaderboard row's "claim this rank for $X")
 *  and for the actual payment quote, so they can never disagree. */
function computeClaimPrice(currentTotalCents: number, minBid: number, minIncrement: number): number {
  if (currentTotalCents <= 0) return minBid;
  return currentTotalCents + minIncrement;
}

/**
 * The authoritative ordering: highest cumulative bid first; on an exact
 * tie (including the common case of many untouched $0 listings), whichever
 * channel's bid last changed earliest keeps the better spot, and among
 * listings that have NEVER changed (true free/first-come-first-served
 * territory) whichever channel was created first wins. Rank numbers are
 * computed here, live, on every call — never trusted from a stored column
 * for anything that affects money or ranking guarantees. (listings.
 * current_rank is a display cache only, refreshed by rebuildRankCache
 * below, and is always re-derivable from this query.)
 */
export async function getLeaderboard(filter: LeaderboardFilter = {}): Promise<LeaderboardEntry[]> {
  const db = await getDb();
  const clauses: string[] = [];
  const params: SqlParam[] = [];

  if (filter.category) {
    clauses.push('AND c.category_slug = ?');
    params.push(filter.category);
  }
  if (filter.country) {
    clauses.push('AND c.country_code = ?');
    params.push(filter.country);
  }

  const limit = Math.max(1, Math.min(Math.floor(filter.limit ?? 50) || 50, 200));
  const offset = Math.max(0, Math.floor(filter.offset ?? 0) || 0);

  const rows = await db.all<Omit<LeaderboardEntry, 'rank' | 'requiredToClaimCents'>>(
    `${BASE_QUERY} ${clauses.join(' ')}
     ORDER BY l.total_bid_cents DESC, l.seq ASC, c.created_at ASC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const [minBid, minIncrement] = await Promise.all([minBidCents(), minIncrementCents()]);

  // Rank is positional within the *unfiltered global* ordering when no
  // filter is applied; within category/country when filtered, matching the
  // spec's per-scope leaderboards. Offset is folded in so pagination shows
  // correct absolute ranks.
  return rows.map((row, i) => ({
    ...row,
    rank: offset + i + 1,
    requiredToClaimCents: computeClaimPrice(row.totalBidCents, minBid, minIncrement),
  }));
}

export async function getChannelRank(channelId: string): Promise<{ rank: number; totalBidCents: number } | null> {
  const db = await getDb();
  const listing = await db.first<{ totalBidCents: number; seq: number; createdAt: string }>(
    `SELECT l.total_bid_cents as totalBidCents, l.seq as seq, c.created_at as createdAt
     FROM listings l JOIN channels c ON c.id = l.channel_id
     WHERE l.channel_id = ?`,
    [channelId]
  );
  if (!listing) return null;

  // Every channel with a listings row (i.e. every submitted channel) gets a
  // real rank now, free ones included — matches getLeaderboard's ordering
  // rule exactly (bid DESC, then seq ASC, then created_at ASC) so a
  // channel's own profile page and the homepage never disagree about its
  // position.
  const better = await db.first<{ n: number }>(
    `SELECT count(*) as n FROM listings l
     JOIN channels c ON c.id = l.channel_id
     WHERE c.moderation_status = 'approved' AND c.is_available = 1
     AND (
       l.total_bid_cents > ?
       OR (l.total_bid_cents = ? AND l.seq < ?)
       OR (l.total_bid_cents = ? AND l.seq = ? AND c.created_at < ?)
     )`,
    [
      listing.totalBidCents,
      listing.totalBidCents,
      listing.seq,
      listing.totalBidCents,
      listing.seq,
      listing.createdAt,
    ]
  );

  return { rank: (better?.n ?? 0) + 1, totalBidCents: listing.totalBidCents };
}

/** What a channel would need to reach a given rank right now. Advisory only —
 *  re-validated server-side again at payment time (see BiddingService.quote). */
export async function requiredTotalForRank(targetRank: number, filter: LeaderboardFilter = {}): Promise<number> {
  const [minBid, minIncrement] = await Promise.all([minBidCents(), minIncrementCents()]);
  const rank = Math.max(1, Math.floor(targetRank) || 1);
  if (rank <= 1) {
    const top = (await getLeaderboard({ ...filter, limit: 1 }))[0];
    return computeClaimPrice(top?.totalBidCents ?? 0, minBid, minIncrement);
  }
  const aboveTarget = await getLeaderboard({ ...filter, limit: rank, offset: 0 });
  const channelCurrentlyAtTarget = aboveTarget[rank - 1];
  return computeClaimPrice(channelCurrentlyAtTarget?.totalBidCents ?? 0, minBid, minIncrement);
}

/** Rebuilds the cached rank columns on `listings` for display purposes
 *  (dashboard "current rank" without a live join everywhere). Safe to run
 *  any time — it is derived entirely from `bids`/`listings`, never the
 *  other way around. Intended to run after every bid and on a schedule.
 *
 *  One set-based statement (window function) rather than a per-row loop:
 *  D1 has no interactive transactions, and this keeps the whole rebuild a
 *  single atomic write no matter how many channels exist. */
export async function rebuildRankCache(): Promise<void> {
  const db = await getDb();
  await db.run(
    `WITH ranked AS MATERIALIZED (
       SELECT l.channel_id AS cid,
              ROW_NUMBER() OVER (ORDER BY l.total_bid_cents DESC, l.seq ASC, c.created_at ASC) AS rk
       FROM listings l JOIN channels c ON c.id = l.channel_id
       WHERE c.moderation_status = 'approved' AND c.is_available = 1
     )
     UPDATE listings SET
       current_rank = (SELECT rk FROM ranked WHERE cid = listings.channel_id),
       highest_rank = CASE
         WHEN highest_rank IS NULL OR (SELECT rk FROM ranked WHERE cid = listings.channel_id) < highest_rank
           THEN (SELECT rk FROM ranked WHERE cid = listings.channel_id) ELSE highest_rank END,
       lowest_rank = CASE
         WHEN lowest_rank IS NULL OR (SELECT rk FROM ranked WHERE cid = listings.channel_id) > lowest_rank
           THEN (SELECT rk FROM ranked WHERE cid = listings.channel_id) ELSE lowest_rank END
     WHERE channel_id IN (SELECT cid FROM ranked)`
  );
}

export async function recordRankHistory(channelId: string, rank: number, totalBidCents: number): Promise<void> {
  const db = await getDb();
  await db.run(`INSERT INTO rank_history (id, channel_id, rank, total_bid_cents) VALUES (?, ?, ?, ?)`, [
    newId('rh'),
    channelId,
    rank,
    totalBidCents,
  ]);
}

export interface ReferralLeaderboardEntry {
  channelId: string;
  name: string;
  handle: string | null;
  slug: string;
  avatarUrl: string | null;
  referredVisits: number;
  rank: number;
}

/**
 * A DELIBERATELY SEPARATE leaderboard driven by referred_visits (traffic
 * from shared /r/{code} links), never by cumulative bid. This must never be
 * merged with getLeaderboard() above or used to influence total_bid_cents
 * ordering — the spec is explicit that paid rank reflects verified bid
 * only, never engagement/traffic metrics. This exists purely as a second,
 * clearly-labeled scoreboard alongside the real one.
 */
export async function getReferralLeaderboard(limit = 20): Promise<ReferralLeaderboardEntry[]> {
  const db = await getDb();
  const n = Math.max(1, Math.min(Math.floor(limit) || 20, 100));
  const rows = await db.all<Omit<ReferralLeaderboardEntry, 'rank'>>(
    `SELECT id as channelId, name, handle, slug, avatar_url as avatarUrl, referred_visits as referredVisits
     FROM channels
     WHERE referred_visits > 0 AND moderation_status = 'approved' AND is_available = 1
     ORDER BY referred_visits DESC, created_at ASC
     LIMIT ?`,
    [n]
  );

  return rows.map((row, i) => ({ ...row, rank: i + 1 }));
}
