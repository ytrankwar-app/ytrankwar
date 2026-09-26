import { db } from '@/db';

function getSetting(key: string, fallback: number): number {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? Number(row.value) : fallback;
}

export function minBidCents(): number {
  return getSetting('min_bid_cents', 2500);
}

/** The minimum a challenger must add beyond a target position's current
 *  total to take it over — the spec's "minimum_new_total = current_position_bid
 *  + minimum_increment" rule. Configurable via the `settings` table;
 *  defaults to $1 (100 cents). */
export function minIncrementCents(): number {
  return getSetting('min_increment_cents', 100);
}
