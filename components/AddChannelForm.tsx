'use client';

import { useState } from 'react';
import { saveLocalChannel } from '@/lib/local-channels';
import { CATEGORIES } from '@/lib/categories';

export function AddChannelForm() {
  const [url, setUrl] = useState('');
  const [category, setCategory] = useState('');
  const [busyMode, setBusyMode] = useState<'free' | 'premium' | null>(null);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  async function submit(premium: boolean) {
    setBusyMode(premium ? 'premium' : 'free');
    setMessage(null);
    const res = await fetch('/api/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, premium, category: category || null }),
    });
    const data = await res.json();
    setBusyMode(null);
    if (!res.ok) {
      setMessage({ type: 'error', text: data.error || 'Something went wrong.' });
      return;
    }

    // manageToken is returned exactly once, right here — save it now or
    // it's gone. This is what lets this browser manage/bid on the channel
    // later without any account. The same token is embedded in the manage
    // link shown after redirect, in case they want to open it on another
    // device too.
    saveLocalChannel({ channelId: data.channelId, manageToken: data.manageToken, slug: data.slug, name: data.name });

    // The premium path lands on the channel page with ?claim=1, which
    // auto-opens the bid modal (the channel was already auto-verified
    // server-side for this flow — see app/api/channels/route.ts).
    window.location.href = premium ? `/channel/${data.slug}?claim=1` : `/channel/${data.slug}`;
  }

  return (
    <div>
      <form
        className="hero-form"
        id="add-channel"
        onSubmit={(e) => {
          e.preventDefault();
          submit(false);
        }}
      >
        <input
          placeholder="https://youtube.com/@yourchannel"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="hero-category-select"
          aria-label="Channel category"
        >
          <option value="">Category (optional)</option>
          {CATEGORIES.map(([slug, label]) => (
            <option key={slug} value={slug}>{label}</option>
          ))}
        </select>
        <button className="btn btn-primary" type="submit" disabled={busyMode !== null}>
          {busyMode === 'free' ? 'Adding…' : 'Add Channel'}
        </button>
        <button
          type="button"
          className="btn btn-gold"
          disabled={busyMode !== null}
          onClick={() => submit(true)}
        >
          {busyMode === 'premium' ? 'Adding…' : '⚡ Add & Take a Position'}
        </button>
      </form>
      <p className="muted small hero-form-hint">
        Adding your channel is always free. Pick a category so people can find you on the category tabs below. Take
        a paid position to skip straight to bidding for a rank.
      </p>
      {message && (
        <p className="small" style={{ color: message.type === 'error' ? 'var(--danger)' : 'var(--accent)' }}>
          {message.text}
        </p>
      )}
    </div>
  );
}
