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
}: {
  channelId: string;
  channelName: string;
  onClose: () => void;
  /** Kept for API compatibility: payment now completes on Dodo's hosted page and returns to /payment/return. */
  onSuccess?: () => void;
}) {
  const [desiredRank, setDesiredRank] = useState(1);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'quote' | 'redirecting'>('quote');
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
    try {
      const res = await fetch('/api/payments/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: channelId, desiredRank: desiredRank }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.checkoutUrl) {
        setError(data.error || 'Something went wrong. You have not been charged.');
        setBusy(false);
        return;
      }
      // Hand off to Dodo Payments' secure hosted checkout. The bid is applied
      // by the server once Dodo confirms the payment, then the customer is
      // returned to /payment/return.
      setPhase('redirecting');
      window.location.assign(data.checkoutUrl);
    } catch {
      setError('Network error. You have not been charged — please try again.');
      setBusy(false);
    }
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

        {phase === 'redirecting' && <p className="muted">Taking you to Dodo Payments' secure checkout…</p>}
      </div>
    </div>
  );
}
