import test from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import fs from 'node:fs';
import path from 'node:path';

const workerScript = fs.readFileSync(path.join(process.cwd(), 'workers/race-proof.mjs'), 'utf-8');

async function makeMiniflare() {
  const mf = new Miniflare({
    workers: [
      {
        name: 'race-proof',
        modules: true,
        script: workerScript,
        durableObjects: {
          UNSAFE_COUNTER: 'UnsafeCounter',
          SAFE_COUNTER: 'SafeCounter',
        },
        d1Databases: ['DB'],
      },
    ],
  });
  const db = await mf.getD1Database('DB');
  await db.exec('CREATE TABLE IF NOT EXISTS counter (id INTEGER PRIMARY KEY, value INTEGER NOT NULL)');
  await db.exec('DELETE FROM counter');
  await db.exec('INSERT INTO counter (id, value) VALUES (1, 0)');
  return mf;
}

async function fireConcurrent(mf, kind, n) {
  const requests = Array.from({ length: n }, () => mf.dispatchFetch(`http://do/?kind=${kind}`));
  return Promise.all(requests.map((p) => p.then((r) => r.text())));
}

test('proof: a naive read-await-write inside a Durable Object DOES lose updates under concurrency', async () => {
  const mf = await makeMiniflare();
  try {
    const N = 10;
    await fireConcurrent(mf, 'unsafe', N);

    const db = await mf.getD1Database('DB');
    const row = await db.prepare('SELECT value FROM counter WHERE id = 1').first();

    // If every increment were correctly serialized, value would be exactly
    // N. This assertion demonstrates the FAILURE mode empirically — it
    // asserts the bug is present, proving the concern was real and not
    // hypothetical, before trusting the fix below.
    assert.notEqual(row.value, N, 'expected the naive version to actually lose updates under concurrency (proving the race is real)');
  } finally {
    await mf.dispose();
  }
});

test('proof: the same logic wrapped in blockConcurrencyWhile() does NOT lose updates under concurrency', async () => {
  const mf = await makeMiniflare();
  try {
    const N = 10;
    await fireConcurrent(mf, 'safe', N);

    const db = await mf.getD1Database('DB');
    const row = await db.prepare('SELECT value FROM counter WHERE id = 1').first();

    assert.equal(row.value, N, 'blockConcurrencyWhile should make every increment count exactly once, with none lost to interleaving');
  } finally {
    await mf.dispose();
  }
});
