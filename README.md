# ytrankwar

The YouTube channel rank war: list a channel for free, then pay to climb the leaderboard. Ranked purely by
total paid bid.

**Stack:** Next.js 14 (App Router) on **Cloudflare Workers** via [OpenNext](https://opennext.js.org/cloudflare),
**Cloudflare D1** (SQLite) for data, **Dodo Payments** for checkout. Contact / support email:
`ytrankwar@gmail.com`.

There is **one code path** for everything. `npm run dev`, `npm run cf:preview` and production all read and write
D1 through the same `db/` layer, so what works locally is what runs on the main domain.

> Product behaviour (bidding economics, ranking, referrals, verification, YouTube data) is documented in
> [docs/PRODUCT_NOTES.md](docs/PRODUCT_NOTES.md).

---

## Pages

| Route | What it is |
| --- | --- |
| `/` | Leaderboard |
| `/channel/[slug]` | Channel profile, bid history, verification, referral link |
| `/rules` | Rules (how bids, ranks, ties, verification, referrals and payments work) |
| `/policy` | One page with Privacy, Cookies, Terms, Payments & refunds, Content policy, Disclaimer, Contact |
| `/payment/return` | Where Dodo sends the customer back; shows the payment status |
| `/robots.txt`, `/sitemap.xml` | Generated per request from the domain being served; the sitemap lists every approved channel |
| 404 / 500 | `app/not-found.tsx`, `app/error.tsx`, and `app/global-error.tsx` (last-resort boundary) |

---

## Local development

Requires **Node 22.5+** (unit tests use the built-in `node:sqlite`).

```bash
npm install
cp .dev.vars.example .dev.vars      # local config; never commit it
npm run dev                         # http://localhost:3000
```

`npm run dev` first applies any pending D1 migrations to the local database (Wrangler may ask "Ok to proceed?" —
answer `Y`), then starts Next.js. If you ever see `no such table: ...` errors, the local database is missing its
tables: run `npm run d1:migrate:local`, or `npm run d1:reset:local` to wipe the local data and start clean.

`next dev` is wired to the Cloudflare bindings (see `next.config.mjs`), so it uses a local D1 emulated by
Wrangler.

**Payments locally.** With no Dodo credentials in `.dev.vars`, "Confirm & Pay" uses a built-in simulator
(`/api/dev/complete-payment`) that completes the payment without a charge. It only exists under `next dev`; in a
production build it returns 404 and payments return a clean "unavailable" error instead. To test real Dodo
checkout locally, put your **test-mode** keys in `.dev.vars` and expose the site with a tunnel so Dodo can reach
the webhook (e.g. `cloudflared tunnel --url http://localhost:3000`).

Other commands:

```bash
npm test                # unit tests (in-memory SQLite built from the real migrations)
npm run typecheck
npm run db:seed         # OPTIONAL demo data into a local SQLite file (never production)
npm run cf:preview      # build for Workers and run it locally exactly as production would
```

---

## Deploy to Cloudflare (main domain)

Do these once.

1. **Create the database**
   ```bash
   npx wrangler login
   npx wrangler d1 create ytrankwar-db
   ```
   Paste the printed `database_id` into `wrangler.toml` (`[[d1_databases]]`).

2. **Set the site URL** in `wrangler.toml` `[vars]`: `SITE_URL = "https://yourdomain.com"` (https, no trailing
   slash). Also set `DODO_PRODUCT_ID` (step 3).

3. **Dodo Payments** (dashboard: <https://app.dodopayments.com>)
   - Create ONE **one-time product** with **Pay What You Want** pricing (USD, minimum $1, maximum ≥ $10,000).
     Bids are variable, so the site sends the exact amount at checkout. Put its id in `DODO_PRODUCT_ID`.
   - **Developer → API Keys**: create a key, then `npx wrangler secret put DODO_PAYMENTS_API_KEY`.
   - **Developer → Webhooks**: add endpoint `https://yourdomain.com/api/payments/webhook` and subscribe to
     `payment.succeeded`, `payment.failed`, `refund.succeeded`, `dispute.opened`, `dispute.lost`. Copy the signing
     secret, then `npx wrangler secret put DODO_PAYMENTS_WEBHOOK_KEY`.
   - Test first with `DODO_PAYMENTS_ENVIRONMENT = "test_mode"` (and test-mode key/product/webhook). When ready,
     create the live equivalents and switch to `"live_mode"`.

4. **YouTube key (optional but recommended)**: `npx wrangler secret put YOUTUBE_API_KEY`. Without it channel data
   is mock data.

5. **Deploy**
   ```bash
   npm run deploy      # applies D1 migrations to the remote DB, builds, deploys
   ```

6. **Attach your domain**: the domain's DNS must be on Cloudflare. Uncomment the `[[routes]]` blocks in
   `wrangler.toml` (`custom_domain = true`) and `npm run deploy` again (or Workers & Pages → ytrankwar →
   Settings → Domains & Routes).

7. **Submit** `https://yourdomain.com/sitemap.xml` in Google Search Console.

Every later release is just `npm run deploy`. Migrations are applied in order and only once.

### Configuration reference

| Name | Where | Purpose |
| --- | --- | --- |
| `SITE_URL` | `wrangler.toml` `[vars]` | Canonical base URL (falls back to the request host if unset) |
| `DODO_PAYMENTS_ENVIRONMENT` | `[vars]` | `test_mode` or `live_mode` |
| `DODO_PRODUCT_ID` | `[vars]` | The Pay-What-You-Want product used for every bid |
| `DODO_PAYMENTS_API_KEY` | secret | Creates checkout sessions |
| `DODO_PAYMENTS_WEBHOOK_KEY` | secret | Verifies webhook signatures |
| `YOUTUBE_API_KEY` | secret | Real channel data |

---

## Ownership verification

A channel is only marked `verified` after the owner proves control of **that exact channel**:

1. The channel page shows a line like `ytrankwar verification: YTW-XXXXXXXX`.
2. The owner pastes it into the channel **description** (YouTube Studio > Customization > Basic info) and publishes.
3. The server re-reads that channel's description from the YouTube Data API (keyed by the channel's own `UC...` id)
   and requires the code to be present. Nothing the browser sends is treated as proof, so a post or code on a
   different channel cannot verify someone else's channel.

`YOUTUBE_API_KEY` is therefore **required in production**; without it verification returns 503 instead of
approving. The `premium` flag on `POST /api/channels` never verifies anything.

If you deployed an earlier version, review channels that were verified without proof:

```bash
npx wrangler d1 execute ytrankwar-db --remote --command \
  "SELECT id, slug, name FROM channels WHERE verification_status='verified' AND id NOT IN (SELECT channel_id FROM channel_ownership_tokens WHERE status='verified' AND proof_url LIKE 'method:%')"
```

---

## How payments work

1. The browser asks `POST /api/payments/create` to bid for a rank. The server recomputes the price itself (never
   trusts the browser), records a `payments` row, creates a Dodo hosted checkout for that exact amount and returns
   its URL.
2. The customer pays on Dodo's page and is returned to `/payment/return`.
3. The bid is applied by the **signed webhook** (`payment.succeeded`). If the customer lands on the return page
   first, the page asks Dodo directly (server-to-server) and applies the payment itself. Both paths are safe to
   run together.
4. `confirmPayment` (`lib/bidding-service.ts`) is atomic and idempotent. D1 has no interactive transactions, so
   it is one `batch()` of conditional SQL statements; the first confirmation applies the bid and every duplicate
   finds the payment already `paid` and changes nothing. `bids.payment_id` is also `UNIQUE` as a backstop. If a
   channel was suspended while the customer was at checkout, the money is **not** credited and the payment is
   marked `NEEDS REFUND` in its `note`.
5. Refund and dispute webhooks only *flag* the payment (`refunded` / `disputed`). Whether to reduce a bid is a
   human decision.

To see payments that need attention:
```bash
npx wrangler d1 execute ytrankwar-db --remote --command \
  "SELECT id, channel_id, amount_cents, status, note FROM payments WHERE note LIKE 'NEEDS REFUND%' OR status IN ('refunded','disputed','pending')"
```

---

## Production checklist

- [ ] `database_id`, `SITE_URL`, `DODO_PRODUCT_ID` set in `wrangler.toml`
- [ ] Secrets set: `DODO_PAYMENTS_API_KEY`, `DODO_PAYMENTS_WEBHOOK_KEY`, `YOUTUBE_API_KEY`
- [ ] Dodo webhook endpoint added and receiving events (Dodo dashboard shows delivery status)
- [ ] Did a full test-mode payment end to end, then switched to `live_mode` with live credentials
- [ ] Custom domain attached; `https://yourdomain.com/robots.txt` and `/sitemap.xml` show your domain
- [ ] Add a Cloudflare **rate limiting rule** for `/api/*` (Security → WAF → Rate limiting), e.g. 60 requests /
      minute per IP. The app validates all input but does not rate limit by itself.
- [ ] Read `/rules` and `/policy` and confirm they match how you actually want to run the business (see below)
- [ ] No demo data in the production DB (`db:seed` only ever writes a local file)

## Things to review (business decisions baked into the copy)

- **Refunds:** `/rules` and `/policy` say all payments are final (modelled on xme.lol/rules), with an exception for
  billing errors on our side. Change both pages if you want a different policy.
- **Minimums:** the pages say $25 first bid and +$1 to outbid; these are the database defaults
  (`settings.min_bid_cents`, `min_increment_cents`). If you change the settings, update `/rules`.
- `/policy` is a sensible starting point, not legal advice. Have it reviewed for the countries you sell in.

## Scheduled work

An hourly Cron Trigger (`worker.ts`) rebuilds the rank cache and refreshes the 40 least-recently-updated channels'
YouTube stats (≈960 quota units/day of the free 10,000). YouTube is never called during a page request.

## Project layout

```
app/            pages, error pages, API routes (payments/webhook, payments/create, ...)
components/     UI
db/index.ts     Db interface + D1 adapter (the only DB access point)
db/sqlite-adapter.ts   Node-only adapter used by tests/seed (never imported by app code)
lib/            bidding, leaderboard, channel, verification, Dodo client, site URL helpers
migrations/     D1 migrations (0001 schema, 0002 Dodo payments)
worker.ts       Worker entry: OpenNext app + Cron handler
```
