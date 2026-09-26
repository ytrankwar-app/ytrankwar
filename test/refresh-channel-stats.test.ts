import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

process.env.SQLITE_PATH = path.join(process.cwd(), 'data', `test-refresh-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

const { db } = await import('../db/index');
const { newId, newSecretToken } = await import('../lib/ids');
const { refreshAllChannelStats } = await import('../scripts/refresh-channel-stats');

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.YOUTUBE_API_KEY;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.YOUTUBE_API_KEY;
  else process.env.YOUTUBE_API_KEY = originalApiKey;
});

function makeChannelWithOldMockData(name: string, youtubeChannelId: string) {
  const id = newId('ch');
  const ownerUserId = newId('usr');
  db.prepare('INSERT INTO users (id, name, email) VALUES (?, ?, ?)').run(ownerUserId, name, `${id}@owner.test`);
  db.prepare(
    `INSERT INTO channels (id, youtube_channel_id, slug, name, handle, avatar_url, description, owner_user_id, manage_token, verification_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'verified')`
  ).run(id, youtubeChannelId, id, name, '@oldhandle', 'https://dicebear.example/old.svg', 'old mock description', ownerUserId, newSecretToken());
  db.prepare(
    `INSERT INTO channel_stats (channel_id, subscribers, total_views, video_count) VALUES (?, ?, ?, ?)`
  ).run(id, 12345, 99999, 42);
  return id;
}

test('refreshAllChannelStats replaces old (mock) data with the real API response, for every field', async () => {
  process.env.YOUTUBE_API_KEY = 'test-key';
  const channelId = makeChannelWithOldMockData('Old Mock Name', 'UCrealid123');

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
  const result = await refreshAllChannelStats(db, (m) => logs.push(m));

  assert.equal(result.updated, 1);
  assert.equal(result.failed, 0);

  const channel = db
    .prepare('SELECT name, handle, avatar_url as avatarUrl, description FROM channels WHERE id = ?')
    .get(channelId) as { name: string; handle: string; avatarUrl: string; description: string };
  assert.equal(channel.name, 'The Real Channel Name');
  assert.equal(channel.handle, '@realhandle');
  assert.equal(channel.avatarUrl, 'https://yt3.example/real-avatar.jpg');
  assert.equal(channel.description, 'A real, non-mock description.');

  const stats = db
    .prepare('SELECT subscribers, total_views as totalViews, video_count as videoCount FROM channel_stats WHERE channel_id = ?')
    .get(channelId) as { subscribers: number; totalViews: number; videoCount: number };
  assert.equal(stats.subscribers, 2_500_000);
  assert.equal(stats.totalViews, 80_000_000);
  assert.equal(stats.videoCount, 410);

  assert.ok(logs.some((l) => l.includes('The Real Channel Name')));
});

test('refreshAllChannelStats leaves bidding/verification/manage_token completely untouched', async () => {
  process.env.YOUTUBE_API_KEY = 'test-key';
  const channelId = makeChannelWithOldMockData('Untouched Fields Test', 'UCuntouched1');

  const before = db
    .prepare('SELECT manage_token as manageToken, verification_status as verificationStatus FROM channels WHERE id = ?')
    .get(channelId) as { manageToken: string; verificationStatus: string };

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

  await refreshAllChannelStats(db, () => {});

  const after = db
    .prepare('SELECT manage_token as manageToken, verification_status as verificationStatus FROM channels WHERE id = ?')
    .get(channelId) as { manageToken: string; verificationStatus: string };

  assert.equal(after.manageToken, before.manageToken);
  assert.equal(after.verificationStatus, before.verificationStatus);
});

test('refreshAllChannelStats stops early on a quota/key error instead of burning through every channel', async () => {
  process.env.YOUTUBE_API_KEY = 'test-key';
  makeChannelWithOldMockData('First Channel', 'UCfirst1');
  makeChannelWithOldMockData('Second Channel', 'UCsecond2');

  let callCount = 0;
  globalThis.fetch = (async () => {
    callCount++;
    return {
      ok: false,
      status: 403,
      json: async () => ({ error: { errors: [{ reason: 'quotaExceeded' }] } }),
    };
  }) as unknown as typeof fetch;

  const result = await refreshAllChannelStats(db, () => {});

  assert.equal(result.stoppedEarly, true);
  assert.equal(callCount, 1, 'should stop after the first quota error rather than retrying for every channel');
});

test.after(() => {
  db.close();
  fs.rmSync(process.env.SQLITE_PATH!, { force: true });
  fs.rmSync(`${process.env.SQLITE_PATH}-wal`, { force: true });
  fs.rmSync(`${process.env.SQLITE_PATH}-shm`, { force: true });
});
