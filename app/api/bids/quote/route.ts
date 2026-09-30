import { NextRequest, NextResponse } from 'next/server';
import { quoteAdditionalForTarget } from '@/lib/bidding-service';
import { requiredTotalForRank } from '@/lib/leaderboard-service';
import { clampInt, isPlausibleId, jsonError } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    channelId?: unknown;
    desiredRank?: unknown;
    targetTotalCents?: unknown;
  };
  if (!isPlausibleId(body.channelId)) return jsonError('channelId is required.', 400);

  try {
    const target =
      typeof body.targetTotalCents === 'number' && Number.isFinite(body.targetTotalCents)
        ? Math.floor(body.targetTotalCents)
        : await requiredTotalForRank(clampInt(body.desiredRank, 1, 1000, 1));

    const quote = await quoteAdditionalForTarget(body.channelId, target);
    return NextResponse.json({
      quote,
      note: 'Advisory only — recalculated server-side again at checkout and at payment confirmation.',
    });
  } catch (e) {
    console.error('[api/bids/quote]', e);
    return jsonError('Pricing is temporarily unavailable.', 503);
  }
}
