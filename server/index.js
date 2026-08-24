import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readStore, writeStore, backup, newId, COLLECTIONS, STORE_PATH } from './store.js';
import { findDuplicate, screenBatch, describeRow } from '../src/lib/dupes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 5174;

app.use(express.json({ limit: '64mb' })); // room for a large backfill import in one request

const singular = { programs: 'prog', redemptions: 'rdm' };

function assertCollection(req, res, next) {
  if (!COLLECTIONS.includes(req.params.collection)) {
    return res.status(404).json({ error: `Unknown collection "${req.params.collection}"` });
  }
  next();
}

// --- Specific routes first. The generic /api/:collection handlers below would
// --- otherwise swallow these paths and report "Unknown collection".

app.get('/api/store', (req, res) => {
  res.json(readStore());
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, storePath: STORE_PATH, exists: fs.existsSync(STORE_PATH) });
});

// Delete every row that came from one import batch — the undo button for a bad CSV mapping.
app.delete('/api/import-batch/:batchId', (req, res) => {
  const store = readStore();
  const before = store.redemptions.length;
  store.redemptions = store.redemptions.filter((x) => x.batchId !== req.params.batchId);
  writeStore(store);
  res.json({ removed: before - store.redemptions.length });
});

app.post('/api/backup', (req, res) => {
  const dest = backup();
  res.json({ backup: dest });
});

app.get('/api/export', (req, res) => {
  res.setHeader('Content-Disposition', 'attachment; filename="points-tracker-export.json"');
  res.json(readStore());
});

app.post('/api/import-store', (req, res) => {
  if (!req.body || typeof req.body !== 'object') return res.status(400).json({ error: 'Bad payload' });
  backup();
  writeStore(req.body);
  res.json({ ok: true });
});

app.patch('/api/settings', (req, res) => {
  const store = readStore();
  store.settings = { ...store.settings, ...req.body };
  writeStore(store);
  res.json(store.settings);
});

// The duplicate gate. The UI checks too, so the user is warned before they
// click, but this is the check that actually holds: a row that already exists
// is refused unless the caller says, in as many words, to write it anyway.
const overridden = (req) => req.query.allowDuplicate === '1' || req.body?.allowDuplicate === true;

app.post('/api/:collection', assertCollection, (req, res) => {
  const store = readStore();
  const collection = req.params.collection;
  if (collection === 'redemptions' && !overridden(req)) {
    const match = findDuplicate(store.redemptions, req.body);
    if (match) {
      return res.status(409).json({
        error: `This entry is already in the ledger — ${describeRow(match, store.programs)}`,
        duplicateOf: match,
      });
    }
  }
  const item = { id: newId(singular[collection]), createdAt: new Date().toISOString(), ...req.body };
  delete item.allowDuplicate;
  store[collection].push(item);
  writeStore(store);
  res.status(201).json(item);
});

app.post('/api/:collection/bulk', assertCollection, (req, res) => {
  const store = readStore();
  const collection = req.params.collection;
  const rows = Array.isArray(req.body) ? req.body : req.body?.items;
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'Expected an array of items' });

  // Duplicates are blocked row by row and reported back; the rest of the file
  // still imports, the same way rows that fail validation do.
  const allow = collection !== 'redemptions' || req.query.allowDuplicate === '1' || req.body?.allowDuplicate === true;
  const screened = allow
    ? { rows, blocked: [] }
    : screenBatch(rows, store.redemptions, { programs: store.programs });

  const now = new Date().toISOString();
  const created = screened.rows.map((r) => ({ id: newId(singular[collection]), createdAt: now, ...r }));
  store[collection].push(...created);
  writeStore(store);
  res.status(201).json({ inserted: created.length, blocked: screened.blocked });
});

app.put('/api/:collection/:id', assertCollection, (req, res) => {
  const store = readStore();
  const list = store[req.params.collection];
  const i = list.findIndex((x) => x.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  const next = { ...list[i], ...req.body, id: list[i].id };
  if (req.params.collection === 'redemptions' && !overridden(req)) {
    // Ignore the row being edited, or every save would collide with itself.
    const match = findDuplicate(list, next, { ignoreId: list[i].id });
    if (match) {
      return res.status(409).json({
        error: `Those edits duplicate another entry — ${describeRow(match, store.programs)}`,
        duplicateOf: match,
      });
    }
  }
  delete next.allowDuplicate;
  list[i] = next;
  writeStore(store);
  res.json(list[i]);
});

app.delete('/api/:collection/:id', assertCollection, (req, res) => {
  const store = readStore();
  const before = store[req.params.collection].length;
  store[req.params.collection] = store[req.params.collection].filter((x) => x.id !== req.params.id);
  if (store[req.params.collection].length === before) return res.status(404).json({ error: 'Not found' });
  writeStore(store);
  res.status(204).end();
});

// In production, serve the built React app from the same origin.
const dist = path.join(__dirname, '..', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`Points Tracker API on http://localhost:${PORT}`);
  console.log(`Data file: ${STORE_PATH}`);
});
