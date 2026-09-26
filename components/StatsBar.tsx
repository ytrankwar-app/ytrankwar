'use client';

import { useEffect, useState } from 'react';

const SESSION_KEY = 'ytrankwar_session_id';
const PING_INTERVAL_MS = 20_000;
const STATS_POLL_MS = 10_000;

function getSessionId(): string {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    // sessionStorage unavailable (e.g. privacy mode) — fall back to a
    // per-mount id; it just won't persist across a refresh in that case.
    return crypto.randomUUID();
  }
}

function EyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function ChannelsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="3" />
      <path d="M8 4v16M2 9h6" />
      <path d="m13 10 4 2.5-4 2.5v-5Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function StatsBar() {
  const [liveVisitors, setLiveVisitors] = useState<number | null>(null);
  const [totalChannels, setTotalChannels] = useState<number | null>(null);

  useEffect(() => {
    const sessionId = getSessionId();

    const ping = () => {
      fetch('/api/presence/ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      }).catch(() => {});
    };

    const pollStats = () => {
      fetch('/api/stats')
        .then((r) => r.json())
        .then((d) => {
          setLiveVisitors(d.liveVisitors);
          setTotalChannels(d.totalChannels);
        })
        .catch(() => {});
    };

    ping();
    pollStats();
    const pingId = setInterval(ping, PING_INTERVAL_MS);
    const statsId = setInterval(pollStats, STATS_POLL_MS);
    return () => {
      clearInterval(pingId);
      clearInterval(statsId);
    };
  }, []);

  return (
    <div className="stats-bar">
      <div className="stat-pill">
        <span className="live-dot" aria-hidden="true" />
        <EyeIcon />
        <span>{liveVisitors === null ? '—' : formatCompact(liveVisitors)} online now</span>
      </div>
      <div className="stat-pill">
        <ChannelsIcon />
        <span>{totalChannels === null ? '—' : formatCompact(totalChannels)} channels added</span>
      </div>
    </div>
  );
}
