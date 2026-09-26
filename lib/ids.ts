import { nanoid } from 'nanoid';

export function newId(prefix: string): string {
  return `${prefix}_${nanoid(14)}`;
}

/** A secret, high-entropy credential (see manage_token) — deliberately much
 *  longer than newId()'s ids, since this one grants control of a channel to
 *  whoever holds it and must not be practically guessable. */
export function newSecretToken(): string {
  return nanoid(40);
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60) || 'channel';
}
