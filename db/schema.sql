-- YouTube Channel Leaderboard schema
-- SQLite / Cloudflare D1 compatible. All money stored as integer minor units (cents).

PRAGMA foreign_keys = ON;

-- No login and no accounts in this app. One synthetic row is auto-created
-- per channel at submission time purely so bids/payments/reports have a
-- stable user_id to reference for audit continuity — see
-- lib/channel-service.ts. There is no authorization check anywhere; anyone
-- can bid on or verify any channel.
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  suspended     INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS categories (
  slug          TEXT PRIMARY KEY,
  name          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS countries (
  code          TEXT PRIMARY KEY, -- ISO 3166-1 alpha-2
  name          TEXT NOT NULL
);

-- One row per YouTube channel ever submitted. youtube_channel_id is the
-- permanent canonical identifier (handles/names can change, IDs don't).
CREATE TABLE IF NOT EXISTS channels (
  id                  TEXT PRIMARY KEY,
  youtube_channel_id  TEXT NOT NULL UNIQUE,
  slug                TEXT NOT NULL UNIQUE,
  name                TEXT NOT NULL,
  handle              TEXT,
  avatar_url          TEXT,
  description         TEXT,
  category_slug       TEXT REFERENCES categories(slug),
  country_code        TEXT REFERENCES countries(code),
  -- Internal bookkeeping identity only (bids/payments still reference a
  -- users.id for audit continuity) — NOT used for authorization. There is
  -- no login in this app; a synthetic user row is auto-created per channel
  -- at submission time. See lib/channel-service.ts.
  owner_user_id       TEXT REFERENCES users(id),
  -- PUBLIC. Generated at submission time and meant to be shared: posting it
  -- to the channel's YouTube Community tab both proves ownership (only the
  -- real owner can post there) and drives referred traffic — visits via
  -- `/r/{referral_code}` increment referred_visits below. See
  -- lib/verification-service.ts.
  referral_code       TEXT UNIQUE,
  referred_visits     INTEGER NOT NULL DEFAULT 0,
  verification_status TEXT NOT NULL DEFAULT 'pending'
                        CHECK (verification_status IN ('pending','verified','rejected','revoked')),
  moderation_status   TEXT NOT NULL DEFAULT 'approved'
                        CHECK (moderation_status IN ('pending','under_review','approved','rejected','suspended','removed')),
  is_available        INTEGER NOT NULL DEFAULT 1, -- 0 if the underlying YouTube channel disappeared
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_channels_youtube_id ON channels(youtube_channel_id);
CREATE INDEX IF NOT EXISTS idx_channels_category ON channels(category_slug);
CREATE INDEX IF NOT EXISTS idx_channels_country ON channels(country_code);
CREATE INDEX IF NOT EXISTS idx_channels_verified ON channels(verification_status);
CREATE INDEX IF NOT EXISTS idx_channels_referral_code ON channels(referral_code);
CREATE INDEX IF NOT EXISTS idx_channels_referred_visits ON channels(referred_visits DESC);

-- Cached YouTube statistics snapshot. Refreshed on a schedule, never per-request.
CREATE TABLE IF NOT EXISTS channel_stats (
  channel_id      TEXT PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
  subscribers     INTEGER NOT NULL DEFAULT 0,
  total_views     INTEGER NOT NULL DEFAULT 0,
  video_count     INTEGER NOT NULL DEFAULT 0,
  channel_created_at TEXT,
  fetched_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Verification tokens for Method B (Community-post proof). `token` here is
-- a copy of the channel's referral_code at the time it was checked, kept
-- as an audit record even if the code is later regenerated.
CREATE TABLE IF NOT EXISTS channel_ownership_tokens (
  id            TEXT PRIMARY KEY,
  channel_id    TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id),
  token         TEXT NOT NULL,
  -- URL of the YouTube Community post the owner submitted as proof once
  -- they've posted the verification text. Null until submitted.
  proof_url     TEXT,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected','expired')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  resolved_at   TEXT
);

-- The current authoritative bidding state for a channel. This table is a
-- performance cache: it MUST always be re-derivable by summing `bids`.
-- current_rank is likewise a cache column, rebuildable from total_bid_cents
-- ordered against every other listing (see LeaderboardService.rebuildRanks).
CREATE TABLE IF NOT EXISTS listings (
  channel_id        TEXT PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
  total_bid_cents   INTEGER NOT NULL DEFAULT 0,
  -- first_reached_at: human-readable timestamp of when total_bid_cents last
  -- increased. Display only — NOT used for tiebreaking (wall-clock strings
  -- can collide between two bids applied in the same millisecond, which is
  -- exactly when a real tiebreak matters most).
  first_reached_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  -- seq: strictly increasing counter assigned when total_bid_cents changes.
  -- This is the actual ASC tiebreaker: whichever channel's bid was applied
  -- first (lower seq) keeps the higher position on an exact total_bid tie.
  -- Safe under concurrent writers because SQLite/D1 serialize writes and
  -- this is read-then-written inside the same transaction as the bid apply.
  seq               INTEGER NOT NULL DEFAULT 0,
  current_rank      INTEGER,
  highest_rank      INTEGER,
  lowest_rank       INTEGER,
  bid_count         INTEGER NOT NULL DEFAULT 0,
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_listings_total_bid ON listings(total_bid_cents DESC, seq ASC);

-- Immutable append-only ledger of every bid ever applied. This — not
-- `listings` — is the source of truth. listings.total_bid_cents must always
-- equal SUM(bids.amount_added_cents) for that channel.
CREATE TABLE IF NOT EXISTS bids (
  id                  TEXT PRIMARY KEY,
  channel_id          TEXT NOT NULL REFERENCES channels(id),
  user_id             TEXT NOT NULL REFERENCES users(id),
  payment_id          TEXT NOT NULL REFERENCES payments(id),
  amount_added_cents  INTEGER NOT NULL CHECK (amount_added_cents > 0),
  total_bid_after_cents INTEGER NOT NULL,
  rank_after          INTEGER,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_bids_channel ON bids(channel_id, created_at DESC);

CREATE TABLE IF NOT EXISTS payments (
  id              TEXT PRIMARY KEY,
  channel_id      TEXT NOT NULL REFERENCES channels(id),
  user_id         TEXT NOT NULL REFERENCES users(id),
  amount_cents    INTEGER NOT NULL CHECK (amount_cents > 0),
  -- what the client believed the resulting total/rank would be at
  -- checkout time; informational only, never trusted for the real apply.
  quoted_total_cents INTEGER,
  quoted_rank     INTEGER,
  provider        TEXT NOT NULL DEFAULT 'stripe',
  provider_ref    TEXT,
  status          TEXT NOT NULL DEFAULT 'created'
                    CHECK (status IN ('created','pending','paid','failed','cancelled','refunded','disputed')),
  applied         INTEGER NOT NULL DEFAULT 0, -- idempotency guard: bid ledger written exactly once
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  confirmed_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_channel ON payments(channel_id);

-- Point-in-time snapshots so profile pages can render a rank-over-time chart.
CREATE TABLE IF NOT EXISTS rank_history (
  id            TEXT PRIMARY KEY,
  channel_id    TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  rank          INTEGER NOT NULL,
  total_bid_cents INTEGER NOT NULL,
  recorded_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_rank_history_channel ON rank_history(channel_id, recorded_at);

CREATE TABLE IF NOT EXISTS profile_views (
  channel_id    TEXT PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
  count         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS youtube_clicks (
  channel_id    TEXT PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
  count         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS reports (
  id            TEXT PRIMARY KEY,
  channel_id    TEXT NOT NULL REFERENCES channels(id),
  reporter_user_id TEXT REFERENCES users(id),
  reason        TEXT NOT NULL,
  details       TEXT,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','under_review','approved','rejected','removed')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key           TEXT PRIMARY KEY,
  value         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  channel_id    TEXT REFERENCES channels(id),
  type          TEXT NOT NULL,
  message       TEXT NOT NULL,
  read          INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Live visitor presence: one row per active browser session, refreshed by a
-- periodic client-side heartbeat. A session counts as "live" if its
-- last_seen falls within the counting window (see lib/presence-service.ts).
-- This is a coarse, single-instance approximation of real-time presence —
-- fine for a demo; a production deployment at scale would use Durable
-- Objects or a KV-backed counter instead of a polled SQL table.
CREATE TABLE IF NOT EXISTS presence_pings (
  session_id    TEXT PRIMARY KEY,
  last_seen     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('min_bid_cents', '2500'),
  ('min_increment_cents', '100'),
  ('maintenance_mode', 'false');

INSERT OR IGNORE INTO categories (slug, name) VALUES
  ('gaming','Gaming'), ('entertainment','Entertainment'), ('music','Music'),
  ('technology','Technology'), ('education','Education'), ('business','Business'),
  ('finance','Finance'), ('sports','Sports'), ('comedy','Comedy');

INSERT OR IGNORE INTO countries (code, name) VALUES
  ('IN','India'), ('US','United States'), ('GB','United Kingdom'), ('CA','Canada');
