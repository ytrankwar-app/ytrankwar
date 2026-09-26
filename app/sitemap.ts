import type { MetadataRoute } from 'next';
import { db } from '@/db';

const SITE_URL = process.env.SITE_URL || 'https://ytrankwar.example';

// Without this, Next.js prerenders this route once at build time and never
// again — new channels added afterward would silently never appear in the
// sitemap. Confirmed: with only `revalidate` set, the build output still
// showed "○ (Static)" for this route; force-dynamic is what actually flips
// it to server-rendered-on-demand ("ƒ") in this Next.js version — same
// class of bug as /api/stats needing the same fix.
export const dynamic = 'force-dynamic';

export default function sitemap(): MetadataRoute.Sitemap {
  const channels = db
    .prepare(
      `SELECT slug, created_at as createdAt FROM channels
       WHERE moderation_status = 'approved' AND is_available = 1
       ORDER BY created_at DESC`
    )
    .all() as { slug: string; createdAt: string }[];

  return [
    { url: SITE_URL, changeFrequency: 'always', priority: 1 },
    ...channels.map((c) => ({
      url: `${SITE_URL}/channel/${c.slug}`,
      lastModified: c.createdAt,
      changeFrequency: 'hourly' as const,
      priority: 0.7,
    })),
  ];
}
