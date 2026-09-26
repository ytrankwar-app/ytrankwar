import { NextRequest, NextResponse } from 'next/server';
import { getLeaderboard } from '@/lib/leaderboard-service';

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const entries = getLeaderboard({
    category: params.get('category') || undefined,
    country: params.get('country') || undefined,
    limit: params.get('limit') ? Number(params.get('limit')) : undefined,
    offset: params.get('offset') ? Number(params.get('offset')) : undefined,
  });
  return NextResponse.json({ entries });
}
