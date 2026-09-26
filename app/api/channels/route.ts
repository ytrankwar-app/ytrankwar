import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { submitChannel, mockVerifyChannel, ChannelError } from '@/lib/channel-service';

// No login in this app. "My channels" is tracked entirely client-side
// (localStorage holds {channelId, manageToken, slug, name} per channel this
// browser created — see lib/local-channels.ts). This GET endpoint only does
// public, harmless bulk lookups by id so the client can refresh live data
// (current rank, bid total, verification status) for whichever channels it
// already knows about — it never reveals manage_token or any other secret.
export async function GET(req: NextRequest) {
  const idsParam = req.nextUrl.searchParams.get('ids');
  if (!idsParam) return NextResponse.json({ channels: [] });

  const ids = idsParam.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 50);
  if (ids.length === 0) return NextResponse.json({ channels: [] });

  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT c.id, c.name, c.slug, c.handle, c.avatar_url as avatarUrl, c.verification_status as verificationStatus,
              c.category_slug as categorySlug, c.country_code as countryCode,
              l.total_bid_cents as totalBidCents, l.current_rank as currentRank
       FROM channels c LEFT JOIN listings l ON l.channel_id = c.id
       WHERE c.id IN (${placeholders})`
    )
    .all(...ids);

  return NextResponse.json({ channels: rows });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const rawUrl = String(body.url || '');
  const premium = body.premium === true;
  try {
    const result = await submitChannel({
      rawUrl,
      category: body.category || null,
      country: body.country || null,
    });

    // "Premium" only changes what happens right after listing (skip the
    // manual verify step so the user can head straight into bidding) — the
    // listing itself is free either way, per the spec's free/paid
    // distinction. Auto-verification is only reasonable in this demo
    // because verification is itself a mock; production would still
    // require the real OAuth/token verification here too.
    if (premium) {
      mockVerifyChannel(result.channelId);
    }

    // manageToken is returned exactly once, here — the client must persist
    // it (localStorage) to retain control of this channel. It cannot be
    // recovered later since the server never displays it again.
    return NextResponse.json({ ...result, verified: premium }, { status: 201 });
  } catch (e) {
    if (e instanceof ChannelError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ error: 'Something went wrong submitting your channel.' }, { status: 500 });
  }
}
