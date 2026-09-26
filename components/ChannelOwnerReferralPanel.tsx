'use client';

import { useEffect, useState } from 'react';
import { getManageToken } from '@/lib/local-channels';
import { ReferralLinkPanel } from './ReferralLinkPanel';

export function ChannelOwnerReferralPanel({
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

  if (!manageToken) return null;

  const manageUrl = `${window.location.origin}/channel/${slug}?manage=${manageToken}`;

  return (
    <>
      <ReferralLinkPanel postText={postText} communityUrl={communityUrl} referredVisits={referredVisits} />
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
          <div className="verify-post-text" style={{ marginTop: 10, wordBreak: 'break-all' }}>{manageUrl}</div>
        )}
      </div>
    </>
  );
}
