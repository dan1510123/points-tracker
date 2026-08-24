import React from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useStore } from './StoreContext.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Redemptions from './pages/Redemptions.jsx';
import RedemptionForm from './pages/RedemptionForm.jsx';
import Balances from './pages/Balances.jsx';
import Import from './pages/Import.jsx';
import Settings from './pages/Settings.jsx';

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

  return (
    <div className="layout">
      <nav className="sidebar">
        <div className="brand">
          Points<span>Tracker</span>
        </div>
        {/* className as a function: passing a string would get NavLink's own
            prefix-matched "active" class appended on top of ours. */}
        {NAV.map(([to, label]) => (
          <NavLink key={to} to={to} className={() => `navlink${to === active ? ' active' : ''}`}>
            {label}
          </NavLink>
        ))}
        <div className="sidebar-foot">
          Local only. Data lives in
          <br />
          <code>data/store.json</code>
        </div>
      </nav>

      <main className="main">
        {error && (
          <div className="error">
            {error} <button className="ghost sm" onClick={() => setError(null)}>dismiss</button>
          </div>
        )}
        {!store ? (
          <div className="empty">Loading…</div>
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
    </div>
  );
}
