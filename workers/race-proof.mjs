// PROOF-OF-CONCEPT ONLY — not production code. Used once, by
// test/workers/race-proof.test.mjs, to empirically confirm (not just
// assert from documentation) that:
//   1. a naive read-await-write inside a Durable Object DOES race when the
//      await is for external I/O (like a D1 query), and
//   2. wrapping the same logic in blockConcurrencyWhile() fixes it.
// The real production BidCoordinator (workers/bid-coordinator.ts) uses the
// same blockConcurrencyWhile pattern proven safe here.

import { DurableObject } from 'cloudflare:workers';

export class UnsafeCounter extends DurableObject {
  async increment() {
    // Simulates "read current total from D1" with a real external await
    // (D1 queries are external I/O from the DO's perspective, same as
    // fetch() — this is NOT the DO's own ctx.storage, which the runtime
    // protects automatically).
    const row = await this.env.DB.prepare('SELECT value FROM counter WHERE id = 1').first();
    const current = row.value;

    // Simulate doing some work between the read and the write — this is
    // exactly the shape of our real bidding logic (read total, compute new
    // total, write it back).
    await new Promise((r) => setTimeout(r, 5));

    await this.env.DB.prepare('UPDATE counter SET value = ? WHERE id = 1').bind(current + 1).run();
    return current + 1;
  }
}

export class SafeCounter extends DurableObject {
  async increment() {
    let result;
    await this.ctx.blockConcurrencyWhile(async () => {
      const row = await this.env.DB.prepare('SELECT value FROM counter WHERE id = 1').first();
      const current = row.value;
      await new Promise((r) => setTimeout(r, 5));
      await this.env.DB.prepare('UPDATE counter SET value = ? WHERE id = 1').bind(current + 1).run();
      result = current + 1;
    });
    return result;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const kind = url.searchParams.get('kind') === 'safe' ? 'SAFE_COUNTER' : 'UNSAFE_COUNTER';
    const id = env[kind].idFromName('the-one-counter');
    const stub = env[kind].get(id);
    const result = await stub.increment();
    return new Response(String(result));
  },
};
