import test from 'node:test';
import assert from 'node:assert/strict';

const { setDb } = await import('../db/index');
const { createSqliteDb } = await import('../db/sqlite-adapter');
const db = createSqliteDb(':memory:');
setDb(db);

delete process.env.YOUTUBE_API_KEY; // mock lookup
const { submitChannel, ChannelError } = await import('../lib/channel-service');

const count = async () => (await db.first<{ n: number }>('SELECT COUNT(*) as n FROM channels'))!.n;

test('adding the same channel twice is rejected with "already added" and creates no second row', async () => {
  const first = await submitChannel({ rawUrl: 'https://youtube.com/@dupechannel' });
  assert.equal(await count(), 1);

  await assert.rejects(
    () => submitChannel({ rawUrl: 'https://youtube.com/@dupechannel' }),
    (e: any) =>
      e instanceof ChannelError &&
      e.code === 'duplicate' &&
      e.message === 'This channel is already added.' &&
      e.existing?.slug === first.slug
  );
  assert.equal(await count(), 1);
});

test('handle match is case-insensitive and works for a bare @handle', async () => {
  await assert.rejects(
    () => submitChannel({ rawUrl: '@DupeChannel' }),
    (e: any) => e.code === 'duplicate'
  );
  assert.equal(await count(), 1);
});

test('the same channel pasted as /channel/UC... is also caught', async () => {
  const row = (await db.first<{ id: string }>('SELECT youtube_channel_id as id FROM channels'))!;
  await assert.rejects(
    () => submitChannel({ rawUrl: `https://www.youtube.com/channel/${row.id}` }),
    (e: any) => e.code === 'duplicate'
  );
  assert.equal(await count(), 1);
});

test('a different channel is still added normally', async () => {
  await submitChannel({ rawUrl: '@anotherone' });
  assert.equal(await count(), 2);
});

test.after(() => {
  db.close();
  setDb(null);
});
