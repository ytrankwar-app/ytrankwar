'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Re-fetches the server component every few seconds while a payment is
 *  still being confirmed by the provider's webhook. Stops after ~1 minute. */
export default function AutoRefresh({ everyMs = 3000, maxTimes = 20 }: { everyMs?: number; maxTimes?: number }) {
  const router = useRouter();
  useEffect(() => {
    let n = 0;
    const t = setInterval(() => {
      n += 1;
      router.refresh();
      if (n >= maxTimes) clearInterval(t);
    }, everyMs);
    return () => clearInterval(t);
  }, [router, everyMs, maxTimes]);
  return null;
}
