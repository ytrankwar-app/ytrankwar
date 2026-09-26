'use client';

import { useState } from 'react';

export function ReferralLinkPanel({
  postText,
  communityUrl,
  referredVisits,
}: {
  postText: string;
  communityUrl: string;
  referredVisits: number;
}) {
  const [copied, setCopied] = useState(false);

  async function copyText() {
    try {
      await navigator.clipboard.writeText(postText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — text is still visible/selectable below.
    }
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Your ytrankwar link</h3>
      <p className="muted small">
        Share this on your channel's Community tab. Every visitor who clicks it counts toward your spot on the{' '}
        <a href="#referral-leaderboard" style={{ textDecoration: 'underline' }}>referral leaderboard</a> — a separate
        board from paid rank, which is decided by bid only. This is only visible to you; nobody else can see or
        copy this link from your channel's page.
      </p>
      <div className="verify-post-text">{postText}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <button type="button" className="btn btn-secondary btn-compact" onClick={copyText}>
          {copied ? 'Copied!' : 'Copy'}
        </button>
        <a className="btn btn-secondary btn-compact" href={communityUrl} target="_blank" rel="noreferrer noopener">
          Open YouTube Community
        </a>
      </div>
      <div className="stat-row">
        <span className="muted">Referred visits so far</span>
        <span>{referredVisits.toLocaleString()}</span>
      </div>
    </div>
  );
}
