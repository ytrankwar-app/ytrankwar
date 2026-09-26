import { StatsBar } from './StatsBar';

// Deliberately no logo, no brand link, no "My channels" menu — just the
// live visitor/channel counters, kept visible at the very top of every
// page via position: sticky (see .top-bar in globals.css).
export function TopBar() {
  return (
    <div className="top-bar">
      <div className="container top-bar-inner">
        <StatsBar />
      </div>
    </div>
  );
}
