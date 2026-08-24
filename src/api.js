const BASE = '/api';

async function req(method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).error || detail;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(`${method} ${url} failed: ${detail}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// The server refuses a row that duplicates one already in the ledger; passing
// { allowDuplicate: true } is the explicit override.
const dupeFlag = (opts) => (opts?.allowDuplicate ? '?allowDuplicate=1' : '');

export const api = {
  getStore: () => req('GET', '/store'),
  patchSettings: (patch) => req('PATCH', '/settings', patch),
  create: (collection, item, opts) => req('POST', `/${collection}${dupeFlag(opts)}`, item),
  bulk: (collection, items, opts) => req('POST', `/${collection}/bulk${dupeFlag(opts)}`, items),
  update: (collection, id, patch, opts) => req('PUT', `/${collection}/${id}${dupeFlag(opts)}`, patch),
  remove: (collection, id) => req('DELETE', `/${collection}/${id}`),
  removeBatch: (batchId) => req('DELETE', `/import-batch/${batchId}`),
  backup: () => req('POST', '/backup'),
  importStore: (store) => req('POST', '/import-store', store),
};
