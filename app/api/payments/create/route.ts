import { NextRequest, NextResponse } from 'next/server';
import {
  BiddingError,
  createPayment,
  markPaymentFailedToStart,
  markPaymentPending,
  quoteAdditionalForTarget,
} from '@/lib/bidding-service';
import { requiredTotalForRank } from '@/lib/leaderboard-service';
import { createCheckoutSession, DodoError, isDodoConfigured } from '@/lib/dodo';
import { siteUrlFromRequest } from '@/lib/site';
import { clampInt, isPlausibleId, jsonError, NO_STORE } from '@/lib/http';

export const dynamic = 'force-dynamic';

// Hard ceiling for a single charge ($10,000). Keep the "maximum amount" of
// your Dodo Pay-What-You-Want product at or above this value.
const MAX_PAYMENT_CENTS = 1_000_000;

// Starts a paid bid.
//   1. Recompute the price from scratch on the server (the client-supplied
//      rank is only a *target*; the amount is never taken from the browser).
//   2. Record a payment row, create a hosted Dodo checkout session for that
//      exact amount, and hand the checkout URL back to the browser.
//   3. The bid is applied ONLY by the verified webhook (or by the return
//      page after re-checking the session with Dodo) — never here.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { channelId?: unknown; desiredRank?: unknown };
  if (!isPlausibleId(body.channelId)) return jsonError('channelId is required.', 400);
  const channelId = body.channelId;
  const desiredRank = clampInt(body.desiredRank, 1, 1000, 1);

  const dev = process.env.NODE_ENV === 'development';
  if (!isDodoConfigured() && !dev) {
    console.error('[payments/create] Dodo Payments is not configured (DODO_PAYMENTS_API_KEY / DODO_PRODUCT_ID).');
    return jsonError('Payments are temporarily unavailable. Please try again later.', 503, 'not_configured');
  }

  try {
    const target = await requiredTotalForRank(desiredRank);
    const quote = await quoteAdditionalForTarget(channelId, target);
    if (quote.requiredAdditionalCents > MAX_PAYMENT_CENTS) {
      return jsonError('That amount is above the maximum for a single payment.', 400, 'above_maximum');
    }

    const { paymentId, amountCents } = await createPayment({
      channelId,
      amountCents: quote.requiredAdditionalCents,
      quotedTotalCents: quote.newTotalCents,
      quotedRank: desiredRank,
      provider: isDodoConfigured() ? 'dodo' : 'dev-simulator',
    });

    // Local development without Dodo credentials: a simulator route (which
    // 404s outside `next dev`) completes the payment so the whole flow can
    // still be exercised end-to-end.
    if (!isDodoConfigured()) {
      await markPaymentPending(paymentId);
      return NextResponse.json(
        { paymentId, amountCents, checkoutUrl: `/api/dev/complete-payment?paymentId=${paymentId}` },
        { headers: NO_STORE }
      );
    }

    const base = siteUrlFromRequest(req);
    try {
      const session = await createCheckoutSession({
        amountCents,
        paymentId,
        channelId,
        returnUrl: `${base}/payment/return?pid=${encodeURIComponent(paymentId)}`,
        cancelUrl: `${base}/payment/return?pid=${encodeURIComponent(paymentId)}&cancelled=1`,
      });
      await markPaymentPending(paymentId, session.sessionId);
      return NextResponse.json({ paymentId, amountCents, checkoutUrl: session.checkoutUrl }, { headers: NO_STORE });
    } catch (e) {
      await markPaymentFailedToStart(paymentId, e instanceof Error ? e.message : 'checkout failed');
      if (e instanceof DodoError) {
        return jsonError('We could not start checkout. You have not been charged. Please try again.', 502, 'provider_error');
      }
      throw e;
    }
  } catch (e) {
    if (e instanceof BiddingError) {
      const status = e.code === 'not_found' ? 404 : 400;
      return jsonError(e.message, status, e.code);
    }
    console.error('[payments/create]', e);
    return jsonError('Something went wrong starting your payment. You have not been charged.', 500);
  }
}
