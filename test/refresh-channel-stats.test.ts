import test from 'node:test';
import assert from 'node:assert/strict';

const { setDb } = await import('../db/index');
const { createSqliteDb } = await import('../db/sqlite-adapter');
const db = createSqliteDb(':memory:');
setDb(db);

const { newId } = await import('../lib/ids');
const { newReferralCode } = await import('../lib/verification-service');
const { refreshChannelStats } = await import('../lib/stats-refresh');

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.YOUTUBE_API_KEY;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.YOUTUBE_API_KEY;
  else process.env.YOUTUBE_API_KEY = originalApiKey;
});

async function makeChannelWithOldMockData(name: string, youtubeChannelId: string) {
  const id = newId('ch');
  const ownerUserId = newId('usr');
  await db.run('INSERT INTO users (id, name, email) VALUES (?, ?, ?)', [ownerUserId, name, `${id}@owner.test`]);
  await db.run(
    `INSERT INTO channels (id, youtube_channel_id, slug, name, handle, avatar_url, description, owner_user_id, referral_code, verification_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'verified')`,
    [id, youtubeChannelId, id, name, '@oldhandle', 'https://dicebear.example/old.svg', 'old mock description', ownerUserId, newReferralCode()]
  );
  await db.run('INSERT INTO channel_stats (channel_id, subscribers, total_views, video_count) VALUES (?, ?, ?, ?)', [id, 12345, 99999, 42]);
  return id;
}

test('refreshChannelStats replaces old (mock) data with the real API response, for every field', async () => {
  process.env.YOUTUBE_API_KEY = 'test-key';
  const channelId = await makeChannelWithOldMockData('Old Mock Name', 'UCrealid123');

  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      items: [
        {
          id: 'UCrealid123',
          snippet: {
            title: 'The Real Channel Name',
            description: 'A real, non-mock description.',
            customUrl: '@realhandle',
            publishedAt: '2016-06-01T00:00:00Z',
            thumbnails: { high: { url: 'https://yt3.example/real-avatar.jpg' } },
          },
          statistics: { subscriberCount: '2500000', viewCount: '80000000', videoCount: '410' },
        },
      ],
    }),
  })) as unknown as typeof fetch;

  const logs: string[] = [];
  const result = await refreshChannelStats(db, { log: (m) => logs.push(m) });

  assert.equal(result.updated, 1);
  assert.equal(result.failed, 0);

  const channel = (await db.first<{ name: string; handle: string; avatarUrl: string; description: string }>('SELECT name, handle, avatar_url as avatarUrl, description FROM channels WHERE id = ?', [channelId]))!;
  assert.equal(channel.name, 'The Real Channel Name');
  assert.equal(channel.handle, '@realhandle');
  assert.equal(channel.avatarUrl, 'https://yt3.example/real-avatar.jpg');
  assert.equal(channel.description, 'A real, non-mock description.');

  const stats = (await db.first<{ subscribers: number; totalViews: number; videoCount: number }>('SELECT subscribers, total_views as totalViews, video_count as videoCount FROM channel_stats WHERE channel_id = ?', [channelId]))!;
  assert.equal(stats.subscribers, 2_500_000);
  assert.equal(stats.totalViews, 80_000_000);
  assert.equal(stats.videoCount, 410);

  assert.ok(logs.some((l) => l.includes('The Real Channel Name')));
});

test('refreshChannelStats leaves bidding/verification/referral_code completely untouched', async () => {
  process.env.YOUTUBE_API_KEY = 'test-key';
  const channelId = await makeChannelWithOldMockData('Untouched Fields Test', 'UCuntouched1');

  const before = (await db.first<{ referralCode: string; verificationStatus: string }>('SELECT referral_code as referralCode, verification_status as verificationStatus FROM channels WHERE id = ?', [channelId]))!;

  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      items: [
        {
          id: 'UCuntouched1',
          snippet: { title: 'New Name', publishedAt: '2020-01-01T00:00:00Z' },
          statistics: { subscriberCount: '1', viewCount: '1', videoCount: '1' },
        },
      ],
    }),
  })) as unknown as typeof fetch;

  await refreshChannelStats(db, {});

  const after = (await db.first<{ referralCode: string; verificationStatus: string }>('SELECT referral_code as referralCode, verification_status as verificationStatus FROM channels WHERE id = ?', [channelId]))!;

  assert.equal(after.referralCode, before.referralCode);
  assert.equal(after.verificationStatus, before.verificationStatus);
});

test('refreshChannelStats stops early on a quota/key error instead of burning through every channel', async () => {
  process.env.YOUTUBE_API_KEY = 'test-key';
  await makeChannelWithOldMockData('First Channel', 'UCfirst1');
  await makeChannelWithOldMockData('Second Channel', 'UCsecond2');

  let callCount = 0;
  globalThis.fetch = (async () => {
    callCount++;
    return {
      ok: false,
      status: 403,
      json: async () => ({ error: { errors: [{ reason: 'quotaExceeded' }] } }),
    };
  }) as unknown as typeof fetch;

  const result = await refreshChannelStats(db, {});

  assert.equal(result.stoppedEarly, true);
  assert.equal(callCount, 1, 'should stop after the first quota error rather than retrying for every channel');
});

test.after(() => {
  db.close();
  setDb(null);
});
