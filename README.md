# ytrankwar — YouTube Channel Rank War (working prototype)

A working implementation of the core mechanic from the spec: creators submit
a YouTube channel for free, verify ownership, and place paid bids to compete
for position on a public leaderboard — ranked purely by cumulative bid, never
by subscribers or views.

## What's real vs. mocked

This is a genuine full-stack app you can run and click through end-to-end —
not a static mockup. But building the *entire* spec (real Stripe billing,
real YouTube Data API access, live Cloudflare D1/Workers deployment, OAuth,
dozens of SEO landing pages, full admin moderation tooling) is weeks of work
requiring real credentials and infrastructure this environment doesn't have.
Given that, effort went into making the **hard part** — the bidding and
ranking engine — fully real and tested, while integrations that need
external accounts are cleanly mocked behind the same interface a real
integration would use.

| Piece | Status |
|---|---|
| Bidding engine (`lib/bidding-service.ts`) | **Real.** Atomic, idempotent, race-safe. See tests. |
| Ranking (`lib/leaderboard-service.ts`) | **Real.** Rank always derived live from bid totals, never trusted from a cache. |
| Database schema (`db/schema.sql`) | **Real.** SQLite, directly D1-compatible. |
| Channel submission & profile pages | **Real.** SEO metadata, bid/rank history, category tabs. |
| Public homepage only — no admin panel or dashboard | **Intentional.** Verification and bid management happen on the channel's own profile page instead. |
| YouTube Data API (`lib/youtube.ts`) | **Real, opt-in.** Set `YOUTUBE_API_KEY` and channel name, logo, subscriber/view/video counts, and creation date come from the real `channels.list`/`search.list` endpoints. Without a key, falls back to deterministic mock data automatically so the app still works out of the box. Parsing/fallback/error-handling logic is covered by tests with a mocked `fetch` (`test/youtube-real-api.test.ts`) — a live call was not possible to test from this environment (no network egress to googleapis.com here), so test it with your own key before relying on it. |
| Payments (`app/api/payments/*`) | **Mocked.** A "Simulate payment" button stands in for Stripe Checkout; the webhook handler is written exactly like a real Stripe webhook (idempotent, re-validates server-side) so swapping in real Stripe is additive, not a rewrite. |
| No login (`lib/manage-auth.ts`) | **Real, by design.** There is no sign-in anywhere in this app. Pasting a channel link generates a secret `manage_token` ("magic link" model, like a password-reset link) that's the only credential authorizing bidding/verification on that channel. See "No login" below. |
| Ownership verification (`lib/verification-service.ts`) | **Real flow, mocked check.** Owner shares a generated public link on their channel's YouTube Community tab and submits the post URL back — this is genuinely Method B from the spec, not a placeholder button. What's mocked: without YouTube API access, the server checks the URL is *structurally* a plausible community-post link rather than fetching and confirming the link actually appears in the post. See the section below. |
| Referral leaderboard (`getReferralLeaderboard` in `lib/leaderboard-service.ts`) | **Real, and deliberately separate.** Visits via a channel's shared `/r/{code}` link feed a second, clearly-labeled scoreboard. This never touches or influences `total_bid_cents` or paid rank — the spec is explicit that paid rank reflects verified bid only. |
| Cloudflare D1 schema & BidCoordinator Durable Object | **Real, independently verified.** The D1 migration and the money-critical bid-confirmation Durable Object both actually run and were tested against a real local Cloudflare Workers + D1 + Durable Objects runtime — see "Cloudflare D1 + Durable Objects" below. |
| Cloudflare hosting for the app itself | **Not done.** The Next.js app still runs on Node against `better-sqlite3`, not on Workers against D1 — see the same section for exactly what's left. |

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

## Referral link: owner-only, by explicit product decision

This has flip-flopped once and it's worth documenting why, rather than
leaving only the current state: an earlier revision made the "share this
channel" panel visible to every visitor (the `referral_code`/link itself
was never actually secret — only `manage_token` is — so showing it publicly
wasn't a *security* problem). That was then explicitly reverted: channel
privacy takes priority here, so `components/ReferralSection.tsx` now hides
the entire panel — both the share link and the "show my management link"
reveal beneath it — unless the visiting browser holds that specific
channel's real `manage_token`. Nobody but the channel's own creator can see
or copy either link from its profile page.

## No login: the manage_token model

There is no sign-in, no password, no session anywhere in this app — pasting
a YouTube channel link is the entire "account creation" step:

1. Submitting a channel (`POST /api/channels`) generates two distinct
   tokens, returned exactly once:
   - `manageToken` — **secret**. Whoever holds it can bid on and verify that
     channel. The browser saves it to `localStorage`
     (`lib/local-channels.ts`) automatically; it is never shown again by the
     server after this response, the same trust model as a password-reset
     link.
   - `referralCode` — **public**, safe to share. Builds the `/r/{code}` link
     described below.
2. Every management request (bid, verify) includes the `manageToken` in its
   body. The server checks it against `channels.manage_token`
   (`lib/manage-auth.ts`) — that check *is* the entire authorization model.
   No user table lookup, no cookie, no session.
3. To use a saved channel from a different browser or after clearing
   storage, visiting `/channel/{slug}?manage={token}` (shown as a
   reveal-to-view "management link" on the channel's own page) restores
   access — `components/ManageTokenCapture.tsx` saves it back into that
   browser's `localStorage` and strips it from the visible URL.

This is intentionally channel-scoped, not person-scoped: there's no concept
of "a user" who owns several channels beyond "a browser holding several
tokens." A `users` table still exists in the schema purely so
`bids`/`payments` rows have a stable id to reference for audit continuity —
a synthetic row is auto-created per channel at submission time
(`lib/channel-service.ts`) and is never used for authorization.

**Trade-off, stated plainly:** anyone who obtains a `manage_token` controls
that channel, and losing it (clearing browser storage, without having saved
the manage link elsewhere) means losing access with no recovery path — there
is no "forgot password" flow, because there's no password. This is the same
trade-off as any bookmarklet/magic-link tool; it was chosen deliberately over
accounts, not overlooked.

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
above — one link serves three purposes (management access via the token
that generated it, ownership proof, and referral tracking), which is worth
restating concretely as a single flow:

1. A unique public code (`YTW-XXXXXXXX`) is generated per channel at
   submission time (`channels.referral_code`) — this is the code embedded
   in `/r/{code}`.
2. The channel's profile page shows suggested post text containing that
   link, a **Copy** button, and a deep link that opens the channel's own
   YouTube Community tab in a new tab. YouTube has no public "compose
   intent" URL like X's `intent/tweet?text=...`, so this is copy-paste
   rather than one click.
3. The owner posts the copied text there, then pastes the post's URL back
   into the verification form (this step needs the `manageToken` from
   "No login" above — only the browser holding it can submit proof).
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

## Node.js version note (Windows especially)

`better-sqlite3` is pinned to **v13.x**. Earlier drafts of this project used
v11.x, which does not ship a prebuilt native binary for Node 24 — on Windows
in particular, that surfaced as every API route failing with `Error: Could
not locate the bindings file` the moment it first touched the database
(the dev server itself would start and say "Ready" fine, since the native
module only loads on first use). v13 moved to N-API, which ships prebuilt
binaries directly in the package for all major platforms/architectures
without needing per-Node-version downloads — this should no longer happen
on any currently supported Node version. If you ever see that error again
after `npm install`, run `npm rebuild better-sqlite3` first before assuming
anything else is wrong.

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
  atomic + idempotent: a duplicated webhook delivery (which Stripe explicitly
  says can happen) is a safe no-op, verified by a test.
- **Nothing about price or rank is trusted from the client.** The quote shown
  before checkout is advisory; the real total is re-read from the database
  inside the transaction at confirmation time.
- **Only a channel's `manage_token` holder can bid on it.** Bidding always
  raises YOUR channel's position — the server checks the submitted
  `manageToken` against `channels.manage_token` on payment creation
  (`lib/manage-auth.ts`), independent of what the UI happens to show. There
  is no session to check at confirmation time; see "No login" above for why
  that's a deliberate design, not a gap.

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

## Running it locally

```bash
npm install
npm run db:seed   # optional: adds demo channels/bids, clearly marked as fake
npm run dev        # http://localhost:3000
```

There is no sign-in. Paste a channel link on the homepage, then verify it
from its profile page by posting the generated link to your channel's
YouTube Community tab and pasting the post URL back (see "Ownership
verification" above) — or use the gold **Add & Take a Position** button on
the homepage instead, which auto-verifies and skips straight to bidding.
Either way, once verified:

- hit **Claim #1** at the top of the homepage to bid one of your channels
  into the top spot, or
- hit **Outbid** on any row to bid one of your channels above that specific
  one.

Either way you'll pick which of your own verified channels to use, see a
quote, then simulate the payment (a "Simulate payment" button stands in for
Stripe Checkout).

Only the public homepage and channel profile pages exist — there is no
admin panel or user dashboard in this build; channel verification and
bid management both live on the channel's own profile page.

`npm run build && npm start` runs the production Next.js build.
`npm test` runs the bidding/ranking/validation/ownership test suite (`node:test` via `tsx`).

## Cloudflare D1 + Durable Objects: what's built, and what's proven

This section documents real, working infrastructure — not a sketch. It was
built and verified against a real local Cloudflare Workers + D1 + Durable
Objects runtime (via Wrangler's local emulation, which needs no Cloudflare
account or network access), not just written to match documentation.

### The database schema (done)

`migrations/0001_initial.sql` is the exact same schema as `db/schema.sql`,
adapted for D1's migration format (D1 enables foreign keys by default, so
the `PRAGMA foreign_keys = ON` line is removed — D1 migration files don't
use PRAGMA statements). Verified by actually running
`wrangler d1 migrations apply --local` against it: all 33 statements
executed successfully and created all 17 tables. Apply it to a real
database with:

```bash
wrangler d1 create ytrankwar-db   # prints a database_id — put it in wrangler.toml
npm run d1:migrate:local           # or d1:migrate:remote for the real thing
```

### The bidding engine's money-critical path (done — and here's why it needed a redesign, not just a driver swap)

**Cloudflare D1 has no interactive SQL transactions** (no `BEGIN`/`COMMIT`
spanning a JS read, then a computed write). It only offers `.batch()` — a
*pre-built array* of statements, which can't branch on a value read moments
earlier. The existing `confirmPayment` (in `lib/bidding-service.ts`) does
exactly that: read the current total, compute a new one, write it, wrapped
in `better-sqlite3`'s synchronous transaction — the core protection against
two concurrent payments corrupting each other. That pattern has no direct
D1 equivalent.

The natural next idea — "run it inside a Durable Object, since a DO handles
one request at a time" — is a real fix, but only if done correctly.
**A Durable Object's automatic serialization ("input gate") only protects
its own `ctx.storage` calls. Awaiting external I/O — including a D1
query — releases that gate**, letting a second concurrent call interleave
its own read before the first call's write completes. A naive
`async confirmPayment()` inside a DO that queries D1 would silently
reintroduce the identical race condition, just relocated. This is
documented Cloudflare behavior, but rather than trust that and move on, it
was verified empirically:

```bash
sh workers/verify-concurrency-proof.sh
```

This script (fully automated, no account/network needed) spins up a real
local Durable Object + D1 pair via `wrangler dev`, fires 10 truly
concurrent increments at a naive version, and at a version wrapped in
`blockConcurrencyWhile()`. Result: **the naive version loses 9 of 10
updates** (final value: 1, not 10) — proving the race is real, not
hypothetical — **and the protected version loses none** (final value:
exactly 10). `workers/race-proof.mjs` is the toy worker used for this;
`workers/bid-coordinator.ts` is the real one, built on the same proven
pattern.

**`workers/bid-coordinator.ts`** is a `BidCoordinator` Durable Object, one
instance per channel (`env.BID_COORDINATOR.idFromName(channelId)`), whose
`confirmPayment()` method mirrors `lib/bidding-service.ts`'s logic exactly
— idempotency check, re-validate the channel's eligibility, read the
current total, compute the new one, write via `db.batch()` — all inside
`blockConcurrencyWhile()`. Business-logic rejections (unverified channel,
suspended, etc.) are caught *inside* that callback and returned as a normal
result; only a genuinely unexpected error is allowed to propagate out
(which intentionally tears down and resets that Durable Object instance —
correct for a real failure, far too destructive for an expected rejection).
Different channels get different DO instances, so one channel's bid
processing never blocks another's.

This was tested against the *actual* logic, not a toy example: a real
verified channel, two real pending payments ($50.00 and $30.00), confirmed
at the exact same instant. Result: both applied correctly, final total
exactly $80.00 (`5000 + 3000` cents), `bid_count = 2`, both bid ledger rows
present — no money lost. A duplicate confirmation of an already-paid
payment correctly returned `applied: false` without re-adding another
$50.00. Global, cross-channel bookkeeping (rank cache rebuild, rank
history) deliberately stays *outside* this DO — it's cache-only,
eventually-consistent by design, and touches every channel, so it has no
business being serialized behind any single channel's coordinator.

Durable Objects require at least the **Workers Paid plan ($5/mo)** — worth
knowing before committing to this architecture.

`workers/tsconfig.json` type-checks this code separately from the Next.js
app (`npm run workers:typecheck`), because Workers-runtime types
(`D1Database`, `DurableObject`, etc.) would collide with the DOM/Node types
the rest of the app uses. `workers/bid-coordinator.ts` deliberately
duplicates the tiny, dependency-free `BiddingError` class rather than
importing it from `lib/bidding-service.ts` — that file's other imports
(`@/db`) load `better-sqlite3`, a native Node addon that cannot run in the
Workers runtime, and nothing here verifies a bundler would tree-shake that
half away.

### What's NOT done yet — the app doesn't run on Cloudflare end-to-end

The pieces above are real and independently verified, but the Next.js app
itself still runs on Node (`next start`) against a local `better-sqlite3`
file, not against D1. Wiring them together is the remaining work:

1. **Hosting**: build with [OpenNext's Cloudflare
   adapter](https://opennext.js.org/cloudflare) instead of `next start`, so
   Next.js server code can reach `env.DB` and `env.BID_COORDINATOR` via
   `getCloudflareContext()`.
2. **The rest of the data layer**: every other function in `lib/*.ts`
   (`leaderboard-service.ts`, `channel-service.ts`, `verification-service.ts`,
   `manage-auth.ts`, `settings.ts`, `presence-service.ts`) is still
   synchronous `better-sqlite3` code and needs converting to async D1
   queries. None of these have D1's transaction limitation as a concern —
   they're ordinary reads and independent writes — so this is a more
   mechanical (if large) conversion than the bidding engine was, but it
   hasn't been done, and doing it while also preserving today's
   zero-Cloudflare-account local dev experience (`npm run dev`, `npm test`)
   is a real design question worth its own focused pass rather than rushing
   both at once.
3. **Wiring `app/api/payments/webhook/route.ts`** to call
   `env.BID_COORDINATOR.idFromName(channelId).get().confirmPayment(...)`
   instead of the local `confirmPayment()` — straightforward once (1) and
   (2) exist.
4. **YouTube**: the real `channels.list`/`search.list` integration already
   exists (`lib/youtube.ts`, opt-in via `YOUTUBE_API_KEY`) — what's left for
   production scale is moving `channel_stats` refresh to the Cron Trigger
   already declared in `wrangler.toml`, so it's never called on a live page
   view, and monitoring quota usage (a direct lookup costs 1 unit of the
   10,000/day free tier; the custom-URL fallback search costs 100).
5. **Payments**: replace `app/api/payments/create` with a real Stripe
   Checkout Session creation call, and `app/api/payments/webhook` with
   `stripe.webhooks.constructEvent` signature verification before calling
   into the Durable Object.
6. **Optional accounts on top of the token model**: this app deliberately
   has no login (see "No login" above) — `manage_token` possession is the
   entire authorization model, and that can stay true in production too.
   If real user accounts are ever wanted (e.g. so someone can see all their
   channels without local storage), add them as an *additional* layer that
   maps a real identity to the `manage_token`s it has created, rather than
   replacing the token check in `lib/manage-auth.ts`. Google OAuth login
   can double as YouTube ownership Method A if added.
7. **Everything not built yet** per the original spec — country/category
   SEO landing pages beyond the tabs already on the homepage, battle pages,
   moderation queue UI, and email notifications — can be layered on top of
   the existing schema and services without touching the bidding engine.
   (Sitemap and robots generation are already built — see
   `app/sitemap.ts` / `app/robots.ts`.)

## What's intentionally out of scope here

Legal page copy, full moderation workflows, notification emails, and the
dozens of SEO landing pages from the spec are not built — they're UI/content
work that doesn't depend on the hard engineering problem this prototype
focuses on, and are better written with real legal review and real brand
copy rather than placeholder text.
