import { AddChannelForm } from '@/components/AddChannelForm';
import { ClaimTopCard } from '@/components/ClaimTopCard';
import { Leaderboard } from '@/components/Leaderboard';
import { ReferralLeaderboard } from '@/components/ReferralLeaderboard';

export default function HomePage() {
  return (
    <>
      <section className="hero">
        <h1>THE YOUTUBE CHANNEL RANK WAR</h1>
        <p>Add your channel for free. Claim a position. Outbid competitors. Get discovered.</p>
        <AddChannelForm />
        <div className="trust-line">Free to list · Transparent bidding · Real-time rankings</div>
      </section>

      <div className="section-gap">
        <ClaimTopCard />
      </div>
      <div className="section-gap">
        <Leaderboard />
      </div>
      <div className="section-gap">
        <ReferralLeaderboard />
      </div>

      <section className="container" style={{ marginTop: 48, marginBottom: 48 }}>
        <p className="muted small" style={{ textAlign: 'center' }}>
          Paid positions are promotional placements on ytrankwar only — not YouTube search rankings, endorsements,
          or guarantees of views or subscribers.
        </p>
      </section>
    </>
  );
}
