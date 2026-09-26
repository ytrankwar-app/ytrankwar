import { NextRequest, NextResponse } from 'next/server';
import { confirmPayment, BiddingError } from '@/lib/bidding-service';

// MOCK payment webhook, standing in for Stripe's `checkout.session.completed`
// (and `payment_intent.payment_failed`) events.
//
// In production:
//   - verify the Stripe-Signature header against STRIPE_WEBHOOK_SECRET
//     using stripe.webhooks.constructEvent before touching anything below
//   - never accept `success` from a query string — read it from the
//     verified event payload
//   - Stripe (and any provider) can and will redeliver the same event;
//     confirmPayment() is idempotent specifically so redelivery is safe
//
// This demo exposes it as a simple GET/POST so the "Simulate payment"
// button in the UI can trigger it without a real payment provider.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return handle(body.paymentId, body.success !== false, body.providerRef);
}

export async function GET(req: NextRequest) {
  const paymentId = req.nextUrl.searchParams.get('paymentId') || '';
  const success = req.nextUrl.searchParams.get('success') !== 'false';
  return handle(paymentId, success, undefined);
}

function handle(paymentId: string, success: boolean, providerRef?: string) {
  if (!paymentId) return NextResponse.json({ error: 'paymentId is required.' }, { status: 400 });
  try {
    const result = confirmPayment(paymentId, { success, providerRef: providerRef ?? `mock_${Date.now()}` });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof BiddingError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error(e);
    return NextResponse.json({ error: 'Webhook processing failed.' }, { status: 500 });
  }
}
