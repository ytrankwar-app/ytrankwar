import fs from 'node:fs';
import path from 'node:path';

/**
 * Minimal .env.local / .env loader (no dotenv dependency needed). Next.js
 * itself loads these automatically when you run `next dev`/`next build`,
 * but a standalone script run via `tsx scripts/whatever.ts` doesn't get
 * that for free, so scripts in this folder read the same files by hand.
 */
export function loadLocalEnv(): void {
  for (const filename of ['.env.local', '.env']) {
    const filePath = path.join(process.cwd(), filename);
    if (!fs.existsSync(filePath)) continue;
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  }
}
