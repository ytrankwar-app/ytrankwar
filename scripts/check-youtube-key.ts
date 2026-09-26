// Run locally with: npx tsx scripts/check-youtube-key.ts
//
// This never prints your actual key or sends it anywhere except directly to
// Google's API from your own machine — safe to run and share the output.

import { loadLocalEnv } from './load-env';

loadLocalEnv();

const apiKey = process.env.YOUTUBE_API_KEY;

function mask(key: string): string {
  if (key.length <= 8) return '*'.repeat(key.length);
  return `${key.slice(0, 4)}${'*'.repeat(key.length - 8)}${key.slice(-4)}`;
}

async function main() {
  console.log('--- YouTube API key diagnostic ---\n');

  if (!apiKey) {
    console.log('❌ YOUTUBE_API_KEY is not set (checked .env.local / .env / process env).');
    console.log('   The app will use mock data until this is set, then the dev server is restarted.');
    process.exitCode = 1;
    return;
  }

  console.log(`Found YOUTUBE_API_KEY: ${mask(apiKey)} (${apiKey.length} characters)`);
  if (apiKey.length !== 39 || !apiKey.startsWith('AIzaSy')) {
    console.log(
      '⚠️  This does not look like a well-formed Google API key. Real keys are exactly 39 characters and start with "AIzaSy". Double-check you copied the whole thing with no extra quotes, spaces, or line breaks in .env.local.\n'
    );
  }

  const url = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&forHandle=@YouTube&key=${apiKey}`;

  console.log('\nCalling YouTube Data API (channels.list, forHandle=@YouTube)...\n');

  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    console.log('❌ Network error reaching googleapis.com:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
    return;
  }

  const body = await res.json().catch(() => null);

  if (res.ok) {
    const item = body?.items?.[0];
    console.log('✅ Success! The key works. Sample response:');
    console.log(`   Channel: ${item?.snippet?.title}`);
    console.log(`   Subscribers: ${item?.statistics?.subscriberCount}`);
    console.log('\nIf real data still isn\'t showing in the app for a channel you added, the most');
    console.log('likely cause is that channel was added BEFORE the key was set — data is fetched');
    console.log('once at submission time and cached, not re-fetched later. Run `npm run db:refresh-stats`');
    console.log('to backfill real data onto channels you already added.');
    return;
  }

  console.log(`❌ Request failed with HTTP ${res.status}`);
  console.log('Raw error from Google:', JSON.stringify(body?.error ?? body, null, 2));

  const bodyText = JSON.stringify(body);
  const reason = body?.error?.errors?.[0]?.reason;
  console.log('\nDiagnosis:');
  if (/API_KEY_HTTP_REFERRER_BLOCKED|referrer.*blocked|referer.*blocked/i.test(bodyText)) {
    console.log('- CONFIRMED: this key has "HTTP referrer" restrictions in Google Cloud Console.');
    console.log('  That restriction type only ever works for requests made from a browser (which sends a');
    console.log('  Referer header) — it will ALWAYS reject this kind of server-side call, with no exceptions.');
    console.log('  Fix: console.cloud.google.com -> APIs & Services -> Credentials -> click this key ->');
    console.log('  under "Application restrictions", change it from "HTTP referrers" to "None" (simplest for');
    console.log('  local dev) or "IP addresses" (for a production server with a static IP) -> Save.');
    console.log('  Changes can take a minute or two to take effect.');
  } else if (res.status === 403 && /quota/i.test(reason ?? '')) {
    console.log('- Daily quota exceeded. Wait until it resets (midnight Pacific time) or request more quota.');
  } else if (res.status === 403 && /accessNotConfigured|not been used|disabled/i.test(bodyText)) {
    console.log('- "YouTube Data API v3" is likely not ENABLED for this project.');
    console.log('  Fix: console.cloud.google.com -> APIs & Services -> Library -> search "YouTube Data API v3" -> Enable.');
  } else if (res.status === 400 || res.status === 403) {
    console.log('- The key itself is likely invalid, deleted, or restricted in a way that blocks this request.');
    console.log('  Fix: in Credentials, edit the key -> Application restrictions -> set to "None" or "IP addresses"');
    console.log('  (not "HTTP referrers") for a key used server-side like this.');
  } else {
    console.log('- Unrecognized error shape; see the raw error above for details.');
  }
  process.exitCode = 1;
}

main();
