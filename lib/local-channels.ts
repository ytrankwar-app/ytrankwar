'use client';

// No login in this app. "My channels" is entirely client-side: whichever
// channels this browser has created, along with the SECRET manage_token
// that authorizes managing/bidding on each one. This is the same trust
// model as a password-reset link — whoever holds the token controls the
// channel — so this data never leaves localStorage except as the
// `manageToken` field sent with a specific management request.

const STORAGE_KEY = 'ytrankwar_my_channels';

export interface LocalChannel {
  channelId: string;
  manageToken: string;
  slug: string;
  name: string;
}

export function getLocalChannels(): LocalChannel[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLocalChannel(channel: LocalChannel): void {
  try {
    const existing = getLocalChannels().filter((c) => c.channelId !== channel.channelId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...existing, channel]));
  } catch {
    // localStorage unavailable (e.g. privacy mode) — the channel still
    // exists server-side, but this browser won't remember it. Nothing to
    // recover from here; the user would need their saved manage link.
  }
}

export function getLocalChannel(channelId: string): LocalChannel | null {
  return getLocalChannels().find((c) => c.channelId === channelId) ?? null;
}

export function getManageToken(channelId: string): string | null {
  return getLocalChannel(channelId)?.manageToken ?? null;
}
