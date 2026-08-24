import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

export const COLLECTIONS = ['programs', 'redemptions'];

const DEFAULT_PROGRAMS = [
  { name: 'Amex Membership Rewards', issuer: 'American Express', kind: 'transferable', color: '#2E77BC', cpp: 1.8 },
  { name: 'Chase Ultimate Rewards', issuer: 'Chase', kind: 'transferable', color: '#117ACA', cpp: 1.8 },
  { name: 'Delta SkyMiles', issuer: 'Delta', kind: 'airline', color: '#C8102E', cpp: 1.2 },
  { name: 'Bilt Rewards', issuer: 'Bilt', kind: 'transferable', color: '#111111', cpp: 2.0 },
  { name: 'Alaska Mileage Plan', issuer: 'Alaska Airlines', kind: 'airline', color: '#01426A', cpp: 1.5 },
];

function defaultStore() {
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

function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

let cache = null;

export function readStore() {
  if (cache) return cache;
  ensureDirs();
  if (!fs.existsSync(STORE_PATH)) {
    cache = defaultStore();
    writeStore(cache);
    return cache;
  }
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    // Fill in any collections added by later versions.
    const base = defaultStore();
    cache = {
      ...base,
      ...parsed,
      settings: { ...base.settings, ...(parsed.settings || {}) },
    };
    for (const c of COLLECTIONS) if (!Array.isArray(cache[c])) cache[c] = base[c];
    return cache;
  } catch (err) {
    // Corrupt file: keep it aside rather than silently clobbering user data.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const quarantine = path.join(BACKUP_DIR, `corrupt-${stamp}.json`);
    fs.copyFileSync(STORE_PATH, quarantine);
    console.error(`store.json was unreadable; moved a copy to ${quarantine}`);
    cache = defaultStore();
    writeStore(cache);
    return cache;
  }
}

export function writeStore(next) {
  ensureDirs();
  cache = next;
  const tmp = `${STORE_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tmp, STORE_PATH); // atomic-ish: no half-written store
  return cache;
}

export function backup() {
  ensureDirs();
  if (!fs.existsSync(STORE_PATH)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(BACKUP_DIR, `store-${stamp}.json`);
  fs.copyFileSync(STORE_PATH, dest);
  return dest;
}

export function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export { STORE_PATH, DATA_DIR };
