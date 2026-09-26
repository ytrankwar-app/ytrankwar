// Bindings and variables available on `getCloudflareContext().env`.
import type { D1Database } from '@cloudflare/workers-types';

declare global {
  interface CloudflareEnv {
    DB: D1Database;
    SITE_URL?: string;
    YOUTUBE_API_KEY?: string;
  }
}

export {};
