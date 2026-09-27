import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';

// Public, unauthenticated by design: anyone clicking a shared referral link
// increments that channel's referred_visits counter (a separate signal from
// the paid leaderboard, never affecting cumulative-bid rank — see
// lib/leaderboard-service.ts, which is untouched by this).
export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  const channel = db
    .prepare('SELECT id, slug FROM channels WHERE referral_code = ?')
    .get(params.code) as { id: string; slug: string } | undefined;

  if (!channel) {
    return NextResponse.redirect(new URL('/', req.url));
  }

  db.prepare('UPDATE channels SET referred_visits = referred_visits + 1 WHERE id = ?').run(channel.id);

  return NextResponse.redirect(new URL(`/channel/${channel.slug}?ref=1`, req.url));
}
