import { run } from '../../lib/db';
import { newId, newSecretToken } from '../../lib/ids';

/** Inserts a channel straight into the schema (bypassing the YouTube lookup). */
export async function makeChannel(
  name: string,
  opts: { verified?: boolean; category?: string | null; createdAt?: string } = {}
) {
  const id = newId('ch');
  const ownerUserId = newId('usr');
  const manageToken = newSecretToken();
  await run('INSERT INTO users (id, name, email) VALUES (?, ?, ?)', ownerUserId, name, `${id}@owner.test`);
  await run(
    `INSERT INTO channels (id, youtube_channel_id, slug, name, owner_user_id, manage_token, category_slug, verification_status${
      opts.createdAt ? ', created_at' : ''
    })
     VALUES (?, ?, ?, ?, ?, ?, ?, ?${opts.createdAt ? ', ?' : ''})`,
    id,
    `UC_${id}`,
    id,
    name,
    ownerUserId,
    manageToken,
    opts.category ?? null,
    opts.verified === false ? 'pending' : 'verified',
    ...(opts.createdAt ? [opts.createdAt] : [])
  );
  await run('INSERT INTO listings (channel_id, total_bid_cents) VALUES (?, 0)', id);
  await run('INSERT INTO channel_stats (channel_id) VALUES (?)', id);
  return { id, manageToken };
}
