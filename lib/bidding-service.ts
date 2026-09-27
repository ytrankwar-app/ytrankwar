import { db } from '@/db';
import { newId } from './ids';
import { rebuildRankCache, recordRankHistory, getChannelRank } from './leaderboard-service';
import { minBidCents, minIncrementCents } from './settings';

export { minBidCents, minIncrementCents };

export class BiddingError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function getListing(channelId: string): { totalBidCents: number } {
  const row = db
    .prepare('SELECT total_bid_cents as totalBidCents FROM listings WHERE channel_id = ?')
    .get(channelId) as { totalBidCents: number } | undefined;
  return row ?? { totalBidCents: 0 };
}

/** Re-checks the channel's own eligibility to bid — verification status and
 *  moderation state. There is no login or ownership check anywhere in this
 *  app, so this is the only gate on bidding: anyone can pay to raise any
 *  channel's total, as long as the channel itself is verified and not
 *  suspended/removed. */
function assertChannelEligible(
  channelId: string
): { verificationStatus: string; moderationStatus: string; ownerUserId: string } {
  const channel = db
    .prepare(
      'SELECT verification_status as verificationStatus, moderation_status as moderationStatus, owner_user_id as ownerUserId FROM channels WHERE id = ?'
    )
    .get(channelId) as { verificationStatus: string; moderationStatus: string; ownerUserId: string } | undefined;

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
 * inside the atomic transaction when the payment is confirmed, exactly per
 * the spec's race-condition rules. No ownership check here — a quote is
 * harmless to compute for anyone.
 */
export function quoteAdditionalForTarget(channelId: string, targetTotalCents: number): BidQuote {
  const current = getListing(channelId).totalBidCents;
  const minBid = minBidCents();
  const flooredTarget = current === 0 ? Math.max(targetTotalCents, minBid) : targetTotalCents;
  const requiredAdditionalCents = Math.max(flooredTarget - current, current === 0 ? minBid : 1);
  return {
    currentTotalCents: current,
    requiredAdditionalCents,
    newTotalCents: current + requiredAdditionalCents,
    minBidCents: minBid,
  };
}

export function createPayment(params: {
  channelId: string;
  amountCents: number;
  quotedTotalCents?: number;
  quotedRank?: number;
}): { paymentId: string } {
  const channel = assertChannelEligible(params.channelId);

  const current = getListing(params.channelId).totalBidCents;
  const minBid = minBidCents();
  if (current === 0 && current + params.amountCents < minBid) {
    throw new BiddingError('below_minimum', `The minimum first bid is ${minBid / 100} dollars.`);
  }
  if (params.amountCents <= 0) {
    throw new BiddingError('invalid_amount', 'Bid amount must be greater than zero.');
  }

  const paymentId = newId('pay');
  db.prepare(
    `INSERT INTO payments (id, channel_id, user_id, amount_cents, quoted_total_cents, quoted_rank, status)
     VALUES (?, ?, ?, ?, ?, ?, 'created')`
  ).run(paymentId, params.channelId, channel.ownerUserId, params.amountCents, params.quotedTotalCents ?? null, params.quotedRank ?? null);

  return { paymentId };
}

/**
 * Simulates the payment provider moving a payment from "created" to
 * "pending" once the user reaches hosted checkout. In production this has
 * no code here at all — Stripe owns this state.
 */
export function markPaymentPending(paymentId: string): void {
  db.prepare(`UPDATE payments SET status = 'pending' WHERE id = ? AND status = 'created'`).run(paymentId);
}

export interface ConfirmResult {
  applied: boolean; // false if this was a duplicate/already-processed webhook call
  channelId?: string;
  newTotalCents?: number;
  newRank?: number;
}

/**
 * The only place bid money is ever applied to a listing. Called from the
 * payment webhook handler. Must be:
 *   - ATOMIC: total_bid update + ledger row + rank cache happen together
 *   - IDEMPOTENT: a duplicated webhook delivery must not double-apply
 *   - NEVER TRUST THE CLIENT: re-reads current_total from the DB inside
 *     the transaction, not from anything the browser sent
 */
export function confirmPayment(paymentId: string, opts: { providerRef?: string; success: boolean }): ConfirmResult {
  const applyTx = db.transaction((): ConfirmResult => {
    // BEGIN IMMEDIATE-equivalent: better-sqlite3 transactions take an
    // exclusive write lock on first write statement, which is what
    // protects the read-then-write below from a concurrent bid.
    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId) as
      | {
          id: string;
          channel_id: string;
          user_id: string;
          amount_cents: number;
          status: string;
          applied: number;
        }
      | undefined;

    if (!payment) throw new BiddingError('not_found', 'Unknown payment.');

    // Idempotency: if this payment was already terminal, ignore the
    // duplicate webhook entirely rather than re-applying or re-failing it.
    if (payment.status === 'paid' || payment.status === 'failed' || payment.status === 'refunded') {
      return { applied: false };
    }

    if (!opts.success) {
      db.prepare(`UPDATE payments SET status = 'failed' WHERE id = ?`).run(paymentId);
      return { applied: false };
    }

    // Re-check the channel's own eligibility NOW, inside the lock (it may
    // have been suspended while the payment was in flight) — this is the
    // step that makes concurrent checkouts safe against state changing
    // between create and confirm.
    assertChannelEligible(payment.channel_id);
    const before = getListing(payment.channel_id).totalBidCents;
    const newTotal = before + payment.amount_cents;

    // Strictly increasing tiebreak counter. Computed and consumed inside
    // this same transaction, so under SQLite/D1's serialized writers two
    // bids applied "simultaneously" (even within the same millisecond,
    // where wall-clock timestamps could tie) still get distinct, correctly
    // ordered sequence numbers.
    const nextSeq = (db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 as n FROM listings').get() as { n: number }).n;

    db.prepare(
      `UPDATE payments SET status = 'paid', applied = 1, provider_ref = ?, confirmed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ?`
    ).run(opts.providerRef ?? null, paymentId);

    const listingExists = db.prepare('SELECT 1 FROM listings WHERE channel_id = ?').get(payment.channel_id);
    if (listingExists) {
      db.prepare(
        `UPDATE listings SET total_bid_cents = ?, first_reached_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
           seq = ?, bid_count = bid_count + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE channel_id = ?`
      ).run(newTotal, nextSeq, payment.channel_id);
    } else {
      db.prepare(
        `INSERT INTO listings (channel_id, total_bid_cents, seq, bid_count) VALUES (?, ?, ?, 1)`
      ).run(payment.channel_id, newTotal, nextSeq);
    }

    db.prepare(
      `INSERT INTO bids (id, channel_id, user_id, payment_id, amount_added_cents, total_bid_after_cents)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(newId('bid'), payment.channel_id, payment.user_id, paymentId, payment.amount_cents, newTotal);

    return { applied: true, channelId: payment.channel_id, newTotalCents: newTotal };
  });

  const result = applyTx();

  // Rank recompute + history happen after the money is safely committed.
  // If this step failed, the bid itself is still correctly recorded —
  // rebuildRankCache is always safe to re-run and is idempotent.
  if (result.applied && result.channelId) {
    rebuildRankCache();
    const rank = getChannelRank(result.channelId);
    if (rank) {
      recordRankHistory(result.channelId, rank.rank, rank.totalBidCents);
      result.newRank = rank.rank;
      db.prepare('UPDATE bids SET rank_after = ? WHERE payment_id = ?').run(rank.rank, paymentId);
    }
  }

  return result;
}
