import { NextRequest, NextResponse } from 'next/server';
import { verifyChannelOwnership, VerificationError } from '@/lib/verification-service';
import { isPlausibleId, jsonError } from '@/lib/http';

export const dynamic = 'force-dynamic';

// Ownership verification: the owner puts the channel's verification line in
// the channel DESCRIPTION; this endpoint re-reads that same channel's
// description from the YouTube Data API. Nothing the caller sends is trusted
// as proof, so a post or code from another channel cannot verify this one.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!isPlausibleId(params.id)) return jsonError("We couldn't find that channel.", 404);

  try {
    await verifyChannelOwnership(params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof VerificationError) {
      const status = e.code === 'unavailable' ? 503 : e.code === 'not_found' ? 404 : e.code === 'too_fast' ? 429 : 400;
      return jsonError(e.message, status, e.code);
    }
    console.error('[api/channels/:id/verify]', e);
    return jsonError('Verification is temporarily unavailable.', 503);
  }
}
