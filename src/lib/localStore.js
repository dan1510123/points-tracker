/**
 * The datastore, in the browser.
 *
 * This replaces the Express server that used to own data/store.json. The whole
 * store is one JSON object in localStorage — the same shape the server kept on
 * disk, so an export from the old version imports here unchanged.
 *
 * localStorage is per-origin and per-browser: the dev app on localhost and the
 * deployed app on github.io keep separate copies. Export / Import (Settings →
 * Data) is the bridge between them, and gist sync is the durable backup.
 */

const KEY = 'pointstracker:store';
const BACKUPS_KEY = 'pointstracker:backups';
const MAX_BACKUPS = 20; // enough to undo a bad import a few times over; localStorage isn't infinite

export const COLLECTIONS = ['programs', 'redemptions'];

const DEFAULT_PROGRAMS = [
  { name: 'Amex Membership Rewards', issuer: 'American Express', kind: 'transferable', color: '#2E77BC', cpp: 1.8 },
  { name: 'Chase Ultimate Rewards', issuer: 'Chase', kind: 'transferable', color: '#117ACA', cpp: 1.8 },
  { name: 'Delta SkyMiles', issuer: 'Delta', kind: 'airline', color: '#C8102E', cpp: 1.2 },
  { name: 'Bilt Rewards', issuer: 'Bilt', kind: 'transferable', color: '#111111', cpp: 2.0 },
  { name: 'Alaska Mileage Plan', issuer: 'Alaska Airlines', kind: 'airline', color: '#01426A', cpp: 1.5 },
];

export function defaultStore() {
  const now = new Date().toISOString();
  return {
    version: 1,
    settings: {
      // Global fallback only. Per-program cpp always wins when set.
      defaultCpp: 1.5,
      currency: 'USD',
      startYear: new Date().getFullYear() - 6,
    },
    programs: DEFAULT_PROGRAMS.map((p, i) => ({
      id: `prog_${i + 1}`,
      ...p,
      balance: 0,
      balanceUpdatedAt: null,
      history: [],
      archived: false,
      createdAt: now,
    })),
    redemptions: [],
  };
}

// localStorage throws in private-mode / sandboxed contexts; a memory copy keeps
// the app usable for the session instead of taking the page down.
const mem = {};
const raw = {
  get(k) {
    try {
      const v = localStorage.getItem(k);
      return v === null ? (k in mem ? mem[k] : null) : v;
    } catch {
      return k in mem ? mem[k] : null;
    }
  },
  set(k, v) {
    mem[k] = v;
    try { localStorage.setItem(k, v); } catch { /* memory copy stands in */ }
  },
};

/** Fold a parsed store onto the defaults so older/partial exports gain any
 *  fields added since they were written. Mirrors the server's readStore. */
function normalize(parsed) {
  const base = defaultStore();
  const next = {
    ...base,
    ...parsed,
    settings: { ...base.settings, ...(parsed.settings || {}) },
  };
  for (const c of COLLECTIONS) if (!Array.isArray(next[c])) next[c] = base[c];
  return next;
}

export function readStore() {
  const stored = raw.get(KEY);
  if (stored === null) {
    const seed = defaultStore();
    writeStore(seed);
    return seed;
  }
  try {
    return normalize(JSON.parse(stored));
  } catch {
    // Corrupt value: keep it aside rather than silently clobbering it, exactly
    // as the server quarantined an unreadable store.json.
    pushBackup(`corrupt-${new Date().toISOString()}`, stored);
    const seed = defaultStore();
    writeStore(seed);
    return seed;
  }
}

export function writeStore(next) {
  raw.set(KEY, JSON.stringify(next));
  return next;
}

export function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/* ---------- backups: the localStorage stand-in for data/backups/ ---------- */

function readBackups() {
  try {
    const list = JSON.parse(raw.get(BACKUPS_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function pushBackup(label, contentString) {
  const list = readBackups();
  list.unshift({ label, at: new Date().toISOString(), content: contentString });
  raw.set(BACKUPS_KEY, JSON.stringify(list.slice(0, MAX_BACKUPS)));
  return label;
}

/** Snapshot the current store. Returned label mirrors the old backup path. */
export function makeBackup() {
  const stored = raw.get(KEY);
  if (stored === null) return null;
  const label = `store-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  pushBackup(label, stored);
  return label;
}

export function listBackups() {
  return readBackups().map(({ label, at }) => ({ label, at }));
}

/** Restore a snapshot by label, backing up the current store first. */
export function restoreBackup(label) {
  const hit = readBackups().find((b) => b.label === label);
  if (!hit) throw new Error('That backup is no longer here.');
  makeBackup();
  writeStore(normalize(JSON.parse(hit.content)));
  return true;
}
