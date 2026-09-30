// Resolves the public base URL of the site (no trailing slash).
//
// Order of preference:
//   1. SITE_URL, when it is set to a real URL (production: set it in
//      wrangler.toml [vars] to the main domain).
//   2. The host of the current request, so links, the sitemap and payment
//      return URLs are still correct on whatever domain served the request
//      even if SITE_URL was forgotten.
//   3. http://localhost:3000 outside a request (e.g. a build step).

const PLACEHOLDER_HOSTS = /(^|\.)example(\.|$)/i;

function clean(url: string): string {
  return url.replace(/\/+$/, '');
}

export function configuredSiteUrl(): string | null {
  const raw = (process.env.SITE_URL || '').trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (PLACEHOLDER_HOSTS.test(u.hostname)) return null;
    return clean(u.origin);
  } catch {
    return null;
  }
}

export function siteUrlFromHeaders(get: (name: string) => string | null | undefined): string | null {
  const host = get('x-forwarded-host') || get('host');
  if (!host) return null;
  const proto = get('x-forwarded-proto') || (/^(localhost|127\.|\[::1\])/.test(host) ? 'http' : 'https');
  return clean(`${proto.split(',')[0].trim()}://${host.split(',')[0].trim()}`);
}

/** For server components / route handlers that have a request context. */
export async function getSiteUrl(): Promise<string> {
  const configured = configuredSiteUrl();
  if (configured) return configured;
  try {
    const { headers } = await import('next/headers');
    const h = headers();
    const fromHeaders = siteUrlFromHeaders((n) => h.get(n));
    if (fromHeaders) return fromHeaders;
  } catch {
    // not inside a request
  }
  return 'http://localhost:3000';
}

/** For code that already has a Request in hand. */
export function siteUrlFromRequest(req: Request): string {
  return configuredSiteUrl() ?? clean(new URL(req.url).origin);
}

export const CONTACT_EMAIL = 'ytrankwar@gmail.com';
export const SITE_NAME = 'ytrankwar';
