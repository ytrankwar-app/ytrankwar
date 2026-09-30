import type { MetadataRoute } from 'next';
import { getSiteUrl } from '@/lib/site';

// Built per request so the sitemap URL always matches the domain serving it.
export const dynamic = 'force-dynamic';

export default async function robots(): Promise<MetadataRoute.Robots> {
  const base = await getSiteUrl();
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // API endpoints, referral redirects and per-customer payment pages are
      // not content and should never be indexed.
      disallow: ['/api/', '/r/', '/payment/'],
    },
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
