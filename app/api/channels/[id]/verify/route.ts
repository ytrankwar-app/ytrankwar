import { NextRequest, NextResponse } from 'next/server';
import { requireManageToken, ManageAuthError } from '@/lib/manage-auth';
import { submitCommunityPostProof, VerificationError } from '@/lib/verification-service';
import { db } from '@/db';

// Real ownership verification (Method B from the spec): the owner posts
// their channel's referral link to its YouTube Community tab, then submits
// the URL of that post here. Authorized by manage_token (no login) — see
// lib/manage-auth.ts. See lib/verification-service.ts for exactly what is
// and isn't actually checked in this demo (no live YouTube API access).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const manageToken = typeof body.manageToken === 'string' ? body.manageToken : null;

  try {
    requireManageToken(id, manageToken);
  } catch (e) {
    if (e instanceof ManageAuthError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }

  const channel = db
    .prepare(
      'SELECT handle, youtube_channel_id as youtubeChannelId, referral_code as referralCode FROM channels WHERE id = ?'
    )
    .get(id) as { handle: string | null; youtubeChannelId: string; referralCode: string | null } | undefined;

  if (!channel) return NextResponse.json({ error: "We couldn't find that channel." }, { status: 404 });

  const postUrl = String(body.postUrl || '').trim();
  if (!postUrl) {
    return NextResponse.json({ error: 'Paste the link to your YouTube Community post.' }, { status: 400 });
  }

  try {
    submitCommunityPostProof({
      channelId: id,
      postUrl,
      referralCode: channel.referralCode ?? '',
      handle: channel.handle,
      youtubeChannelId: channel.youtubeChannelId,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof VerificationError) return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
    throw e;
  }
}
