'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="container error-page">
      <p className="error-code">500</p>
      <h1>Something went wrong</h1>
      <p className="muted">An unexpected error occurred on our side. Please try again in a moment.</p>
      {error.digest && <p className="muted small">Reference: {error.digest}</p>}
      <p className="error-actions">
        <button className="btn btn-primary" onClick={() => reset()}>Try again</button>
        <Link className="btn btn-secondary" href="/">Back to the leaderboard</Link>
      </p>
    </div>
  );
}
