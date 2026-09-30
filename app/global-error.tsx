'use client';

// Last-resort boundary: replaces the root layout when even the layout fails,
// so it must render its own <html>/<body> and cannot depend on the app CSS.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0b0d12',
          color: '#e6edf3',
          fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
          textAlign: 'center',
          padding: 24,
        }}
      >
        <div>
          <p style={{ fontSize: 64, fontWeight: 800, margin: 0, color: '#5eead4' }}>500</p>
          <h1 style={{ margin: '8px 0' }}>Something went wrong</h1>
          <p style={{ opacity: 0.7 }}>The site hit an unexpected error. Please try again.</p>
          <button
            onClick={() => reset()}
            style={{ padding: '10px 18px', borderRadius: 8, border: 0, background: '#5eead4', color: '#04211c', fontWeight: 700, cursor: 'pointer' }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
