import { NextResponse } from 'next/server';
import { db } from '@/db';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const channel = db
    .prepare(
      `SELECT c.id, c.name, c.slug, c.handle, c.avatar_url as avatarUrl, c.description,
              c.verification_status as verificationStatus, c.moderation_status as moderationStatus,
              c.category_slug as categorySlug, c.country_code as countryCode, c.created_at as createdAt,
              s.subscribers, s.total_views as totalViews, s.video_count as videoCount, s.fetched_at as statsFetchedAt,
              l.total_bid_cents as totalBidCents, l.current_rank as currentRank, l.highest_rank as highestRank,
              l.lowest_rank as lowestRank, l.bid_count as bidCount
       FROM channels c
       LEFT JOIN channel_stats s ON s.channel_id = c.id
       LEFT JOIN listings l ON l.channel_id = c.id
       WHERE c.id = ?`
    )
    .get(id);

  if (!channel) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const bidHistory = db
    .prepare(
      `SELECT amount_added_cents as amountAddedCents, total_bid_after_cents as totalBidAfterCents,
              rank_after as rankAfter, created_at as createdAt
       FROM bids WHERE channel_id = ? ORDER BY created_at DESC LIMIT 25`
    )
    .all(id);

  const rankHistory = db
    .prepare(
      `SELECT rank, total_bid_cents as totalBidCents, recorded_at as recordedAt
       FROM rank_history WHERE channel_id = ? ORDER BY recorded_at ASC LIMIT 200`
    )
    .all(id);

  return NextResponse.json({ channel, bidHistory, rankHistory });
}
