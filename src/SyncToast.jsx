import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { subscribeStatus, getStatus } from './lib/sync.js';

const SHOW_MS = { ok: 2600, bad: 7000 };

/**
 * A brief toast when a save finishes syncing to the gist — or fails to. Only
 * reacts to pushes (pushing → synced/error/conflict), so the pull on page load
 * stays quiet.
 */
export default function SyncToast() {
  const status = useSyncExternalStore(subscribeStatus, getStatus);
  const prev = useRef(status.state);
  const [toast, setToast] = useState(null); // { ok, text, key }

  useEffect(() => {
    const was = prev.current;
    prev.current = status.state;
    if (was !== 'pushing') return;
    if (status.state === 'synced') setToast({ ok: true, text: 'Synced to your private gist', key: Date.now() });
    else if (status.state === 'conflict') setToast({ ok: false, text: 'Not synced — the gist changed on another device', key: Date.now() });
    else if (status.state === 'error') setToast({ ok: false, text: 'Couldn’t sync to your gist', key: Date.now() });
  }, [status]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), toast.ok ? SHOW_MS.ok : SHOW_MS.bad);
    return () => clearTimeout(t);
  }, [toast]);

  if (!toast) return null;

  return (
    <div key={toast.key} className={`toast ${toast.ok ? 'toast-ok' : 'toast-bad'}`} role="status" aria-live="polite">
      <span className="toast-icon" aria-hidden="true">{toast.ok ? '✓' : '!'}</span>
      <span className="toast-text">{toast.text}</span>
      {!toast.ok && (
        <Link to="/settings?section=gist" className="toast-link" onClick={() => setToast(null)}>Details</Link>
      )}
      <button className="toast-close" aria-label="Dismiss" onClick={() => setToast(null)}>{'✕'}</button>
    </div>
  );
}
