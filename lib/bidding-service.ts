import { getDb, NOW_SQL } from '@/db';
import { newId } from './ids';
import { rebuildRankCache, recordRankHistory, getChannelRank } from './leaderboard-service';
import { minBidCents, minIncrementCents, minPaymentCents } from './settings';

export { minBidCents, minIncrementCents, minPaymentCents };

export class BiddingError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

async function getListing(channelId: string): Promise<{ totalBidCents: number }> {
  const db = await getDb();
  const row = await db.first<{ totalBidCents: number }>(
    'SELECT total_bid_cents as totalBidCents FROM listings WHERE channel_id = ?',
    [channelId]
  );
  return row ?? { totalBidCents: 0 };
}

/** Re-checks the channel's own eligibility to bid — verification status and
 *  moderation state. There is no login or ownership check anywhere in this
 *  app, so this is the only gate on bidding: anyone can pay to raise any
 *  channel's total, as long as the channel itself is verified and not
 *  suspended/removed. */
async function assertChannelEligible(
  channelId: string
): Promise<{ verificationStatus: string; moderationStatus: string; ownerUserId: string }> {
  const db = await getDb();
  const channel = await db.first<{ verificationStatus: string; moderationStatus: string; ownerUserId: string }>(
    'SELECT verification_status as verificationStatus, moderation_status as moderationStatus, owner_user_id as ownerUserId FROM channels WHERE id = ?',
    [channelId]
  );

  if (!channel) throw new BiddingError('not_found', "We couldn't find that channel listing.");
  if (channel.verificationStatus !== 'verified') {
    throw new BiddingError('not_verified', 'Verify ownership before placing a paid bid.');
  }
  if (channel.moderationStatus === 'suspended' || channel.moderationStatus === 'removed') {
    throw new BiddingError('suspended', 'This channel is currently suspended from paid bidding.');
  }
  return channel;
}

export interface BidQuote {
  currentTotalCents: number;
  requiredAdditionalCents: number;
  newTotalCents: number;
  minBidCents: number;
}

/**
 * Advisory quote for "claim additional amount to reach X". Purely informational
 * — the number shown to the user before checkout. It is recomputed from
 * scratch (never trusted) immediately before creating the payment, and again
 * inside the atomic batch when the payment is confirmed, exactly per the
 * spec's race-condition rules. No ownership check here — a quote is harmless
 * to compute for anyone.
 */
export async function quoteAdditionalForTarget(channelId: string, targetTotalCents: number): Promise<BidQuote> {
  const [listing, minBid, minPayment] = await Promise.all([getListing(channelId), minBidCents(), minPaymentCents()]);
  const current = listing.totalBidCents;
  const flooredTarget = current === 0 ? Math.max(targetTotalCents, minBid) : targetTotalCents;
  // Never quote less than the smallest charge we can actually create, so the
  // number shown to the user is exactly what they will be charged.
  const requiredAdditionalCents = Math.max(flooredTarget - current, current === 0 ? minBid : minPayment);
  return {
    currentTotalCents: current,
    requiredAdditionalCents,
    newTotalCents: current + requiredAdditionalCents,
    minBidCents: minBid,
  };
}

export async function createPayment(params: {
  channelId: string;
  amountCents: number;
  quotedTotalCents?: number;
  quotedRank?: number;
  provider?: string;
}): Promise<{ paymentId: string; amountCents: number }> {
  const channel = await assertChannelEligible(params.channelId);

  if (!Number.isInteger(params.amountCents) || params.amountCents <= 0) {
    throw new BiddingError('invalid_amount', 'Bid amount must be greater than zero.');
  }

  const [current, minBid, minPayment] = await Promise.all([
    getListing(params.channelId).then((l) => l.totalBidCents),
    minBidCents(),
    minPaymentCents(),
  ]);
  if (current === 0 && current + params.amountCents < minBid) {
    throw new BiddingError('below_minimum', `The minimum first bid is ${minBid / 100} dollars.`);
  }
  const amountCents = Math.max(params.amountCents, minPayment);

  const db = await getDb();
  const paymentId = newId('pay');
  await db.run(
    `INSERT INTO payments (id, channel_id, user_id, amount_cents, quoted_total_cents, quoted_rank, provider, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'created')`,
    [
      paymentId,
      params.channelId,
      channel.ownerUserId,
      amountCents,
      params.quotedTotalCents ?? null,
      params.quotedRank ?? null,
      params.provider ?? 'dodo',
    ]
  );

  return { paymentId, amountCents };
}

/** Records the hosted-checkout session for a payment and moves it from
 *  "created" to "pending" (the customer is now being sent to pay). */
export async function markPaymentPending(paymentId: string, providerSessionId?: string): Promise<void> {
  const db = await getDb();
  await db.run(
    `UPDATE payments SET status = 'pending', provider_session_id = COALESCE(?, provider_session_id)
     WHERE id = ? AND status = 'created'`,
    [providerSessionId ?? null, paymentId]
  );
}

/** The provider could not start a checkout: nothing was charged, so close the
 *  payment out instead of leaving it dangling as "created". */
export async function markPaymentFailedToStart(paymentId: string, reason: string): Promise<void> {
  const db = await getDb();
  await db.run(`UPDATE payments SET status = 'failed', note = ? WHERE id = ? AND status IN ('created','pending')`, [
    reason.slice(0, 500),
    paymentId,
  ]);
}

/** A single card attempt failed but the customer can retry inside the same
 *  hosted checkout session, so this must NOT terminally fail the payment —
 *  a later successful attempt still has to be applied. Just leave a note. */
export async function noteFailedAttempt(paymentId: string, reason?: string): Promise<void> {
  const db = await getDb();
  await db.run(`UPDATE payments SET note = ? WHERE id = ? AND status IN ('created','pending')`, [
    `last attempt failed${reason ? `: ${reason}` : ''}`.slice(0, 500),
    paymentId,
  ]);
}

export async function getPayment(paymentId: string) {
  const db = await getDb();
  return db.first<{
    id: string;
    channelId: string;
    amountCents: number;
    status: string;
    applied: number;
    providerRef: string | null;
    providerSessionId: string | null;
    note: string | null;
    slug: string | null;
  }>(
    `SELECT p.id, p.channel_id as channelId, p.amount_cents as amountCents, p.status, p.applied,
            p.provider_ref as providerRef, p.provider_session_id as providerSessionId, p.note, c.slug
     FROM payments p LEFT JOIN channels c ON c.id = p.channel_id
     WHERE p.id = ?`,
    [paymentId]
  );
}

export async function findPaymentIdBySession(sessionId: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.first<{ id: string }>('SELECT id FROM payments WHERE provider_session_id = ?', [sessionId]);
  return row?.id ?? null;
}

/** Flags a payment that the provider reversed after the fact (refund /
 *  chargeback). The bid is deliberately NOT auto-reversed: that is a policy
 *  decision that needs a human. The status change makes it visible. */
export async function markPaymentReversed(
  providerRef: string,
  status: 'refunded' | 'disputed',
  note: string
): Promise<boolean> {
  const db = await getDb();
  const res = await db.run(`UPDATE payments SET status = ?, note = ? WHERE provider_ref = ? AND status = 'paid'`, [
    status,
    note.slice(0, 500),
    providerRef,
  ]);
  return res.changes > 0;
}

export interface ConfirmResult {
  applied: boolean; // false if this was a duplicate/already-processed call
  channelId?: string;
  newTotalCents?: number;
  newRank?: number;
}

const TERMINAL_STATUSES = ['paid', 'failed', 'refunded', 'cancelled', 'disputed'];

/**
 * The only place bid money is ever applied to a listing. Called from the
 * payment webhook handler (and the return-page reconciliation). Must be:
 *   - ATOMIC: ledger row + listing total + payment status change together
 *   - IDEMPOTENT: a duplicated webhook delivery must not double-apply
 *   - NEVER TRUST THE CLIENT: totals are computed from the database, inside
 *     the write, not from anything the browser sent
 *
 * Cloudflare D1 has no interactive transactions, so instead of
 * "read the total in JS, then write it" (which two concurrent confirmations
 * could interleave), everything is expressed as ONE batch of conditional SQL
 * statements. D1 runs a batch as a single all-or-nothing unit and serializes
 * writers, and every statement below is gated on the payment still being
 * 'created'/'pending' — so the first confirmation applies the bid and every
 * duplicate or concurrent one finds the payment already 'paid' and changes
 * nothing. `bids.payment_id` is also UNIQUE (migration 0002) as a final
 * backstop.
 */
export async function confirmPayment(
  paymentId: string,
  opts: { providerRef?: string; success: boolean }
): Promise<ConfirmResult> {
  const db = await getDb();

  const payment = await db.first<{ id: string; channel_id: string; status: string }>(
    'SELECT id, channel_id, status FROM payments WHERE id = ?',
    [paymentId]
  );
  if (!payment) throw new BiddingError('not_found', 'Unknown payment.');

  // Idempotency: already-terminal payments are ignored entirely.
  if (TERMINAL_STATUSES.includes(payment.status)) return { applied: false };

  if (!opts.success) {
    await db.run(
      `UPDATE payments SET status = 'failed', provider_ref = COALESCE(?, provider_ref) WHERE id = ? AND status IN ('created','pending')`,
      [opts.providerRef ?? null, paymentId]
    );
    return { applied: false };
  }

  const pending = `(SELECT status FROM payments WHERE id = ?) IN ('created','pending')`;

  const results = await db.batch([
    // 0. Make sure a listing row exists for the channel.
    {
      sql: `INSERT OR IGNORE INTO listings (channel_id, total_bid_cents)
            SELECT channel_id, 0 FROM payments WHERE id = ?`,
      params: [paymentId],
    },
    // 1. The immutable ledger row. Only inserted when the payment is still
    //    unapplied AND the channel is (still) eligible — eligibility is
    //    re-checked here, inside the write, because the channel may have
    //    been suspended while the customer was at checkout.
    {
      sql: `INSERT INTO bids (id, channel_id, user_id, payment_id, amount_added_cents, total_bid_after_cents)
            SELECT ?, p.channel_id, p.user_id, p.id, p.amount_cents, l.total_bid_cents + p.amount_cents
            FROM payments p
            JOIN channels c ON c.id = p.channel_id
            JOIN listings l ON l.channel_id = p.channel_id
            WHERE p.id = ?
              AND p.status IN ('created','pending')
              AND c.verification_status = 'verified'
              AND c.moderation_status NOT IN ('suspended','removed')`,
      params: [newId('bid'), paymentId],
    },
    // 2. Raise the listing total and take the next tiebreak sequence number
    //    (strictly increasing, computed inside the write so two bids applied
    //    in the same millisecond still get distinct, correctly ordered seqs).
    {
      sql: `UPDATE listings SET
              total_bid_cents = total_bid_cents + (SELECT amount_cents FROM payments WHERE id = ?),
              first_reached_at = ${NOW_SQL},
              seq = (SELECT COALESCE(MAX(seq), 0) + 1 FROM listings),
              bid_count = bid_count + 1,
              updated_at = ${NOW_SQL}
            WHERE channel_id = (SELECT channel_id FROM payments WHERE id = ?)
              AND ${pending}
              AND EXISTS (SELECT 1 FROM bids WHERE payment_id = ?)`,
      params: [paymentId, paymentId, paymentId, paymentId],
    },
    // 3. Close the payment out. If the ledger row was not written (channel
    //    became ineligible) the money was still taken by the provider, so
    //    record that loudly for a manual refund instead of pretending it
    //    was applied.
    {
      sql: `UPDATE payments SET
              status = 'paid',
              applied = CASE WHEN EXISTS (SELECT 1 FROM bids WHERE payment_id = payments.id) THEN 1 ELSE 0 END,
              provider_ref = COALESCE(?, provider_ref),
              confirmed_at = ${NOW_SQL},
              note = CASE WHEN EXISTS (SELECT 1 FROM bids WHERE payment_id = payments.id) THEN note
                          ELSE 'NEEDS REFUND: paid, but the channel was not eligible when the payment was confirmed' END
            WHERE id = ? AND status IN ('created','pending')`,
      params: [opts.providerRef ?? null, paymentId],
    },
  ]);

  const transitioned = results[3].changes === 1;
  if (!transitioned) return { applied: false }; // a concurrent/duplicate confirmation got there first

  const after = await db.first<{ applied: number; channelId: string; total: number | null }>(
    `SELECT p.applied as applied, p.channel_id as channelId, l.total_bid_cents as total
     FROM payments p LEFT JOIN listings l ON l.channel_id = p.channel_id WHERE p.id = ?`,
    [paymentId]
  );
  if (!after || after.applied !== 1) {
    console.error(`[payments] ${paymentId} was paid but NOT applied (channel ineligible) — needs a manual refund.`);
    return { applied: false };
  }

  const result: ConfirmResult = { applied: true, channelId: after.channelId, newTotalCents: after.total ?? 0 };

  // Rank recompute + history happen after the money is safely committed. If
  // this step failed, the bid itself is still correctly recorded —
  // rebuildRankCache is always safe to re-run and is idempotent.
  try {
    await rebuildRankCache();
    const rank = await getChannelRank(after.channelId);
    if (rank) {
      await recordRankHistory(after.channelId, rank.rank, rank.totalBidCents);
      result.newRank = rank.rank;
      await db.run('UPDATE bids SET rank_after = ? WHERE payment_id = ?', [rank.rank, paymentId]);
    }
  } catch (e) {
    console.error('[payments] bid applied but rank bookkeeping failed (safe to re-run):', e);
  }

  return result;
}
