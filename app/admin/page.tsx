import { db } from '@/db';
import { centsToDisplay } from '@/lib/money';

export default function AdminPage() {
  const totals = db
    .prepare(
      `SELECT
         (SELECT count(*) FROM users) as totalUsers,
         (SELECT count(*) FROM channels) as totalChannels,
         (SELECT count(*) FROM channels WHERE verification_status = 'verified') as verifiedChannels,
         (SELECT count(*) FROM listings WHERE total_bid_cents > 0) as paidChannels,
         (SELECT count(*) FROM bids) as totalBids,
         (SELECT COALESCE(SUM(amount_cents),0) FROM payments WHERE status = 'paid') as totalRevenueCents`
    )
    .get() as {
    totalUsers: number;
    totalChannels: number;
    verifiedChannels: number;
    paidChannels: number;
    totalBids: number;
    totalRevenueCents: number;
  };

  const topChannel = db
    .prepare(
      `SELECT c.name, l.total_bid_cents as totalBidCents FROM listings l
       JOIN channels c ON c.id = l.channel_id
       ORDER BY l.total_bid_cents DESC LIMIT 1`
    )
    .get() as { name: string; totalBidCents: number } | undefined;

  const channels = db
    .prepare(
      `SELECT c.id, c.name, c.verification_status as verificationStatus, c.moderation_status as moderationStatus,
              l.total_bid_cents as totalBidCents, l.current_rank as currentRank
       FROM channels c LEFT JOIN listings l ON l.channel_id = c.id
       ORDER BY c.created_at DESC LIMIT 100`
    )
    .all() as { id: string; name: string; verificationStatus: string; moderationStatus: string; totalBidCents: number; currentRank: number | null }[];

  const reports = db.prepare(`SELECT count(*) as n FROM reports WHERE status = 'pending'`).get() as { n: number };

  return (
    <div className="container" style={{ paddingTop: 32, paddingBottom: 60 }}>
      <h1>Admin</h1>
      <p className="muted small">
        Demo admin panel — in production this route must be gated by an admin-role check on the server, never the
        client.
      </p>

      <div className="grid-2" style={{ marginBottom: 20 }}>
        <div className="card">
          <div className="stat-row"><span className="muted">Total users</span><span>{totals.totalUsers}</span></div>
          <div className="stat-row"><span className="muted">Total channels</span><span>{totals.totalChannels}</span></div>
          <div className="stat-row"><span className="muted">Verified channels</span><span>{totals.verifiedChannels}</span></div>
          <div className="stat-row"><span className="muted">Paid channels</span><span>{totals.paidChannels}</span></div>
        </div>
        <div className="card">
          <div className="stat-row"><span className="muted">Total bids placed</span><span>{totals.totalBids}</span></div>
          <div className="stat-row"><span className="muted">Total revenue</span><span>{centsToDisplay(totals.totalRevenueCents)}</span></div>
          <div className="stat-row"><span className="muted">Current #1</span><span>{topChannel ? `${topChannel.name} (${centsToDisplay(topChannel.totalBidCents)})` : '—'}</span></div>
          <div className="stat-row"><span className="muted">Pending reports</span><span>{reports.n}</span></div>
        </div>
      </div>

      <h2>Channels</h2>
      {channels.map((c) => (
        <div className="stat-row" key={c.id}>
          <span>{c.name} <span className="badge badge-muted">{c.verificationStatus}</span> <span className="badge badge-muted">{c.moderationStatus}</span></span>
          <span>{c.currentRank ? `#${c.currentRank}` : '—'} · {centsToDisplay(c.totalBidCents ?? 0)}</span>
        </div>
      ))}
    </div>
  );
}
