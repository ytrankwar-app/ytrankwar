import type { Metadata } from 'next';
import Link from 'next/link';
import AutoRefresh from '@/components/AutoRefresh';
import { confirmPayment, getPayment } from '@/lib/bidding-service';
import { getCheckoutSession, isDodoConfigured } from '@/lib/dodo';
import { CONTACT_EMAIL } from '@/lib/site';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Payment status', robots: { index: false, follow: false } };

export default async function PaymentReturnPage({
  searchParams,
}: {
  searchParams: { pid?: string; cancelled?: string };
}) {
  const pid = String(searchParams.pid || '').slice(0, 64);
  let payment = pid ? await getPayment(pid).catch(() => null) : null;

  // The webhook is the primary path. If the customer lands here before it
  // has arrived, ask Dodo directly (server-to-server, so it cannot be
  // spoofed via the URL) and apply the payment ourselves. confirmPayment is
  // idempotent, so it is harmless if the webhook lands at the same moment.
  if (payment && ['created', 'pending'].includes(payment.status) && payment.providerSessionId && isDodoConfigured()) {
    try {
      const session = await getCheckoutSession(payment.providerSessionId);
      if (session.paymentStatus === 'succeeded') {
        await confirmPayment(payment.id, { providerRef: session.paymentId ?? undefined, success: true });
        payment = await getPayment(pid);
      }
    } catch (e) {
      console.error('[payment/return] reconcile failed', e);
    }
  }

  const cancelled = searchParams.cancelled === '1';
  const channelHref = payment?.slug ? `/channel/${payment.slug}` : '/';

  let title = 'We could not find that payment';
  let body = 'If you were charged, email us and we will sort it out.';
  let tone: 'ok' | 'wait' | 'bad' = 'bad';
  let refresh = false;

  if (payment) {
    if (payment.status === 'paid' && payment.applied === 1) {
      title = 'Payment received — your bid is live';
      body = `Your $${(payment.amountCents / 100).toFixed(2)} bid has been added and the leaderboard is updated.`;
      tone = 'ok';
    } else if (payment.status === 'paid') {
      title = 'Payment received, but we could not apply it';
      body = `The channel was not eligible when your payment arrived. Email ${CONTACT_EMAIL} with payment ID ${payment.id} for a refund.`;
    } else if (['refunded', 'disputed'].includes(payment.status)) {
      title = `This payment was ${payment.status}`;
      body = `Questions? Email ${CONTACT_EMAIL} with payment ID ${payment.id}.`;
    } else if (payment.status === 'failed' || cancelled) {
      title = cancelled ? 'Checkout cancelled' : 'Payment did not go through';
      body = 'You have not been charged. You can go back and try again whenever you like.';
    } else {
      title = 'Confirming your payment…';
      body = 'This usually takes a few seconds. This page updates on its own — no need to pay again.';
      tone = 'wait';
      refresh = true;
    }
  }

  return (
    <div className="container prose-page">
      {refresh && <AutoRefresh />}
      <h1>{title}</h1>
      <p className={tone === 'bad' ? 'muted' : undefined}>{body}</p>
      {payment && <p className="muted small">Payment ID: {payment.id}</p>}
      <p>
        <Link className="btn" href={channelHref}>
          {payment?.slug ? 'Back to the channel' : 'Back to the leaderboard'}
        </Link>
      </p>
    </div>
  );
}
