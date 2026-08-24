import React, { useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import { useStore } from '../StoreContext.jsx';
import { api } from '../api.js';
import { detectMapping, buildRedemptions } from '../lib/csv.js';
import { parseJsonImport, SCHEMA_EXAMPLE } from '../lib/json.js';
import { valueOf, fmtPoints, fmtUSD, REDEMPTION_CATEGORIES, programMap, isTransfer } from '../lib/calc.js';
import { screenBatch, describeRow } from '../lib/dupes.js';

const FIELDS = [
  ['date', 'Date', true],
  ['description', 'Description', false],
  ['points', 'Points redeemed', true],
  ['category', 'Category', false],
];

/**
 * Everything held back as a duplicate, with the entry it collides with. Listed
 * in full rather than truncated — the point is to be able to check each one.
 */
function BlockedDuplicates({ blocked, programs, allow, onAllow }) {
  if (!blocked.length) return null;
  return (
    <div className="notice" style={{ borderLeftColor: allow ? 'var(--warn)' : 'var(--bad)' }}>
      <strong>
        {blocked.length.toLocaleString()} entr{blocked.length === 1 ? 'y is' : 'ies are'} already in your ledger —{' '}
        {allow ? 'the override is on, so they will import as second copies.' : 'they will not be imported.'}
      </strong>
      <div className="table-wrap" style={{ margin: '10px 0' }}>
        <table>
          <thead>
            <tr><th>Entry</th><th>Row in the file</th><th>Why it's blocked</th></tr>
          </thead>
          <tbody>
            {blocked.map((b) => (
              <tr key={b.at}>
                <td className="mono num">{b.at}</td>
                <td className="small">{describeRow(b.row, programs)}</td>
                <td className="small muted">{b.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: 0 }}>
        <input type="checkbox" style={{ width: 'auto' }} checked={allow} onChange={(e) => onAllow(e.target.checked)} />
        <span className="small">Import these anyway — I know they're duplicates</span>
      </label>
    </div>
  );
}

export default function Import() {
  const { store, mutate } = useStore();
  const fileRef = useRef(null);
  const pm = programMap(store.programs);

  const [fileName, setFileName] = useState('');
  const [kind, setKind] = useState(null); // 'csv' | 'json'
  const [headers, setHeaders] = useState([]);
  const [data, setData] = useState([]);
  const [jsonText, setJsonText] = useState('');
  const [mapping, setMapping] = useState({ date: '', description: '', points: '', category: '' });
  const [programId, setProgramId] = useState(store.programs[0]?.id || '');
  const [defaultCategory, setDefaultCategory] = useState('Flight');
  const [onlyNegative, setOnlyNegative] = useState(false);
  const [showSchema, setShowSchema] = useState(false);
  const [allowDuplicates, setAllowDuplicates] = useState(false);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  // Pasted text and an uploaded file are the same JSON path; only the label on
  // the resulting batch differs.
  const pasteMode = kind === 'json' && !fileName;

  function reset() {
    setData([]);
    setHeaders([]);
    setJsonText('');
    setKind(null);
    setFileName('');
    // The duplicate override was granted for one file, not for the next one.
    setAllowDuplicates(false);
    if (fileRef.current) fileRef.current.value = '';
  }

  function handlePaste(text) {
    setResult(null);
    setAllowDuplicates(false);
    setFileName('');
    setData([]);
    setHeaders([]);
    if (fileRef.current) fileRef.current.value = '';
    setJsonText(text);
    setKind(text.trim() ? 'json' : null);
  }

  function handleFile(file) {
    if (!file) return;
    setResult(null);
    setAllowDuplicates(false);
    setFileName(file.name);
    const isJson = /\.json$/i.test(file.name) || file.type === 'application/json';

    if (isJson) {
      setKind('json');
      setData([]);
      setHeaders([]);
      file
        .text()
        .then(setJsonText)
        .catch((err) => setResult({ error: err.message }));
      return;
    }

    setKind('csv');
    setJsonText('');
    Papa.parse(file, {
      header: true,
      skipEmptyLines: 'greedy',
      complete: (res) => {
        const cols = (res.meta.fields || []).filter(Boolean);
        setHeaders(cols);
        setData(res.data);
        setMapping(detectMapping(cols));
      },
      error: (err) => setResult({ error: err.message }),
    });
  }

  const jsonPreview = useMemo(() => {
    if (kind !== 'json' || !jsonText) return null;
    return parseJsonImport(jsonText, {
      programs: store.programs,
      defaultProgramId: programId,
      defaultCategory,
    });
  }, [kind, jsonText, store.programs, programId, defaultCategory]);

  const preview = useMemo(() => {
    if (kind !== 'csv') return null;
    if (!data.length || !mapping.date || !mapping.points || !programId) return null;
    return buildRedemptions(data, { mapping, programId, defaultCategory, onlyNegative });
  }, [kind, data, mapping, programId, defaultCategory, onlyNegative]);

  const parsedRows = kind === 'json' ? jsonPreview?.rows : preview?.redemptions;

  // Entries the ledger already holds — or that the file repeats — are held back
  // and listed one by one with the entry they collide with, the same way rows
  // that fail validation are. The server screens the batch again on write, so
  // the block holds whatever the page does.
  const screened = useMemo(
    () => (parsedRows ? screenBatch(parsedRows, store.redemptions, { programs: store.programs }) : null),
    [parsedRows, store.redemptions, store.programs]
  );

  const blocked = screened?.blocked || [];
  const importable = (allowDuplicates ? parsedRows : screened?.rows) || [];

  const previewValue = useMemo(() => {
    if (kind !== 'csv') return 0;
    const program = pm[programId];
    return importable.reduce((s, r) => s + valueOf(r.points, program, store.settings), 0);
  }, [kind, importable, pm, programId, store.settings]);

  // Each JSON row carries its own program, so value is summed per row.
  const jsonStats = useMemo(() => {
    const spent = importable.filter((r) => !isTransfer(r));
    return {
      value: spent.reduce((s, r) => s + valueOf(r.points, pm[r.programId], store.settings), 0),
      points: importable.reduce((s, r) => s + r.points, 0),
      transfers: importable.length - spent.length,
    };
  }, [importable, pm, store.settings]);

  async function importRows(rows, skipped) {
    if (!rows.length) return;
    setBusy(true);
    const batchId = `batch_${Date.now().toString(36)}`;
    try {
      const source = fileName || 'Pasted JSON';
      const res = await mutate(() =>
        api.bulk('redemptions', rows.map((r) => ({ ...r, batchId, source })), { allowDuplicate: allowDuplicates })
      );
      setResult({
        ok: true,
        imported: res?.inserted ?? rows.length,
        skipped,
        // Anything the server held back that this page didn't already catch.
        blocked: res?.blocked || [],
        duplicatesBlocked: blocked.length,
      });
      reset();
    } catch (err) {
      setResult({ error: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Import redemptions</h1>
          <p className="sub">
            Bulk-backfill your history from a <strong>CSV</strong> or a <strong>JSON</strong> file instead of typing
            each entry.
          </p>
        </div>
        <button className="ghost" onClick={() => setShowSchema((s) => !s)}>
          {showSchema ? 'Hide' : 'Show'} JSON schema
        </button>
      </div>

      {showSchema && (
        <div className="card pad-lg" style={{ marginBottom: 16 }}>
          <h2>JSON schema</h2>
          <p className="muted small" style={{ marginTop: 0 }}>
            Either a top-level array of entries, or an object with a <code>redemptions</code> array — so a file
            exported from Settings → Download JSON can be fed straight back in. No column mapping: the field names
            below are the contract.
          </p>
          <pre
            className="mono small"
            style={{
              background: 'var(--panel-2)',
              border: '1px solid var(--line)',
              borderRadius: 8,
              padding: '12px 14px',
              overflowX: 'auto',
            }}
          >
            {SCHEMA_EXAMPLE}
          </pre>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Field</th><th>Required</th><th>Notes</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td className="mono">date</td><td>yes</td>
                  <td className="muted small">YYYY-MM-DD preferred; MM/DD/YYYY and similar are accepted.</td>
                </tr>
                <tr>
                  <td className="mono">points</td><td>yes</td>
                  <td className="muted small">Points leaving the program. Negatives are treated as positive.</td>
                </tr>
                <tr>
                  <td className="mono">program</td><td>no</td>
                  <td className="muted small">
                    Program name or id. Falls back to the program picked below when omitted.
                  </td>
                </tr>
                <tr>
                  <td className="mono">type</td><td>no</td>
                  <td className="muted small">
                    <code>redemption</code> (default) or <code>transfer</code>.
                  </td>
                </tr>
                <tr>
                  <td className="mono">category</td><td>no</td>
                  <td className="muted small">Redemptions only. Falls back to the default category below.</td>
                </tr>
                <tr>
                  <td className="mono">to</td><td>transfers</td>
                  <td className="muted small">Destination program name or id. Must differ from the source.</td>
                </tr>
                <tr>
                  <td className="mono">bonusPct</td><td>no</td>
                  <td className="muted small">Transfers only, e.g. <code>30</code> for a 30% bonus.</td>
                </tr>
                <tr>
                  <td className="mono">received</td><td>no</td>
                  <td className="muted small">
                    Transfers only. Overrides points × bonus — use it for partners that aren't 1:1.
                  </td>
                </tr>
                <tr>
                  <td className="mono">description, notes</td><td>no</td>
                  <td className="muted small">Free text.</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="muted small" style={{ marginBottom: 0 }}>
            Anything else in the file is ignored. Rows that fail validation are listed individually and skipped —
            they never block the rest of the import.
          </p>
        </div>
      )}

      <div className="notice">
        <strong>Building the file.</strong> None of these programs export redemption history directly, so assemble a
        sheet yourself. The only columns that matter are a <strong>date</strong> and a <strong>points</strong> amount;
        a description and category make it easier to read later. Copy your airline activity page into a spreadsheet,
        or pull award bookings out of old confirmation emails, and save as CSV.
        <br />
        <br />
        Pasting a full statement is fine — awards usually appear as negative miles, and the option below keeps only
        those rows.
      </div>

      {result?.ok && (
        <div className="notice" style={{ borderLeftColor: 'var(--good)' }}>
          <strong>Imported {result.imported.toLocaleString()} entries.</strong>
          {result.skipped > 0 && <> {result.skipped.toLocaleString()} skipped (no date, zero points, filtered out, or rejected).</>}
          {result.duplicatesBlocked > 0 && (
            <> {result.duplicatesBlocked.toLocaleString()} blocked as duplicates.</>
          )}{' '}
          You can undo the whole batch from the Points I've used page.
          {result.blocked?.length > 0 && (
            <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              {result.blocked.map((b) => (
                <li key={b.at} className="small">Entry {b.at}: {b.reason}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {result?.error && <div className="error">{result.error}</div>}

      <div className="card pad-lg" style={{ marginBottom: 16 }}>
        <div className="step"><b>1</b> Choose a file</div>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv,.json,application/json"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        {fileName && kind === 'csv' && (
          <p className="muted small" style={{ marginBottom: 0 }}>
            <strong>{fileName}</strong> · {data.length.toLocaleString()} rows · {headers.length} columns
          </p>
        )}
        {fileName && kind === 'json' && (
          <p className="muted small" style={{ marginBottom: 0 }}>
            <strong>{fileName}</strong> · JSON
            {jsonPreview?.total !== undefined && <> · {jsonPreview.total.toLocaleString()} entries</>}
          </p>
        )}

        <div className="or-divider"><span>or paste JSON</span></div>

        <textarea
          className="mono small"
          rows={8}
          value={pasteMode ? jsonText : ''}
          onChange={(e) => handlePaste(e.target.value)}
          placeholder={'[\n  { "date": "2024-06-02", "program": "Delta SkyMiles", "points": 120000 }\n]'}
          spellCheck={false}
          style={{ resize: 'vertical' }}
        />
        <div className="spread">
          <span className="muted small">
            {pasteMode
              ? `${jsonText.length.toLocaleString()} characters pasted`
              : 'Paste an array of entries, or an object with a "redemptions" array.'}
          </span>
          {pasteMode && (
            <button className="ghost sm" onClick={reset}>Clear</button>
          )}
        </div>
      </div>

      {kind === 'json' && jsonPreview && (
        <>
          {jsonPreview.fatal ? (
            <div className="error">{jsonPreview.fatal}</div>
          ) : (
            <>
              <div className="card pad-lg" style={{ marginBottom: 16 }}>
                <div className="step"><b>2</b> Fallbacks for anything the file leaves out</div>
                <div className="row">
                  <div className="field">
                    <label>Program for entries without one</label>
                    <select value={programId} onChange={(e) => setProgramId(e.target.value)}>
                      {store.programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label>Category for entries without one</label>
                    <select value={defaultCategory} onChange={(e) => setDefaultCategory(e.target.value)}>
                      {REDEMPTION_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
                <p className="muted small" style={{ marginBottom: 0 }}>
                  Entries that name their own <code>program</code> ignore these.
                </p>
              </div>

              <div className="card pad-lg">
                <div className="step"><b>3</b> Preview &amp; import</div>
                <div className="grid kpi" style={{ marginBottom: 14 }}>
                  <div className="card">
                    <div className="kpi-label">Entries ready</div>
                    <div className="kpi-value sm">{importable.length.toLocaleString()}</div>
                    {jsonStats.transfers > 0 && (
                      <div className="kpi-note">{jsonStats.transfers.toLocaleString()} transfer{jsonStats.transfers === 1 ? '' : 's'}</div>
                    )}
                  </div>
                  <div className="card">
                    <div className="kpi-label">Points</div>
                    <div className="kpi-value sm">{fmtPoints(jsonStats.points)}</div>
                  </div>
                  <div className="card">
                    <div className="kpi-label">Value at your cpp</div>
                    <div className="kpi-value sm good">{fmtUSD(jsonStats.value, { cents: false })}</div>
                    <div className="kpi-note">transfers count $0</div>
                  </div>
                  <div className="card">
                    <div className="kpi-label">Duplicates blocked</div>
                    <div className={`kpi-value sm${blocked.length && !allowDuplicates ? ' bad' : ''}`}>
                      {blocked.length.toLocaleString()}
                    </div>
                    {allowDuplicates && blocked.length > 0 && <div className="kpi-note">override on</div>}
                  </div>
                  <div className="card">
                    <div className="kpi-label">Rejected</div>
                    <div className={`kpi-value sm${jsonPreview.errors.length ? ' bad' : ''}`}>
                      {jsonPreview.errors.length.toLocaleString()}
                    </div>
                  </div>
                </div>

                <BlockedDuplicates
                  blocked={blocked}
                  programs={store.programs}
                  allow={allowDuplicates}
                  onAllow={setAllowDuplicates}
                />

                {jsonPreview.errors.length > 0 && (
                  <div className="notice" style={{ borderLeftColor: 'var(--bad)' }}>
                    <strong>These entries will be skipped.</strong> Everything else still imports.
                    <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                      {jsonPreview.errors.slice(0, 8).map((e) => (
                        <li key={e.at} className="small">Entry {e.at}: {e.reason}</li>
                      ))}
                      {jsonPreview.errors.length > 8 && (
                        <li className="small muted">…and {jsonPreview.errors.length - 8} more</li>
                      )}
                    </ul>
                  </div>
                )}

                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th><th>Program</th><th>Description</th><th>Kind</th><th className="num">Points</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importable.slice(0, 10).map((r, i) => (
                        <tr key={i}>
                          <td className="mono nowrap">{r.date}</td>
                          <td className="nowrap">
                            <span className="dot" style={{ background: pm[r.programId]?.color || '#666' }} />
                            {pm[r.programId]?.name}
                            {isTransfer(r) && (
                              <div className="muted small">→ {pm[r.toProgramId]?.name}</div>
                            )}
                          </td>
                          <td>{r.description || <span className="muted">—</span>}</td>
                          <td>
                            <span className="pill">{isTransfer(r) ? 'Transfer' : r.category}</span>
                          </td>
                          <td className="num mono">
                            {fmtPoints(r.points)}
                            {isTransfer(r) && <div className="muted small">→ {fmtPoints(r.received)} in</div>}
                          </td>
                        </tr>
                      ))}
                      {importable.length === 0 && (
                        <tr>
                          <td colSpan={5} className="empty">
                            {blocked.length > 0
                              ? 'Every entry in this file is already in your ledger.'
                              : 'Nothing importable in this file.'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div style={{ marginTop: 16 }}>
                  <button
                    onClick={() => importRows(importable, jsonPreview.errors.length)}
                    disabled={busy || importable.length === 0}
                  >
                    {busy
                      ? 'Importing…'
                      : `Import ${importable.length.toLocaleString()} entr${importable.length === 1 ? 'y' : 'ies'}`}
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {kind === 'csv' && headers.length > 0 && (
        <>
          <div className="card pad-lg" style={{ marginBottom: 16 }}>
            <div className="step"><b>2</b> Which program are these from?</div>
            <div className="row">
              <div className="field">
                <label>Program</label>
                <select value={programId} onChange={(e) => setProgramId(e.target.value)}>
                  {store.programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Category for rows without one</label>
                <select value={defaultCategory} onChange={(e) => setDefaultCategory(e.target.value)}>
                  {REDEMPTION_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div className="card pad-lg" style={{ marginBottom: 16 }}>
            <div className="step"><b>3</b> Map the columns</div>
            <div className="row">
              {FIELDS.map(([key, label, required]) => (
                <div className="field" key={key}>
                  <label>{label}{required && ' *'}</label>
                  <select value={mapping[key]} onChange={(e) => setMapping((m) => ({ ...m, [key]: e.target.value }))}>
                    <option value="">— none —</option>
                    {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '4px 0 0' }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={onlyNegative} onChange={(e) => setOnlyNegative(e.target.checked)} />
              <span className="small">This file mixes earning and redemptions — keep only the negative rows</span>
            </label>
          </div>

          {preview && (
            <div className="card pad-lg">
              <div className="step"><b>4</b> Preview &amp; import</div>
              <div className="grid kpi" style={{ marginBottom: 14 }}>
                <div className="card">
                  <div className="kpi-label">Redemptions found</div>
                  <div className="kpi-value sm">{importable.length.toLocaleString()}</div>
                </div>
                <div className="card">
                  <div className="kpi-label">Points</div>
                  <div className="kpi-value sm">{fmtPoints(importable.reduce((s, r) => s + r.points, 0))}</div>
                </div>
                <div className="card">
                  <div className="kpi-label">Value at your cpp</div>
                  <div className="kpi-value sm good">{fmtUSD(previewValue, { cents: false })}</div>
                </div>
                <div className="card">
                  <div className="kpi-label">Duplicates blocked</div>
                  <div className={`kpi-value sm${blocked.length && !allowDuplicates ? ' bad' : ''}`}>
                    {blocked.length.toLocaleString()}
                  </div>
                  {allowDuplicates && blocked.length > 0 && <div className="kpi-note">override on</div>}
                </div>
                <div className="card">
                  <div className="kpi-label">Rows skipped</div>
                  <div className="kpi-value sm">{preview.skipped.toLocaleString()}</div>
                </div>
              </div>

              <BlockedDuplicates
                blocked={blocked}
                programs={store.programs}
                allow={allowDuplicates}
                onAllow={setAllowDuplicates}
              />

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Date</th><th>Description</th><th>Category</th><th className="num">Points</th></tr>
                  </thead>
                  <tbody>
                    {importable.slice(0, 10).map((r, i) => (
                      <tr key={i}>
                        <td className="mono nowrap">{r.date}</td>
                        <td>{r.description}</td>
                        <td className="muted small">{r.category}</td>
                        <td className="num mono">{fmtPoints(r.points)}</td>
                      </tr>
                    ))}
                    {importable.length === 0 && (
                      <tr>
                        <td colSpan={4} className="empty">
                          {blocked.length > 0
                            ? 'Every row in this file is already in your ledger.'
                            : 'Nothing to import with these settings — check your column mapping.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: 16 }}>
                <button
                  onClick={() => importRows(importable, preview.skipped)}
                  disabled={busy || importable.length === 0}
                >
                  {busy
                    ? 'Importing…'
                    : `Import ${importable.length.toLocaleString()} redemption${importable.length === 1 ? '' : 's'}`}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
