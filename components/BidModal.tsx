'use client';

import { useEffect, useState } from 'react';
import { centsToDisplay } from '@/lib/money';

interface Quote {
  currentTotalCents: number;
  requiredAdditionalCents: number;
  newTotalCents: number;
  minBidCents: number;
}

export function BidModal({
  channelId,
  channelName,
  onClose,
  onSuccess,
}: {
  channelId: string;
  channelName: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [desiredRank, setDesiredRank] = useState(1);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'quote' | 'awaiting-payment' | 'done'>('quote');
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setError(null);
    fetch('/api/bids/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId, desiredRank }),
    })
      .then((r) => r.json())
      .then((d) => setQuote(d.quote));
  }, [channelId, desiredRank]);

  async function confirmAndPay() {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/payments/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId, desiredRank }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error || 'Something went wrong.');
      return;
    }
    setPaymentId(data.paymentId);
    setPhase('awaiting-payment');
  }

  async function simulatePayment(success: boolean) {
    if (!paymentId) return;
    setBusy(true);
    const res = await fetch('/api/payments/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentId, success }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error || 'Payment could not be completed. No bid was created.');
      return;
    }
    if (!success || !data.applied) {
      setError('Payment could not be completed. No bid was created.');
      return;
    }
    setPhase('done');
    setTimeout(onSuccess, 900);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Claim a position for {channelName}</h3>

        {phase === 'quote' && (
          <>
            <label className="muted small">Target rank</label>
            <input
              type="number"
              min={1}
              value={desiredRank}
              onChange={(e) => setDesiredRank(Math.max(1, Number(e.target.value) || 1))}
              style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text)', margin: '8px 0 16px' }}
            />

            {quote && (
              <div style={{ marginBottom: 16 }}>
                <div className="stat-row"><span className="muted">Current total bid</span><span>{centsToDisplay(quote.currentTotalCents)}</span></div>
                <div className="stat-row"><span className="muted">New total bid</span><span>{centsToDisplay(quote.newTotalCents)}</span></div>
                <div className="stat-row"><span className="muted">Additional payment</span><strong>{centsToDisplay(quote.requiredAdditionalCents)}</strong></div>
              </div>
            )}

            {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

            <p className="muted small">
              Final position is recalculated server-side immediately before payment and again after confirmation —
              the price above is an estimate.
            </p>

            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" disabled={!quote || busy} onClick={confirmAndPay}>
                {busy ? 'Processing…' : `Confirm & Pay ${quote ? centsToDisplay(quote.requiredAdditionalCents) : ''}`}
              </button>
            </div>
          </>
        )}

        {phase === 'awaiting-payment' && (
          <>
            <p className="muted">
              In production this hands off to Stripe Checkout. This demo simulates the provider's webhook callback
              instead of a real card form.
            </p>
            {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-danger" disabled={busy} onClick={() => simulatePayment(false)}>Simulate failure</button>
              <button className="btn btn-primary" disabled={busy} onClick={() => simulatePayment(true)}>Simulate successful payment</button>
            </div>
          </>
        )}

        {phase === 'done' && <p>Payment confirmed — your bid is live on the leaderboard.</p>}
      </div>
    </div>
  );
}
