import { NextRequest, NextResponse } from 'next/server';
import { quoteAdditionalForTarget } from '@/lib/bidding-service';
import { requiredTotalForRank } from '@/lib/leaderboard-service';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { channelId, desiredRank, targetTotalCents } = body as {
    channelId: string;
    desiredRank?: number;
    targetTotalCents?: number;
  };

  if (!channelId) return NextResponse.json({ error: 'channelId is required.' }, { status: 400 });

  const target = typeof targetTotalCents === 'number' ? targetTotalCents : requiredTotalForRank(Number(desiredRank ?? 1));

  const quote = quoteAdditionalForTarget(channelId, target);
  return NextResponse.json({ quote, note: 'Advisory only — recalculated server-side again at checkout and at payment confirmation.' });
}
