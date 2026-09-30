import { NextResponse } from 'next/server';
import { countLiveVisitors, countTotalChannels } from '@/lib/presence-service';
import { jsonError, NO_STORE } from '@/lib/http';

// Reads live data on every request — never prerender or cache.
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [liveVisitors, totalChannels] = await Promise.all([countLiveVisitors(), countTotalChannels()]);
    return NextResponse.json({ liveVisitors, totalChannels }, { headers: NO_STORE });
  } catch (e) {
    console.error('[api/stats]', e);
    return jsonError('Stats are temporarily unavailable.', 503);
  }
}
