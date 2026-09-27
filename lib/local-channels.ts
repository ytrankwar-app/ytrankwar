'use client';

// There is no login and no ownership credential anywhere in this app —
// anyone can bid on or verify any channel by calling the API directly.
// "My channels" is purely a client-side convenience: whichever channels
// this browser has added, remembered so the UI can offer a shortlist
// (e.g. "which of your channels do you want to bid up?") instead of
// making you hunt down a channel by slug every time. It grants no
// access — clearing it or switching devices loses only the shortcut,
// never control of anything.

const STORAGE_KEY = 'ytrankwar_my_channels';

export interface LocalChannel {
  channelId: string;
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
    // localStorage unavailable (e.g. privacy mode) — harmless, this is
    // only a convenience shortlist.
  }
}

export function getLocalChannel(channelId: string): LocalChannel | null {
  return getLocalChannels().find((c) => c.channelId === channelId) ?? null;
}
