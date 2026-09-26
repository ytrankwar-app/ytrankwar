'use client';

import { useEffect } from 'react';
import { saveLocalChannel } from '@/lib/local-channels';

/**
 * If this page was reached via a saved manage link
 * (/channel/{slug}?manage={token}), persist that token into this browser's
 * localStorage so future visits (without the query param) still recognize
 * ownership — and strip it from the visible URL/history afterward so the
 * secret doesn't linger in browser history or get leaked via a Referer
 * header on an outbound link click.
 */
export function ManageTokenCapture({
  channelId,
  slug,
  name,
}: {
  channelId: string;
  slug: string;
  name: string;
}) {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('manage');
    if (!token) return;

    saveLocalChannel({ channelId, manageToken: token, slug, name });

    params.delete('manage');
    const cleanQuery = params.toString();
    const cleanUrl = `${window.location.pathname}${cleanQuery ? `?${cleanQuery}` : ''}`;
    window.history.replaceState(null, '', cleanUrl);
  }, [channelId, slug, name]);

  return null;
}
