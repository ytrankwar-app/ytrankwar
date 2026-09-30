import { NextRequest, NextResponse } from 'next/server';
import { submitCommunityPostProof, VerificationError } from '@/lib/verification-service';
import { getDb } from '@/db';
import { isPlausibleId, jsonError } from '@/lib/http';

export const dynamic = 'force-dynamic';

// Real ownership verification (Method B from the spec): the owner posts
// their channel's referral link to its YouTube Community tab, then submits
// the URL of that post here. There is no login and no token check on this
// endpoint — the proof itself is the gate, since only the real channel
// owner can post to that channel's own Community tab. See
// lib/verification-service.ts for exactly what is and isn't actually
// checked (no live YouTube API access to Community posts).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isPlausibleId(params.id)) return jsonError("We couldn't find that channel.", 404);
  const body = (await req.json().catch(() => ({}))) as { postUrl?: unknown };

  try {
    const db = await getDb();
    const channel = await db.first<{ handle: string | null; youtubeChannelId: string; referralCode: string | null }>(
      'SELECT handle, youtube_channel_id as youtubeChannelId, referral_code as referralCode FROM channels WHERE id = ?',
      [params.id]
    );
    if (!channel) return jsonError("We couldn't find that channel.", 404);

    const postUrl = String(body.postUrl || '').trim().slice(0, 500);
    if (!postUrl) return jsonError('Paste the link to your YouTube Community post.', 400);

    await submitCommunityPostProof({
      channelId: params.id,
      postUrl,
      referralCode: channel.referralCode ?? '',
      handle: channel.handle,
      youtubeChannelId: channel.youtubeChannelId,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof VerificationError) return jsonError(e.message, 400, e.code);
    console.error('[api/channels/:id/verify]', e);
    return jsonError('Verification is temporarily unavailable.', 503);
  }
}
