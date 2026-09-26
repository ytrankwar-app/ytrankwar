import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeYouTubeInput, YouTubeLookupError } from '../lib/youtube';

test('accepts a standard @handle URL', () => {
  const r = normalizeYouTubeInput('https://youtube.com/@mrbeast');
  assert.deepEqual(r, { kind: 'handle', value: '@mrbeast' });
});

test('accepts a channel/UC... URL', () => {
  const r = normalizeYouTubeInput('https://www.youtube.com/channel/UC1234567890');
  assert.deepEqual(r, { kind: 'id', value: 'UC1234567890' });
});

test('accepts a bare @handle with no URL', () => {
  const r = normalizeYouTubeInput('@some_channel-1');
  assert.deepEqual(r, { kind: 'handle', value: '@some_channel-1' });
});

test('rejects an empty string', () => {
  assert.throws(() => normalizeYouTubeInput('   '), YouTubeLookupError);
});

test('rejects arbitrary non-URL text instead of treating it as a channel slug', () => {
  assert.throws(() => normalizeYouTubeInput('not a url'), YouTubeLookupError);
  assert.throws(() => normalizeYouTubeInput('hello world'), YouTubeLookupError);
});

test('rejects a non-YouTube URL', () => {
  assert.throws(() => normalizeYouTubeInput('https://vimeo.com/@someone'), YouTubeLookupError);
});

test('rejects a malformed URL string', () => {
  assert.throws(() => normalizeYouTubeInput('https://'), YouTubeLookupError);
});
