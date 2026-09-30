import { NextRequest, NextResponse } from 'next/server';
import { getReferralLeaderboard } from '@/lib/leaderboard-service';
import { jsonError } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const limit = req.nextUrl.searchParams.get('limit');
  try {
    const entries = await getReferralLeaderboard(limit ? Number(limit) : undefined);
    return NextResponse.json({ entries });
  } catch (e) {
    console.error('[api/leaderboard/referrals]', e);
    return jsonError('The referral leaderboard is temporarily unavailable.', 503);
  }
}
