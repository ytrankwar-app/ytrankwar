import { db } from '@/db';
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
function computeClaimPrice(currentTotalCents: number): number {
  if (currentTotalCents <= 0) return minBidCents();
  return currentTotalCents + minIncrementCents();
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
export function getLeaderboard(filter: LeaderboardFilter = {}): LeaderboardEntry[] {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};

  if (filter.category) {
    clauses.push('AND c.category_slug = @category');
    params.category = filter.category;
  }
  if (filter.country) {
    clauses.push('AND c.country_code = @country');
    params.country = filter.country;
  }

  const limit = Math.min(filter.limit ?? 50, 200);
  const offset = filter.offset ?? 0;

  const rows = db
    .prepare(
      `${BASE_QUERY} ${clauses.join(' ')}
       ORDER BY l.total_bid_cents DESC, l.seq ASC, c.created_at ASC
       LIMIT @limit OFFSET @offset`
    )
    .all({ ...params, limit, offset }) as Omit<LeaderboardEntry, 'rank' | 'requiredToClaimCents'>[];

  // Rank is positional within the *unfiltered global* ordering when no
  // filter is applied; within category/country when filtered, matching the
  // spec's per-scope leaderboards. Offset is folded in so pagination shows
  // correct absolute ranks.
  return rows.map((row, i) => ({
    ...row,
    rank: offset + i + 1,
    requiredToClaimCents: computeClaimPrice(row.totalBidCents),
  }));
}

export function getChannelRank(channelId: string): { rank: number; totalBidCents: number } | null {
  const listing = db
    .prepare(
      `SELECT l.total_bid_cents as totalBidCents, l.seq as seq, c.created_at as createdAt
       FROM listings l JOIN channels c ON c.id = l.channel_id
       WHERE l.channel_id = ?`
    )
    .get(channelId) as { totalBidCents: number; seq: number; createdAt: string } | undefined;
  if (!listing) return null;

  // Every channel with a listings row (i.e. every submitted channel) gets a
  // real rank now, free ones included — matches getLeaderboard's ordering
  // rule exactly (bid DESC, then seq ASC, then created_at ASC) so a
  // channel's own profile page and the homepage never disagree about its
  // position.
  const better = db
    .prepare(
      `SELECT count(*) as n FROM listings l
       JOIN channels c ON c.id = l.channel_id
       WHERE c.moderation_status = 'approved' AND c.is_available = 1
       AND (
         l.total_bid_cents > @total
         OR (l.total_bid_cents = @total AND l.seq < @seq)
         OR (l.total_bid_cents = @total AND l.seq = @seq AND c.created_at < @createdAt)
       )`
    )
    .get({ total: listing.totalBidCents, seq: listing.seq, createdAt: listing.createdAt }) as { n: number };

  return { rank: better.n + 1, totalBidCents: listing.totalBidCents };
}

/** What a channel would need to reach a given rank right now. Advisory only —
 *  re-validated server-side again at payment time (see BiddingService.quote). */
export function requiredTotalForRank(targetRank: number, filter: LeaderboardFilter = {}): number {
  if (targetRank <= 1) {
    const top = getLeaderboard({ ...filter, limit: 1 })[0];
    return computeClaimPrice(top?.totalBidCents ?? 0);
  }
  const aboveTarget = getLeaderboard({ ...filter, limit: targetRank, offset: 0 });
  const channelCurrentlyAtTarget = aboveTarget[targetRank - 1];
  return computeClaimPrice(channelCurrentlyAtTarget?.totalBidCents ?? 0);
}

/** Rebuilds the cached rank columns on `listings` for display purposes
 *  (dashboard "current rank" without a live join everywhere). Safe to run
 *  any time — it is derived entirely from `bids`/`listings`, never the
 *  other way around. Intended to run after every bid and on a schedule. */
export function rebuildRankCache(): void {
  const all = getLeaderboard({ limit: 200 });
  const update = db.prepare(
    `UPDATE listings SET
       current_rank = @rank,
       highest_rank = CASE WHEN highest_rank IS NULL OR @rank < highest_rank THEN @rank ELSE highest_rank END,
       lowest_rank = CASE WHEN lowest_rank IS NULL OR @rank > lowest_rank THEN @rank ELSE lowest_rank END
     WHERE channel_id = @channelId`
  );
  const tx = db.transaction((entries: LeaderboardEntry[]) => {
    for (const entry of entries) update.run({ rank: entry.rank, channelId: entry.channelId });
  });
  tx(all);
}

export function recordRankHistory(channelId: string, rank: number, totalBidCents: number): void {
  db.prepare(
    `INSERT INTO rank_history (id, channel_id, rank, total_bid_cents) VALUES (?, ?, ?, ?)`
  ).run(newId('rh'), channelId, rank, totalBidCents);
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
export function getReferralLeaderboard(limit = 20): ReferralLeaderboardEntry[] {
  const rows = db
    .prepare(
      `SELECT id as channelId, name, handle, slug, avatar_url as avatarUrl, referred_visits as referredVisits
       FROM channels
       WHERE referred_visits > 0 AND moderation_status = 'approved' AND is_available = 1
       ORDER BY referred_visits DESC, created_at ASC
       LIMIT ?`
    )
    .all(Math.min(limit, 100)) as Omit<ReferralLeaderboardEntry, 'rank'>[];

  return rows.map((row, i) => ({ ...row, rank: i + 1 }));
}
