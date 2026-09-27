'use client';

import { useEffect, useState } from 'react';
import { centsToDisplay } from '@/lib/money';
import { getLocalChannels, type LocalChannel } from '@/lib/local-channels';

interface MyChannel extends LocalChannel {
  verificationStatus: string;
  totalBidCents: number;
}

interface Quote {
  currentTotalCents: number;
  requiredAdditionalCents: number;
  newTotalCents: number;
  minBidCents: number;
}

/**
 * Used for:
 *  - the homepage "Claim #1" card (targetRank = 1)
 *  - the per-row "Outbid" button (targetRank = that row's current rank, so
 *    the selected channel needs to exceed it)
 *
 * There is no login or ownership check anywhere in this app — anyone can
 * bid on any channel. "Your channels" here just means whichever channels
 * this browser has previously added (see lib/local-channels.ts), kept
 * purely as a convenience shortlist so you don't have to hunt down a
 * channel by slug every time; it grants no special access.
 */
export function ClaimRankModal({
  targetRank,
  contextLabel,
  onClose,
  onSuccess,
}: {
  targetRank: number;
  contextLabel: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [channels, setChannels] = useState<MyChannel[] | null>(null);
  const [selectedId, setSelectedId] = useState<string>('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'pick' | 'quote' | 'awaiting-payment' | 'done'>('pick');
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const local = getLocalChannels();
    if (local.length === 0) {
      setChannels([]);
      return;
    }
    const ids = local.map((c) => c.channelId).join(',');
    fetch(`/api/channels?ids=${encodeURIComponent(ids)}`)
      .then((r) => r.json())
      .then((d) => {
        const live: { id: string; verificationStatus: string; totalBidCents: number }[] = d.channels || [];
        const merged = local
          .map((lc) => {
            const liveInfo = live.find((l) => l.id === lc.channelId);
            return liveInfo
              ? { ...lc, verificationStatus: liveInfo.verificationStatus, totalBidCents: liveInfo.totalBidCents ?? 0 }
              : null;
          })
          .filter((c): c is MyChannel => c !== null);
        setChannels(merged);
      });
  }, []);

  const verifiedChannels = (channels || []).filter((c) => c.verificationStatus === 'verified');

  useEffect(() => {
    if (verifiedChannels.length > 0 && !selectedId) {
      setSelectedId(verifiedChannels[0].channelId);
    }
  }, [verifiedChannels, selectedId]);

  const selectedChannel = verifiedChannels.find((c) => c.channelId === selectedId);

  useEffect(() => {
    if (phase !== 'pick' || !selectedId) return;
    fetch('/api/bids/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId: selectedId, desiredRank: targetRank }),
    })
      .then((r) => r.json())
      .then((d) => setQuote(d.quote));
  }, [selectedId, phase, targetRank]);

  async function confirmAndPay() {
    if (!selectedChannel) return;
    setBusy(true);
    setError(null);
    const res = await fetch('/api/payments/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId: selectedId, desiredRank: targetRank }),
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
    if (!res.ok || !success || !data.applied) {
      setError(data.error || 'Payment could not be completed. No bid was created.');
      return;
    }
    setPhase('done');
    setTimeout(onSuccess, 900);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>{contextLabel}</h3>

        {channels === null && <p className="muted">Loading your channels…</p>}

        {channels !== null && verifiedChannels.length === 0 && (
          <>
            <p className="muted">
              You need a verified channel before you can bid. Add your channel from the homepage, then verify it
              from its profile page by posting your link to YouTube Community.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-secondary" onClick={onClose}>Close</button>
              <a className="btn btn-primary" href="#add-channel" onClick={onClose}>Add my channel</a>
            </div>
          </>
        )}

        {verifiedChannels.length > 0 && phase === 'pick' && (
          <>
            {verifiedChannels.length > 1 && (
              <>
                <label className="muted small">Which of your channels?</label>
                <select
                  value={selectedId}
                  onChange={(e) => setSelectedId(e.target.value)}
                  style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text)', margin: '8px 0 16px' }}
                >
                  {verifiedChannels.map((c) => (
                    <option key={c.channelId} value={c.channelId}>{c.name}</option>
                  ))}
                </select>
              </>
            )}

            {quote && (
              <div style={{ margin: '8px 0 16px' }}>
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

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
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
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
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
