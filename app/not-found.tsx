import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Page not found', robots: { index: false, follow: false } };

export default function NotFound() {
  return (
    <div className="container error-page">
      <p className="error-code">404</p>
      <h1>Page not found</h1>
      <p className="muted">The page you are looking for does not exist, or the channel was removed.</p>
      <p className="error-actions">
        <Link className="btn btn-primary" href="/">Back to the leaderboard</Link>
        <Link className="btn btn-secondary" href="/rules">Read the rules</Link>
      </p>
    </div>
  );
}
