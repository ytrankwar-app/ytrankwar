import { db } from '@/db';

/**
 * There is no login in this app. A channel's `manage_token` (generated once
 * at submission time, see lib/channel-service.ts) is the only credential
 * that authorizes bidding on or verifying that specific channel — the same
 * trust model as a password-reset "magic link". The client is expected to
 * hold onto it (localStorage) and send it back with every management
 * request; this function is the single place that check happens.
 *
 * This is intentionally channel-scoped, not identity-scoped: there is no
 * concept of "a person" who owns several channels beyond "a browser that
 * happens to be holding several tokens in localStorage".
 */
export function verifyManageToken(channelId: string, manageToken: string | null | undefined): boolean {
  if (!manageToken) return false;
  const row = db.prepare('SELECT manage_token as manageToken FROM channels WHERE id = ?').get(channelId) as
    | { manageToken: string | null }
    | undefined;
  if (!row || !row.manageToken) return false;
  return row.manageToken === manageToken;
}

export class ManageAuthError extends Error {
  constructor() {
    super('Invalid or missing management link for this channel.');
  }
}

export function requireManageToken(channelId: string, manageToken: string | null | undefined): void {
  if (!verifyManageToken(channelId, manageToken)) {
    throw new ManageAuthError();
  }
}
