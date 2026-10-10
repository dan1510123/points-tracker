import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { onWrite } from './lib/localStore.js';
import { getCreds, getLocalNudgeOff, setLocalNudgeOff } from './lib/gist.js';

/**
 * A small reminder after each save while no gist is set up: the data exists
 * only in this browser, and clearing site data or losing the device loses it.
 * Shows on every save until dismissed for good with "Don't show this again".
 */
export default function LocalSaveNudge() {
  const [open, setOpen] = useState(false);
  const [never, setNever] = useState(false);

  useEffect(
    () =>
      onWrite(() => {
        const { token, gistId } = getCreds();
        if (!(token && gistId) && !getLocalNudgeOff()) setOpen(true);
      }),
    []
  );

  if (!open) return null;

  const close = () => {
    if (never) setLocalNudgeOff(true);
    setNever(false);
    setOpen(false);
  };

  return (
    <div className="nudge" role="alertdialog" aria-labelledby="nudge-title" aria-describedby="nudge-body">
      <strong id="nudge-title">Saved — but only in this browser</strong>
      <p id="nudge-body">
        Without a private gist, your data lives only here. Clearing browser data or switching devices can lose it.{' '}
        <Link to="/settings?section=gist" onClick={close}>Set up gist sync</Link>
      </p>
      <div className="nudge-foot">
        <label>
          <input type="checkbox" checked={never} onChange={(e) => setNever(e.target.checked)} />
          Don&rsquo;t show this again
        </label>
        <button className="sm" onClick={close}>Got it</button>
      </div>
    </div>
  );
}
