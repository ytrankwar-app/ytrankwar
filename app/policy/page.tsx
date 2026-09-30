import type { Metadata } from 'next';
import Link from 'next/link';
import { CONTACT_EMAIL } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Policy',
  description: 'ytrankwar privacy policy, terms of service, refund policy and content policy in one place.',
  alternates: { canonical: '/policy' },
  openGraph: { title: 'Policy · ytrankwar', description: 'Privacy, terms, refunds and content policy.', url: '/policy' },
};

const UPDATED = 'September 30, 2026';

export default function PolicyPage() {
  return (
    <div className="container prose-page">
      <h1>Policy</h1>
      <p className="muted">Last updated: {UPDATED}</p>
      <p>
        This single page covers how ytrankwar handles your data, the terms for using the service, payments and
        refunds, and what content is allowed. Contact: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
      <nav className="policy-toc" aria-label="On this page">
        <a href="#privacy">Privacy</a> · <a href="#cookies">Cookies &amp; storage</a> · <a href="#terms">Terms</a> ·{' '}
        <a href="#payments">Payments &amp; refunds</a> · <a href="#content">Content</a> ·{' '}
        <a href="#disclaimer">Disclaimer</a> · <a href="#contact">Contact</a>
      </nav>

      <h2 id="privacy">Privacy policy</h2>
      <p>ytrankwar has no accounts or logins. This is what we handle:</p>
      <ul>
        <li>
          <strong>Channel information you submit.</strong> The YouTube channel link you add, plus the public data we
          fetch for it from YouTube (name, handle, avatar, description, subscriber, view and video counts). This is
          shown publicly on the leaderboard and on the channel&apos;s page.
        </li>
        <li>
          <strong>Verification proof.</strong> The link to the YouTube Community post you submit to prove ownership.
        </li>
        <li>
          <strong>Payment records.</strong> The amount, status and the payment reference from Dodo Payments. Your card
          and billing details are entered on Dodo Payments&apos; hosted checkout and are never seen or stored by us.
        </li>
        <li>
          <strong>Aggregate analytics.</strong> Counters for profile views, &ldquo;Visit&rdquo; clicks and referral
          visits. These are totals per channel, not logs of individual people.
        </li>
        <li>
          <strong>Live visitor count.</strong> A random anonymous session ID that expires within an hour, used only to
          show how many people are on the site.
        </li>
        <li>
          <strong>Technical logs.</strong> Our hosting provider, Cloudflare, processes IP addresses and request data to
          deliver and protect the site.
        </li>
      </ul>
      <p>
        We do not sell your data and we do not run advertising trackers. Data is shared only with the service providers
        needed to run the site: Cloudflare (hosting and database), Dodo Payments (payments) and YouTube (channel data).
        To have a channel removed from the site or to ask about data we hold, email{' '}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. Payment records may be kept as required for accounting
        and fraud prevention.
      </p>

      <h2 id="cookies">Cookies &amp; local storage</h2>
      <p>
        We do not use tracking or advertising cookies. Your browser stores a shortlist of the channels you added on
        this device (local storage) and an anonymous session ID (session storage). You can clear both at any time in
        your browser settings. Dodo Payments may set its own cookies on its checkout page.
      </p>

      <h2 id="terms">Terms of service</h2>
      <ul>
        <li>You must be at least 18, or the age of majority where you live, to make a payment.</li>
        <li>You may only list and bid for a channel you own or have permission to promote.</li>
        <li>
          Rank is decided by total paid bid as described on the <Link href="/rules">Rules</Link> page. Positions are
          not permanent and can be lost to a higher bid at any time.
        </li>
        <li>You must not abuse the service: no automation, scraping that harms the site, fake traffic, or attempts to interfere with payments or rankings.</li>
        <li>We may suspend or remove any channel, and change or discontinue the service, at any time.</li>
        <li>The service is provided &ldquo;as is&rdquo;, without warranties. To the extent the law allows, our liability is limited to the amount you paid for the affected bid.</li>
      </ul>

      <h2 id="payments">Payments &amp; refunds</h2>
      <p>
        Payments are processed by Dodo Payments in the currency and with the taxes shown at checkout. Your bid is
        applied to your channel&apos;s total after the payment is confirmed. <strong>All payments are final and
        non-refundable</strong>, including when you are outbid or when a channel is removed for breaking the rules.
      </p>
      <p>
        Exceptions: if you were charged but the bid was not applied because of an error on our side, or you were
        charged more than once for the same bid, email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> with your
        payment ID and we will correct it or refund you. Nothing in this policy limits rights you have under the law
        where you live.
      </p>

      <h2 id="content">Content policy</h2>
      <p>
        Only real YouTube channels may be listed. We remove channels that are illegal, sexually explicit involving
        minors, promote violence or hate, impersonate others, infringe others&apos; rights, or break YouTube&apos;s
        Terms of Service. Anyone can report a listing by email and we will review it.
      </p>

      <h2 id="disclaimer">Disclaimer</h2>
      <p>
        ytrankwar is an independent product. It is not affiliated with, sponsored by or endorsed by YouTube, Google or
        Dodo Payments. YouTube and Google are trademarks of their respective owners. A position on ytrankwar is a
        promotional placement — it is not a YouTube search ranking and does not guarantee views, subscribers or income.
      </p>

      <h2 id="contact">Contact</h2>
      <p>
        Email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> for support, refunds, removals, privacy requests
        or any question about this policy.
      </p>
    </div>
  );
}
