import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

process.env.SQLITE_PATH = path.join(process.cwd(), 'data', `test-lb-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

const { db } = await import('../db/index');
const { newId } = await import('../lib/ids');
const { getLeaderboard, getChannelRank } = await import('../lib/leaderboard-service');
const { minBidCents } = await import('../lib/settings');

// A unique category per test run isolates it from every other test file's
// shared-DB state (same pattern used in bidding.test.ts). category_slug has
// a real foreign key to categories(slug), so it must be registered first.
const CATEGORY = `test-cat-${Date.now()}`;
db.prepare('INSERT OR IGNORE INTO categories (slug, name) VALUES (?, ?)').run(CATEGORY, CATEGORY);

function makeChannel(name: string) {
  const id = newId('ch');
  const ownerUserId = newId('usr');
  db.prepare('INSERT INTO users (id, name, email) VALUES (?, ?, ?)').run(ownerUserId, name, `${id}@owner.test`);
  db.prepare(
    `INSERT INTO channels (id, youtube_channel_id, slug, name, owner_user_id, category_slug, verification_status)
     VALUES (?, ?, ?, ?, ?, ?, 'verified')`
  ).run(id, `UC_${id}`, id, name, ownerUserId, CATEGORY);
  db.prepare('INSERT INTO listings (channel_id, total_bid_cents) VALUES (?, 0)').run(id);
  return { id };
}

test('a never-bid (free) channel appears on the leaderboard, not hidden', () => {
  const free = makeChannel('FreeChannelOnly');
  const board = getLeaderboard({ category: CATEGORY, limit: 50 });
  assert.ok(board.some((e) => e.channelId === free.id), 'free channel should be listed, not filtered out');
});

test('a free channel gets a real rank, not null', () => {
  const free = makeChannel('FreeChannelForRank');
  const rank = getChannelRank(free.id);
  assert.notEqual(rank, null);
  assert.equal(rank!.totalBidCents, 0);
  assert.ok(rank!.rank >= 1);
});

test('a free channel shows $25 as the price to claim its rank', () => {
  const free = makeChannel('FreeChannelPrice');
  const board = getLeaderboard({ category: CATEGORY, limit: 50 });
  const entry = board.find((e) => e.channelId === free.id)!;
  assert.equal(entry.totalBidCents, 0);
  assert.equal(entry.requiredToClaimCents, minBidCents());
});

test('among tied ($0) free channels, first-come-first-served: earlier-created ranks higher', () => {
  const first = makeChannel('FirstComeChannel');
  // Ensure a distinguishable created_at even at high test speed.
  db.prepare(`UPDATE channels SET created_at = '2020-01-01T00:00:00.000Z' WHERE id = ?`).run(first.id);
  const second = makeChannel('SecondComeChannel');
  db.prepare(`UPDATE channels SET created_at = '2020-01-02T00:00:00.000Z' WHERE id = ?`).run(second.id);

  const rankFirst = getChannelRank(first.id)!;
  const rankSecond = getChannelRank(second.id)!;
  assert.equal(rankFirst.totalBidCents, rankSecond.totalBidCents, 'both are still $0, a true tie');
  assert.ok(rankFirst.rank < rankSecond.rank, 'the earlier-created free channel should rank above the later one');

  const board = getLeaderboard({ category: CATEGORY, limit: 50 });
  const idxFirst = board.findIndex((e) => e.channelId === first.id);
  const idxSecond = board.findIndex((e) => e.channelId === second.id);
  assert.ok(idxFirst < idxSecond, 'the leaderboard listing itself should reflect the same order');
});

test('a paid channel still outranks every free channel regardless of creation order', () => {
  const free = makeChannel('FreeButOlder');
  db.prepare(`UPDATE channels SET created_at = '2019-01-01T00:00:00.000Z' WHERE id = ?`).run(free.id);
  const paid = makeChannel('PaidButNewer');
  db.prepare('UPDATE listings SET total_bid_cents = 2500, seq = 999999 WHERE channel_id = ?').run(paid.id);

  const rankFree = getChannelRank(free.id)!;
  const rankPaid = getChannelRank(paid.id)!;
  assert.ok(rankPaid.rank < rankFree.rank, 'a paid listing must always outrank a free one, even if the free one is older');
});

test.after(() => {
  db.close();
  fs.rmSync(process.env.SQLITE_PATH!, { force: true });
  fs.rmSync(`${process.env.SQLITE_PATH}-wal`, { force: true });
  fs.rmSync(`${process.env.SQLITE_PATH}-shm`, { force: true });
});
