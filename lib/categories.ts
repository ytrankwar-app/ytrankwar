// Single source of truth for channel categories, matching categories.slug
// seeded in db/schema.sql. Used by both the leaderboard category tabs and
// the add-channel category selector — keep these in sync by only editing
// here, not by duplicating the list.
export const CATEGORIES: [string, string][] = [
  ['gaming', 'Gaming'],
  ['entertainment', 'Entertainment'],
  ['music', 'Music'],
  ['technology', 'Technology'],
  ['education', 'Education'],
  ['business', 'Business'],
  ['finance', 'Finance'],
  ['sports', 'Sports'],
  ['comedy', 'Comedy'],
];
