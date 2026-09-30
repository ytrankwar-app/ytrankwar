import { NextRequest, NextResponse } from 'next/server';
import { confirmPayment } from '@/lib/bidding-service';

export const dynamic = 'force-dynamic';

// LOCAL DEVELOPMENT ONLY. Completes a payment without a real charge so the
// bidding flow can be tried without Dodo credentials. It refuses to run
// anywhere except `next dev` (NODE_ENV === 'development'); the deployed
// Worker is always built with NODE_ENV=production, where this is a 404.
export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const paymentId = req.nextUrl.searchParams.get('paymentId') || '';
  await confirmPayment(paymentId, { providerRef: `dev_${paymentId}`, success: true });
  return NextResponse.redirect(new URL(`/payment/return?pid=${encodeURIComponent(paymentId)}`, req.url));
}
