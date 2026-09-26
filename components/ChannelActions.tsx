'use client';

import { useEffect, useState } from 'react';
import { BidModal } from './BidModal';
import { ClaimRankModal } from './ClaimRankModal';
import { CommunityPostVerify } from './CommunityPostVerify';
import { getManageToken } from '@/lib/local-channels';

export function ChannelActions({
  channelId,
  channelName,
  verificationStatus,
  currentRank,
  autoOpenBid,
  verificationPostText,
  verificationCommunityUrl,
}: {
  channelId: string;
  channelName: string;
  verificationStatus: string;
  currentRank: number | null;
  autoOpenBid?: boolean;
  verificationPostText: string;
  verificationCommunityUrl: string;
}) {
  const [manageToken, setManageToken] = useState<string | null>(null);
  const [status, setStatus] = useState(verificationStatus);
  const [showBid, setShowBid] = useState(false);
  const [showVerify, setShowVerify] = useState(false);
  const [autoOpened, setAutoOpened] = useState(false);

  const isOwner = !!manageToken;

  // No login in this app — "is this my channel?" is answered by whether
  // this browser's localStorage holds a manage_token for it (saved either
  // right after creation, or by visiting a saved manage link — see
  // ManageTokenCapture, which runs before this on the page).
  useEffect(() => {
    setManageToken(getManageToken(channelId));
  }, [channelId]);

  // The "Add & Take a Position" flow lands here with autoOpenBid=true —
  // once we've confirmed this browser holds the token and the channel
  // is verified (that flow auto-verifies server-side), open the bid modal
  // automatically so they don't have to find and click the button themselves.
  useEffect(() => {
    if (autoOpenBid && !autoOpened && isOwner && status === 'verified') {
      setShowBid(true);
      setAutoOpened(true);
    }
  }, [autoOpenBid, autoOpened, isOwner, status]);

  // Owners increase their own channel's bid directly (BidModal lets them
  // type any target rank). Visitors instead outbid THIS channel using one
  // of their own verified channels (ClaimRankModal), which only makes sense
  // if this channel already holds a paid rank.
  return (
    <div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {isOwner && status !== 'verified' && (
          <button className="btn btn-secondary" onClick={() => setShowVerify((v) => !v)}>
            {showVerify ? 'Hide verification steps' : 'Verify ownership'}
          </button>
        )}

        {isOwner && (
          <button
            className="btn btn-primary"
            onClick={() => setShowBid(true)}
            disabled={status !== 'verified'}
            title={status !== 'verified' ? 'Verify ownership before placing a paid bid.' : undefined}
          >
            Increase my bid
          </button>
        )}

        {!isOwner && currentRank && (
          <button className="btn btn-primary" onClick={() => setShowBid(true)}>
            Outbid this channel
          </button>
        )}
      </div>

      {isOwner && status !== 'verified' && showVerify && (
        <div className="card" style={{ marginTop: 16 }}>
          <CommunityPostVerify
            channelId={channelId}
            manageToken={manageToken}
            postText={verificationPostText}
            communityUrl={verificationCommunityUrl}
            onVerified={() => {
              setStatus('verified');
              setShowVerify(false);
            }}
          />
        </div>
      )}

      {showBid && isOwner && (
        <BidModal
          channelId={channelId}
          channelName={channelName}
          manageToken={manageToken}
          onClose={() => setShowBid(false)}
          onSuccess={() => window.location.reload()}
        />
      )}

      {showBid && !isOwner && currentRank && (
        <ClaimRankModal
          targetRank={currentRank}
          contextLabel={`Outbid ${channelName} (currently #${currentRank})`}
          onClose={() => setShowBid(false)}
          onSuccess={() => window.location.reload()}
        />
      )}
    </div>
  );
}
