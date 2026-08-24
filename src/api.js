/**
 * The data layer. Once this was a thin fetch() wrapper over an Express server;
 * now it runs entirely in the browser against localStorage. The method surface
 * is unchanged and every call still returns a promise, so the pages and
 * StoreContext that call it did not have to change.
 *
 * The duplicate gate that used to live in the server lives here now, using the
 * very same src/lib/dupes.js the UI already screens with — so a write that
 * would duplicate an existing row is refused unless the caller passes
 * { allowDuplicate: true }, exactly as the API used to answer 409.
 */

import {
  readStore,
  writeStore,
  newId,
  makeBackup,
  COLLECTIONS,
} from './lib/localStore.js';
import { findDuplicate, screenBatch, describeRow } from './lib/dupes.js';

const singular = { programs: 'prog', redemptions: 'rdm' };

function assertCollection(collection) {
  if (!COLLECTIONS.includes(collection)) throw new Error(`Unknown collection "${collection}"`);
}

const allowed = (opts) => opts?.allowDuplicate === true;

export const api = {
  getStore: async () => readStore(),

  patchSettings: async (patch) => {
    const store = readStore();
    store.settings = { ...store.settings, ...patch };
    writeStore(store);
    return store.settings;
  },

  create: async (collection, item, opts) => {
    assertCollection(collection);
    const store = readStore();
    if (collection === 'redemptions' && !allowed(opts)) {
      const match = findDuplicate(store.redemptions, item);
      if (match) throw new Error(`This entry is already in the ledger — ${describeRow(match, store.programs)}`);
    }
    const created = { id: newId(singular[collection]), createdAt: new Date().toISOString(), ...item };
    delete created.allowDuplicate;
    store[collection].push(created);
    writeStore(store);
    return created;
  },

  bulk: async (collection, items, opts) => {
    assertCollection(collection);
    const store = readStore();
    const rows = Array.isArray(items) ? items : items?.items;
    if (!Array.isArray(rows)) throw new Error('Expected an array of items');

    // Duplicates are held back row by row and reported; the rest still imports,
    // the same way the server screened a batch.
    const allow = collection !== 'redemptions' || allowed(opts);
    const screened = allow ? { rows, blocked: [] } : screenBatch(rows, store.redemptions, { programs: store.programs });

    const now = new Date().toISOString();
    const created = screened.rows.map((r) => {
      const row = { id: newId(singular[collection]), createdAt: now, ...r };
      delete row.allowDuplicate;
      return row;
    });
    store[collection].push(...created);
    writeStore(store);
    return { inserted: created.length, blocked: screened.blocked };
  },

  update: async (collection, id, patch, opts) => {
    assertCollection(collection);
    const store = readStore();
    const list = store[collection];
    const i = list.findIndex((x) => x.id === id);
    if (i === -1) throw new Error('Not found');
    const next = { ...list[i], ...patch, id: list[i].id };
    if (collection === 'redemptions' && !allowed(opts)) {
      // Ignore the row being edited, or every save collides with itself.
      const match = findDuplicate(list, next, { ignoreId: list[i].id });
      if (match) throw new Error(`Those edits duplicate another entry — ${describeRow(match, store.programs)}`);
    }
    delete next.allowDuplicate;
    list[i] = next;
    writeStore(store);
    return list[i];
  },

  remove: async (collection, id) => {
    assertCollection(collection);
    const store = readStore();
    const before = store[collection].length;
    store[collection] = store[collection].filter((x) => x.id !== id);
    if (store[collection].length === before) throw new Error('Not found');
    writeStore(store);
    return null;
  },

  // Undo one import batch — the button for a bad CSV mapping.
  removeBatch: async (batchId) => {
    const store = readStore();
    const before = store.redemptions.length;
    store.redemptions = store.redemptions.filter((x) => x.batchId !== batchId);
    writeStore(store);
    return { removed: before - store.redemptions.length };
  },

  backup: async () => ({ backup: makeBackup() }),

  // Replace the whole store, snapshotting the current one first.
  importStore: async (store) => {
    if (!store || typeof store !== 'object') throw new Error('Bad payload');
    makeBackup();
    writeStore(store);
    return { ok: true };
  },
};
