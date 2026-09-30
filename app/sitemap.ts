import type { MetadataRoute } from 'next';
import { getDb } from '@/db';
import { getSiteUrl } from '@/lib/site';

// Without force-dynamic Next.js prerenders this once at build time and new
// channels would never appear. It also keeps the D1 query out of the build.
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = await getSiteUrl();

  const pages: MetadataRoute.Sitemap = [
    { url: base, changeFrequency: 'always', priority: 1 },
    { url: `${base}/rules`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${base}/policy`, changeFrequency: 'monthly', priority: 0.5 },
  ];

  try {
    const db = await getDb();
    // Sitemap protocol limit is 50,000 URLs per file.
    const channels = await db.all<{ slug: string; updatedAt: string }>(
      `SELECT c.slug as slug, COALESCE(l.updated_at, c.created_at) as updatedAt
       FROM channels c LEFT JOIN listings l ON l.channel_id = c.id
       WHERE c.moderation_status = 'approved' AND c.is_available = 1
       ORDER BY c.created_at DESC
       LIMIT 49000`
    );
    return [
      ...pages,
      ...channels.map((c) => ({
        url: `${base}/channel/${c.slug}`,
        lastModified: c.updatedAt,
        changeFrequency: 'hourly' as const,
        priority: 0.7,
      })),
    ];
  } catch (e) {
    // Never fail the whole sitemap because the database hiccupped.
    console.error('[sitemap]', e);
    return pages;
  }
}
