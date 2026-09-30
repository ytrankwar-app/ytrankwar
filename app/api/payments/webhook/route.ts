import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhook } from '@/lib/dodo';
import {
  confirmPayment,
  findPaymentIdBySession,
  getPayment,
  markPaymentReversed,
  noteFailedAttempt,
} from '@/lib/bidding-service';

export const dynamic = 'force-dynamic';

interface DodoEvent {
  type?: string;
  data?: {
    payment_id?: string;
    checkout_session_id?: string | null;
    metadata?: Record<string, string> | null;
    error_message?: string | null;
  };
}

// Dodo Payments webhook. This is the ONLY authoritative way a bid is applied:
//   - the signature is verified against the raw body (Standard Webhooks)
//   - the payment row is looked up from OUR OWN id, which we put in the
//     checkout metadata server-side
//   - confirmPayment is idempotent, so Dodo's retries are harmless
//
// Response codes matter: 2xx tells Dodo to stop retrying, anything else makes
// it retry with backoff. So invalid signatures get 401 (never retried into
// success), transient errors get 500 (retried), and events we do not care
// about get 200.
export async function POST(req: NextRequest) {
  const secret = process.env.DODO_PAYMENTS_WEBHOOK_KEY;
  if (!secret) {
    console.error('[payments/webhook] DODO_PAYMENTS_WEBHOOK_KEY is not set.');
    return NextResponse.json({ error: 'Webhook is not configured.' }, { status: 500 });
  }

  const rawBody = await req.text();
  const ok = await verifyWebhook({
    rawBody,
    id: req.headers.get('webhook-id'),
    timestamp: req.headers.get('webhook-timestamp'),
    signatureHeader: req.headers.get('webhook-signature'),
    secret,
  });
  if (!ok) return NextResponse.json({ error: 'Invalid signature.' }, { status: 401 });

  let event: DodoEvent;
  try {
    event = JSON.parse(rawBody) as DodoEvent;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const type = event.type || '';
  const data = event.data || {};

  try {
    // Resolve our payment id: metadata first, then the checkout session id.
    let paymentId: string | null = data.metadata?.payment_id ?? null;
    if (!paymentId && data.checkout_session_id) paymentId = await findPaymentIdBySession(data.checkout_session_id);

    switch (type) {
      case 'payment.succeeded': {
        if (!paymentId) return NextResponse.json({ ok: true, ignored: 'no matching payment' });
        if (!(await getPayment(paymentId))) return NextResponse.json({ ok: true, ignored: 'unknown payment' });
        const result = await confirmPayment(paymentId, { providerRef: data.payment_id, success: true });
        return NextResponse.json({ ok: true, applied: result.applied });
      }
      case 'payment.failed': {
        // Not terminal: the customer may retry inside the same checkout.
        if (paymentId) await noteFailedAttempt(paymentId, data.error_message ?? undefined);
        return NextResponse.json({ ok: true });
      }
      case 'refund.succeeded': {
        const ref = data.payment_id;
        if (ref) await markPaymentReversed(ref, 'refunded', 'Refunded via Dodo Payments — review whether to adjust the bid.');
        return NextResponse.json({ ok: true });
      }
      case 'dispute.opened':
      case 'dispute.lost': {
        const ref = data.payment_id;
        if (ref) await markPaymentReversed(ref, 'disputed', `Dodo Payments event ${type} — review the bid.`);
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ ok: true, ignored: type || 'unknown' });
    }
  } catch (e) {
    console.error('[payments/webhook]', type, e);
    // 500 -> Dodo retries. confirmPayment is idempotent, so that is safe.
    return NextResponse.json({ error: 'Processing failed.' }, { status: 500 });
  }
}
