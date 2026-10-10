/**
 * Sync the whole store to a private GitHub gist.
 *
 * A classic GitHub token with only the "gist" scope, kept in this browser and
 * sent only to api.github.com. (Fine-grained tokens are rejected by the gist
 * API with a bare 404, so classic is required.) The gist holds one file — the
 * same JSON the Export button gives you — so it stays readable and restorable
 * by hand.
 *
 * There is no server for the token to reach even if it wanted to: the app is
 * fully static, so the credential never leaves the browser.
 */

const FILENAME = 'points-tracker.json';
const API = 'https://api.github.com/gists';

const K = {
  token: 'pointstracker:token',
  gist: 'pointstracker:gist',
  // Per-gist so switching gists can't inherit the other one's freshness mark.
  seen: (id) => `pointstracker:gistUpdatedAt:${id}`,
  // Auto-sync is on unless switched off; stored as '0' / '1'.
  auto: 'pointstracker:autoSync',
  // '1' when this browser has local writes the gist hasn't received yet.
  dirty: 'pointstracker:dirty',
};

// localStorage throws in some embedded/private contexts; fall back to memory
// so sync still works for the session instead of taking the page down.
const mem = {};
const store = {
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
  del(k) {
    delete mem[k];
    try { localStorage.removeItem(k); } catch { /* nothing to clean up */ }
  },
};

/* ---------- listeners, so the sidebar can show which gist is in play ---------- */

const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Gist id currently configured, or '' — a string so it snapshots cleanly. */
export function getGistId() {
  return store.get(K.gist) || '';
}

export function getCreds() {
  return { token: store.get(K.token) || '', gistId: getGistId() };
}

export function saveCreds(token, gistId) {
  if (token) store.set(K.token, token);
  if (gistId) store.set(K.gist, gistId);
  emit();
}

export function forgetCreds() {
  const id = getGistId();
  store.del(K.token);
  store.del(K.gist);
  if (id) store.del(K.seen(id));
  emit();
}

/** Push on every save and pull on page load. On by default once a gist is set. */
export function getAutoSync() {
  return store.get(K.auto) !== '0';
}

export function setAutoSync(on) {
  store.set(K.auto, on ? '1' : '0');
  emit();
}

/** Whether this browser holds writes the gist hasn't seen. Survives reloads, so
 *  a save made offline (or right before closing the tab) is still pushed later. */
export function isDirty() {
  return store.get(K.dirty) === '1';
}

export function markDirty(on) {
  if (on) store.set(K.dirty, '1');
  else store.del(K.dirty);
}

/** When this browser last saw the gist — the basis for conflict detection. */
export function lastSeen(gistId) {
  return (gistId && store.get(K.seen(gistId))) || '';
}

const markSeen = (gistId, updatedAt) => store.set(K.seen(gistId), updatedAt || '');

/* ---------- transport ---------- */

export class GistConflictError extends Error {
  constructor(remoteUpdatedAt) {
    super('The gist changed since this browser last synced with it.');
    this.name = 'GistConflictError';
    this.remoteUpdatedAt = remoteUpdatedAt;
  }
}

const headers = (token) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
});

async function call(url, token, init = {}, ctx = {}) {
  const res = await fetch(url, { ...init, headers: { ...headers(token), ...(init.headers || {}) } });
  if (!res.ok) {
    // GitHub's error bodies are JSON but long; the first line is the useful part.
    let detail = res.statusText;
    try {
      detail = (await res.json()).message || detail;
    } catch { /* non-JSON body */ }
    // The gist API is picky about token type, and its "you can't" answer is a
    // bare 404 with no hint — so translate the failures into something the user
    // can act on, and never blame a gist id on a create that supplied none.
    const scopeHelp = 'Use a classic token (github.com/settings/tokens/new) with the "gist" scope checked. Fine-grained tokens do not work with the gist API.';
    if (res.status === 401) throw new Error(`That token was rejected — check it is correct and has not expired. ${scopeHelp}`);
    if (res.status === 403) throw new Error(`That token isn't allowed to use gists. ${scopeHelp}`);
    if (res.status === 404) {
      if (ctx.creating) throw new Error(`GitHub wouldn't create a gist with this token. ${scopeHelp}`);
      throw new Error('No gist with that id is visible to this token — check the id, and that the token can read it.');
    }
    throw new Error(`GitHub returned ${res.status} — ${detail}`);
  }
  return res.json();
}

async function readGist(token, gistId, signal) {
  return call(`${API}/${gistId}`, token, { signal });
}

/** Body of the store file, following raw_url when GitHub truncates a big gist. */
async function fileContent(gist, signal) {
  const f = gist.files?.[FILENAME];
  if (!f) throw new Error(`That gist has no ${FILENAME} — is it the right id?`);
  const text = f.truncated ? await (await fetch(f.raw_url, { signal })).text() : f.content;
  return JSON.parse(text);
}

/**
 * Write the store to the gist, creating a private one if no id is given.
 *
 * Throws GistConflictError when the gist moved since this browser last saw it
 * — almost always another device having pushed. Gists have no ETag/If-Match,
 * so this compare-then-write is the only guard available; call again with
 * { force: true } once the user has decided to overwrite.
 */
export async function pushStore({ token, gistId, data, force = false }) {
  if (!token) throw new Error('Add a token first.');

  if (gistId && !force) {
    const known = lastSeen(gistId);
    if (known) {
      const current = await readGist(token, gistId);
      if (current.updated_at && current.updated_at !== known) {
        throw new GistConflictError(current.updated_at);
      }
    }
  }

  const body = { files: { [FILENAME]: { content: JSON.stringify(data, null, 2) } } };
  if (!gistId) {
    body.description = 'Points Tracker data';
    body.public = false; // private on creation; GitHub will not let this be changed later
  }

  const gist = await call(gistId ? `${API}/${gistId}` : API, token, {
    method: gistId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, { creating: !gistId });

  saveCreds(token, gist.id);
  markSeen(gist.id, gist.updated_at);
  return { gistId: gist.id, updatedAt: gist.updated_at, created: !gistId };
}

/** Read the gist back. The caller is what actually replaces local data. */
export async function pullStore({ token, gistId, signal }) {
  if (!token || !gistId) throw new Error('Need both a token and a gist id.');
  const gist = await readGist(token, gistId, signal);
  const data = await fileContent(gist, signal);
  if (!data || typeof data !== 'object' || !Array.isArray(data.redemptions)) {
    throw new Error('That file does not look like a Points Tracker export.');
  }
  saveCreds(token, gistId);
  markSeen(gistId, gist.updated_at);
  return { data, updatedAt: gist.updated_at };
}
