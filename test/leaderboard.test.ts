import test from 'node:test';
import assert from 'node:assert/strict';

const { setDb } = await import('../db/index');
const { createSqliteDb } = await import('../db/sqlite-adapter');
const db = createSqliteDb(':memory:');
setDb(db);

const { newId } = await import('../lib/ids');
const { getLeaderboard, getChannelRank } = await import('../lib/leaderboard-service');
const { minBidCents } = await import('../lib/settings');

// A unique category per test run isolates it from every other test file's
// shared-DB state (same pattern used in bidding.test.ts). category_slug has
// a real foreign key to categories(slug), so it must be registered first.
const CATEGORY = `test-cat-${Date.now()}`;
await db.run('INSERT OR IGNORE INTO categories (slug, name) VALUES (?, ?)', [CATEGORY, CATEGORY]);

async function makeChannel(name: string) {
  const id = newId('ch');
  const ownerUserId = newId('usr');
  await db.run('INSERT INTO users (id, name, email) VALUES (?, ?, ?)', [ownerUserId, name, `${id}@owner.test`]);
  await db.run(`INSERT INTO channels (id, youtube_channel_id, slug, name, owner_user_id, category_slug, verification_status)
     VALUES (?, ?, ?, ?, ?, ?, 'verified')`, [id, `UC_${id}`, id, name, ownerUserId, CATEGORY]);
  await db.run('INSERT INTO listings (channel_id, total_bid_cents) VALUES (?, 0)', [id]);
  return { id };
}

test('a never-bid (free) channel appears on the leaderboard, not hidden', async () => {
  const free = (await makeChannel('FreeChannelOnly'));
  const board = (await getLeaderboard({ category: CATEGORY, limit: 50 }));
  assert.ok(board.some((e) => e.channelId === free.id), 'free channel should be listed, not filtered out');
});

test('a free channel gets a real rank, not null', async () => {
  const free = (await makeChannel('FreeChannelForRank'));
  const rank = (await getChannelRank(free.id));
  assert.notEqual(rank, null);
  assert.equal(rank!.totalBidCents, 0);
  assert.ok(rank!.rank >= 1);
});

test('a free channel shows $25 as the price to claim its rank', async () => {
  const free = (await makeChannel('FreeChannelPrice'));
  const board = (await getLeaderboard({ category: CATEGORY, limit: 50 }));
  const entry = board.find((e) => e.channelId === free.id)!;
  assert.equal(entry.totalBidCents, 0);
  assert.equal(entry.requiredToClaimCents, (await minBidCents()));
});

test('among tied ($0) free channels, first-come-first-served: earlier-created ranks higher', async () => {
  const first = (await makeChannel('FirstComeChannel'));
  // Ensure a distinguishable created_at even at high test speed.
  await db.run(`UPDATE channels SET created_at = '2020-01-01T00:00:00.000Z' WHERE id = ?`, [first.id]);
  const second = (await makeChannel('SecondComeChannel'));
  await db.run(`UPDATE channels SET created_at = '2020-01-02T00:00:00.000Z' WHERE id = ?`, [second.id]);

  const rankFirst = (await getChannelRank(first.id))!;
  const rankSecond = (await getChannelRank(second.id))!;
  assert.equal(rankFirst.totalBidCents, rankSecond.totalBidCents, 'both are still $0, a true tie');
  assert.ok(rankFirst.rank < rankSecond.rank, 'the earlier-created free channel should rank above the later one');

  const board = (await getLeaderboard({ category: CATEGORY, limit: 50 }));
  const idxFirst = board.findIndex((e) => e.channelId === first.id);
  const idxSecond = board.findIndex((e) => e.channelId === second.id);
  assert.ok(idxFirst < idxSecond, 'the leaderboard listing itself should reflect the same order');
});

test('a paid channel still outranks every free channel regardless of creation order', async () => {
  const free = (await makeChannel('FreeButOlder'));
  await db.run(`UPDATE channels SET created_at = '2019-01-01T00:00:00.000Z' WHERE id = ?`, [free.id]);
  const paid = (await makeChannel('PaidButNewer'));
  await db.run('UPDATE listings SET total_bid_cents = 2500, seq = 999999 WHERE channel_id = ?', [paid.id]);

  const rankFree = (await getChannelRank(free.id))!;
  const rankPaid = (await getChannelRank(paid.id))!;
  assert.ok(rankPaid.rank < rankFree.rank, 'a paid listing must always outrank a free one, even if the free one is older');
});


test.after(() => {
  db.close();
  setDb(null);
});
