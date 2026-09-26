import { NextResponse } from 'next/server';
import { rebuildRankCache } from '@/lib/leaderboard-service';

// Admin/system utility: current_rank on `listings` is only a display cache.
// This proves (and enforces) that it is always fully re-derivable from
// total_bid_cents — safe to call any time, e.g. after a manual DB fix.
export async function POST() {
  rebuildRankCache();
  return NextResponse.json({ ok: true });
}
