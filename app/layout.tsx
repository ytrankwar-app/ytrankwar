import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import './globals.css';
import { TopBar } from '@/components/TopBar';
import { getSiteUrl, CONTACT_EMAIL } from '@/lib/site';

// Every page is rendered per request: the base URL comes from the request
// host (so canonical/OG/sitemap links are always right for the domain being
// served) and the leaderboard data is live.
export const dynamic = 'force-dynamic';

const TITLE = 'ytrankwar — The YouTube Channel Rank War';
const DESCRIPTION =
  'Add your YouTube channel for free and compete for visible positions on ytrankwar, the independent creator leaderboard. Transparent bidding, real-time rankings.';

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0b0d12' };

export async function generateMetadata(): Promise<Metadata> {
  const base = await getSiteUrl();
  return {
    metadataBase: new URL(base),
    title: { default: TITLE, template: '%s · ytrankwar' },
    description: DESCRIPTION,
    alternates: { canonical: '/' },
    openGraph: { type: 'website', siteName: 'ytrankwar', title: TITLE, description: DESCRIPTION, url: '/' },
    twitter: { card: 'summary', title: TITLE, description: DESCRIPTION },
  };
}

function buildStructuredData(siteUrl: string) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        name: 'ytrankwar',
        url: siteUrl,
        logo: `${siteUrl}/web-app-manifest-512x512.png`,
        email: CONTACT_EMAIL,
        description:
          'ytrankwar is an independent YouTube channel leaderboard. It is not affiliated with, sponsored by, or endorsed by YouTube or Google.',
      },
      {
        '@type': 'WebSite',
        name: 'ytrankwar',
        url: siteUrl,
        description:
          'Add your YouTube channel for free and compete for visible positions on ytrankwar, ranked purely by verified paid bid.',
      },
    ],
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const structuredData = buildStructuredData(await getSiteUrl());

  return (
    <html lang="en">
      <head>
        {/* Google tag (gtag.js) */}
        <script async src="https://www.googletagmanager.com/gtag/js?id=G-VYVT5GLSMG" />
        {/* eslint-disable-next-line react/no-danger */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());

  gtag('config', 'G-VYVT5GLSMG');
`,
          }}
        />
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
              <nav className="footer-links" aria-label="Footer">
                <Link href="/rules">Rules</Link>
              </nav>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
