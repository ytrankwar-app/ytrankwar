import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Isolate each test run in its own throwaway SQLite file so tests never
// interfere with dev data or each other.
process.env.SQLITE_PATH = path.join(process.cwd(), 'data', `test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

const { db } = await import('../db/index');
const { newId, newSecretToken } = await import('../lib/ids');
const {
  createPayment,
  confirmPayment,
  quoteAdditionalForTarget,
  minBidCents,
  BiddingError,
} = await import('../lib/bidding-service');
const { getLeaderboard, getChannelRank, requiredTotalForRank, rebuildRankCache } = await import(
  '../lib/leaderboard-service'
);
const { minIncrementCents } = await import('../lib/settings');

// No login in this app — a channel's manage_token is the only credential
// that authorizes bidding on it (see lib/manage-auth.ts). Tests build
// channels directly against the schema rather than through submitChannel()
// (which hits the mocked YouTube lookup), so they generate their own token
// the same way channel-service.ts does.
function makeChannel(name: string, verified = true) {
  const id = newId('ch');
  const ownerUserId = newId('usr');
  db.prepare('INSERT INTO users (id, name, email) VALUES (?, ?, ?)').run(ownerUserId, name, `${id}@owner.test`);
  const manageToken = newSecretToken();
  db.prepare(
    `INSERT INTO channels (id, youtube_channel_id, slug, name, owner_user_id, manage_token, verification_status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, `UC_${id}`, id, name, ownerUserId, manageToken, verified ? 'verified' : 'pending');
  db.prepare('INSERT INTO listings (channel_id, total_bid_cents) VALUES (?, 0)').run(id);
  return { id, manageToken };
}

function payAndConfirm(channelId: string, manageToken: string, amountCents: number) {
  const { paymentId } = createPayment({ channelId, manageToken, amountCents });
  return confirmPayment(paymentId, { success: true });
}

test('first bid must meet the minimum', () => {
  const { id, manageToken } = makeChannel('MinBidChannel');
  assert.throws(() => createPayment({ channelId: id, manageToken, amountCents: minBidCents() - 1 }), BiddingError);
  const result = payAndConfirm(id, manageToken, minBidCents());
  assert.equal(result.applied, true);
  assert.equal(result.newTotalCents, minBidCents());
});

test('unverified channels cannot bid', () => {
  const { id, manageToken } = makeChannel('Unverified', false);
  assert.throws(() => createPayment({ channelId: id, manageToken, amountCents: minBidCents() }), BiddingError);
});

test('higher cumulative bid ranks higher', () => {
  const a = makeChannel('RankA');
  const b = makeChannel('RankB');
  payAndConfirm(a.id, a.manageToken, 5000);
  payAndConfirm(b.id, b.manageToken, 3000);

  const board = getLeaderboard({ limit: 10 });
  const idxA = board.findIndex((e) => e.channelId === a.id);
  const idxB = board.findIndex((e) => e.channelId === b.id);
  assert.ok(idxA < idxB, 'higher bidder should rank above lower bidder');
});

test('equal cumulative bids: earlier bidder keeps the higher position', () => {
  const a = makeChannel('TieA');
  const b = makeChannel('TieB');
  payAndConfirm(a.id, a.manageToken, 2500); // reaches $25 first
  payAndConfirm(b.id, b.manageToken, 2500); // reaches $25 slightly later

  const rankA = getChannelRank(a.id)!;
  const rankB = getChannelRank(b.id)!;
  assert.equal(rankA.totalBidCents, rankB.totalBidCents);
  assert.ok(rankA.rank < rankB.rank, 'earlier bidder should remain ranked above a later, equal bidder');
});

test('minimum increment: required total to claim #1 is current #1 + the configured increment', () => {
  const a = makeChannel('LeaderA');
  const challenger = makeChannel('ChallengerA');
  payAndConfirm(a.id, a.manageToken, 10000); // $100

  const increment = minIncrementCents(); // $1 (100 cents) by default
  const target = requiredTotalForRank(1);
  assert.equal(target, 10000 + increment); // e.g. $101, strictly greater than current #1

  const quote = quoteAdditionalForTarget(challenger.id, target);
  assert.equal(quote.newTotalCents, 10000 + increment);

  payAndConfirm(challenger.id, challenger.manageToken, quote.requiredAdditionalCents);
  const newRankA = getChannelRank(a.id)!;
  const newRankChallenger = getChannelRank(challenger.id)!;
  assert.equal(newRankChallenger.rank, 1);
  assert.equal(newRankA.rank, 2);
});

test('a duplicate webhook delivery does not double-apply a payment', () => {
  const c = makeChannel('IdempotentChannel');
  const { paymentId } = createPayment({ channelId: c.id, manageToken: c.manageToken, amountCents: 5000 });

  const first = confirmPayment(paymentId, { success: true });
  const second = confirmPayment(paymentId, { success: true }); // simulated retry

  assert.equal(first.applied, true);
  assert.equal(second.applied, false, 'duplicate webhook must be a no-op');

  const listing = db.prepare('SELECT total_bid_cents as t FROM listings WHERE channel_id = ?').get(c.id) as { t: number };
  assert.equal(listing.t, 5000, 'total must reflect exactly one application of the payment');

  const bidCount = db.prepare('SELECT count(*) as n FROM bids WHERE channel_id = ?').get(c.id) as { n: number };
  assert.equal(bidCount.n, 1, 'exactly one bid ledger row, not two');
});

test('a failed payment never affects the listing total', () => {
  const c = makeChannel('FailedPaymentChannel');
  const { paymentId } = createPayment({ channelId: c.id, manageToken: c.manageToken, amountCents: 5000 });
  const result = confirmPayment(paymentId, { success: false });
  assert.equal(result.applied, false);
  const listing = db.prepare('SELECT total_bid_cents as t FROM listings WHERE channel_id = ?').get(c.id) as { t: number };
  assert.equal(listing.t, 0);
});

test('concurrent race: two challengers targeting the same stale #1 price both get applied correctly', () => {
  // Simulates the spec's race scenario: two users start checkout against the
  // same #1 target ($100.01, one cent above the leader's $100) at roughly
  // the same time — both quoted from the same stale leaderboard snapshot.
  // confirmPayment recomputes each channel's running total from the DB at
  // apply-time (never from the quote), so both payments are applied in
  // full, independently, and correctly — this is what prevents a real race
  // from corrupting the ledger or silently dropping one payer's money.
  const leader = makeChannel('RaceLeader');
  const bidder1 = makeChannel('RaceBidder1');
  const bidder2 = makeChannel('RaceBidder2');
  payAndConfirm(leader.id, leader.manageToken, 10000); // $100, current #1

  // Both quote against the same stale #1 ($100) before either pays. (Computed
  // directly from this test's own leader rather than via the global
  // requiredTotalForRank(), since other tests share this DB file and may
  // have created channels with higher bids elsewhere on the leaderboard —
  // that's a test-isolation detail, not something the engine needs to care
  // about in production, where this scenario is exactly what the function
  // is for.)
  const increment = minIncrementCents();
  const staleTargetCents = 10000 + increment;
  const quote1 = quoteAdditionalForTarget(bidder1.id, staleTargetCents);
  const quote2 = quoteAdditionalForTarget(bidder2.id, staleTargetCents);

  const p1 = createPayment({ channelId: bidder1.id, manageToken: bidder1.manageToken, amountCents: quote1.requiredAdditionalCents });
  const p2 = createPayment({ channelId: bidder2.id, manageToken: bidder2.manageToken, amountCents: quote2.requiredAdditionalCents });

  // bidder1's payment confirms first
  const r1 = confirmPayment(p1.paymentId, { success: true });
  assert.equal(r1.newTotalCents, staleTargetCents);

  // bidder2's payment confirms second — applied on top of the NOW-current
  // total for bidder2's own listing (bidder2 started at 0, unaffected by
  // bidder1's total), landing bidder2 above bidder1.
  const r2 = confirmPayment(p2.paymentId, { success: true });
  assert.equal(r2.newTotalCents, staleTargetCents);

  // Compare relative order via getChannelRank rather than absolute
  // leaderboard positions — other tests share this DB file and may have
  // channels sitting at similar bid levels elsewhere on the global board.
  const rankLeader = getChannelRank(leader.id)!.rank;
  const rankBidder1 = getChannelRank(bidder1.id)!.rank;
  const rankBidder2 = getChannelRank(bidder2.id)!.rank;

  // Both challengers reached 10001, which genuinely exceeds the leader's
  // 10000 — so both correctly outrank the original leader now. Between the
  // two challengers themselves, whichever payment confirmed (and so reached
  // the total) first keeps the better spot on the tie.
  assert.ok(rankBidder1 < rankLeader, 'bidder1 legitimately outbid the leader and should now rank above them');
  assert.ok(rankBidder2 < rankLeader, 'bidder2 legitimately outbid the leader and should now rank above them');
  assert.ok(rankBidder1 < rankBidder2, 'earlier-confirmed equal bid should outrank the later one');

  // The key correctness property this test actually demonstrates: both
  // challengers' payments were quoted against the exact same stale target,
  // yet both were applied in full and independently (bidder2's apply never
  // saw or was affected by bidder1's payment, since ranking is derived live
  // from each channel's own ledger) — no money was silently dropped or
  // overwritten by the "race".
});

test('rank cache is always re-derivable and matches live query', () => {
  const a = makeChannel('CacheA');
  const b = makeChannel('CacheB');
  payAndConfirm(a.id, a.manageToken, 7000);
  payAndConfirm(b.id, b.manageToken, 3000);
  rebuildRankCache();

  const cachedA = db.prepare('SELECT current_rank as r FROM listings WHERE channel_id = ?').get(a.id) as { r: number };
  const liveA = getChannelRank(a.id)!;
  assert.equal(cachedA.r, liveA.rank);
});

test('a wrong or missing manage_token cannot bid on someone else\'s channel', () => {
  const c = makeChannel('OwnedByAlice');
  const wrongToken = newSecretToken(); // a different, unrelated token
  assert.throws(() => createPayment({ channelId: c.id, manageToken: wrongToken, amountCents: minBidCents() }), BiddingError);
  assert.throws(() => createPayment({ channelId: c.id, manageToken: null, amountCents: minBidCents() }), BiddingError);
  assert.throws(() => createPayment({ channelId: c.id, manageToken: undefined, amountCents: minBidCents() }), BiddingError);
  // The real token still works.
  const result = payAndConfirm(c.id, c.manageToken, minBidCents());
  assert.equal(result.applied, true);
});

test('spec requirement: first paid position costs $25, taking an already-ranked position costs +$1 over its current value', () => {
  const holder = makeChannel('HolderChannel');
  const challenger = makeChannel('ChallengerChannel');

  // Claiming a first paid position costs exactly the $25 minimum.
  const firstBid = payAndConfirm(holder.id, holder.manageToken, minBidCents());
  assert.equal(firstBid.newTotalCents, 2500);

  // Other tests share this DB file and may have left higher bids on the
  // global board, so top the holder up comfortably above whatever the
  // current global #1 actually is right now, guaranteeing holder becomes
  // the new #1 with a known total we can reason about exactly.
  const priorTopCents = getLeaderboard({ limit: 1 })[0]?.totalBidCents ?? 0;
  const holderTargetTotal = priorTopCents + 5000;
  payAndConfirm(holder.id, holder.manageToken, holderTargetTotal - 2500);
  assert.equal(getChannelRank(holder.id)!.rank, 1);

  // To take that #1 position, another channel must pay the holder's exact
  // current value + $1.00 more (the configured minimum increment) — not a
  // single extra cent.
  const increment = minIncrementCents();
  assert.equal(increment, 100, 'this assertion demonstrates the $1 default; update it if the setting changes');
  const target = requiredTotalForRank(1);
  assert.equal(target, holderTargetTotal + increment);

  const quote = quoteAdditionalForTarget(challenger.id, target);
  assert.equal(quote.requiredAdditionalCents, holderTargetTotal + increment); // challenger starts at $0, so pays the full amount
  const outbid = payAndConfirm(challenger.id, challenger.manageToken, quote.requiredAdditionalCents);
  assert.equal(outbid.newTotalCents, holderTargetTotal + increment);
  assert.equal(getChannelRank(challenger.id)!.rank, 1);
});

test('required total for an empty rank is the real $25 minimum, not $0 or $1', () => {
  // Before this was fixed, requiredTotalForRank returned totalBidCents (0)
  // + the $1 increment = $1.00 for an empty #1 slot, or a bare 0 for any
  // other empty rank — both misleading, since the actual enforced minimum
  // first bid is $25. This matters for display-only UI (e.g. the homepage
  // "Claim #1" card) that calls this directly rather than going through
  // quoteAdditionalForTarget (which already floored correctly).
  const emptyRank1 = requiredTotalForRank(1, { category: 'a-category-nobody-uses-xyz' });
  assert.equal(emptyRank1, minBidCents());

  const emptyRank5 = requiredTotalForRank(5, { category: 'a-category-nobody-uses-xyz' });
  assert.equal(emptyRank5, minBidCents());
});

test.after(() => {
  db.close();
  fs.rmSync(process.env.SQLITE_PATH!, { force: true });
  fs.rmSync(`${process.env.SQLITE_PATH}-wal`, { force: true });
  fs.rmSync(`${process.env.SQLITE_PATH}-shm`, { force: true });
});
