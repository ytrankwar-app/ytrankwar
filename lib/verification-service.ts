import { customAlphabet } from 'nanoid';
import { db } from '@/db';
import { newId } from './ids';

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
  return { referralCode, referralUrl, postText, communityUrl, studioUrl };
}

export class VerificationError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * MOCK check. YouTube doesn't currently expose a public API for reading
 * Community posts, so a real production implementation would most likely
 * need a server-side fetch of the public community-tab page and a check
 * that the posted text actually contains the referral link — genuinely
 * confirming the post exists and links back correctly. This mock only
 * checks that the submitted URL is *structurally* a plausible YouTube
 * community-post link (right domain, right shape, ideally matching this
 * channel's handle or id) — it does NOT fetch or read the real post
 * content. Do not treat this as a substitute for the real check above.
 */
export function looksLikeOwnCommunityPost(url: string, handle: string | null, youtubeChannelId: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
  if (host !== 'youtube.com' && host !== 'm.youtube.com') return false;

  const path = parsed.pathname.toLowerCase();
  const looksLikeCommunityShape = path.includes('/community') || path.includes('/post/');
  if (!looksLikeCommunityShape) return false;

  // Stronger signal when the URL's own path happens to embed this
  // channel's handle or id (e.g. youtube.com/@handle/community) — accept
  // immediately in that case. Real community-post permalinks
  // (youtube.com/post/Ug...) often don't embed either, though, so a
  // correctly-shaped URL without a match is still accepted below rather
  // than rejected — see the limits of this mock documented above.
  const normalizedHandle = handle?.toLowerCase().replace(/^@/, '');
  if (normalizedHandle && path.includes(normalizedHandle)) return true;
  if (path.includes(youtubeChannelId.toLowerCase())) return true;

  return true;
}

/**
 * Records the submitted proof and marks the channel verified. The caller
 * (API route) is responsible for having already checked the requester's
 * manage_token before calling this — this function only knows about the
 * channel, not who's asking.
 */
export function submitCommunityPostProof(params: {
  channelId: string;
  postUrl: string;
  referralCode: string;
  handle: string | null;
  youtubeChannelId: string;
}): void {
  if (!looksLikeOwnCommunityPost(params.postUrl, params.handle, params.youtubeChannelId)) {
    throw new VerificationError(
      'invalid_proof',
      "That doesn't look like a YouTube Community post link. Paste the URL of the post itself (it should look like youtube.com/@yourhandle/community or youtube.com/post/...)."
    );
  }

  const channel = db.prepare('SELECT owner_user_id as ownerUserId FROM channels WHERE id = ?').get(params.channelId) as
    | { ownerUserId: string }
    | undefined;
  if (!channel) throw new VerificationError('not_found', "We couldn't find that channel.");

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO channel_ownership_tokens (id, channel_id, user_id, token, proof_url, status, resolved_at)
       VALUES (?, ?, ?, ?, ?, 'verified', strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
    ).run(newId('tok'), params.channelId, channel.ownerUserId, params.referralCode, params.postUrl);

    db.prepare(`UPDATE channels SET verification_status = 'verified' WHERE id = ?`).run(params.channelId);
  });
  tx();
}
