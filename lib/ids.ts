import { nanoid } from 'nanoid';

export function newId(prefix: string): string {
  return `${prefix}_${nanoid(14)}`;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60) || 'channel';
}
