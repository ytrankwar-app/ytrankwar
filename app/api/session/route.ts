import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, loginOrCreateDemoUser, logout } from '@/lib/auth';

export async function GET() {
  return NextResponse.json({ user: getCurrentUser() });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  if (!name || !email || !email.includes('@')) {
    return NextResponse.json({ error: 'Please enter a name and valid email.' }, { status: 400 });
  }
  const user = loginOrCreateDemoUser(name, email);
  return NextResponse.json({ user });
}

export async function DELETE() {
  logout();
  return NextResponse.json({ ok: true });
}
