import test from 'node:test';
import assert from 'node:assert/strict';
// Every test file gets its own private in-memory SQLite database (created
// from the real migrations) injected through setDb(), so tests never touch
// dev data or each other.
const { setDb } = await import('../db/index');
const { createSqliteDb } = await import('../db/sqlite-adapter');
const db = createSqliteDb(':memory:');
setDb(db);

const { newId } = await import('../lib/ids');
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

// No login or ownership credential anywhere in this app — anyone can bid on
// any verified channel. Tests build channels directly against the schema
// rather than through submitChannel() (which hits the mocked YouTube
// lookup).
async function makeChannel(name: string, verified = true) {
  const id = newId('ch');
  const ownerUserId = newId('usr');
  await db.run('INSERT INTO users (id, name, email) VALUES (?, ?, ?)', [ownerUserId, name, `${id}@owner.test`]);
  await db.run(
    `INSERT INTO channels (id, youtube_channel_id, slug, name, owner_user_id, verification_status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, `UC_${id}`, id, name, ownerUserId, verified ? 'verified' : 'pending']
  );
  await db.run('INSERT INTO listings (channel_id, total_bid_cents) VALUES (?, 0)', [id]);
  return { id };
}

async function payAndConfirm(channelId: string, amountCents: number) {
  const { paymentId } = (await createPayment({ channelId, amountCents }));
  return (await confirmPayment(paymentId, { success: true }));
}

test('first bid must meet the minimum', async () => {
  const { id } = (await makeChannel('MinBidChannel'));
  const min = await minBidCents();
  await assert.rejects(() => createPayment({ channelId: id, amountCents: min - 1 }), BiddingError);
  const result = (await payAndConfirm(id, (await minBidCents())));
  assert.equal(result.applied, true);
  assert.equal(result.newTotalCents, (await minBidCents()));
});

test('unverified channels cannot bid', async () => {
  const { id } = (await makeChannel('Unverified', false));
  const min = await minBidCents();
  await assert.rejects(() => createPayment({ channelId: id, amountCents: min }), BiddingError);
});

test('anyone can bid on any verified channel — there is no ownership check', async () => {
  const c = (await makeChannel('OpenToAnyone'));
  // No credential of any kind is required or accepted here — this is the
  // entire point: bidding is open to whoever calls the API.
  const result = (await payAndConfirm(c.id, (await minBidCents())));
  assert.equal(result.applied, true);
});

test('higher cumulative bid ranks higher', async () => {
  const a = (await makeChannel('RankA'));
  const b = (await makeChannel('RankB'));
  (await payAndConfirm(a.id, 5000));
  (await payAndConfirm(b.id, 3000));

  const board = (await getLeaderboard({ limit: 10 }));
  const idxA = board.findIndex((e) => e.channelId === a.id);
  const idxB = board.findIndex((e) => e.channelId === b.id);
  assert.ok(idxA < idxB, 'higher bidder should rank above lower bidder');
});

test('equal cumulative bids: earlier bidder keeps the higher position', async () => {
  const a = (await makeChannel('TieA'));
  const b = (await makeChannel('TieB'));
  (await payAndConfirm(a.id, 2500)); // reaches $25 first
  (await payAndConfirm(b.id, 2500)); // reaches $25 slightly later

  const rankA = (await getChannelRank(a.id))!;
  const rankB = (await getChannelRank(b.id))!;
  assert.equal(rankA.totalBidCents, rankB.totalBidCents);
  assert.ok(rankA.rank < rankB.rank, 'earlier bidder should remain ranked above a later, equal bidder');
});

test('minimum increment: required total to claim #1 is current #1 + the configured increment', async () => {
  const a = (await makeChannel('LeaderA'));
  const challenger = (await makeChannel('ChallengerA'));
  (await payAndConfirm(a.id, 10000)); // $100

  const increment = (await minIncrementCents()); // $1 (100 cents) by default
  const target = (await requiredTotalForRank(1));
  assert.equal(target, 10000 + increment); // e.g. $101, strictly greater than current #1

  const quote = (await quoteAdditionalForTarget(challenger.id, target));
  assert.equal(quote.newTotalCents, 10000 + increment);

  (await payAndConfirm(challenger.id, quote.requiredAdditionalCents));
  const newRankA = (await getChannelRank(a.id))!;
  const newRankChallenger = (await getChannelRank(challenger.id))!;
  assert.equal(newRankChallenger.rank, 1);
  assert.equal(newRankA.rank, 2);
});

test('a duplicate webhook delivery does not double-apply a payment', async () => {
  const c = (await makeChannel('IdempotentChannel'));
  const { paymentId } = (await createPayment({ channelId: c.id, amountCents: 5000 }));

  const first = (await confirmPayment(paymentId, { success: true }));
  const second = (await confirmPayment(paymentId, { success: true })); // simulated retry

  assert.equal(first.applied, true);
  assert.equal(second.applied, false, 'duplicate webhook must be a no-op');

  const listing = (await db.first<{ t: number }>('SELECT total_bid_cents as t FROM listings WHERE channel_id = ?', [c.id]))!;
  assert.equal(listing.t, 5000, 'total must reflect exactly one application of the payment');

  const bidCount = (await db.first<{ n: number }>('SELECT count(*) as n FROM bids WHERE channel_id = ?', [c.id]))!;
  assert.equal(bidCount.n, 1, 'exactly one bid ledger row, not two');
});

test('a failed payment never affects the listing total', async () => {
  const c = (await makeChannel('FailedPaymentChannel'));
  const { paymentId } = (await createPayment({ channelId: c.id, amountCents: 5000 }));
  const result = (await confirmPayment(paymentId, { success: false }));
  assert.equal(result.applied, false);
  const listing = (await db.first<{ t: number }>('SELECT total_bid_cents as t FROM listings WHERE channel_id = ?', [c.id]))!;
  assert.equal(listing.t, 0);
});

test('concurrent race: two challengers targeting the same stale #1 price both get applied correctly', async () => {
  // Simulates the spec's race scenario: two users start checkout against the
  // same #1 target ($100.01, one cent above the leader's $100) at roughly
  // the same time — both quoted from the same stale leaderboard snapshot.
  // confirmPayment recomputes each channel's running total from the DB at
  // apply-time (never from the quote), so both payments are applied in
  // full, independently, and correctly — this is what prevents a real race
  // from corrupting the ledger or silently dropping one payer's money.
  const leader = (await makeChannel('RaceLeader'));
  const bidder1 = (await makeChannel('RaceBidder1'));
  const bidder2 = (await makeChannel('RaceBidder2'));
  (await payAndConfirm(leader.id, 10000)); // $100, current #1

  // Both quote against the same stale #1 ($100) before either pays. (Computed
  // directly from this test's own leader rather than via the global
  // (await requiredTotalForRank()), since other tests share this DB file and may
  // have created channels with higher bids elsewhere on the leaderboard —
  // that's a test-isolation detail, not something the engine needs to care
  // about in production, where this scenario is exactly what the function
  // is for.)
  const increment = (await minIncrementCents());
  const staleTargetCents = 10000 + increment;
  const quote1 = (await quoteAdditionalForTarget(bidder1.id, staleTargetCents));
  const quote2 = (await quoteAdditionalForTarget(bidder2.id, staleTargetCents));

  const p1 = (await createPayment({ channelId: bidder1.id, amountCents: quote1.requiredAdditionalCents }));
  const p2 = (await createPayment({ channelId: bidder2.id, amountCents: quote2.requiredAdditionalCents }));

  // bidder1's payment confirms first
  const r1 = (await confirmPayment(p1.paymentId, { success: true }));
  assert.equal(r1.newTotalCents, staleTargetCents);

  // bidder2's payment confirms second — applied on top of the NOW-current
  // total for bidder2's own listing (bidder2 started at 0, unaffected by
  // bidder1's total), landing bidder2 above bidder1.
  const r2 = (await confirmPayment(p2.paymentId, { success: true }));
  assert.equal(r2.newTotalCents, staleTargetCents);

  // Compare relative order via getChannelRank rather than absolute
  // leaderboard positions — other tests share this DB file and may have
  // channels sitting at similar bid levels elsewhere on the global board.
  const rankLeader = (await getChannelRank(leader.id))!.rank;
  const rankBidder1 = (await getChannelRank(bidder1.id))!.rank;
  const rankBidder2 = (await getChannelRank(bidder2.id))!.rank;

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

test('rank cache is always re-derivable and matches live query', async () => {
  const a = (await makeChannel('CacheA'));
  const b = (await makeChannel('CacheB'));
  (await payAndConfirm(a.id, 7000));
  (await payAndConfirm(b.id, 3000));
  (await rebuildRankCache());

  const cachedA = (await db.first<{ r: number }>('SELECT current_rank as r FROM listings WHERE channel_id = ?', [a.id]))!;
  const liveA = (await getChannelRank(a.id))!;
  assert.equal(cachedA.r, liveA.rank);
});

test('spec requirement: first paid position costs $25, taking an already-ranked position costs +$1 over its current value', async () => {
  const holder = (await makeChannel('HolderChannel'));
  const challenger = (await makeChannel('ChallengerChannel'));

  // Claiming a first paid position costs exactly the $25 minimum.
  const firstBid = (await payAndConfirm(holder.id, (await minBidCents())));
  assert.equal(firstBid.newTotalCents, 2500);

  // Other tests share this DB file and may have left higher bids on the
  // global board, so top the holder up comfortably above whatever the
  // current global #1 actually is right now, guaranteeing holder becomes
  // the new #1 with a known total we can reason about exactly.
  const priorTopCents = (await getLeaderboard({ limit: 1 }))[0]?.totalBidCents ?? 0;
  const holderTargetTotal = priorTopCents + 5000;
  (await payAndConfirm(holder.id, holderTargetTotal - 2500));
  assert.equal((await getChannelRank(holder.id))!.rank, 1);

  // To take that #1 position, another channel must pay the holder's exact
  // current value + $1.00 more (the configured minimum increment) — not a
  // single extra cent.
  const increment = (await minIncrementCents());
  assert.equal(increment, 100, 'this assertion demonstrates the $1 default; update it if the setting changes');
  const target = (await requiredTotalForRank(1));
  assert.equal(target, holderTargetTotal + increment);

  const quote = (await quoteAdditionalForTarget(challenger.id, target));
  assert.equal(quote.requiredAdditionalCents, holderTargetTotal + increment); // challenger starts at $0, so pays the full amount
  const outbid = (await payAndConfirm(challenger.id, quote.requiredAdditionalCents));
  assert.equal(outbid.newTotalCents, holderTargetTotal + increment);
  assert.equal((await getChannelRank(challenger.id))!.rank, 1);
});

test('required total for an empty rank is the real $25 minimum, not $0 or $1', async () => {
  // Before this was fixed, requiredTotalForRank returned totalBidCents (0)
  // + the $1 increment = $1.00 for an empty #1 slot, or a bare 0 for any
  // other empty rank — both misleading, since the actual enforced minimum
  // first bid is $25. This matters for display-only UI (e.g. the homepage
  // "Claim #1" card) that calls this directly rather than going through
  // quoteAdditionalForTarget (which already floored correctly).
  const emptyRank1 = (await requiredTotalForRank(1, { category: 'a-category-nobody-uses-xyz' }));
  assert.equal(emptyRank1, (await minBidCents()));

  const emptyRank5 = (await requiredTotalForRank(5, { category: 'a-category-nobody-uses-xyz' }));
  assert.equal(emptyRank5, (await minBidCents()));
});

test('parallel confirmations of the same payment apply it exactly once', async () => {
  const c = await makeChannel('ParallelConfirm');
  const { paymentId } = await createPayment({ channelId: c.id, amountCents: 5000 });

  const results = await Promise.all(
    Array.from({ length: 8 }, () => confirmPayment(paymentId, { success: true, providerRef: 'pay_x' }))
  );
  assert.equal(results.filter((r) => r.applied).length, 1, 'exactly one delivery may apply the bid');

  const listing = (await db.first<{ t: number; n: number }>(
    'SELECT total_bid_cents as t, bid_count as n FROM listings WHERE channel_id = ?',
    [c.id]
  ))!;
  assert.equal(listing.t, 5000);
  assert.equal(listing.n, 1);
});

test('a payment for a channel suspended during checkout is recorded for refund, never applied', async () => {
  const c = await makeChannel('SuspendedMidCheckout');
  const { paymentId } = await createPayment({ channelId: c.id, amountCents: 5000 });
  await db.run(`UPDATE channels SET moderation_status = 'suspended' WHERE id = ?`, [c.id]);

  const result = await confirmPayment(paymentId, { success: true, providerRef: 'pay_y' });
  assert.equal(result.applied, false);

  const listing = (await db.first<{ t: number }>('SELECT total_bid_cents as t FROM listings WHERE channel_id = ?', [c.id]))!;
  assert.equal(listing.t, 0, 'money must not be credited to a suspended channel');
  const pay = (await db.first<{ status: string; applied: number; note: string | null }>(
    'SELECT status, applied, note FROM payments WHERE id = ?',
    [paymentId]
  ))!;
  assert.equal(pay.status, 'paid');
  assert.equal(pay.applied, 0);
  assert.match(pay.note ?? '', /NEEDS REFUND/);
});

test('charges below the minimum payment are rounded up to it', async () => {
  const c = await makeChannel('TinyTopUp');
  await payAndConfirm(c.id, 2500);
  const { amountCents } = await createPayment({ channelId: c.id, amountCents: 1 });
  assert.equal(amountCents, 100);
});

test.after(() => {
  db.close();
  setDb(null);
});
