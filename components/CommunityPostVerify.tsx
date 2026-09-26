'use client';

import { useState } from 'react';

export function CommunityPostVerify({
  channelId,
  manageToken,
  postText,
  communityUrl,
  onVerified,
}: {
  channelId: string;
  manageToken: string;
  postText: string;
  communityUrl: string;
  onVerified: () => void;
}) {
  const [postUrl, setPostUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function copyText() {
    try {
      await navigator.clipboard.writeText(postText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — the text is
      // still shown and selectable, so this is a soft failure only.
    }
  }

  async function submitProof(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/channels/${channelId}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postUrl, manageToken }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error || 'Could not verify that post.');
      return;
    }
    onVerified();
  }

  return (
    <div className="verify-card">
      <div className="verify-step">
        <div className="verify-step-num">1</div>
        <div>
          <p className="verify-step-title">Get your verification post</p>
          <div className="verify-post-text">{postText}</div>
          <button type="button" className="btn btn-secondary btn-compact" onClick={copyText}>
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      <div className="verify-step">
        <div className="verify-step-num">2</div>
        <div>
          <p className="verify-step-title">Post it to your channel's Community tab</p>
          <p className="muted small">
            Only your channel's owner can post there, which is what proves this channel is yours. YouTube doesn't
            let us pre-fill the post for you — paste the copied text in yourself.
          </p>
          <a className="btn btn-secondary btn-compact" href={communityUrl} target="_blank" rel="noreferrer noopener">
            Open YouTube Community
          </a>
        </div>
      </div>

      <div className="verify-step">
        <div className="verify-step-num">3</div>
        <div style={{ width: '100%' }}>
          <p className="verify-step-title">Paste the link to your post</p>
          <form onSubmit={submitProof} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              type="url"
              placeholder="https://youtube.com/@yourhandle/community"
              value={postUrl}
              onChange={(e) => setPostUrl(e.target.value)}
              required
              style={{ flex: '1 1 220px', minWidth: 0, padding: 10, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text)' }}
            />
            <button className="btn btn-primary btn-compact" type="submit" disabled={busy}>
              {busy ? 'Checking…' : 'Verify'}
            </button>
          </form>
          {error && <p className="small" style={{ color: 'var(--danger)' }}>{error}</p>}
        </div>
      </div>
    </div>
  );
}
