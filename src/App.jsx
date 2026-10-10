import React, { useState, useSyncExternalStore } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useStore } from './StoreContext.jsx';
import { subscribe, getGistId, getAutoSync } from './lib/gist.js';
import { subscribeStatus, getStatus } from './lib/sync.js';
import Dashboard from './pages/Dashboard.jsx';
import Redemptions from './pages/Redemptions.jsx';
import RedemptionForm from './pages/RedemptionForm.jsx';
import Balances from './pages/Balances.jsx';
import Import from './pages/Import.jsx';
import Settings from './pages/Settings.jsx';
import LocalSaveNudge from './LocalSaveNudge.jsx';
import SyncToast from './SyncToast.jsx';

const NAV = [
  ['/', 'Dashboard'],
  ['/balances', 'Points I have'],
  ['/redemptions', 'Points I’ve used'],
  ['/redemptions/new', 'Log a redemption'],
  ['/import', 'Import CSV'],
  ['/settings', 'Settings'],
];

/**
 * The link whose path is the longest prefix of the current one — so
 * /redemptions/new lights up "Log a redemption" while /redemptions/<id> falls
 * back to "Points I've used", and exactly one link is ever active.
 */
function activePath(pathname) {
  let best = '/';
  for (const [to] of NAV) {
    if (to === '/') continue;
    if ((pathname === to || pathname.startsWith(`${to}/`)) && to.length > best.length) best = to;
  }
  return best;
}

export default function App() {
  const { store, error, setError } = useStore();
  const active = activePath(useLocation().pathname);
  // '' when sync is off, so the footer can say plainly where the data goes.
  const gistId = useSyncExternalStore(subscribe, getGistId, () => '');
  const autoSync = useSyncExternalStore(subscribe, getAutoSync);
  const sync = useSyncExternalStore(subscribeStatus, getStatus);
  // Off-canvas nav drawer, mobile only (the CSS ignores this class ≥ 720px).
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className={`layout${menuOpen ? ' menu-open' : ''}`}>
      {/* Mobile-only top bar: brand + hamburger. Hidden by CSS on desktop. */}
      <header className="topbar">
        <div className="brand">
          Points<span>Tracker</span>
        </div>
        <button
          className="ghost hamburger"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          {menuOpen ? '✕' : '☰'}
        </button>
      </header>

      {/* Tap-to-close scrim behind the open drawer. */}
      <div className="scrim" onClick={() => setMenuOpen(false)} />

      <nav className="sidebar">
        <div className="brand">
          Points<span>Tracker</span>
        </div>
        {/* className as a function: passing a string would get NavLink's own
            prefix-matched "active" class appended on top of ours. */}
        {NAV.map(([to, label]) => (
          <NavLink
            key={to}
            to={to}
            className={() => `navlink${to === active ? ' active' : ''}`}
            onClick={() => setMenuOpen(false)}
          >
            {label}
          </NavLink>
        ))}
        <div className="sidebar-foot">
          Data lives in this browser
          <br />
          {gistId ? <SyncLine gistId={gistId} autoSync={autoSync} sync={sync} /> : 'local only'}
        </div>
      </nav>

      <main className="main">
        {error && (
          <div className="error">
            {error} <button className="ghost sm" onClick={() => setError(null)}>dismiss</button>
          </div>
        )}
        {!store ? (
          <div className="empty">{sync.state === 'pulling' ? 'Loading the latest from your gist…' : 'Loading…'}</div>
        ) : (
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/redemptions" element={<Redemptions />} />
            {/* Specific path first: /new must not be read as an :id. */}
            <Route path="/redemptions/new" element={<RedemptionForm />} />
            <Route path="/redemptions/:id" element={<RedemptionForm />} />
            <Route path="/balances" element={<Balances />} />
            <Route path="/import" element={<Import />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        )}
      </main>

      <LocalSaveNudge />
      <SyncToast />
    </div>
  );
}

/** Sidebar footer: which gist, and where the last save got to. */
function SyncLine({ gistId, autoSync, sync }) {
  const id = <code>{gistId.slice(0, 7)}</code>;
  if (!autoSync) return <>gist {id} · auto-sync off</>;
  switch (sync.state) {
    case 'pulling': return <>pulling from gist {id}…</>;
    case 'pending':
    case 'pushing': return <>saving to gist {id}…</>;
    case 'conflict': return <span className="sync-bad">gist {id} changed elsewhere — see Settings</span>;
    case 'error': return <span className="sync-bad">gist sync failed — see Settings</span>;
    default: return <>synced to gist {id}</>;
  }
}
