import { NextRequest, NextResponse } from 'next/server';
import { getLeaderboard } from '@/lib/leaderboard-service';
import { jsonError } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  try {
    const entries = await getLeaderboard({
      category: params.get('category') || undefined,
      country: params.get('country') || undefined,
      limit: params.get('limit') ? Number(params.get('limit')) : undefined,
      offset: params.get('offset') ? Number(params.get('offset')) : undefined,
    });
    return NextResponse.json({ entries });
  } catch (e) {
    console.error('[api/leaderboard]', e);
    return jsonError('The leaderboard is temporarily unavailable.', 503);
  }
}
