import test from 'node:test';
import assert from 'node:assert/strict';

const { setDb } = await import('../db/index');
const { createSqliteDb } = await import('../db/sqlite-adapter');
const db = createSqliteDb(':memory:');
setDb(db);

const { verifyWebhook, signWebhook, dodoBaseUrl, createCheckoutSession } = await import('../lib/dodo');

// A Standard Webhooks style secret: "whsec_" + base64 of the key bytes.
const SECRET = 'whsec_' + Buffer.from('super-secret-signing-key-for-tests').toString('base64');
const BODY = JSON.stringify({ type: 'payment.succeeded', data: { payment_id: 'pay_123', metadata: { payment_id: 'pay_x' } } });
const NOW = 1_800_000_000;

test('a correctly signed webhook verifies', async () => {
  const sig = await signWebhook({ rawBody: BODY, id: 'msg_1', timestamp: String(NOW), secret: SECRET });
  assert.equal(
    await verifyWebhook({ rawBody: BODY, id: 'msg_1', timestamp: String(NOW), signatureHeader: sig, secret: SECRET, nowSeconds: NOW }),
    true
  );
});

test('a tampered body, wrong secret, or wrong id is rejected', async () => {
  const sig = await signWebhook({ rawBody: BODY, id: 'msg_1', timestamp: String(NOW), secret: SECRET });
  const base = { id: 'msg_1', timestamp: String(NOW), signatureHeader: sig, secret: SECRET, nowSeconds: NOW };
  assert.equal(await verifyWebhook({ ...base, rawBody: BODY.replace('pay_123', 'pay_999') }), false);
  assert.equal(await verifyWebhook({ ...base, rawBody: BODY, secret: 'whsec_' + Buffer.from('other').toString('base64') }), false);
  assert.equal(await verifyWebhook({ ...base, rawBody: BODY, id: 'msg_2' }), false);
});

test('stale timestamps (replay) and missing headers are rejected', async () => {
  const ts = String(NOW - 3600);
  const sig = await signWebhook({ rawBody: BODY, id: 'msg_1', timestamp: ts, secret: SECRET });
  assert.equal(await verifyWebhook({ rawBody: BODY, id: 'msg_1', timestamp: ts, signatureHeader: sig, secret: SECRET, nowSeconds: NOW }), false);
  assert.equal(await verifyWebhook({ rawBody: BODY, id: null, timestamp: String(NOW), signatureHeader: sig, secret: SECRET, nowSeconds: NOW }), false);
  assert.equal(await verifyWebhook({ rawBody: BODY, id: 'msg_1', timestamp: String(NOW), signatureHeader: null, secret: SECRET, nowSeconds: NOW }), false);
});

test('a header with several signatures verifies if any v1 signature matches', async () => {
  const good = await signWebhook({ rawBody: BODY, id: 'msg_1', timestamp: String(NOW), secret: SECRET });
  assert.equal(
    await verifyWebhook({ rawBody: BODY, id: 'msg_1', timestamp: String(NOW), signatureHeader: `v1,AAAA ${good}`, secret: SECRET, nowSeconds: NOW }),
    true
  );
});

test('environment selects the right Dodo API host', () => {
  assert.equal(dodoBaseUrl('live_mode'), 'https://live.dodopayments.com');
  assert.equal(dodoBaseUrl('test_mode'), 'https://test.dodopayments.com');
  assert.equal(dodoBaseUrl(undefined), 'https://test.dodopayments.com');
});

test('checkout session request carries our payment id, amount and urls', async () => {
  const original = globalThis.fetch;
  let captured: { url: string; init: RequestInit } | null = null;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    captured = { url, init };
    return { ok: true, status: 200, json: async () => ({ session_id: 'cks_1', checkout_url: 'https://checkout.dodopayments.com/session/cks_1' }) };
  }) as unknown as typeof fetch;
  try {
    const out = await createCheckoutSession({
      amountCents: 2500,
      paymentId: 'pay_abc',
      channelId: 'ch_1',
      returnUrl: 'https://example.com/payment/return?pid=pay_abc',
      cancelUrl: 'https://example.com/payment/return?pid=pay_abc&cancelled=1',
      config: { apiKey: 'k', productId: 'pdt_1', baseUrl: 'https://test.dodopayments.com' },
    });
    assert.equal(out.checkoutUrl, 'https://checkout.dodopayments.com/session/cks_1');
    assert.equal(captured!.url, 'https://test.dodopayments.com/checkouts');
    const body = JSON.parse(String(captured!.init.body));
    assert.deepEqual(body.product_cart, [{ product_id: 'pdt_1', quantity: 1, amount: 2500 }]);
    assert.equal(body.metadata.payment_id, 'pay_abc');
    assert.equal((captured!.init.headers as Record<string, string>).Authorization, 'Bearer k');
  } finally {
    globalThis.fetch = original;
  }
});

test.after(() => {
  db.close();
  setDb(null);
});
