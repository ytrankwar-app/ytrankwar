// Dodo Payments integration (https://docs.dodopayments.com).
//
// Uses the REST API directly with fetch and Web Crypto — no SDK — so it runs
// unchanged on Cloudflare Workers.
//
//   * createCheckoutSession  -> POST {base}/checkouts   (hosted checkout)
//   * getCheckoutSession     -> GET  {base}/checkouts/{id}
//   * verifyWebhook          -> Standard Webhooks HMAC-SHA256 verification
//
// Bids are variable amounts, so the Dodo product used for checkout must be a
// one-time "Pay What You Want" product; we pass the exact amount (in cents)
// on the cart item and Dodo charges exactly that.

export class DodoError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

export interface DodoConfig {
  apiKey: string;
  productId: string;
  baseUrl: string;
}

export function dodoBaseUrl(env: string | undefined): string {
  return (env || '').toLowerCase() === 'live_mode' ? 'https://live.dodopayments.com' : 'https://test.dodopayments.com';
}

/** True for empty values and for template placeholders like "REPLACE_WITH_...". */
function isRealValue(v: string | undefined): v is string {
  const t = (v || '').trim();
  return t.length > 0 && !/^(replace|your_|changeme|todo|xxx)/i.test(t) && !/REPLACE[_-]WITH/i.test(t);
}

export function getDodoConfig(): DodoConfig {
  const apiKey = process.env.DODO_PAYMENTS_API_KEY;
  const productId = process.env.DODO_PRODUCT_ID;
  if (!isRealValue(apiKey) || !isRealValue(productId)) {
    throw new DodoError(
      'Payments are not configured yet (DODO_PAYMENTS_API_KEY / DODO_PRODUCT_ID are missing).'
    );
  }
  return { apiKey, productId, baseUrl: dodoBaseUrl(process.env.DODO_PAYMENTS_ENVIRONMENT) };
}

export function isDodoConfigured(): boolean {
  return isRealValue(process.env.DODO_PAYMENTS_API_KEY) && isRealValue(process.env.DODO_PRODUCT_ID);
}

/** Plain-English hint for the operator (logs only, never shown to customers). */
export function dodoFailureHint(status: number | undefined, baseUrl: string): string {
  const mode = baseUrl.includes('test.') ? 'test_mode' : 'live_mode';
  if (status === 401 || status === 403)
    return `Dodo rejected the API key. The key must belong to ${mode} (DODO_PAYMENTS_ENVIRONMENT currently selects ${mode}). Test keys need test_mode, live keys need live_mode; also re-run "wrangler secret put DODO_PAYMENTS_API_KEY" and redeploy.`;
  if (status === 404)
    return `Dodo could not find DODO_PRODUCT_ID in ${mode}. Products are separate per mode: use a ${mode} product id.`;
  if (status === 400 || status === 422)
    return 'Dodo rejected the request body. Usual causes: the product is not "Pay What You Want", or the amount is below its minimum / above its maximum.';
  if (status === 429) return 'Dodo rate limit hit.';
  return 'Unexpected response from Dodo; see the status and body above.';
}

export async function createCheckoutSession(params: {
  amountCents: number;
  paymentId: string;
  channelId: string;
  returnUrl: string;
  cancelUrl: string;
  config?: DodoConfig;
}): Promise<{ sessionId: string; checkoutUrl: string }> {
  const cfg = params.config ?? getDodoConfig();

  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}/checkouts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product_cart: [{ product_id: cfg.productId, quantity: 1, amount: params.amountCents }],
        return_url: params.returnUrl,
        cancel_url: params.cancelUrl,
        metadata: { payment_id: params.paymentId, channel_id: params.channelId },
      }),
    });
  } catch {
    throw new DodoError('Could not reach the payment provider. Please try again.');
  }

  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 500); // raw body: Dodo's shape varies by error
    } catch {
      // unreadable body
    }
    console.error(
      `[dodo] create checkout failed: HTTP ${res.status} from ${cfg.baseUrl} | body: ${detail} | hint: ${dodoFailureHint(res.status, cfg.baseUrl)}`
    );
    throw new DodoError('The payment provider rejected the checkout request.', res.status);
  }

  const data = (await res.json()) as { session_id?: string; checkout_url?: string | null };
  if (!data.session_id || !data.checkout_url) {
    throw new DodoError('The payment provider did not return a checkout link.');
  }
  return { sessionId: data.session_id, checkoutUrl: data.checkout_url };
}

export async function getCheckoutSession(
  sessionId: string,
  config?: DodoConfig
): Promise<{ paymentId: string | null; paymentStatus: string | null }> {
  const cfg = config ?? getDodoConfig();
  const res = await fetch(`${cfg.baseUrl}/checkouts/${encodeURIComponent(sessionId)}`, {
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
  });
  if (!res.ok) throw new DodoError(`Could not read the checkout session (${res.status}).`, res.status);
  const data = (await res.json()) as { payment_id?: string | null; payment_status?: string | null };
  return { paymentId: data.payment_id ?? null, paymentStatus: data.payment_status ?? null };
}

// ---------------------------------------------------------------------------
// Webhook verification (Standard Webhooks)
// ---------------------------------------------------------------------------

const enc = new TextEncoder();

function b64decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64encode(bytes: ArrayBuffer): string {
  let s = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s);
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

/**
 * Verifies a Dodo Payments webhook. `rawBody` MUST be the exact bytes
 * received (read with req.text(), never re-serialised JSON).
 * Returns true only if a `v1` signature matches and the timestamp is fresh.
 */
export async function verifyWebhook(params: {
  rawBody: string;
  id: string | null;
  timestamp: string | null;
  signatureHeader: string | null;
  secret: string;
  nowSeconds?: number;
}): Promise<boolean> {
  const { rawBody, id, timestamp, signatureHeader, secret } = params;
  if (!id || !timestamp || !signatureHeader || !secret) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > WEBHOOK_TOLERANCE_SECONDS) return false;

  const keyBytes = secret.startsWith('whsec_') ? b64decode(secret.slice(6)) : enc.encode(secret);
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signed = await crypto.subtle.sign('HMAC', key, enc.encode(`${id}.${timestamp}.${rawBody}`));
  const expected = b64encode(signed);

  return signatureHeader
    .split(' ')
    .map((p) => p.trim())
    .filter((p) => p.startsWith('v1,'))
    .some((p) => safeEqual(p.slice(3), expected));
}

/** Test helper: produce the header a real Dodo delivery would carry. */
export async function signWebhook(params: {
  rawBody: string;
  id: string;
  timestamp: string;
  secret: string;
}): Promise<string> {
  const keyBytes = params.secret.startsWith('whsec_') ? b64decode(params.secret.slice(6)) : enc.encode(params.secret);
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${params.id}.${params.timestamp}.${params.rawBody}`));
  return `v1,${b64encode(sig)}`;
}
