import { NextRequest, NextResponse } from 'next/server';
import { getReferralLeaderboard } from '@/lib/leaderboard-service';

export async function GET(req: NextRequest) {
  const limit = req.nextUrl.searchParams.get('limit');
  const entries = getReferralLeaderboard(limit ? Number(limit) : undefined);
  return NextResponse.json({ entries });
}
