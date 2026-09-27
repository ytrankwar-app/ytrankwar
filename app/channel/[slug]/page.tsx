import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getChannelBySlug } from '@/lib/channel-service';
import { getChannelRank } from '@/lib/leaderboard-service';
import { getVerificationInfo } from '@/lib/verification-service';
import { centsToDisplay } from '@/lib/money';
import { db } from '@/db';
import { ChannelActions } from '@/components/ChannelActions';
import { VisitYouTubeButton } from '@/components/VisitYouTubeButton';
import { ReferralSection } from '@/components/ReferralSection';

interface ChannelRow {
  id: string;
  youtubeChannelId: string;
  name: string;
  handle: string | null;
  slug: string;
  avatarUrl: string | null;
  description: string | null;
  verification_status: string;
  referralCode: string | null;
  referredVisits: number;
  categorySlug: string | null;
  countryCode: string | null;
  createdAt: string;
  subscribers: number | null;
  totalViews: number | null;
  videoCount: number | null;
  statsFetchedAt: string | null;
  totalBidCents: number | null;
  currentRank: number | null;
  highestRank: number | null;
  lowestRank: number | null;
  bidCount: number | null;
}

function loadChannel(slug: string) {
  const channel = getChannelBySlug(slug) as ChannelRow | undefined;
  if (!channel) return null;
  const rank = getChannelRank(channel.id);
  const bidHistory = db
    .prepare(
      `SELECT amount_added_cents as amountAddedCents, total_bid_after_cents as totalBidAfterCents,
              rank_after as rankAfter, created_at as createdAt
       FROM bids WHERE channel_id = ? ORDER BY created_at DESC LIMIT 15`
    )
    .all(channel.id) as { amountAddedCents: number; totalBidAfterCents: number; rankAfter: number | null; createdAt: string }[];
  return { channel, rank, bidHistory };
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const data = loadChannel(params.slug);
  if (!data) return { title: 'Channel not found — ytrankwar' };
  const { channel, rank } = data;
  const title = `${channel.name} YouTube Channel Ranking — Current Rank & Profile`;
  const description = `View ${channel.name}'s YouTube channel profile, current leaderboard position${rank ? ` (#${rank.rank})` : ''}, bid history, statistics and ranking history on ytrankwar.`;
  return {
    title,
    description,
    alternates: { canonical: `/channel/${channel.slug}` },
    openGraph: { title, description },
  };
}

export default function ChannelProfilePage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { claim?: string };
}) {
  const data = loadChannel(params.slug);
  if (!data) notFound();
  const { channel, rank, bidHistory } = data;
  const autoOpenBid = searchParams.claim === '1';

  const siteUrl = process.env.SITE_URL || 'https://ytrankwar.example';
  const verificationInfo = getVerificationInfo(
    {
      referralCode: channel.referralCode,
      handle: channel.handle,
      youtubeChannelId: channel.youtubeChannelId,
      slug: channel.slug,
      name: channel.name,
    },
    siteUrl
  );
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    name: `${channel.name} on ytrankwar`,
    url: `${siteUrl}/channel/${channel.slug}`,
    dateCreated: channel.createdAt,
    breadcrumb: {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'ytrankwar', item: siteUrl },
        { '@type': 'ListItem', position: 2, name: channel.name, item: `${siteUrl}/channel/${channel.slug}` },
      ],
    },
    mainEntity: {
      '@type': 'Brand',
      name: channel.name,
      description: channel.description || undefined,
      sameAs: `https://youtube.com/${channel.handle ?? `channel/${channel.youtubeChannelId}`}`,
    },
  };

  return (
    <div className="container" style={{ paddingTop: 32, paddingBottom: 60 }}>
      {/* eslint-disable-next-line react/no-danger */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />

      <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
        <img className="avatar" style={{ width: 72, height: 72 }} src={channel.avatarUrl ?? ''} alt="" />
        <div>
          <h1 style={{ margin: 0 }}>
            {channel.name}
            {channel.verification_status === 'verified' && <span className="badge">Verified</span>}
          </h1>
          <p className="muted" style={{ margin: '4px 0' }}>{channel.handle}</p>
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: 28 }}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Leaderboard status</h3>
          <div className="stat-row"><span className="muted">Current rank</span><span>{rank ? `#${rank.rank}` : '—'}</span></div>
          <div className="stat-row"><span className="muted">Position type</span><span>{(channel.totalBidCents ?? 0) > 0 ? 'Paid' : 'Free listing'}</span></div>
          <div className="stat-row"><span className="muted">Current bid</span><span>{centsToDisplay(channel.totalBidCents ?? 0)}</span></div>
          <div className="stat-row"><span className="muted">Highest rank reached</span><span>{channel.highestRank ? `#${channel.highestRank}` : '—'}</span></div>
          <div className="stat-row"><span className="muted">Number of bids</span><span>{channel.bidCount ?? 0}</span></div>
          <div className="stat-row"><span className="muted">Referred visits</span><span>{channel.referredVisits.toLocaleString()}</span></div>
          <div style={{ marginTop: 16 }}>
            <ChannelActions
              channelId={channel.id}
              channelName={channel.name}
              channelSlug={channel.slug}
              verificationStatus={channel.verification_status}
              autoOpenBid={autoOpenBid}
              verificationPostText={verificationInfo.postText}
              verificationCommunityUrl={verificationInfo.communityUrl}
            />
          </div>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>YouTube statistics</h3>
          <div className="stat-row"><span className="muted">Subscribers</span><span>{(channel.subscribers ?? 0).toLocaleString()}</span></div>
          <div className="stat-row"><span className="muted">Total views</span><span>{(channel.totalViews ?? 0).toLocaleString()}</span></div>
          <div className="stat-row"><span className="muted">Videos</span><span>{(channel.videoCount ?? 0).toLocaleString()}</span></div>
          <div className="stat-row"><span className="muted">Category</span><span>{channel.categorySlug ?? '—'}</span></div>
          <p className="muted small" style={{ marginTop: 14 }}>
            Statistics last synced from the YouTube Data API {channel.statsFetchedAt ? new Date(channel.statsFetchedAt).toLocaleString() : 'recently'}.
          </p>
          <VisitYouTubeButton
            channelId={channel.id}
            handle={channel.handle}
            youtubeChannelId={channel.youtubeChannelId}
          />
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        <ReferralSection
          channelId={channel.id}
          slug={channel.slug}
          postText={verificationInfo.postText}
          communityUrl={verificationInfo.communityUrl}
          referredVisits={channel.referredVisits}
        />
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <h3 style={{ marginTop: 0 }}>Bid history</h3>
        {bidHistory.length === 0 && <p className="muted small">No paid bids yet.</p>}
        {bidHistory.map((b, i) => (
          <div className="stat-row" key={i}>
            <span className="muted">{new Date(b.createdAt).toLocaleDateString()}</span>
            <span>+{centsToDisplay(b.amountAddedCents)} → {centsToDisplay(b.totalBidAfterCents)}{b.rankAfter ? ` (rank #${b.rankAfter})` : ''}</span>
          </div>
        ))}
      </div>

      <p className="muted small" style={{ marginTop: 20 }}>
        This paid leaderboard position is a promotional placement on ytrankwar and does not represent a YouTube
        search ranking, endorsement, or guarantee of views or subscribers. Referred visits are a separate metric
        and never affect paid rank, which is decided by verified bid only.
      </p>
    </div>
  );
}
