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

// Local demo data for `npm run db:seed`. Seeds a LOCAL SQLite file
// (SQLITE_PATH, default ./data/app.db) — it never touches production D1.
// To seed the local Wrangler D1 instead, run the app with `npm run dev`
// and add channels through the UI.
async function main() {
  const { loadLocalEnv } = await import('../scripts/load-env');
  loadLocalEnv();
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { createSqliteDb } = await import('./sqlite-adapter');
  const { setDb } = await import('./index');

  const file = process.env.SQLITE_PATH || './data/app.db';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = createSqliteDb(file);
  setDb(db);

  console.log(`Seeding DEMO data into ${file} (never use in production)...`);

  for (const spec of DEMO_CHANNELS) {
    const { channelId } = await submitChannel({ rawUrl: spec.handle, category: spec.category, country: spec.country });

    if (spec.bids.length > 0) {
      await mockVerifyChannel(channelId);
      for (const amountCents of spec.bids) {
        const { paymentId } = await createPayment({ channelId, amountCents, provider: 'seed_demo' });
        await confirmPayment(paymentId, { success: true, providerRef: 'seed_demo' });
      }
    }

    if (spec.referredVisits) {
      await db.run('UPDATE channels SET referred_visits = ? WHERE id = ?', [spec.referredVisits, channelId]);
    }
    console.log(`  seeded ${spec.handle} (${spec.bids.length} bid(s) applied)`);
  }

  db.close();
  console.log('Done. This is demo data only — clear it before production.');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
