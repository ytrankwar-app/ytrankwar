import { customAlphabet } from 'nanoid';
import { getDb, NOW_SQL } from '@/db';
import { newId } from './ids';
import { fetchLiveChannelDescription, YouTubeLookupError } from './youtube';

// Alphabet excludes 0/O/1/I to avoid transcription mistakes if anyone
// copies it by hand; mainly used as a short, readable path segment for the
// public /r/{code} referral URL.
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const generateCode = customAlphabet(CODE_ALPHABET, 8);

/** PUBLIC, safe-to-share code. See channels.referral_code. */
export function newReferralCode(): string {
  return `YTW-${generateCode()}`;
}

export interface VerificationInfo {
  referralCode: string;
  referralUrl: string;
  postText: string;
  communityUrl: string;
  studioUrl: string;
  /** The exact line the owner must add to the channel description. */
  verificationLine: string;
  /** Where the owner edits the channel description. */
  descriptionEditUrl: string;
}

/**
 * Builds the one shareable link a channel owner needs: posting it to their
 * YouTube Community tab both proves ownership (only the real owner can post
 * there) and drives referred visits (see app/r/[code]/route.ts). YouTube has
 * no public "compose intent" URL like X's `intent/tweet?text=...`, so these
 * are best-effort deep links to the right page — the suggested text still
 * has to be copy-pasted by hand, which is disclosed in the UI, not hidden.
 */
export function getVerificationInfo(
  channel: { referralCode: string | null; handle: string | null; youtubeChannelId: string; slug: string; name: string },
  siteUrl: string
): VerificationInfo {
  const referralCode = channel.referralCode ?? 'MISSING-CODE';
  const referralUrl = `${siteUrl}/r/${referralCode}`;
  const postText = `🏆 ${channel.name} just claimed a spot on the ytrankwar leaderboard! Check out our ranking and help us climb: ${referralUrl}`;
  const communityUrl = channel.handle
    ? `https://www.youtube.com/${channel.handle}/community`
    : `https://www.youtube.com/channel/${channel.youtubeChannelId}/community`;
  const studioUrl = `https://studio.youtube.com/channel/${channel.youtubeChannelId}/community`;
  const verificationLine = `ytrankwar verification: ${referralCode}`;
  const descriptionEditUrl = `https://studio.youtube.com/channel/${channel.youtubeChannelId}/editing/details`;
  return { referralCode, referralUrl, postText, communityUrl, studioUrl, verificationLine, descriptionEditUrl };
}

export class VerificationError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** True when the description contains this channel's code (case-insensitive). */
export function descriptionHasCode(description: string, code: string): boolean {
  if (!code || code === 'MISSING-CODE') return false;
  return description.toUpperCase().includes(code.toUpperCase());
}

const RETRY_COOLDOWN_SECONDS = 10;

/**
 * Real ownership check. The owner adds `ytrankwar verification: <code>` to
 * their channel DESCRIPTION (only the owner can edit it). We then read that
 * SAME channel's description live from the official YouTube Data API, keyed
 * by the channel's own permanent id, and require the code to be there.
 *
 *  - Proof on a different channel can never pass: we never look at a URL the
 *    caller supplies, only at the target channel's own description.
 *  - No API key => we refuse (never auto-verify) outside `next dev`.
 */
export async function verifyChannelOwnership(channelId: string): Promise<void> {
  const db = await getDb();
  const channel = await db.first<{
    ownerUserId: string;
    youtubeChannelId: string;
    referralCode: string | null;
    verificationStatus: string;
  }>(
    `SELECT owner_user_id as ownerUserId, youtube_channel_id as youtubeChannelId,
            referral_code as referralCode, verification_status as verificationStatus
     FROM channels WHERE id = ?`,
    [channelId]
  );
  if (!channel) throw new VerificationError('not_found', "We couldn't find that channel.");
  if (channel.verificationStatus === 'verified') return;

  const code = channel.referralCode ?? '';

  // Local development without a YouTube key: allow so the flow can be tried.
  // In production (no key) verification is unavailable rather than skipped.
  if (!process.env.YOUTUBE_API_KEY) {
    if (process.env.NODE_ENV !== 'development') {
      console.error('[verify] YOUTUBE_API_KEY is not configured; ownership cannot be checked.');
      throw new VerificationError('unavailable', 'Verification is temporarily unavailable. Please try again later.');
    }
    await markVerified(channelId, channel.ownerUserId, code, 'dev-no-youtube-key');
    return;
  }

  // Cheap brake on hammering the YouTube quota for one channel.
  const recent = await db.first(
    `SELECT 1 as x FROM channel_ownership_tokens
     WHERE channel_id = ? AND status = 'rejected'
       AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-${RETRY_COOLDOWN_SECONDS} seconds')`,
    [channelId]
  );
  if (recent) {
    throw new VerificationError('too_fast', `Please wait ${RETRY_COOLDOWN_SECONDS} seconds before checking again.`);
  }

  let live: { id: string; description: string } | null;
  try {
    live = await fetchLiveChannelDescription(channel.youtubeChannelId);
  } catch (e) {
    if (e instanceof YouTubeLookupError) {
      console.error('[verify] YouTube lookup failed:', e.message);
      throw new VerificationError('unavailable', 'Verification is temporarily unavailable. Please try again later.');
    }
    throw e;
  }

  // The returned channel must be exactly the one we are verifying.
  if (!live || live.id !== channel.youtubeChannelId) {
    throw new VerificationError('not_found', "We couldn't read that YouTube channel. Please try again later.");
  }

  if (!descriptionHasCode(live.description, code)) {
    await db.run(
      `INSERT INTO channel_ownership_tokens (id, channel_id, user_id, token, status, resolved_at)
       VALUES (?, ?, ?, ?, 'rejected', ${NOW_SQL})`,
      [newId('tok'), channelId, channel.ownerUserId, code]
    );
    throw new VerificationError(
      'code_not_found',
      "We couldn't find the verification line in this channel's description yet. Save it in YouTube Studio, wait a minute, and check again."
    );
  }

  await markVerified(channelId, channel.ownerUserId, code, 'description');
}

async function markVerified(channelId: string, userId: string, code: string, method: string): Promise<void> {
  const db = await getDb();
  // One atomic batch: the audit row and the status change land together.
  await db.batch([
    {
      sql: `INSERT INTO channel_ownership_tokens (id, channel_id, user_id, token, proof_url, status, resolved_at)
            VALUES (?, ?, ?, ?, ?, 'verified', ${NOW_SQL})`,
      params: [newId('tok'), channelId, userId, code, `method:${method}`],
    },
    { sql: `UPDATE channels SET verification_status = 'verified' WHERE id = ?`, params: [channelId] },
  ]);
}
