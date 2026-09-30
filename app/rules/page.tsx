import type { Metadata } from 'next';
import Link from 'next/link';
import { CONTACT_EMAIL } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Rules',
  description: 'How the ytrankwar leaderboard works: bids, ranks, ties, verification, referrals and payments.',
  alternates: { canonical: '/rules' },
  openGraph: { title: 'Rules · ytrankwar', description: 'How the ytrankwar leaderboard works.', url: '/rules' },
};

export default function RulesPage() {
  return (
    <div className="container prose-page">
      <h1>Rules</h1>

      <h2>We <strong>DON&apos;T</strong> sell views or subscribers</h2>
      <p>
        You pay for a position on this leaderboard and nothing else. We never sell views, subscribers or watch time,
        and we don&apos;t promise any number of visits to your channel. Real people look at the board and decide which
        channels to open.
      </p>

      <h2>Listing is free</h2>
      <p>
        Anyone can add a YouTube channel for free. A free listing shows up on the board below every paid channel.
      </p>

      <h2>Your total bid decides the rank</h2>
      <p>
        The leaderboard sorts channels by the total amount paid. Pay more than #1 to take #1. Pay less and you get
        whatever place that total can take. On a tie, the channel that reached the total first wins.
      </p>

      <h2>Bids add up</h2>
      <p>
        Every payment adds to your channel&apos;s total. Got outbid? Open your channel and top up the difference to
        climb back. You never start from zero. To take a position from another channel you need to beat its total by at
        least <strong>$1</strong>.
      </p>

      <h2>Minimum first bid $25, no refunds</h2>
      <p>
        A channel&apos;s first paid bid is at least <strong>$25</strong>. After that, a top-up can be any amount your
        chosen rank requires (never less than $1). All payments are final. There are no refunds, including when
        someone outbids you. If you were charged but your bid was not applied because of a fault on our side, email us
        and we will fix it or refund you.
      </p>

      <h2>Verify your channel to bid</h2>
      <p>
        To place a paid bid you first prove the channel is yours by posting your referral link on the channel&apos;s
        YouTube Community tab and submitting the post link. You can only list a channel you own or have permission to
        promote.
      </p>

      <h2>Channel data</h2>
      <p>
        A channel&apos;s name, avatar and statistics come from public YouTube data and are refreshed regularly. Statistics
        are informational and never affect paid rank.
      </p>

      <h2>Clicks</h2>
      <p>
        When someone uses a channel&apos;s &ldquo;Visit&rdquo; button we count it. We keep a total per channel only, with
        no per-click history.
      </p>

      <h2>Referral race</h2>
      <p>
        Every channel gets a personal referral link. The referral board ranks channels by the visits that link brings.
        It is a separate ranking that never changes paid rank, and we may remove counts that look automated.
      </p>

      <h2>Payments</h2>
      <p>
        Payments are handled by <strong>Dodo Payments</strong> on their secure hosted checkout. We never see or store
        your card details. Your bid is applied once Dodo confirms the payment, usually within seconds.
      </p>

      <h2>No guarantees</h2>
      <p>
        A bid buys a position on the leaderboard, not a permanent one. Anyone can outbid you at any time, and your rank
        drops without notice or refund. A position here is not a YouTube search ranking and does not guarantee views or
        subscribers.
      </p>

      <h2>Removals</h2>
      <p>
        We remove or suspend channels that are illegal, impersonate someone, contain content that breaks YouTube&apos;s
        rules, or abuse the service. There is no refund when that happens.
      </p>

      <h2>No affiliation</h2>
      <p>
        ytrankwar is not affiliated with, sponsored by or endorsed by YouTube, Google or Dodo Payments.
      </p>

      <p className="muted">
        Questions? Email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. See also our{' '}
        <Link href="/policy">Policy</Link> page.
      </p>
    </div>
  );
}
