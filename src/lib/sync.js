/**
 * Automatic gist sync: every save pushes, every page load pulls.
 *
 * Runs only when a gist is configured (token + id saved, which happens on the
 * first manual push or pull) and auto-sync hasn't been switched off in
 * Settings. Without that, this module does nothing and the app is local-only.
 *
 * Saves are debounced, so a burst of writes (saving several rates at once)
 * becomes one push. A write that never reached the gist — offline, tab closed
 * mid-debounce, push failed — leaves a dirty mark that survives reloads, and
 * the next page load pushes it.
 *
 * Conflicts follow the manual push's rule: never overwrite a gist that moved
 * since this browser last saw it without asking first.
 */

import { readStore, writeStore, makeBackup, onWrite } from './localStore.js';
import {
  getCreds,
  getAutoSync,
  isDirty,
  markDirty,
  lastSeen,
  pushStore,
  pullStore,
  subscribe as subscribeCreds,
  GistConflictError,
} from './gist.js';

const DEBOUNCE_MS = 1500;
const LOAD_TIMEOUT_MS = 10000;

/** Token, gist id and the auto-sync switch all in place. */
export function autoSyncEnabled() {
  const { token, gistId } = getCreds();
  return !!(token && gistId && getAutoSync());
}

/* ---------- status, for the sidebar and Settings ---------- */

// state: idle | pending | pulling | pushing | synced | conflict | error
let status = { state: 'idle', at: '', message: '' };
const listeners = new Set();

function setStatus(state, extra = {}) {
  status = { state, at: '', message: '', ...extra };
  listeners.forEach((fn) => fn());
}

export function subscribeStatus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const getStatus = () => status;

/* ---------- push on save ---------- */

let ready = false; // nothing pushes until the load-time pull has settled
let timer = null;
let inflight = null;
let again = false;

onWrite(() => {
  markDirty(true);
  if (ready && autoSyncEnabled()) schedule();
});

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => flush(), DEBOUNCE_MS);
  if (status.state !== 'pushing') setStatus('pending');
}

/** Push the current store now. Coalesces with a push already in flight. */
export function flush({ force = false } = {}) {
  clearTimeout(timer);
  timer = null;
  if (!autoSyncEnabled()) return Promise.resolve();
  if (inflight) {
    again = true;
    return inflight;
  }
  inflight = (async () => {
    try {
      let res;
      do {
        again = false;
        setStatus('pushing');
        // Cleared before the push so a write landing mid-push re-marks it.
        markDirty(false);
        try {
          res = await pushStore({ ...getCreds(), data: readStore(), force });
        } catch (err) {
          markDirty(true);
          throw err;
        }
        force = false; // only the first round was the user's explicit choice
      } while (again);
      setStatus('synced', { at: res.updatedAt });
    } catch (err) {
      if (err instanceof GistConflictError) {
        setStatus('conflict', {
          at: err.remoteUpdatedAt,
          message:
            `The gist was changed at ${new Date(err.remoteUpdatedAt).toLocaleString()} from somewhere else, ` +
            'so this save was not pushed. Pull to take that copy, or Push to overwrite it with this device’s.',
        });
      } else {
        setStatus('error', { message: `Couldn’t save to the gist: ${err.message}` });
      }
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

// Don't strand a debounced save when the tab is hidden or closed.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && timer) flush();
  });
}

// Turning auto-sync back on (or finishing setup) pushes anything left over;
// turning it off or forgetting the token clears the status.
subscribeCreds(() => {
  if (!autoSyncEnabled()) {
    clearTimeout(timer);
    timer = null;
    setStatus('idle');
  } else if (ready && isDirty() && !inflight) {
    flush();
  }
});

/* ---------- pull on load ---------- */

/** Replace local data with a copy that came from the gist, snapshotting first.
 *  Silent, so it isn't pushed straight back. */
export function applyRemote(data, updatedAt) {
  makeBackup();
  writeStore(data, { silent: true });
  noteSynced(updatedAt);
}

/** Record that this device and the gist now match (after a manual push/pull). */
export function noteSynced(updatedAt) {
  markDirty(false);
  setStatus(autoSyncEnabled() ? 'synced' : 'idle', { at: updatedAt });
}

let started = null;

/**
 * Bring this device up to date with the gist before the app shows data.
 * Idempotent — StrictMode's double effect only runs it once.
 */
export function startup() {
  return (started ??= loadFromGist().finally(() => {
    ready = true;
    if (autoSyncEnabled() && isDirty() && !inflight && status.state !== 'conflict') flush();
  }));
}

async function loadFromGist() {
  if (!autoSyncEnabled()) return;
  const creds = getCreds();
  const known = lastSeen(creds.gistId);
  setStatus('pulling');

  // Abort rather than race: a pull that lands late would mark the gist as
  // seen without applying it, and the next save would overwrite it unasked.
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), LOAD_TIMEOUT_MS);
  let remote;
  try {
    remote = await pullStore({ ...creds, signal: ctl.signal });
  } catch (err) {
    const why = err.name === 'AbortError' ? 'GitHub took too long to answer' : err.message;
    setStatus('error', { message: `Couldn’t load from the gist (${why}). Showing this device’s copy.` });
    return;
  } finally {
    clearTimeout(t);
  }

  const { data, updatedAt } = remote;
  if (updatedAt === known) {
    // Gist unchanged since this device last synced: local is current. Any
    // unpushed local writes go up in startup()'s finally.
    setStatus('synced', { at: updatedAt });
    return;
  }

  if (isDirty()) {
    // Both sides moved. Only the user can say which one wins.
    const takeGist = window.confirm(
      `The gist was updated at ${new Date(updatedAt).toLocaleString()}, but this device also has changes ` +
      'that never reached it.\n\n' +
      'OK — load the gist copy (this device’s data is snapshotted first).\n' +
      'Cancel — keep this device’s data and overwrite the gist with it.'
    );
    if (!takeGist) {
      ready = true;
      await flush({ force: true });
      return;
    }
  }

  applyRemote(data, updatedAt);
}
