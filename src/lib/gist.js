/**
 * Sync the whole store to a private GitHub gist.
 *
 * Same shape as the perk-graph sync: a fine-grained token scoped to
 * "Gists: read and write" and nothing else, kept in this browser only and
 * sent only to api.github.com. The gist holds one file — the same JSON the
 * Download button gives you — so it stays readable and restorable by hand.
 *
 * The token deliberately never reaches our own server: data/store.json is
 * committed to nothing and backed up locally, and a credential on disk would
 * be the one secret in a project that otherwise has none.
 */

const FILENAME = 'points-tracker.json';
const API = 'https://api.github.com/gists';

const K = {
  token: 'pointstracker:token',
  gist: 'pointstracker:gist',
  // Per-gist so switching gists can't inherit the other one's freshness mark.
  seen: (id) => `pointstracker:gistUpdatedAt:${id}`,
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

async function call(url, token, init = {}) {
  const res = await fetch(url, { ...init, headers: { ...headers(token), ...(init.headers || {}) } });
  if (!res.ok) {
    // GitHub's error bodies are JSON but long; the first line is the useful part.
    let detail = res.statusText;
    try {
      detail = (await res.json()).message || detail;
    } catch { /* non-JSON body */ }
    // The two failures that actually happen get plain-English replacements;
    // "GitHub returned 401" tells the user nothing they can act on.
    if (res.status === 401) throw new Error('That token was rejected — check it has Gists: read and write, and has not expired.');
    if (res.status === 404) throw new Error('No gist with that id is visible to this token.');
    throw new Error(`GitHub returned ${res.status} — ${detail}`);
  }
  return res.json();
}

async function readGist(token, gistId) {
  return call(`${API}/${gistId}`, token);
}

/** Body of the store file, following raw_url when GitHub truncates a big gist. */
async function fileContent(gist) {
  const f = gist.files?.[FILENAME];
  if (!f) throw new Error(`That gist has no ${FILENAME} — is it the right id?`);
  const text = f.truncated ? await (await fetch(f.raw_url)).text() : f.content;
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
  });

  saveCreds(token, gist.id);
  markSeen(gist.id, gist.updated_at);
  return { gistId: gist.id, updatedAt: gist.updated_at, created: !gistId };
}

/** Read the gist back. The caller is what actually replaces local data. */
export async function pullStore({ token, gistId }) {
  if (!token || !gistId) throw new Error('Need both a token and a gist id.');
  const gist = await readGist(token, gistId);
  const data = await fileContent(gist);
  if (!data || typeof data !== 'object' || !Array.isArray(data.redemptions)) {
    throw new Error('That file does not look like a Points Tracker export.');
  }
  saveCreds(token, gistId);
  markSeen(gistId, gist.updated_at);
  return { data, updatedAt: gist.updated_at };
}
