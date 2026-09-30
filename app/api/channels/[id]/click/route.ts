import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { isPlausibleId, jsonError } from '@/lib/http';

export const dynamic = 'force-dynamic';

// Fire-and-forget from the frontend when a "Visit" button is clicked.
// Privacy-friendly: an aggregated counter only, no per-click identity or
// timestamp log, per the spec's analytics privacy requirement.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  if (!isPlausibleId(params.id)) return jsonError('Not found', 404);
  try {
    const db = await getDb();
    // Only count clicks for channels that actually exist (the counter table
    // has a foreign key to channels).
    await db.run(
      `INSERT INTO youtube_clicks (channel_id, count)
       SELECT id, 1 FROM channels WHERE id = ?
       ON CONFLICT(channel_id) DO UPDATE SET count = count + 1`,
      [params.id]
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[api/channels/:id/click]', e);
    return jsonError('Temporarily unavailable.', 503);
  }
}
