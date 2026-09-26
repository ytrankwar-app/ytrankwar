'use client';

import { useEffect, useState, useCallback } from 'react';
import { centsToDisplay } from '@/lib/money';
import { ClaimRankModal } from './ClaimRankModal';

interface TopEntry {
  channelId: string;
  name: string;
  avatarUrl: string | null;
  totalBidCents: number;
}

export function ClaimTopCard() {
  const [top, setTop] = useState<TopEntry | null | undefined>(undefined);
  const [nextPriceCents, setNextPriceCents] = useState<number | null>(null);
  const [showModal, setShowModal] = useState(false);

  const load = useCallback(() => {
    fetch('/api/leaderboard?limit=1')
      .then((r) => r.json())
      .then((d) => setTop(d.entries?.[0] ?? null));
    // The real minimum-increment rule ($1 by default, configurable) lives
    // server-side in requiredTotalForRank() — never hardcode it here.
    fetch('/api/bids/next-price?rank=1')
      .then((r) => r.json())
      .then((d) => setNextPriceCents(d.requiredTotalCents));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (top === undefined) return null;

  return (
    <div className="container">
      <div className="claim1-card">
        <div className="claim1-info">
          <div className="claim1-eyebrow">🏆 CURRENT #1</div>
          {top ? (
            <>
              <div className="claim1-name">
                <img className="avatar claim1-avatar" src={top.avatarUrl ?? ''} alt="" />
                {top.name}
              </div>
              <div className="muted small">
                {top.totalBidCents > 0 ? `Current bid ${centsToDisplay(top.totalBidCents)}` : 'Free listing — not yet claimed'}
              </div>
            </>
          ) : (
            <div className="claim1-name">Nobody yet — this spot is open</div>
          )}
        </div>
        <div className="claim1-action">
          <div className="muted small">Next takeover</div>
          <div className="claim1-price">{nextPriceCents === null ? '—' : centsToDisplay(nextPriceCents)}</div>
          <button className="btn btn-primary btn-gold" onClick={() => setShowModal(true)}>
            Claim #1
          </button>
        </div>
      </div>

      {showModal && (
        <ClaimRankModal
          targetRank={1}
          contextLabel="Claim the #1 position"
          onClose={() => setShowModal(false)}
          onSuccess={() => { setShowModal(false); load(); }}
        />
      )}
    </div>
  );
}
