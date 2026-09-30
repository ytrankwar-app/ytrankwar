import { NextRequest, NextResponse } from 'next/server';
import { requiredTotalForRank } from '@/lib/leaderboard-service';
import { clampInt, jsonError } from '@/lib/http';

export const dynamic = 'force-dynamic';

// Used by display-only UI (e.g. the homepage "Claim #1" card) that needs to
// show the price to take a rank before any specific challenger channel has
// been chosen yet — quoteAdditionalForTarget needs a channelId (it computes
// an ADDITIONAL amount relative to that channel's current total), but this
// just needs the target total itself.
export async function GET(req: NextRequest) {
  const rank = clampInt(req.nextUrl.searchParams.get('rank') ?? '1', 1, 1000, 1);
  try {
    const requiredTotalCents = await requiredTotalForRank(rank);
    return NextResponse.json({ rank, requiredTotalCents });
  } catch (e) {
    console.error('[api/bids/next-price]', e);
    return jsonError('Pricing is temporarily unavailable.', 503);
  }
}
