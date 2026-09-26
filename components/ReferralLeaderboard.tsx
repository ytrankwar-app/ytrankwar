'use client';

import { useEffect, useState } from 'react';

interface ReferralEntry {
  channelId: string;
  name: string;
  handle: string | null;
  slug: string;
  avatarUrl: string | null;
  referredVisits: number;
  rank: number;
}

export function ReferralLeaderboard() {
  const [entries, setEntries] = useState<ReferralEntry[] | null>(null);

  useEffect(() => {
    fetch('/api/leaderboard/referrals?limit=10')
      .then((r) => r.json())
      .then((d) => setEntries(d.entries || []));
  }, []);

  if (entries !== null && entries.length === 0) return null;

  return (
    <section className="container" id="referral-leaderboard">
      <h2 style={{ marginBottom: 4 }}>🔗 TOP BY COMMUNITY REACH</h2>
      <p className="muted small" style={{ marginTop: 0 }}>
        Ranked by visitors referred through a channel's shared link — separate from the paid leaderboard above,
        which is decided by verified bid only.
      </p>

      {entries === null && <p className="muted">Loading…</p>}

      {entries?.map((e) => (
        <div className="lb-row" key={e.channelId}>
          <div className="lb-rank">#{e.rank}</div>
          <img className="avatar" src={e.avatarUrl ?? ''} alt="" />
          <div className="lb-name-col">
            <div className="lb-name">{e.name}</div>
          </div>
          <div className="lb-price-col">
            <span className="muted small">{e.referredVisits.toLocaleString()} visits</span>
          </div>
          <a className="btn btn-secondary btn-compact" href={`/channel/${e.slug}`}>Profile</a>
        </div>
      ))}
    </section>
  );
}
