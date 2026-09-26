import { NextRequest, NextResponse } from 'next/server';
import { createPayment, quoteAdditionalForTarget, BiddingError, markPaymentPending } from '@/lib/bidding-service';
import { requiredTotalForRank } from '@/lib/leaderboard-service';

/**
 * Mirrors the spec's checkout sequence:
 *   1. fetch latest leaderboard / required bid (fresh, not from client)
 *   2. lock in the additional amount the user is committing to pay
 *   3. create a payment session (here: a local `payments` row; in
 *      production this step also creates the Stripe Checkout Session and
 *      returns its redirect URL)
 * The actual bid is NOT applied here — only `confirmPayment` (called from
 * the webhook) ever touches `listings`/`bids`. Authorized by manage_token
 * (no login) — see lib/manage-auth.ts.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { channelId, desiredRank, manageToken } = body as { channelId: string; desiredRank?: number; manageToken?: string };
  if (!channelId) return NextResponse.json({ error: 'channelId is required.' }, { status: 400 });

  const target = requiredTotalForRank(Number(desiredRank ?? 1));
  const quote = quoteAdditionalForTarget(channelId, target);

  try {
    const { paymentId } = createPayment({
      channelId,
      manageToken,
      amountCents: quote.requiredAdditionalCents,
      quotedTotalCents: quote.newTotalCents,
      quotedRank: Number(desiredRank ?? 1),
    });
    markPaymentPending(paymentId);

    return NextResponse.json({
      paymentId,
      amountCents: quote.requiredAdditionalCents,
      newTotalCents: quote.newTotalCents,
      // In production this becomes the Stripe Checkout Session URL.
      mockCheckoutUrl: `/api/payments/webhook?paymentId=${paymentId}`,
    });
  } catch (e) {
    if (e instanceof BiddingError) {
      const status = e.code === 'not_verified' || e.code === 'not_owner' ? 403 : 400;
      return NextResponse.json({ error: e.message, code: e.code }, { status });
    }
    console.error(e);
    return NextResponse.json({ error: "We couldn't complete your payment. No bid was created." }, { status: 500 });
  }
}
