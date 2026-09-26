'use client';

import { useEffect, useState } from 'react';
import { getManageToken } from '@/lib/local-channels';
import { ReferralLinkPanel } from './ReferralLinkPanel';

export function ReferralSection({
  channelId,
  slug,
  postText,
  communityUrl,
  referredVisits,
}: {
  channelId: string;
  slug: string;
  postText: string;
  communityUrl: string;
  referredVisits: number;
}) {
  const [manageToken, setManageToken] = useState<string | null>(null);
  const [showManageLink, setShowManageLink] = useState(false);

  useEffect(() => {
    setManageToken(getManageToken(channelId));
  }, [channelId]);

  // Owner-only, by explicit product decision: this channel's referral
  // share link and its private management link are both hidden from
  // everyone except the browser holding the real manage_token. (An earlier
  // version of this made the share link public to any visitor; that was
  // deliberately reverted — see the README's note on this.)
  if (!manageToken) return null;

  return (
    <>
      <ReferralLinkPanel
        postText={postText}
        communityUrl={communityUrl}
        referredVisits={referredVisits}
      />

      <div className="card" style={{ marginTop: 12 }}>
        <p className="muted small" style={{ margin: 0 }}>
          There's no login for this channel — this browser remembers you own it. If you clear your browser data or
          switch devices, you'll need this private link to get back in.
        </p>
        {!showManageLink ? (
          <button className="btn btn-secondary btn-compact" style={{ marginTop: 10 }} onClick={() => setShowManageLink(true)}>
            Show my management link
          </button>
        ) : (
          <div className="verify-post-text" style={{ marginTop: 10, wordBreak: 'break-all' }}>
            {`${window.location.origin}/channel/${slug}?manage=${manageToken}`}
          </div>
        )}
      </div>
    </>
  );
}
