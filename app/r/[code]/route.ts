import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { getSiteUrl } from '@/lib/site';

export const dynamic = 'force-dynamic';

// Public, unauthenticated by design: anyone clicking a shared referral link
// increments that channel's referred_visits counter (a separate signal from
// the paid leaderboard, never affecting cumulative-bid rank — see
// lib/leaderboard-service.ts, which is untouched by this).
export async function GET(_req: NextRequest, { params }: { params: { code: string } }) {
  const base = await getSiteUrl();
  const code = String(params.code || '').slice(0, 40);

  try {
    const db = await getDb();
    const channel = await db.first<{ id: string; slug: string }>(
      'SELECT id, slug FROM channels WHERE referral_code = ?',
      [code]
    );

    if (!channel) return NextResponse.redirect(new URL('/', base));

    await db.run('UPDATE channels SET referred_visits = referred_visits + 1 WHERE id = ?', [channel.id]);
    return NextResponse.redirect(new URL(`/channel/${channel.slug}?ref=1`, base));
  } catch (e) {
    console.error('[r/:code]', e);
    return NextResponse.redirect(new URL('/', base));
  }
}
