import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestD1 } from './helpers/d1-shim';
import { setDatabase, all, first } from '../lib/db';
import { submitChannel, ChannelError } from '../lib/channel-service';

const { d1 } = createTestD1();
setDatabase(d1);

const originalFetch = globalThis.fetch;
const originalKey = process.env.YOUTUBE_API_KEY;
test.afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.YOUTUBE_API_KEY;
  else process.env.YOUTUBE_API_KEY = originalKey;
});

function mockYouTube(id: string, title: string) {
  globalThis.fetch = (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            id,
            snippet: { title, description: 'd', customUrl: `@${title.toLowerCase().replace(/\W/g, '')}`, publishedAt: '2016-01-01T00:00:00Z', thumbnails: { high: { url: 'https://yt3.example/a.jpg' } } },
            statistics: { subscriberCount: '1000', viewCount: '50000', videoCount: '40' },
          },
        ],
      }),
    }) as Response) as typeof fetch;
}

test('without a YouTube API key nothing is stored — no fake channel is invented', async () => {
  delete process.env.YOUTUBE_API_KEY;
  await assert.rejects(() => submitChannel({ rawUrl: '@anything' }), ChannelError);
  assert.equal((await all('SELECT id FROM channels')).length, 0);
});

test('a channel resolved by the YouTube API is stored in D1 with all of its rows', async () => {
  process.env.YOUTUBE_API_KEY = 'test-key';
  mockYouTube('UCreal000000000000000001', 'Real Channel');
  const res = await submitChannel({ rawUrl: 'https://youtube.com/@realchannel', category: 'music' });

  const ch = await first<{ name: string; slug: string; avatar: string; status: string }>(
    'SELECT name, slug, avatar_url as avatar, verification_status as status FROM channels WHERE id = ?',
    res.channelId
  );
  assert.equal(ch!.name, 'Real Channel');
  assert.equal(ch!.slug, 'real-channel');
  assert.equal(ch!.avatar, 'https://yt3.example/a.jpg');
  assert.equal(ch!.status, 'pending');
  for (const table of ['channel_stats', 'listings', 'profile_views', 'youtube_clicks']) {
    const row = await first(`SELECT 1 as x FROM ${table} WHERE channel_id = ?`, res.channelId);
    assert.ok(row, `${table} row should exist`);
  }
  assert.ok(res.manageToken.length >= 40);
});

test('submitting the same YouTube channel twice is rejected as a duplicate', async () => {
  process.env.YOUTUBE_API_KEY = 'test-key';
  mockYouTube('UCreal000000000000000001', 'Real Channel');
  await assert.rejects(
    () => submitChannel({ rawUrl: 'https://youtube.com/@realchannel' }),
    (e: unknown) => e instanceof ChannelError && e.code === 'duplicate'
  );
});

test('two different channels with the same name get distinct slugs', async () => {
  process.env.YOUTUBE_API_KEY = 'test-key';
  mockYouTube('UCreal000000000000000002', 'Real Channel');
  const res = await submitChannel({ rawUrl: 'https://youtube.com/channel/UCreal000000000000000002' });
  assert.equal(res.slug, 'real-channel-2');
});
