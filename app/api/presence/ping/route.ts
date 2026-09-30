import { NextRequest, NextResponse } from 'next/server';
import { recordPing } from '@/lib/presence-service';
import { jsonError } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const sessionId = String((body as { sessionId?: unknown }).sessionId || '');
  if (!sessionId) return jsonError('sessionId is required.', 400);
  try {
    await recordPing(sessionId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[api/presence/ping]', e);
    return jsonError('Temporarily unavailable.', 503);
  }
}
