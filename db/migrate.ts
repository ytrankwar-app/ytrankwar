import { db } from './index';

// schema.sql uses CREATE TABLE IF NOT EXISTS / INSERT OR IGNORE throughout,
// so simply opening the connection (done by importing ./index) applies any
// new statements. This script exists as an explicit, documented step —
// mirrors `wrangler d1 migrations apply` in the Cloudflare deployment.
const tableCount = db
  .prepare("SELECT count(*) as n FROM sqlite_master WHERE type='table'")
  .get() as { n: number };

console.log(`Migrations applied. ${tableCount.n} tables present at ${process.env.SQLITE_PATH || 'data/app.db'}`);
