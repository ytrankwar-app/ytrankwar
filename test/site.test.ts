import test from 'node:test';
import assert from 'node:assert/strict';
import { siteUrlFromHeaders } from '../lib/site';

test('site url from forwarded headers prefers x-forwarded-host and https', () => {
  const h: Record<string, string> = { 'x-forwarded-host': 'ytrankwar.com', 'x-forwarded-proto': 'https' };
  assert.equal(siteUrlFromHeaders((n) => h[n] ?? null), 'https://ytrankwar.com');
});

test('localhost defaults to http, other hosts to https', () => {
  assert.equal(siteUrlFromHeaders((n) => (n === 'host' ? 'localhost:3000' : null)), 'http://localhost:3000');
  assert.equal(siteUrlFromHeaders((n) => (n === 'host' ? 'example.org' : null)), 'https://example.org');
});
