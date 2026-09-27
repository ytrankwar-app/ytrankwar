'use client';

import { useEffect, useState } from 'react';
import { BidModal } from './BidModal';
import { CommunityPostVerify } from './CommunityPostVerify';
import { getLocalChannel, saveLocalChannel } from '@/lib/local-channels';

/**
 * There is no login or ownership check anywhere in this app — anyone can
 * verify or bid on any channel. This just remembers (client-side only)
 * that this browser has visited the channel, so it shows up in "My
 * channels" pickers elsewhere (e.g. ClaimRankModal) as a shortlist; it
 * grants no special access here.
 */
export function ChannelActions({
  channelId,
  channelName,
  channelSlug,
  verificationStatus,
  autoOpenBid,
  verificationPostText,
  verificationCommunityUrl,
}: {
  channelId: string;
  channelName: string;
  channelSlug: string;
  verificationStatus: string;
  autoOpenBid?: boolean;
  verificationPostText: string;
  verificationCommunityUrl: string;
}) {
  const [status, setStatus] = useState(verificationStatus);
  const [showBid, setShowBid] = useState(false);
  const [showVerify, setShowVerify] = useState(false);
  const [autoOpened, setAutoOpened] = useState(false);

  // Remember this channel locally so it shows up as a shortlist elsewhere
  // on this browser — purely a convenience, not a credential.
  useEffect(() => {
    if (!getLocalChannel(channelId)) {
      saveLocalChannel({ channelId, slug: channelSlug, name: channelName });
    }
  }, [channelId, channelSlug, channelName]);

  // The "Add & Take a Position" flow lands here with autoOpenBid=true —
  // once the channel is verified (that flow auto-verifies server-side),
  // open the bid modal automatically so the visitor doesn't have to find
  // and click the button themselves.
  useEffect(() => {
    if (autoOpenBid && !autoOpened && status === 'verified') {
      setShowBid(true);
      setAutoOpened(true);
    }
  }, [autoOpenBid, autoOpened, status]);

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {status !== 'verified' && (
          <button className="btn btn-secondary" onClick={() => setShowVerify((v) => !v)}>
            {showVerify ? 'Hide verification steps' : 'Verify ownership'}
          </button>
        )}

        <button
          className="btn btn-primary"
          onClick={() => setShowBid(true)}
          disabled={status !== 'verified'}
          title={status !== 'verified' ? 'Verify ownership before placing a paid bid.' : undefined}
        >
          Bid on this channel
        </button>
      </div>

      {status !== 'verified' && showVerify && (
        <div className="card" style={{ marginTop: 16 }}>
          <CommunityPostVerify
            channelId={channelId}
            postText={verificationPostText}
            communityUrl={verificationCommunityUrl}
            onVerified={() => {
              setStatus('verified');
              setShowVerify(false);
            }}
          />
        </div>
      )}

      {showBid && (
        <BidModal
          channelId={channelId}
          channelName={channelName}
          onClose={() => setShowBid(false)}
          onSuccess={() => window.location.reload()}
        />
      )}
    </div>
  );
}
