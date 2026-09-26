import { cookies } from 'next/headers';
import { db } from '@/db';
import { newId } from './ids';

// DEMO AUTH ONLY. Production must replace this with real authentication
// (e.g. NextAuth / Google OAuth — which doubles as YouTube ownership Method
// A). The rest of the app only depends on `getCurrentUser()` returning a
// user id, so swapping the implementation here is sufficient.
const COOKIE = 'demo_session_user_id';

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
}

export function getCurrentUser(): CurrentUser | null {
  const userId = cookies().get(COOKIE)?.value;
  if (!userId) return null;
  const row = db.prepare('SELECT id, name, email, is_admin as isAdmin FROM users WHERE id = ?').get(userId) as
    | { id: string; name: string; email: string; isAdmin: number }
    | undefined;
  if (!row) return null;
  return { ...row, isAdmin: !!row.isAdmin };
}

export function loginOrCreateDemoUser(name: string, email: string): CurrentUser {
  let user = db.prepare('SELECT id, name, email, is_admin as isAdmin FROM users WHERE email = ?').get(email) as
    | { id: string; name: string; email: string; isAdmin: number }
    | undefined;

  if (!user) {
    const id = newId('usr');
    db.prepare('INSERT INTO users (id, name, email) VALUES (?, ?, ?)').run(id, name, email);
    user = { id, name, email, isAdmin: 0 };
  }

  cookies().set(COOKIE, user.id, { httpOnly: true, sameSite: 'lax', path: '/' });
  return { ...user, isAdmin: !!user.isAdmin };
}

export function logout(): void {
  cookies().delete(COOKIE);
}
