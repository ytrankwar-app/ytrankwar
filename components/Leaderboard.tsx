'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { CATEGORIES } from '@/lib/categories';
import { centsToDisplay } from '@/lib/money';
import { ClaimRankModal } from './ClaimRankModal';

interface Entry {
  channelId: string;
  name: string;
  handle: string | null;
  slug: string;
  avatarUrl: string | null;
  youtubeChannelId: string;
  subscribers: number;
  clickCount: number;
  totalBidCents: number;
  requiredToClaimCents: number;
  lastBidAt: string;
  rank: number;
  verificationStatus: string;
}

const LIMIT_OPTIONS = [10, 20, 50] as const;

function visitUrl(entry: Entry): string {
  if (entry.handle) return `https://youtube.com/${entry.handle}`;
  return `https://youtube.com/channel/${entry.youtubeChannelId}`;
}

function trackClick(channelId: string) {
  fetch(`/api/channels/${channelId}/click`, { method: 'POST' }).catch(() => {});
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function Leaderboard() {
  const router = useRouter();
  const [category, setCategory] = useState('');
  const [limit, setLimit] = useState<number>(20);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [outbidTarget, setOutbidTarget] = useState<Entry | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: String(limit) });
    if (category) params.set('category', category);
    fetch(`/api/leaderboard?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => setEntries(d.entries))
      .finally(() => setLoading(false));
  }, [category, limit]);

  useEffect(() => { load(); }, [load]);

  function goToProfile(slug: string) {
    router.push(`/channel/${slug}`);
  }

  return (
    <section className="container">
      <div className="lb-controls">
        <div className="tabs">
          {[['', 'Global'], ...CATEGORIES].map(([slug, label]) => (
            <button
              key={slug}
              className={`tab ${category === slug ? 'active' : ''}`}
              onClick={() => setCategory(slug)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="limit-tabs">
          {LIMIT_OPTIONS.map((n) => (
            <button
              key={n}
              className={`tab ${limit === n ? 'active' : ''}`}
              onClick={() => setLimit(n)}
            >
              Top {n}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="muted">Loading…</p>}
      {!loading && entries.length === 0 && (
        <div className="card">
          <p style={{ margin: 0 }}>No channels in this category yet.</p>
          <p className="muted small">Be the first creator to add yours.</p>
        </div>
      )}

      {entries.map((e) => (
        <div
          className="lb-row lb-row-clickable"
          key={e.channelId}
          role="link"
          tabIndex={0}
          onClick={() => goToProfile(e.slug)}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter' || ev.key === ' ') goToProfile(e.slug);
          }}
        >
          <div className={`lb-rank ${e.rank <= 3 ? 'gold' : ''}`}>#{e.rank}</div>
          <img className="avatar" src={e.avatarUrl ?? ''} alt="" />
          <div className="lb-name-col">
            <div className="lb-name">
              {e.name}
              <span className="lb-handle">{e.handle}</span>
              {e.verificationStatus === 'verified' && <span className="badge">Verified</span>}
            </div>
            <div className="lb-sub">
              {formatCompact(e.subscribers)} subscribers · {formatCompact(e.clickCount)} clicks · {timeAgo(e.lastBidAt)}
            </div>
          </div>
          <div className="lb-price-col">
            <div className="lb-bid-amount">{e.totalBidCents > 0 ? centsToDisplay(e.totalBidCents) : 'Free'}</div>
            <button
              className="lb-claim-link"
              onClick={(ev) => {
                ev.stopPropagation();
                setOutbidTarget(e);
              }}
            >
              claim this rank for {centsToDisplay(e.requiredToClaimCents)}
            </button>
          </div>
          <a
            className="btn btn-secondary btn-compact lb-visit-btn"
            href={visitUrl(e)}
            target="_blank"
            rel="noreferrer noopener"
            onClick={(ev) => {
              ev.stopPropagation();
              trackClick(e.channelId);
            }}
          >
            Visit
          </a>
        </div>
      ))}

      {outbidTarget && (
        <ClaimRankModal
          targetRank={outbidTarget.rank}
          contextLabel={`Outbid ${outbidTarget.name} (currently #${outbidTarget.rank})`}
          onClose={() => setOutbidTarget(null)}
          onSuccess={() => { setOutbidTarget(null); load(); }}
        />
      )}
    </section>
  );
}
