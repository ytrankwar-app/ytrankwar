import test from 'node:test';
import assert from 'node:assert/strict';

const { lookupChannel } = await import('../lib/youtube');

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.YOUTUBE_API_KEY;

function mockFetchOnce(responses: { status?: number; body: any }[]) {
  let call = 0;
  globalThis.fetch = (async (url: string) => {
    const r = responses[Math.min(call, responses.length - 1)];
    call++;
    return {
      ok: (r.status ?? 200) < 400,
      status: r.status ?? 200,
      json: async () => r.body,
    } as Response;
  }) as typeof fetch;
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.YOUTUBE_API_KEY;
  else process.env.YOUTUBE_API_KEY = originalApiKey;
});

test('with no API key configured, uses the deterministic mock (no network call)', async () => {
  delete process.env.YOUTUBE_API_KEY;
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    throw new Error('should not be called');
  }) as typeof fetch;

  const info = await lookupChannel('@somechannel');
  assert.equal(called, false);
  assert.ok(info.youtubeChannelId.startsWith('UC'));
});

test('with an API key, a handle lookup calls channels.list with forHandle and parses a real-shaped response', async () => {
  process.env.YOUTUBE_API_KEY = 'test-key';
  let capturedUrl = '';
  globalThis.fetch = (async (url: string) => {
    capturedUrl = url.toString();
    return {
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            id: 'UCabc123',
            snippet: {
              title: 'Real Channel Name',
              description: 'A real description.',
              customUrl: '@realhandle',
              publishedAt: '2015-03-01T00:00:00Z',
              thumbnails: { high: { url: 'https://yt3.example/avatar.jpg' } },
            },
            statistics: {
              subscriberCount: '123456',
              viewCount: '9876543',
              videoCount: '250',
            },
          },
        ],
      }),
    } as Response;
  }) as typeof fetch;

  const info = await lookupChannel('@realhandle');

  assert.ok(capturedUrl.includes('forHandle=%40realhandle') || capturedUrl.includes('forHandle=@realhandle'));
  assert.ok(capturedUrl.includes('channels?'));
  assert.equal(info.youtubeChannelId, 'UCabc123');
  assert.equal(info.name, 'Real Channel Name');
  assert.equal(info.handle, '@realhandle');
  assert.equal(info.avatarUrl, 'https://yt3.example/avatar.jpg');
  assert.equal(info.subscribers, 123456);
  assert.equal(info.totalViews, 9876543);
  assert.equal(info.videoCount, 250);
  assert.equal(info.channelCreatedAt, '2015-03-01T00:00:00Z');
});

test('a hidden subscriber count is reported as 0, not the raw (usually absent) field', async () => {
  process.env.YOUTUBE_API_KEY = 'test-key';
  mockFetchOnce([
    {
      body: {
        items: [
          {
            id: 'UChidden',
            snippet: { title: 'Hidden Subs', publishedAt: '2020-01-01T00:00:00Z' },
            statistics: { hiddenSubscriberCount: true, viewCount: '500', videoCount: '10' },
          },
        ],
      },
    },
  ]);

  const info = await lookupChannel('@hiddensubs');
  assert.equal(info.subscribers, 0);
});

test('a channel/UC... URL looks up by id, not forHandle', async () => {
  process.env.YOUTUBE_API_KEY = 'test-key';
  let capturedUrl = '';
  globalThis.fetch = (async (url: string) => {
    capturedUrl = url.toString();
    return {
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            id: 'UCdirectid',
            snippet: { title: 'By Id', publishedAt: '2018-01-01T00:00:00Z' },
            statistics: { subscriberCount: '10', viewCount: '10', videoCount: '1' },
          },
        ],
      }),
    } as Response;
  }) as typeof fetch;

  const info = await lookupChannel('https://youtube.com/channel/UCdirectid');
  assert.ok(capturedUrl.includes('id=UCdirectid'));
  assert.equal(info.youtubeChannelId, 'UCdirectid');
});

test('a custom slug falls back through forUsername then search when neither resolves directly', async () => {
  process.env.YOUTUBE_API_KEY = 'test-key';
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    calls.push(url.toString());
    if (url.toString().includes('forUsername')) {
      return { ok: true, status: 200, json: async () => ({ items: [] }) } as Response;
    }
    if (url.toString().includes('/search?')) {
      return { ok: true, status: 200, json: async () => ({ items: [{ id: { channelId: 'UCfromsearch' } }] }) } as Response;
    }
    // final channels.list?id= lookup
    return {
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            id: 'UCfromsearch',
            snippet: { title: 'Found Via Search', publishedAt: '2019-01-01T00:00:00Z' },
            statistics: { subscriberCount: '99', viewCount: '99', videoCount: '9' },
          },
        ],
      }),
    } as Response;
  }) as typeof fetch;

  const info = await lookupChannel('https://youtube.com/c/somecustomname');
  assert.equal(info.youtubeChannelId, 'UCfromsearch');
  assert.equal(calls.length, 3, 'should try forUsername, then search, then fetch full details by id');
});

test('a channel that truly cannot be found throws a clear not-found error', async () => {
  process.env.YOUTUBE_API_KEY = 'test-key';
  globalThis.fetch = (async () => ({ ok: true, status: 200, json: async () => ({ items: [] }) })) as unknown as typeof fetch;

  await assert.rejects(() => lookupChannel('@nonexistentchannel'), /couldn't find/i);
});

test('a quota-exceeded response surfaces a clear, specific error rather than a generic one', async () => {
  process.env.YOUTUBE_API_KEY = 'test-key';
  globalThis.fetch = (async () => ({
    ok: false,
    status: 403,
    json: async () => ({ error: { errors: [{ reason: 'quotaExceeded' }] } }),
  })) as unknown as typeof fetch;

  await assert.rejects(() => lookupChannel('@anychannel'), /quota/i);
});

test('an invalid API key surfaces a clear, specific error', async () => {
  process.env.YOUTUBE_API_KEY = 'bad-key';
  globalThis.fetch = (async () => ({
    ok: false,
    status: 400,
    json: async () => ({ error: { errors: [{ reason: 'keyInvalid' }] } }),
  })) as unknown as typeof fetch;

  await assert.rejects(() => lookupChannel('@anychannel'), /api key/i);
});

test('a network failure surfaces a clear connectivity error, not a raw exception', async () => {
  process.env.YOUTUBE_API_KEY = 'test-key';
  globalThis.fetch = (async () => {
    throw new TypeError('fetch failed');
  }) as typeof fetch;

  await assert.rejects(() => lookupChannel('@anychannel'), /reach the youtube/i);
});
