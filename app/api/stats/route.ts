import { NextResponse } from 'next/server';
import { countLiveVisitors, countTotalChannels } from '@/lib/presence-service';

// Without this, Next.js has no signal that this route reads live data (no
// cookies/headers/request usage) and will statically prerender it at build
// time — silently freezing the counts forever. Confirmed this was actually
// happening: it showed up as "○ (Static)" in the build output before this
// line was added.
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    liveVisitors: countLiveVisitors(),
    totalChannels: countTotalChannels(),
  });
}
