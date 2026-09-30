import { NextResponse } from 'next/server';

export function jsonError(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, ...(code ? { code } : {}) }, { status });
}

/** Ids are our own nanoid-style strings; reject anything else early. */
export function isPlausibleId(id: unknown, max = 64): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= max && /^[A-Za-z0-9_-]+$/.test(id);
}

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export const NO_STORE = { 'Cache-Control': 'no-store' } as const;
