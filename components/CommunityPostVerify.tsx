'use client';

import { useState } from 'react';

// Ownership check: the owner adds one line to the channel DESCRIPTION (only
// the owner can edit it) and we re-read that channel's description from the
// YouTube Data API. Nothing typed here is used as proof.
export function CommunityPostVerify({
  channelId,
  verificationLine,
  descriptionEditUrl,
  onVerified,
}: {
  channelId: string;
  verificationLine: string;
  descriptionEditUrl: string;
  onVerified: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function copyText() {
    try {
      await navigator.clipboard.writeText(verificationLine);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — the text is still shown and selectable.
    }
  }

  async function check() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/channels/${channelId}/verify`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not verify this channel.');
        return;
      }
      onVerified();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="verify-card">
      <div className="verify-step">
        <div className="verify-step-num">1</div>
        <div>
          <p className="verify-step-title">Copy your verification line</p>
          <div className="verify-post-text">{verificationLine}</div>
          <button type="button" className="btn btn-secondary btn-compact" onClick={copyText}>
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      <div className="verify-step">
        <div className="verify-step-num">2</div>
        <div>
          <p className="verify-step-title">Add it to your channel description</p>
          <p className="muted small">
            In YouTube Studio go to Customization → Basic info → Description, paste the line anywhere, and click
            Publish. Only the channel's owner can edit the description, which is what proves the channel is yours.
            You can delete the line again after verification.
          </p>
          <a className="btn btn-secondary btn-compact" href={descriptionEditUrl} target="_blank" rel="noreferrer noopener">
            Open YouTube Studio
          </a>
        </div>
      </div>

      <div className="verify-step">
        <div className="verify-step-num">3</div>
        <div style={{ width: '100%' }}>
          <p className="verify-step-title">Check my channel</p>
          <p className="muted small">It can take a minute for YouTube to show the change.</p>
          <button className="btn btn-primary btn-compact" type="button" onClick={check} disabled={busy}>
            {busy ? 'Checking…' : 'Verify'}
          </button>
          {error && <p className="small" style={{ color: 'var(--danger)' }}>{error}</p>}
        </div>
      </div>
    </div>
  );
}
