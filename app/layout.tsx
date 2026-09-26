import type { Metadata } from 'next';
import './globals.css';
import { TopBar } from '@/components/TopBar';

export const metadata: Metadata = {
  title: 'ytrankwar — The YouTube Channel Rank War',
  description:
    'Add your YouTube channel for free and compete for visible positions on ytrankwar, the independent creator leaderboard. Transparent bidding, real-time rankings.',
};

const SITE_URL = process.env.SITE_URL || 'https://ytrankwar.example';

const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      name: 'ytrankwar',
      url: SITE_URL,
      logo: `${SITE_URL}/web-app-manifest-512x512.png`,
      description:
        'ytrankwar is an independent YouTube channel leaderboard. It is not affiliated with, sponsored by, or endorsed by YouTube or Google.',
    },
    {
      '@type': 'WebSite',
      name: 'ytrankwar',
      url: SITE_URL,
      description:
        'Add your YouTube channel for free and compete for visible positions on ytrankwar, ranked purely by verified paid bid.',
    },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" type="image/png" href="/favicon-96x96.png" sizes="96x96" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="shortcut icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <meta name="apple-mobile-web-app-title" content="ytrankwar" />
        <link rel="manifest" href="/site.webmanifest" />
        {/* eslint-disable-next-line react/no-danger */}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      </head>
      <body>
        <TopBar />
        <main>{children}</main>
        <footer className="site-footer">
          <div className="container footer-grid">
            <div>
              <div className="brand-link footer-brand">
                <img src="/web-app-manifest-192x192.png" alt="" className="brand-logo" width={24} height={24} />
                <span className="brand">ytrankwar</span>
              </div>
              <p className="muted small">
                ytrankwar is an independent leaderboard product. It is not affiliated with, sponsored by, or
                endorsed by YouTube or Google. YouTube and Google are trademarks of their respective owners.
              </p>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
