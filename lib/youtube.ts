// YouTube Data API v3 client, with a deterministic mock fallback.
//
// Real data is used automatically once YOUTUBE_API_KEY is set in the
// environment (see .env.example) — no other code needs to change, since
// both paths return the same YouTubeChannelInfo shape. Never scrape
// YouTube pages; this always uses the official Data API. Real lookups are
// cached in `channel_stats` and refreshed on a schedule, never called on
// every page view (see the deployment notes in the README).

export interface YouTubeChannelInfo {
  youtubeChannelId: string;
  name: string;
  handle: string | null;
  avatarUrl: string;
  description: string;
  subscribers: number;
  totalViews: number;
  videoCount: number;
  channelCreatedAt: string; // ISO date
}

export class YouTubeLookupError extends Error {}

/**
 * Parses a pasted YouTube URL / handle into a normalized identifier.
 * Accepts: youtube.com/@handle, youtube.com/channel/UC..., youtube.com/c/name, bare @handle
 */
export function normalizeYouTubeInput(raw: string): { kind: 'id' | 'handle' | 'custom'; value: string } {
  const trimmed = raw.trim();
  if (!trimmed) throw new YouTubeLookupError('Please enter a YouTube channel URL or handle.');

  if (/^https?:\/\//i.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      throw new YouTubeLookupError('Please enter a valid YouTube channel URL.');
    }
    if (!/youtube\.com$|youtu\.be$/i.test(url.hostname.replace(/^www\./, ''))) {
      throw new YouTubeLookupError('Please enter a valid YouTube channel URL.');
    }
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0]?.startsWith('@')) return { kind: 'handle', value: parts[0] };
    if (parts[0] === 'channel' && parts[1]) return { kind: 'id', value: parts[1] };
    if (parts[0] === 'c' && parts[1]) return { kind: 'custom', value: parts[1] };
    if (parts[0]) return { kind: 'custom', value: parts[0] };
    throw new YouTubeLookupError('Please enter a valid YouTube channel URL.');
  }

  // Not a URL: only accept a bare, well-formed @handle. Anything else
  // (plain words, sentences, garbage) is rejected rather than silently
  // treated as a channel slug.
  if (/^@[a-zA-Z0-9._-]{2,60}$/.test(trimmed)) {
    return { kind: 'handle', value: trimmed };
  }

  throw new YouTubeLookupError('Please enter a valid YouTube channel URL.');
}

// Deterministic pseudo-random generator so the same input always mocks the
// same channel (stable across requests/demo restarts) without a database.
function seededInt(seed: string, min: number, max: number): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const normalized = (h >>> 0) / 4294967295;
  return Math.floor(min + normalized * (max - min));
}

function mockLookup(parsed: { kind: 'id' | 'handle' | 'custom'; value: string }): YouTubeChannelInfo {
  const handle = parsed.kind === 'handle' ? parsed.value : `@${parsed.value}`;
  const seed = handle.toLowerCase();

  const subscribers = seededInt(seed, 500, 5_000_000);
  const totalViews = subscribers * seededInt(seed + 'v', 20, 400);
  const videoCount = seededInt(seed + 'c', 5, 3000);

  return {
    youtubeChannelId: `UC${Buffer.from(seed).toString('base64url').slice(0, 22).padEnd(22, '0')}`,
    name: parsed.value.replace(/^@/, '').replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    handle,
    avatarUrl: `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(seed)}`,
    description: 'Channel description will populate from the real YouTube Data API in production.',
    subscribers,
    totalViews,
    videoCount,
    channelCreatedAt: new Date(Date.now() - seededInt(seed + 't', 100, 3000) * 86_400_000).toISOString(),
  };
}

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

interface RawChannelItem {
  id: string;
  snippet: {
    title: string;
    description?: string;
    customUrl?: string;
    publishedAt: string;
    thumbnails?: { high?: { url: string }; medium?: { url: string }; default?: { url: string } };
  };
  statistics: {
    subscriberCount?: string;
    hiddenSubscriberCount?: boolean;
    viewCount?: string;
    videoCount?: string;
  };
}

function channelItemToInfo(item: RawChannelItem): YouTubeChannelInfo {
  const rawCustomUrl = item.snippet.customUrl ?? null;
  const handle = rawCustomUrl ? (rawCustomUrl.startsWith('@') ? rawCustomUrl : `@${rawCustomUrl}`) : null;
  return {
    youtubeChannelId: item.id,
    name: item.snippet.title,
    handle,
    avatarUrl:
      item.snippet.thumbnails?.high?.url ??
      item.snippet.thumbnails?.medium?.url ??
      item.snippet.thumbnails?.default?.url ??
      '',
    description: item.snippet.description ?? '',
    subscribers: item.statistics.hiddenSubscriberCount ? 0 : Number(item.statistics.subscriberCount ?? 0),
    totalViews: Number(item.statistics.viewCount ?? 0),
    videoCount: Number(item.statistics.videoCount ?? 0),
    channelCreatedAt: item.snippet.publishedAt,
  };
}

async function callYouTubeApi(path: string, params: Record<string, string>, apiKey: string): Promise<any> {
  const url = new URL(`${YOUTUBE_API_BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('key', apiKey);

  let res: Response;
  try {
    res = await fetch(url.toString());
  } catch {
    throw new YouTubeLookupError('Could not reach the YouTube Data API. Check your connection and try again.');
  }

  if (!res.ok) {
    let reason = '';
    try {
      const body = await res.json();
      reason = body?.error?.errors?.[0]?.reason || body?.error?.message || '';
    } catch {
      // response wasn't JSON — fall through with an empty reason
    }
    if (res.status === 403 && /quota/i.test(reason)) {
      throw new YouTubeLookupError('The YouTube API daily quota has been used up. Please try again tomorrow.');
    }
    if (res.status === 400 || res.status === 403) {
      throw new YouTubeLookupError('YouTube API key is invalid, restricted, or missing required permissions.');
    }
    throw new YouTubeLookupError(`YouTube API error (${res.status}). Please try again.`);
  }

  return res.json();
}

async function realLookup(
  parsed: { kind: 'id' | 'handle' | 'custom'; value: string },
  apiKey: string
): Promise<YouTubeChannelInfo> {
  const baseParams = { part: 'snippet,statistics' };

  if (parsed.kind === 'id') {
    const data = await callYouTubeApi('channels', { ...baseParams, id: parsed.value }, apiKey);
    if (!data.items?.length) throw new YouTubeLookupError("We couldn't find that YouTube channel.");
    return channelItemToInfo(data.items[0]);
  }

  if (parsed.kind === 'handle') {
    // `forHandle` covers current @handle-style URLs (added to the API in 2024).
    const data = await callYouTubeApi('channels', { ...baseParams, forHandle: parsed.value }, apiKey);
    if (data.items?.length) return channelItemToInfo(data.items[0]);
    // Fall through to search below rather than failing immediately — some
    // very old channels can have quirks forHandle doesn't resolve.
  }

  if (parsed.kind === 'custom') {
    // Legacy /c/name or bare-slug URLs aren't guaranteed to match forHandle
    // or the old forUsername parameter, so try forUsername first (cheap,
    // 1 quota unit) before falling back to a search (100 quota units).
    const byUsername = await callYouTubeApi('channels', { ...baseParams, forUsername: parsed.value }, apiKey);
    if (byUsername.items?.length) return channelItemToInfo(byUsername.items[0]);
  }

  // Last resort for handles/custom slugs that didn't resolve directly:
  // search by name and fetch full details for the top result. Costs 100
  // quota units (vs. 1 for a direct lookup) — only reached when the cheap
  // paths above didn't find anything.
  const query = parsed.kind === 'handle' ? parsed.value.replace(/^@/, '') : parsed.value;
  const searchData = await callYouTubeApi(
    'search',
    { part: 'snippet', type: 'channel', maxResults: '1', q: query },
    apiKey
  );
  const channelId = searchData.items?.[0]?.id?.channelId;
  if (!channelId) throw new YouTubeLookupError("We couldn't find that YouTube channel.");
  return realLookup({ kind: 'id', value: channelId }, apiKey);
}

export async function lookupChannel(rawInput: string): Promise<YouTubeChannelInfo> {
  const parsed = normalizeYouTubeInput(rawInput);
  const apiKey = process.env.YOUTUBE_API_KEY;

  if (apiKey) {
    // A configured key means real data is expected — never silently fall
    // back to mock data on a real API failure, since that would look
    // exactly like genuine data while actually being fake.
    return realLookup(parsed, apiKey);
  }

  return mockLookup(parsed);
}

/**
 * Live read of ONE channel's public description straight from the official
 * Data API (1 quota unit). Used for ownership verification: only the real
 * owner can edit a channel's description, and the lookup is keyed by the
 * channel's own permanent UC... id, so proof placed on a different channel
 * can never satisfy it. Returns null when the channel no longer exists.
 */
export async function fetchLiveChannelDescription(
  youtubeChannelId: string
): Promise<{ id: string; description: string } | null> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new YouTubeLookupError('YOUTUBE_API_KEY is not configured.');
  const data = await callYouTubeApi('channels', { part: 'snippet', id: youtubeChannelId }, apiKey);
  const item = data.items?.[0];
  if (!item) return null;
  return { id: String(item.id), description: String(item.snippet?.description ?? '') };
}
