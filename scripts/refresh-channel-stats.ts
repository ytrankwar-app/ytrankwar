// Local helper: re-fetch real YouTube data for every channel in a LOCAL
// SQLite file. Production does this automatically via the hourly Cron
// Trigger in worker.ts; you normally never run this by hand.
//
//   SQLITE_PATH=./data/app.db npm run db:refresh-stats

import { createSqliteDb } from '../db/sqlite-adapter';
import { refreshChannelStats } from '../lib/stats-refresh';

async function main() {
  const { loadLocalEnv } = await import('./load-env');
  loadLocalEnv();

  if (!process.env.YOUTUBE_API_KEY) {
    console.log('YOUTUBE_API_KEY is not set in .env.local — there is nothing to refresh with.');
    console.log('Run `npm run check:youtube-key` first to confirm your key is set up correctly.');
    process.exitCode = 1;
    return;
  }

  const file = process.env.SQLITE_PATH || './data/app.db';
  const db = createSqliteDb(file, { migrate: false });
  const result = await refreshChannelStats(db, { log: console.log });
  console.log(`\nDone. ${result.updated} updated, ${result.failed} failed.`);
  if (result.failed > 0 && result.updated === 0) process.exitCode = 1;
}

main();
