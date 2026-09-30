import test from 'node:test';
import assert from 'node:assert/strict';

const { setDb } = await import('../db/index');
const { createSqliteDb } = await import('../db/sqlite-adapter');
const db = createSqliteDb(':memory:');
setDb(db);

const { newId } = await import('../lib/ids');
const { verifyChannelOwnership, VerificationError, descriptionHasCode } = await import('../lib/verification-service');
const { dodoFailureHint, isDodoConfigured } = await import('../lib/dodo');

async function makeChannel(youtubeId: string, code: string) {
  const id = newId('ch');
  const uid = newId('usr');
  await db.run('INSERT INTO users (id, name, email) VALUES (?, ?, ?)', [uid, 'o', `${id}@x.internal`]);
  await db.run(
    `INSERT INTO channels (id, youtube_channel_id, slug, name, owner_user_id, referral_code, verification_status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
    [id, youtubeId, id, 'Ch', uid, code]
  );
  return id;
}
const status = async (id: string) =>
  (await db.first<{ s: string }>('SELECT verification_status as s FROM channels WHERE id = ?', [id]))!.s;

// Fake YouTube Data API: channel id -> description
function fakeYouTube(descriptions: Record<string, string>) {
  globalThis.fetch = (async (url: string) => {
    const u = new URL(url);
    const id = u.searchParams.get('id') || '';
    const items = id in descriptions ? [{ id, snippet: { description: descriptions[id] } }] : [];
    return { ok: true, status: 200, json: async () => ({ items }) };
  }) as unknown as typeof fetch;
}
const realFetch = globalThis.fetch;
process.env.YOUTUBE_API_KEY = 'test-key';

test('owner with the code in THEIR OWN description is verified', async () => {
  const id = await makeChannel('UC_victim', 'YTW-AAAA1111');
  fakeYouTube({ UC_victim: 'hello ytrankwar verification: YTW-AAAA1111' });
  await verifyChannelOwnership(id);
  assert.equal(await status(id), 'verified');
});

test('CROSS-CHANNEL: code present only on the attacker channel does NOT verify the victim', async () => {
  const victim = await makeChannel('UC_victim2', 'YTW-BBBB2222');
  fakeYouTube({
    UC_attacker: 'ytrankwar verification: YTW-BBBB2222', // attacker copied victim's public code
    UC_victim2: 'my normal channel description',
  });
  await assert.rejects(() => verifyChannelOwnership(victim), (e: any) => e instanceof VerificationError && e.code === 'code_not_found');
  assert.equal(await status(victim), 'pending');
});

test('another channel\'s code in the victim description does not verify (needs OWN code)', async () => {
  const id = await makeChannel('UC_victim3', 'YTW-CCCC3333');
  fakeYouTube({ UC_victim3: 'ytrankwar verification: YTW-OTHER999' });
  await assert.rejects(() => verifyChannelOwnership(id));
  assert.equal(await status(id), 'pending');
});

test('API returning a different channel id is rejected', async () => {
  const id = await makeChannel('UC_want', 'YTW-DDDD4444');
  globalThis.fetch = (async () => ({
    ok: true, status: 200,
    json: async () => ({ items: [{ id: 'UC_other', snippet: { description: 'YTW-DDDD4444' } }] }),
  })) as unknown as typeof fetch;
  await assert.rejects(() => verifyChannelOwnership(id), (e: any) => e.code === 'not_found');
  assert.equal(await status(id), 'pending');
});

test('without a YouTube key, production never auto-verifies', async () => {
  const id = await makeChannel('UC_nokey', 'YTW-EEEE5555');
  const key = process.env.YOUTUBE_API_KEY;
  delete process.env.YOUTUBE_API_KEY;
  try {
    await assert.rejects(() => verifyChannelOwnership(id), (e: any) => e.code === 'unavailable');
    assert.equal(await status(id), 'pending');
  } finally {
    process.env.YOUTUBE_API_KEY = key;
  }
});

test('descriptionHasCode ignores missing codes and case', () => {
  assert.equal(descriptionHasCode('x ytw-abcd1234 y', 'YTW-ABCD1234'), true);
  assert.equal(descriptionHasCode('anything', ''), false);
  assert.equal(descriptionHasCode('MISSING-CODE', 'MISSING-CODE'), false);
});

test('placeholder Dodo values count as NOT configured; hints name the cause', () => {
  process.env.DODO_PAYMENTS_API_KEY = 'real_key';
  process.env.DODO_PRODUCT_ID = 'REPLACE_WITH_DODO_PAY_WHAT_YOU_WANT_PRODUCT_ID';
  assert.equal(isDodoConfigured(), false);
  process.env.DODO_PRODUCT_ID = 'pdt_123';
  assert.equal(isDodoConfigured(), true);
  assert.match(dodoFailureHint(401, 'https://test.dodopayments.com'), /live_mode|test_mode/);
  assert.match(dodoFailureHint(404, 'https://live.dodopayments.com'), /product/i);
});

test.after(() => {
  globalThis.fetch = realFetch;
  db.close();
  setDb(null);
});
