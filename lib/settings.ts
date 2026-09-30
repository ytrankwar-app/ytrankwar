import { getDb } from '@/db';

async function getSetting(key: string, fallback: number): Promise<number> {
  const db = await getDb();
  const row = await db.first<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
  const n = row ? Number(row.value) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export function minBidCents(): Promise<number> {
  return getSetting('min_bid_cents', 2500);
}

/** The minimum a challenger must add beyond a target position's current
 *  total to take it over — the spec's "minimum_new_total = current_position_bid
 *  + minimum_increment" rule. Configurable via the `settings` table;
 *  defaults to $1 (100 cents). */
export function minIncrementCents(): Promise<number> {
  return getSetting('min_increment_cents', 100);
}

/** The smallest single charge we create. Payment processors reject tiny
 *  charges, so a top-up smaller than this is rounded up to it. */
export function minPaymentCents(): Promise<number> {
  return getSetting('min_payment_cents', 100);
}
