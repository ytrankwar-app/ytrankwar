import { NextRequest, NextResponse } from 'next/server';
import { requiredTotalForRank } from '@/lib/leaderboard-service';

// Used by display-only UI (e.g. the homepage "Claim #1" card) that needs to
// show the price to take a rank before any specific challenger channel has
// been chosen yet — quoteAdditionalForTarget needs a channelId (it computes
// an ADDITIONAL amount relative to that channel's current total), but this
// just needs the target total itself.
export async function GET(req: NextRequest) {
  const rank = Number(req.nextUrl.searchParams.get('rank') ?? '1');
  const requiredTotalCents = requiredTotalForRank(rank);
  return NextResponse.json({ rank, requiredTotalCents });
}
