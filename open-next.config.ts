import { defineCloudflareConfig } from '@opennextjs/cloudflare';

// Every data-driven route in this app is dynamic and reads D1 directly, so no
// incremental (ISR) cache is configured. Add an R2 cache here only if you
// later introduce ISR/revalidate.
export default defineCloudflareConfig({});
