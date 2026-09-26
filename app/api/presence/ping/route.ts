import { NextRequest, NextResponse } from 'next/server';
import { recordPing } from '@/lib/presence-service';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const sessionId = String(body.sessionId || '');
  if (!sessionId) return NextResponse.json({ error: 'sessionId is required.' }, { status: 400 });
  recordPing(sessionId);
  return NextResponse.json({ ok: true });
}
