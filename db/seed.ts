// DEMO SEED DATA ONLY.
//
// Per the spec's explicit requirement: this data must be removed before any
// production deployment, and none of it should ever be presented as real
// bidding activity. Run with `npm run db:seed` against a fresh local DB.

import { submitChannel, mockVerifyChannel } from '../lib/channel-service';
import { createPayment, confirmPayment } from '../lib/bidding-service';

const DEMO_CHANNELS: { handle: string; category: string; country: string; bids: number[]; referredVisits?: number }[] = [
  { handle: '@codewithnina', category: 'technology', country: 'US', bids: [2500, 5000], referredVisits: 340 },
  { handle: '@lofi-league', category: 'music', country: 'GB', bids: [2500, 2000], referredVisits: 12 },
  { handle: '@pixelpushers', category: 'gaming', country: 'IN', bids: [10000], referredVisits: 88 },
  { handle: '@marketmavens', category: 'finance', country: 'US', bids: [2500] },
  { handle: '@dailygrindfit', category: 'sports', country: 'CA', bids: [] }, // free listing only, no paid bid
];

async function main() {
  console.log('Seeding DEMO data (never use in production)...');

  const { db } = await import('./index');

  for (const spec of DEMO_CHANNELS) {
    // No login in this app — submitChannel just auto-generates a
    // referral_code. There is no manage_token or any other credential to
    // hold onto.
    const { channelId } = await submitChannel({
      rawUrl: spec.handle,
      category: spec.category,
      country: spec.country,
    });

    if (spec.bids.length > 0) {
      mockVerifyChannel(channelId);
      for (const amountCents of spec.bids) {
        const { paymentId } = createPayment({ channelId, amountCents });
        confirmPayment(paymentId, { success: true, providerRef: 'seed_demo' });
      }
    }

    if (spec.referredVisits) {
      db.prepare('UPDATE channels SET referred_visits = ? WHERE id = ?').run(spec.referredVisits, channelId);
    }

    console.log(`  seeded ${spec.handle} (${spec.bids.length} bid(s) applied)`);
  }

  console.log('Done. This is demo data only — clear it before production.');
}

main().then(() => process.exit(0));
