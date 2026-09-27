import { NextResponse } from 'next/server';
import { db } from '@/db';

// Fire-and-forget from the frontend when a "Visit" button is clicked.
// Privacy-friendly: an aggregated counter only, no per-click identity or
// timestamp log, per the spec's analytics privacy requirement.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  db.prepare(
    `INSERT INTO youtube_clicks (channel_id, count) VALUES (?, 1)
     ON CONFLICT(channel_id) DO UPDATE SET count = count + 1`
  ).run(params.id);
  return NextResponse.json({ ok: true });
}
