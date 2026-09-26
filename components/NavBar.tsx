'use client';

import { useEffect, useState } from 'react';
import { getLocalChannels, type LocalChannel } from '@/lib/local-channels';

// No login in this app. "My channels" is whichever channels this browser
// has created (tracked in localStorage — see lib/local-channels.ts), shown
// here as a lightweight dropdown instead of an account menu.
export function NavBar() {
  const [myChannels, setMyChannels] = useState<LocalChannel[]>([]);
  const [showMenu, setShowMenu] = useState(false);

  useEffect(() => {
    setMyChannels(getLocalChannels());
  }, []);

  return (
    <nav className="nav">
      <div className="nav-inner">
        <a href="/" className="brand-link">
          <img src="/web-app-manifest-192x192.png" alt="" className="brand-logo" width={28} height={28} />
          <span className="brand">ytrankwar</span>
        </a>
        <div className="nav-links" style={{ position: 'relative' }}>
          {myChannels.length > 0 && (
            <>
              <button className="btn btn-secondary btn-compact" onClick={() => setShowMenu((v) => !v)}>
                My channels ({myChannels.length})
              </button>
              {showMenu && (
                <div className="my-channels-menu">
                  {myChannels.map((c) => (
                    <a key={c.channelId} href={`/channel/${c.slug}`} onClick={() => setShowMenu(false)}>
                      {c.name}
                    </a>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
