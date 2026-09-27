'use client';

import { ReferralLinkPanel } from './ReferralLinkPanel';

/**
 * There is no login in this app, so there's no "owner-only" view to gate
 * this behind — the referral link is public information for the channel
 * (it's shown to everyone via the verification steps too), so it's just
 * always rendered here.
 */
export function ReferralSection({
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
  return (
    <ReferralLinkPanel
      postText={postText}
      communityUrl={communityUrl}
      referredVisits={referredVisits}
    />
  );
}
