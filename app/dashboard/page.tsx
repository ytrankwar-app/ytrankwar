'use client';

import { useEffect, useState } from 'react';
import { centsToDisplay } from '@/lib/money';
import { BidModal } from '@/components/BidModal';
import { AddChannelForm } from '@/components/AddChannelForm';

interface MyChannel {
  id: string;
  name: string;
  slug: string;
  handle: string | null;
  avatarUrl: string | null;
  verificationStatus: string;
  totalBidCents: number;
  currentRank: number | null;
}

export default function DashboardPage() {
  const [user, setUser] = useState<{ id: string; name: string } | null | undefined>(undefined);
  const [channels, setChannels] = useState<MyChannel[]>([]);
  const [bidTarget, setBidTarget] = useState<MyChannel | null>(null);

  function load() {
    fetch('/api/channels?mine=1').then((r) => r.json()).then((d) => setChannels(d.channels));
  }

  useEffect(() => {
    fetch('/api/session').then((r) => r.json()).then((d) => setUser(d.user));
    load();
  }, []);

  if (user === undefined) return <div className="container" style={{ paddingTop: 40 }}>Loading…</div>;
  if (user === null) {
    return (
      <div className="container" style={{ paddingTop: 40 }}>
        <div className="card">
          <p>Sign in from the top bar to view your dashboard.</p>
        </div>
      </div>
    );
  }

  const totalSpent = channels.reduce((sum, c) => sum + c.totalBidCents, 0);

  return (
    <div className="container" style={{ paddingTop: 32, paddingBottom: 60 }}>
      <h1>Dashboard</h1>

      <div className="grid-2" style={{ marginBottom: 24 }}>
        <div className="card">
          <div className="stat-row"><span className="muted">Channels owned</span><span>{channels.length}</span></div>
          <div className="stat-row"><span className="muted">Total cumulative bid</span><span>{centsToDisplay(totalSpent)}</span></div>
          <div className="stat-row"><span className="muted">Highest current position</span><span>{channels.filter((c) => c.currentRank).length ? `#${Math.min(...channels.filter((c) => c.currentRank).map((c) => c.currentRank!))}` : '—'}</span></div>
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Add another channel</h3>
          <AddChannelForm />
        </div>
      </div>

      <h2>My channels</h2>
      {channels.length === 0 && <p className="muted">You haven't added a channel yet.</p>}
      {channels.map((c) => (
        <div className="lb-row" key={c.id} style={{ gridTemplateColumns: '44px 1fr auto auto' }}>
          <img className="avatar" src={c.avatarUrl ?? ''} alt="" />
          <div>
            <div className="lb-name">{c.name} {c.verificationStatus === 'verified' && <span className="badge">Verified</span>}{c.verificationStatus !== 'verified' && <span className="badge badge-muted">Unverified</span>}</div>
            <div className="lb-sub">Rank {c.currentRank ? `#${c.currentRank}` : '—'} · Bid {centsToDisplay(c.totalBidCents)}</div>
          </div>
          <a className="btn btn-secondary" href={`/channel/${c.slug}`}>View profile</a>
          <button className="btn btn-primary" onClick={() => setBidTarget(c)}>Increase bid</button>
        </div>
      ))}

      {bidTarget && (
        <BidModal
          channelId={bidTarget.id}
          channelName={bidTarget.name}
          onClose={() => setBidTarget(null)}
          onSuccess={() => { setBidTarget(null); load(); } } manageToken={''}        />
      )}
    </div>
  );
}
