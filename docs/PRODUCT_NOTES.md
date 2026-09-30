# ytrankwar — product notes

> Background on how the product behaves (bidding economics, ranking, referrals, verification, YouTube data). Deployment, payments and local setup are covered in the main [README](../README.md), which supersedes anything in these notes about Stripe, SQLite, Durable Objects or running locally.


A working implementation of the core mechanic from the spec: creators submit
a YouTube channel for free, verify ownership, and place paid bids to compete
for position on a public leaderboard — ranked purely by cumulative bid, never
by subscribers or views.

## Bidding economics

- First paid position: **$25 minimum** (`min_bid_cents` in `settings`, default 2500).
- Taking an already-ranked position: the holder's **current total bid + $1**
  (`min_increment_cents` in `settings`, default 100) — not a single cent.
  Both numbers are configurable via the `settings` table without touching
  code. Locked in by a dedicated test:
  `test/bidding.test.ts` → "spec requirement: first paid position costs $25,
  taking an already-ranked position costs +$1 over its current value".

## Every channel is ranked — free and paid alike

Every submitted channel appears on the leaderboard with a real rank, not
just ones that have taken a paid position. Ranking order is:

1. **Highest cumulative bid wins**, as always.
2. **First-come-first-served among ties** — most visibly, every channel
   that has never placed a bid sits at $0 and would otherwise tie with
   every other free channel; whichever was *added* earlier keeps the
   better spot among them. (Paid ties are still broken by whichever
   payment was *confirmed* first, via the `seq` counter described below —
   `created_at` is only reached as a third tiebreak when `seq` itself ties,
   which only happens for channels that have never bid at all.)

`getLeaderboard()` and `getChannelRank()` share one ordering rule
(`total_bid_cents DESC, seq ASC, created_at ASC`) so a channel's own
profile page and its position on the homepage can never disagree. Verified
with dedicated tests in `test/leaderboard.test.ts`, including a live
end-to-end check: two free channels plus one paid channel produce exactly
paid-first, then free-in-creation-order.

Each leaderboard entry also carries `requiredToClaimCents` — the exact
price to overtake that specific row right now ($25 if it's still free,
current total + $1 otherwise) — computed once server-side
(`computeClaimPrice` in `lib/leaderboard-service.ts`) so the homepage's
"claim this rank for $X" links and the actual payment quote can never drift
apart the way they briefly did before (see the bug note further down).

## No header — just a slim live-stats bar at the top

There is no branded nav bar, logo, or "My channels" menu anywhere in this
app anymore (`components/NavBar.tsx` is deleted). In its place,
`components/TopBar.tsx` renders only the live visitor/channel counters
(the same `StatsBar` component from before), pinned to the top of every
page via `position: sticky` so they stay visible while scrolling. The
homepage no longer renders a second copy of these counters inline in the
hero — they exist in exactly one place now, avoiding duplicate presence
pings.

## Homepage leaderboard: real stats, clickable rows, Top N segments

Each row now shows the channel's real (or, without a `YOUTUBE_API_KEY`,
mock-but-consistent) subscriber count, the real click-through count tracked
via `/api/channels/{id}/click`, and how long ago its bid last changed (or
since it was added, if it's still free) — not just name and rank. The
entire row is a clickable/keyboard-focusable link straight to the channel's
own profile page (`role="link"`, `Enter`/`Space` activation); the "Visit"
button and the "claim this rank" link both stop event propagation so they
don't also trigger the row's navigation. A **Top 10 / Top 20 / Top 50**
control sits alongside the category tabs, simply setting the existing
`limit` query param.

## Referral link: public, visible to everyone

There is no login or ownership credential in this app (see "No login"
below), so there's no "owner-only" view to gate this behind. An earlier
revision hid the "share this channel" panel unless the visiting browser held
that channel's `manage_token`; now that the token model has been removed
entirely, `components/ReferralSection.tsx` always renders the panel — the
`referral_code`/link was always meant to be shared publicly anyway.

## No login: fully open, by design

There is no sign-in, no password, no session, and no per-channel credential
anywhere in this app. Submitting a channel (`POST /api/channels`) just
generates a public `referralCode` (safe to share, builds the `/r/{code}`
link described below) — nothing secret is returned or stored.

- **Anyone can bid on any verified channel.** `POST /api/payments/create`
  and `createPayment()` (`lib/bidding-service.ts`) take only a `channelId`;
  the only gate is the channel's own state (verified, not
  suspended/removed) — never who's asking.
- **Anyone can submit ownership-verification proof for any channel.**
  `POST /api/channels/{id}/verify` has no auth check either. The proof
  itself is the real gate: only the actual channel owner can post to that
  channel's own YouTube Community tab, so a valid post URL is
  self-authenticating (see "Ownership verification" below).
- **"My channels" (`lib/local-channels.ts`) is a client-side convenience
  only**, not a credential. It's a `localStorage` list of channels this
  browser has visited or added, used purely so pickers (e.g. "which of your
  channels do you want to bid up?" in `ClaimRankModal.tsx`) can offer a
  shortlist instead of making you look up a channel by slug every time.
  Clearing it, or opening the site on a different device, loses only that
  shortcut — never any access, since there was never any access to lose.

A `users` table still exists in the schema purely so `bids`/`payments` rows
have a stable id to reference for audit continuity — a synthetic row is
auto-created per channel at submission time (`lib/channel-service.ts`) and
is never used for authorization.

**Trade-off, stated plainly:** with no ownership check, anyone can pay to
raise any channel's total (not just its original submitter's) — functionally
closer to "sponsor any channel you like" than "defend your own channel from
rivals." That's an intentional consequence of removing login entirely, not
an oversight; see the "Coming from here" section at the bottom for what
adding real per-channel ownership back would require.

## Referral traffic: the /r/{code} link and its leaderboard

The same public link a channel shares to prove ownership also drives
referred traffic, adapted from the "get my link → copy → post" growth loop
on sites like xme.lol (built for X/Twitter) — here posted to YouTube
Community instead:

- `GET /r/{code}` (`app/r/[code]/route.ts`) is a public, unauthenticated
  redirect: it increments that channel's `referred_visits` counter, then
  sends the visitor on to the channel's profile page.
- `getReferralLeaderboard()` ranks channels by `referred_visits` and is
  surfaced as its own section on the homepage
  (`components/ReferralLeaderboard.tsx`), clearly separate from — and never
  mixed into — the paid leaderboard above it.
- This was a deliberate product decision, not a default: paid bidding stays
  the primary ranking mechanic; referred traffic earns a separate scoreboard
  and bragging rights, never a paid-rank boost.

## Ownership verification: post to YouTube Community

This is now the same link described in "No login" and "Referral traffic"
above — one link serves two purposes (ownership proof and referral
tracking), which is worth restating concretely as a single flow:

1. A unique public code (`YTW-XXXXXXXX`) is generated per channel at
   submission time (`channels.referral_code`) — this is the code embedded
   in `/r/{code}`.
2. The channel's profile page shows suggested post text containing that
   link, a **Copy** button, and a deep link that opens the channel's own
   YouTube Community tab in a new tab. YouTube has no public "compose
   intent" URL like X's `intent/tweet?text=...`, so this is copy-paste
   rather than one click.
3. The owner posts the copied text there, then pastes the post's URL back
   into the verification form — anyone can open this form for any channel
   (there is no login), but only the real owner can produce a URL that
   actually points at a post on that channel's own Community tab, which is
   what the next step checks.
4. The server (`lib/verification-service.ts`) validates the URL is
   plausibly a YouTube community-post link for that channel and records it
   in `channel_ownership_tokens` as an audit trail, then marks the channel
   verified.

**What's real vs. mocked here specifically:** the code generation, the UI
flow, the audit record, and the gate that blocks unverified channels from
bidding are all real and enforced server-side (verified with live requests:
an unverified channel is rejected from `/api/payments/create`, a
non-YouTube URL is rejected from the verify endpoint, a plausible one
succeeds). What's mocked is the actual content check — YouTube doesn't
expose a public API for reading Community posts, so this doesn't fetch the
post and confirm the link is really there. A production version would need
a server-side fetch of the public community-tab page (or Data API access,
if/when YouTube exposes one for this) to close that gap. The "Add & Take a
Position" premium flow still exists as a separate instant-verify shortcut
for users who'd rather skip this step entirely.

## Getting real channel data (logo, subscribers, views, videos)

By default (no `YOUTUBE_API_KEY` set), channel data is deterministic mock
data — the same handle always produces the same fake avatar/numbers, which
is why a freshly-added channel's logo, subscriber count, etc. won't match
the real channel. To get real data:

1. In [Google Cloud Console](https://console.cloud.google.com), create or
   select a project, enable **YouTube Data API v3**, then create an API key
   under Credentials.
2. Set `YOUTUBE_API_KEY=your-key` in `.env.local` (or your deployment's env
   vars) and restart the dev server.
3. Run `npm run check:youtube-key` to verify the key actually works before
   testing in the app — it reads `.env.local` directly and calls the real
   API itself, printing a specific diagnosis (quota exceeded, API not
   enabled, key restricted to HTTP referrers — which never works for
   server-side calls like this, invalid key, etc.) rather than a generic
   failure. **Never paste your actual key into a chat conversation or
   commit it** — this script exists specifically so you never have to share
   it with anyone to debug it.
4. New channel submissions will now fetch the real name, logo, description,
   subscriber/view/video counts, and creation date via `channels.list` (or
   `search.list` as a fallback for custom URLs that don't resolve directly
   — see `lib/youtube.ts`).
5. **Channels added before the key was set/working keep their old mock
   data forever otherwise** — the lookup only happens once, at submission
   time, nothing re-fetches it later. Run `npm run db:refresh-stats` to
   re-fetch real data for every existing channel and update it in place
   (name, handle, avatar, description, subscriber/view/video counts). Bids,
   verification status, and the manage/referral tokens are left untouched.
   The core logic (`scripts/refresh-channel-stats.ts` →
   `refreshAllChannelStats`) is covered by
   `test/refresh-channel-stats.test.ts` with a mocked API response,
   confirming it genuinely replaces every mock field with the fetched one,
   leaves bidding/ownership state alone, and stops early on a quota/key
   error instead of burning through every remaining channel with the same
   failure.

**A separate, unrelated gap this surfaced:** channel *category* (Gaming,
Music, etc.) was never settable from the UI at all — the backend fully
supported it, but `AddChannelForm` never sent it, so every channel's
category was silently `null` and never showed up under any category tab.
This is now fixed with a category dropdown on the add-channel form
(`lib/categories.ts` is the single shared list, used by both the form and
the leaderboard's category tabs so they can't drift out of sync).

I could not test the live YouTube API call from this environment (no
network egress to `googleapis.com` here), so instead I wrote
`test/youtube-real-api.test.ts`, which mocks `fetch` with realistic
`channels.list`/`search.list` response shapes and verifies the parsing,
the handle → id → custom-URL fallback chain, and every error path (quota
exceeded, invalid key, not found, network failure) produces a clear
message rather than a raw exception. That gives confidence the code is
correct, but the final live test with your own key is still worth doing.

## Icons, branding, and crawler/LLM compatibility

- Favicons, apple-touch-icon, and the web app manifest live in `public/` and
  are linked from `app/layout.tsx`; the manifest's theme/background colors
  match the site's dark palette rather than the generator's defaults.
- `/llms.txt` (in `public/`) follows the [llmstxt.org](https://llmstxt.org)
  convention — a plain-language summary of what the site is, how bidding
  works, which API endpoints are safe to call read-only, and which mutate
  state and require a real user's intent.
- `app/robots.ts` and `app/sitemap.ts` are Next.js metadata routes that
  generate `/robots.txt` and `/sitemap.xml`. The sitemap is marked
  `force-dynamic` deliberately — an early version used the default static
  rendering and silently froze the channel list at build time, so newly
  added channels would never have appeared in it.
- Both the homepage and each channel profile page emit JSON-LD structured
  data (`Organization`/`WebSite` and `ProfilePage`/`Brand` respectively) so
  search engines and LLM crawlers get machine-readable context, not just
  prose.

While wiring this in, two pre-existing bugs surfaced and got fixed:
`getChannelBySlug` used `SELECT c.*`, which returns snake_case columns
(`category_slug`, `created_at`, ...) while the page read camelCase
(`categorySlug`) — so a channel's category silently always rendered as "—".
And the profile page's "Visit YouTube" button linked to
`youtube.com/channel/{internal-db-id}` instead of the real handle/YouTube
channel id, so it never actually pointed at the right channel. Both are
fixed and covered by the smoke tests in this session's history.

## Homepage features added since the first pass

- **Live visitor count** — a pulsing "N online now" pill. Each browser tab
  gets an anonymous session id (sessionStorage) and pings
  `/api/presence/ping` every 20s; `/api/stats` counts sessions seen in the
  last 60 seconds. This is a single-instance SQL-table approximation of
  presence, not real-time infra — fine for a demo, but a production
  deployment at real scale would want Durable Objects or a KV counter
  instead (noted in `db/schema.sql`).
- **Total channels added count** — a simple `count(*)` on `channels`,
  served from the same `/api/stats` endpoint.
- **"Add & Take a Position"** — a second, gold-styled button next to the
  free "Add Channel" button. Listing is free either way; this path just
  auto-verifies the channel (demo-only shortcut — see
  `app/api/channels/route.ts`) and redirects straight into the bid modal so
  a creator can go from "never listed" to "bidding for a rank" in one flow,
  instead of add → find profile page → click verify → click bid.

## A bug worth knowing about (fixed, but instructive)

`requiredTotalForRank()` originally returned `0 + $1 increment` for an empty
rank slot (e.g. an empty leaderboard's #1), which meant the homepage's
"Claim #1" card briefly displayed **$1.00** as the price to take the top
spot instead of the real **$25.00** minimum — a display-only bug (the actual
payment path already enforced the $25 floor via `quoteAdditionalForTarget`),
but a misleading one on the site's most prominent button. Fixed to return
`minBidCents()` for any empty rank, with a dedicated regression test
(`test/bidding.test.ts` → "required total for an empty rank is the real $25
minimum, not $0 or $1") and a new `GET /api/bids/next-price?rank=N` endpoint
so display-only UI never has to duplicate this logic itself.

## Why the bidding engine is the priority

This is the one piece where getting it wrong loses real money or produces an
unfair leaderboard, so it got the most attention:

- **Money is stored as integer cents everywhere** — no floating point.
- **`bids` is an append-only ledger.** `listings.total_bid_cents` is a cache
  that must always equal `SUM(bids.amount_added_cents)` for that channel —
  never written from anywhere except `confirmPayment`.
- **Rank is always derived live** from `total_bid_cents`, ordered by amount
  then by a strictly-increasing `seq` counter (not wall-clock time, which can
  tie at millisecond resolution during a real race — this was caught by the
  test suite, see below).
- **`confirmPayment` is the only place a bid is ever applied**, and it's
  atomic + idempotent: a duplicated webhook delivery (which payment providers explicitly
  says can happen) is a safe no-op, verified by a test.
- **Nothing about price or rank is trusted from the client.** The quote shown
  before checkout is advisory; the real total is re-read from the database
  inside the transaction at confirmation time.
- **There is no ownership check on bidding at all.** Any verified channel
  can be bid on by anyone — the server never checks who's asking, only that
  the target channel itself is verified and not suspended/removed
  (`assertChannelEligible` in `lib/bidding-service.ts`). See "No login"
  above for what that trades away.

Run `npm test` to see this exercised directly, including a simulated race
where two bidders check out against the same stale "current #1" price at
once.

## Troubleshooting

**Getting a 500 on API routes after pulling a newer version of this project?**
This demo has no real migration system — `db/schema.sql` uses
`CREATE TABLE IF NOT EXISTS` everywhere, so if you already had a
`data/app.db` file from an older version, re-applying a newer schema over it
does nothing to add columns/tables that version didn't have yet. `db/index.ts`
now fails loudly with a clear message and the exact fix when this happens,
but the short version is:

```bash
rm -f data/app.db data/app.db-wal data/app.db-shm
```

Then restart. This is a local data-file problem, not a sign that the
frontend+backend-in-one-app architecture is broken — a separate backend
using the same SQLite file would hit the identical error, since the cause is
schema drift, not process layout.

## What's intentionally out of scope here

Legal page copy, full moderation workflows, notification emails, and the
dozens of SEO landing pages from the spec are not built — they're UI/content
work that doesn't depend on the hard engineering problem this prototype
focuses on, and are better written with real legal review and real brand
copy rather than placeholder text.
