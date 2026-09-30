import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { submitChannel, mockVerifyChannel, ChannelError } from '@/lib/channel-service';
import { isPlausibleId, jsonError } from '@/lib/http';

export const dynamic = 'force-dynamic';

// No login in this app. "My channels" is tracked entirely client-side
// (localStorage holds {channelId, slug, name} per channel this browser
// added — see lib/local-channels.ts, purely a convenience shortlist, not a
// credential). This GET endpoint just does public, harmless bulk lookups
// by id so the client can refresh live data (current rank, bid total,
// verification status) for whichever channels it already knows about.
export async function GET(req: NextRequest) {
  const idsParam = req.nextUrl.searchParams.get('ids');
  if (!idsParam) return NextResponse.json({ channels: [] });

  const ids = idsParam
    .split(',')
    .map((s) => s.trim())
    .filter((s) => isPlausibleId(s))
    .slice(0, 50);
  if (ids.length === 0) return NextResponse.json({ channels: [] });

  try {
    const db = await getDb();
    const placeholders = ids.map(() => '?').join(',');
    const rows = await db.all(
      `SELECT c.id, c.name, c.slug, c.handle, c.avatar_url as avatarUrl, c.verification_status as verificationStatus,
              c.category_slug as categorySlug, c.country_code as countryCode,
              l.total_bid_cents as totalBidCents, l.current_rank as currentRank
       FROM channels c LEFT JOIN listings l ON l.channel_id = c.id
       WHERE c.id IN (${placeholders})`,
      ids
    );
    return NextResponse.json({ channels: rows });
  } catch (e) {
    console.error('[api/channels GET]', e);
    return jsonError('Channels are temporarily unavailable.', 503);
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    url?: unknown;
    premium?: unknown;
    category?: unknown;
    country?: unknown;
  };
  const rawUrl = String(body.url || '').slice(0, 300);
  const premium = body.premium === true;
  try {
    const result = await submitChannel({
      rawUrl,
      category: typeof body.category === 'string' ? body.category.slice(0, 40) : null,
      country: typeof body.country === 'string' ? body.country.slice(0, 2).toUpperCase() : null,
    });

    // "Premium" only changes what happens right after listing (skip the
    // manual verify step so the user can head straight into bidding) — the
    // listing itself is free either way, per the spec's free/paid
    // distinction. Auto-verification is only reasonable in this demo
    // because verification is itself a mock; production would still
    // require the real OAuth/token verification here too.
    if (premium) {
      await mockVerifyChannel(result.channelId);
    }

    return NextResponse.json({ ...result, verified: premium }, { status: 201 });
  } catch (e) {
    if (e instanceof ChannelError) {
      const status = e.code === 'duplicate' ? 409 : 400;
      return NextResponse.json({ error: e.message, code: e.code }, { status });
    }
    console.error('[api/channels POST]', e);
    return jsonError('Something went wrong submitting your channel.', 500);
  }
}
