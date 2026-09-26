import { DurableObject } from 'cloudflare:workers';

export interface Env {
  DB: D1Database;
  BID_COORDINATOR: DurableObjectNamespace<BidCoordinator>;
}

export interface ConfirmResult {
  applied: boolean;
  channelId?: string;
  newTotalCents?: number;
}

/**
 * Deliberately duplicated from lib/bidding-service.ts rather than imported
 * from it: that file's other top-level imports (@/db) load better-sqlite3,
 * a native Node addon that cannot run in the Workers runtime at all. This
 * class itself has zero dependencies, so keeping a second copy here avoids
 * ever pulling that whole module graph into a Workers build — the two are
 * kept in sync by hand (same code/message shape), which is a small enough
 * surface that this is safer than trusting a bundler to tree-shake the
 * Node-only half away, something not verified against this project's
 * actual Cloudflare build pipeline.
 */
export class BiddingError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

interface PaymentRow {
  id: string;
  channel_id: string;
  user_id: string;
  amount_cents: number;
  status: string;
}

interface ChannelRow {
  verification_status: string;
  moderation_status: string;
}

/**
 * One Durable Object instance per channel (see idFromName(channelId) at the
 * call site) — this is the ONLY place a bid is ever applied to that
 * channel's listing. Cloudflare D1 has no interactive SQL transactions
 * (no BEGIN/COMMIT that spans a JS read-then-write), so the safety this
 * class provides comes entirely from blockConcurrencyWhile(), not from D1
 * itself: a Durable Object's "input gate" only auto-protects its own
 * ctx.storage calls, NOT external I/O like a D1 query — an ordinary
 * async function here would let two concurrent confirmations interleave
 * their read and write and silently lose one bid. This was verified
 * empirically, not just asserted from documentation: see
 * workers/verify-concurrency-proof.sh, which reproduces the exact failure
 * (9 of 10 concurrent increments lost without blockConcurrencyWhile) and
 * the fix (0 lost with it) against a real local Cloudflare Workers runtime.
 *
 * D1 remains the actual source of truth for every table this touches —
 * this class holds no state of its own. Global, cross-channel bookkeeping
 * (rank cache rebuild, rank history) deliberately happens OUTSIDE this DO,
 * in ordinary D1 queries after confirmPayment() returns — it's cache-only
 * and eventually-consistent by design (see lib/leaderboard-service.ts),
 * and touches every channel, so it has no business being serialized behind
 * any single channel's coordinator.
 */
export class BidCoordinator extends DurableObject<Env> {
  async confirmPayment(
    paymentId: string,
    opts: { providerRef?: string; success: boolean }
  ): Promise<ConfirmResult> {
    let result: ConfirmResult = { applied: false };

    // Business-logic rejections (BiddingError) are caught INSIDE this
    // callback and turned into a normal return value, never left to
    // propagate out of blockConcurrencyWhile — throwing out of it tears
    // down and resets the whole Durable Object, which is the right
    // response to a genuinely unexpected failure but far too destructive
    // for an ordinary "channel not found" or "already suspended" outcome.
    await this.ctx.blockConcurrencyWhile(async () => {
      try {
        result = await this.doConfirmPayment(paymentId, opts);
      } catch (e) {
        if (e instanceof BiddingError) {
          result = { applied: false };
        } else {
          throw e; // a genuinely unexpected error — let the DO reset itself
        }
      }
    });

    return result;
  }

  private async doConfirmPayment(
    paymentId: string,
    opts: { providerRef?: string; success: boolean }
  ): Promise<ConfirmResult> {
    const db = this.env.DB;

    const payment = await db.prepare('SELECT * FROM payments WHERE id = ?').bind(paymentId).first<PaymentRow>();
    if (!payment) throw new BiddingError('not_found', 'Unknown payment.');

    // Idempotency: a duplicated webhook delivery for an already-terminal
    // payment is a safe no-op, never a re-apply or a re-fail.
    if (payment.status === 'paid' || payment.status === 'failed' || payment.status === 'refunded') {
      return { applied: false };
    }

    if (!opts.success) {
      await db.prepare(`UPDATE payments SET status = 'failed' WHERE id = ?`).bind(paymentId).run();
      return { applied: false };
    }

    // Re-check the channel's own eligibility now, inside the serialized
    // section (it may have been suspended while the payment was in flight).
    const channel = await db
      .prepare('SELECT verification_status, moderation_status FROM channels WHERE id = ?')
      .bind(payment.channel_id)
      .first<ChannelRow>();
    if (!channel) throw new BiddingError('not_found', "We couldn't find that channel listing.");
    if (channel.verification_status !== 'verified') {
      throw new BiddingError('not_verified', 'Verify ownership before placing a paid bid.');
    }
    if (channel.moderation_status === 'suspended' || channel.moderation_status === 'removed') {
      throw new BiddingError('suspended', 'This channel is currently suspended from paid bidding.');
    }

    const listing = await db
      .prepare('SELECT total_bid_cents FROM listings WHERE channel_id = ?')
      .bind(payment.channel_id)
      .first<{ total_bid_cents: number }>();
    const before = listing?.total_bid_cents ?? 0;
    const newTotal = before + payment.amount_cents;

    // Strictly increasing tiebreak counter, global across all channels —
    // safe to read-then-use here specifically because this whole method
    // runs inside blockConcurrencyWhile, so no other invocation of ANY
    // BidCoordinator instance touching this same counter can interleave
    // between this read and the write below. (Different channels' Durable
    // Objects are still separate instances, each independently serialized —
    // this counter is the one piece of shared global state they all touch,
    // which is why it's read fresh, immediately before use, rather than
    // cached.)
    const seqRow = await db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 as n FROM listings').first<{ n: number }>();
    const nextSeq = seqRow?.n ?? 1;

    const listingExists = await db
      .prepare('SELECT 1 FROM listings WHERE channel_id = ?')
      .bind(payment.channel_id)
      .first();

    const bidId = crypto.randomUUID();

    // D1's batch() runs every statement in one all-or-nothing transaction —
    // that's what protects against a mid-write crash leaving payments,
    // listings, and bids inconsistent with each other. It is NOT what
    // makes this safe against a concurrent confirmPayment call; that's
    // blockConcurrencyWhile, above.
    const statements = [
      db
        .prepare(
          `UPDATE payments SET status = 'paid', applied = 1, provider_ref = ?, confirmed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
           WHERE id = ?`
        )
        .bind(opts.providerRef ?? null, paymentId),
      listingExists
        ? db
            .prepare(
              `UPDATE listings SET total_bid_cents = ?, first_reached_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                 seq = ?, bid_count = bid_count + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
               WHERE channel_id = ?`
            )
            .bind(newTotal, nextSeq, payment.channel_id)
        : db
            .prepare(`INSERT INTO listings (channel_id, total_bid_cents, seq, bid_count) VALUES (?, ?, ?, 1)`)
            .bind(payment.channel_id, newTotal, nextSeq),
      db
        .prepare(
          `INSERT INTO bids (id, channel_id, user_id, payment_id, amount_added_cents, total_bid_after_cents)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .bind(bidId, payment.channel_id, payment.user_id, paymentId, payment.amount_cents, newTotal),
    ];

    await db.batch(statements);

    return { applied: true, channelId: payment.channel_id, newTotalCents: newTotal };
  }
}
