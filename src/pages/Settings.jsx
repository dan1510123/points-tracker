import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router-dom';
import { useStore } from '../StoreContext.jsx';
import { api } from '../api.js';
import { holdingsSummary, redemptionSummary, fmtUSD } from '../lib/calc.js';
import { getCreds, forgetCreds, pushStore, pullStore, GistConflictError, getAutoSync, setAutoSync, subscribe as subscribeCreds } from '../lib/gist.js';
import { applyRemote, noteSynced, subscribeStatus, getStatus } from '../lib/sync.js';

const PALETTE = ['#2E77BC', '#117ACA', '#C8102E', '#111111', '#01426A', '#3ec97a', '#f0b429', '#a06cd5'];

// <input type="color"> only accepts #rrggbb, so widen #rgb and fall back for anything else.
const toHex6 = (c) => {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(c || '').trim());
  if (!m) return PALETTE[5];
  return m[1].length === 3 ? `#${[...m[1]].map((x) => x + x).join('')}` : `#${m[1]}`;
};

export default function Settings() {
  const { store, mutate, refresh } = useStore();
  const [drafts, setDrafts] = useState({});
  const [defaultCpp, setDefaultCpp] = useState(store.settings.defaultCpp ?? 1.5);
  const [newProgram, setNewProgram] = useState({ name: '', issuer: '', cpp: 1.5, color: toHex6(PALETTE[5]) });
  // Inline edit of one program's name / issuer / colour: { id, name, issuer, color, error }.
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [sync, setSync] = useState(() => getCreds());
  const [syncBusy, setSyncBusy] = useState('');
  const [syncMsg, setSyncMsg] = useState(null);
  const autoSync = useSyncExternalStore(subscribeCreds, getAutoSync);
  const syncStatus = useSyncExternalStore(subscribeStatus, getStatus);

  // The local-only save reminder links here with ?section=gist.
  const gistCard = useRef(null);
  const { search, key } = useLocation();
  useEffect(() => {
    if (new URLSearchParams(search).get('section') === 'gist') {
      gistCard.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [search, key]); // key: re-scroll when the link is followed again from this page

  const held = holdingsSummary(store);
  const redeemed = redemptionSummary(store);

  const setDraft = (id, val) => setDrafts((d) => ({ ...d, [id]: val }));

  async function saveRates() {
    setBusy(true);
    try {
      await mutate(() => api.patchSettings({ defaultCpp: Number(defaultCpp) || 0 }));
      for (const [id, val] of Object.entries(drafts)) {
        await mutate(() => api.update('programs', id, { cpp: val === '' ? null : Number(val) }));
      }
      setDrafts({});
      setMsg('Rates saved. Every dollar figure in the app now uses them.');
    } finally {
      setBusy(false);
    }
  }

  async function addProgram(e) {
    e.preventDefault();
    if (!newProgram.name.trim()) return;
    await mutate(() =>
      api.create('programs', {
        name: newProgram.name.trim(),
        issuer: newProgram.issuer.trim(),
        cpp: Number(newProgram.cpp) || 0,
        color: newProgram.color,
        kind: 'other',
        balance: 0,
        balanceUpdatedAt: null,
        archived: false,
        history: [],
      })
    );
    setNewProgram({ name: '', issuer: '', cpp: 1.5, color: toHex6(PALETTE[5]) });
  }

  const startEdit = (p) => setEditing({ id: p.id, name: p.name, issuer: p.issuer || '', color: toHex6(p.color), error: '' });
  const setEdit = (k) => (e) => setEditing((ed) => ({ ...ed, [k]: e.target.value, error: '' }));

  async function saveEdit() {
    const name = editing.name.trim();
    if (!name) return setEditing((ed) => ({ ...ed, error: 'Name can’t be empty.' }));
    // Imports match programs by name, so two with the same name would be ambiguous.
    const clash = store.programs.find((p) => p.id !== editing.id && p.name.trim().toLowerCase() === name.toLowerCase());
    if (clash) return setEditing((ed) => ({ ...ed, error: `There’s already a program called “${clash.name}”.` }));
    await mutate(() => api.update('programs', editing.id, { name, issuer: editing.issuer.trim(), color: editing.color }));
    setEditing(null);
  }

  const editKeys = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); saveEdit(); }
    if (e.key === 'Escape') setEditing(null);
  };

  async function deleteProgram(p) {
    const rdms = store.redemptions.filter((r) => r.programId === p.id).length;
    const warn = rdms > 0 ? `\n\n${rdms} redemption${rdms === 1 ? '' : 's'} reference it and will be orphaned.` : '';
    if (!confirm(`Delete "${p.name}"?${warn}`)) return;
    await mutate(() => api.remove('programs', p.id));
  }

  // A full snapshot of everything — programs, redemptions, settings — as a
  // single JSON file. This is the whole backup; import it to restore.
  function exportData() {
    const stamp = new Date().toISOString().slice(0, 10);
    const blob = new Blob([JSON.stringify(store, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `points-tracker-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    const counts = `${store.programs.length} programs, ${store.redemptions.length} entries`;
    setMsg(`Exported points-tracker-backup-${stamp}.json (${counts}). Keep it somewhere safe.`);
  }

  async function importData(file) {
    if (!file) return;
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch (err) {
      setMsg(`Could not read that file — it isn't valid JSON. (${err.message})`);
      return;
    }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.redemptions) || !Array.isArray(parsed.programs)) {
      setMsg("That file doesn't look like a Points Tracker backup — it's missing the programs or redemptions list.");
      return;
    }
    const counts = `${parsed.programs.length} programs and ${parsed.redemptions.length} entries`;
    if (!confirm(`Replace everything on this device with this backup (${counts})?\n\nYour current data is snapshotted first, so this is undoable.`)) return;
    try {
      await api.importStore(parsed); // snapshots the current store, then swaps it in
      await refresh();
      setMsg(`Imported ${counts}. Everything on this device now matches the backup.`);
    } catch (err) {
      setMsg(`Import failed: ${err.message}`);
    }
  }

  const setSyncField = (k) => (e) => setSync((c) => ({ ...c, [k]: e.target.value.trim() }));
  const said = (ok, text) => setSyncMsg({ ok, text });

  async function push(force = false) {
    setSyncBusy('push');
    setSyncMsg(null);
    try {
      const res = await pushStore({ ...sync, data: store, force });
      setSync((c) => ({ ...c, gistId: res.gistId }));
      noteSynced(res.updatedAt);
      said(true, res.created
        ? `Created private gist ${res.gistId} and pushed your data. Paste that id on your other device.`
        : `Pushed. The gist now matches this device as of ${new Date(res.updatedAt).toLocaleString()}.`);
    } catch (err) {
      if (err instanceof GistConflictError) {
        const when = new Date(err.remoteUpdatedAt).toLocaleString();
        // No ETag on gists, so this prompt is the only thing standing between
        // a second device's push and a silent overwrite of it.
        const go = confirm(
          `That gist was written at ${when}, after the last time this device synced with it — ` +
          `most likely from another device.\n\nPushing now overwrites it. Pull first if you want to see it.`
        );
        if (go) return push(true);
        said(false, 'Push cancelled. Pull to see the other device\u2019s copy first.');
      } else {
        said(false, err.message);
      }
    } finally {
      setSyncBusy('');
    }
  }

  async function pull() {
    setSyncBusy('pull');
    setSyncMsg(null);
    try {
      const { data, updatedAt } = await pullStore(sync);
      if (!confirm('Replace all data on this device with the gist copy? Your current data is backed up first.')) {
        said(false, 'Pull cancelled. Nothing on this device changed.');
        return;
      }
      applyRemote(data, updatedAt); // snapshots first, and isn't pushed straight back
      await refresh();
      said(true, `Pulled the copy saved ${new Date(updatedAt).toLocaleString()}.`);
    } catch (err) {
      said(false, err.message);
    } finally {
      setSyncBusy('');
    }
  }

  function forget() {
    forgetCreds();
    setSync({ token: '', gistId: '' });
    said(true, 'Token and gist id cleared from this browser. The gist itself is untouched.');
  }

  const preview = (cppOverride) => {
    let total = 0;
    for (const p of store.programs) {
      const cpp = cppOverride[p.id] !== undefined && cppOverride[p.id] !== ''
        ? Number(cppOverride[p.id])
        : (p.cpp ?? Number(defaultCpp));
      const points = (Number(p.balance) || 0) +
        store.redemptions.filter((r) => r.programId === p.id).reduce((s, r) => s + (Number(r.points) || 0), 0);
      total += (points * (Number(cpp) || 0)) / 100;
    }
    return total;
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="sub">Cents-per-point is entirely your call. Nothing here is derived from your redemption history.</p>
        </div>
        <button onClick={saveRates} disabled={busy}>{busy ? 'Saving…' : 'Save rates'}</button>
      </div>

      {msg && <div className="notice">{msg}</div>}

      <div className="card pad-lg" style={{ marginBottom: 16 }}>
        <h2>Your cents-per-point</h2>
        <p className="muted small">
          One rate per program. Leave a program blank to fall back to the global default. Common reference points:
          transferable currencies are often valued near 1.7–2.2¢, airline miles near 1.1–1.5¢ — but these are your
          numbers, so set whatever matches how you actually redeem.
        </p>

        <div className="row" style={{ maxWidth: 240, marginBottom: 16 }}>
          <div className="field">
            <label>Global default (¢ per point)</label>
            <input type="number" step="0.05" min="0" value={defaultCpp} onChange={(e) => setDefaultCpp(e.target.value)} />
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Program</th>
                <th>Issuer</th>
                <th style={{ width: 150 }}>Cents per point</th>
                <th className="num">Total points</th>
                <th className="num">Implied value</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {store.programs.map((p) => {
                const draft = drafts[p.id];
                const shown = draft !== undefined ? draft : (p.cpp ?? '');
                const effective = shown === '' ? Number(defaultCpp) || 0 : Number(shown) || 0;
                const points = (Number(p.balance) || 0) +
                  store.redemptions.filter((r) => r.programId === p.id).reduce((s, r) => s + (Number(r.points) || 0), 0);
                const ed = editing?.id === p.id ? editing : null;
                return (
                  <tr key={p.id}>
                    {ed ? (
                      <>
                        <td>
                          <div className="edit-name">
                            <input
                              type="color"
                              aria-label="Color"
                              className="color-pick"
                              value={ed.color}
                              onChange={setEdit('color')}
                            />
                            <input aria-label="Name" value={ed.name} onChange={setEdit('name')} onKeyDown={editKeys} autoFocus />
                          </div>
                          {ed.error && <div className="field-error">{ed.error}</div>}
                        </td>
                        <td>
                          <input aria-label="Issuer" value={ed.issuer} onChange={setEdit('issuer')} onKeyDown={editKeys} placeholder="Issuer" />
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="nowrap"><span className="dot" style={{ background: p.color }} />{p.name}</td>
                        <td className="muted small">{p.issuer}</td>
                      </>
                    )}
                    <td>
                      <input
                        type="number"
                        step="0.05"
                        min="0"
                        value={shown}
                        placeholder={`${defaultCpp} (default)`}
                        onChange={(e) => setDraft(p.id, e.target.value)}
                        className="mono"
                      />
                    </td>
                    <td className="num mono muted">{Math.round(points).toLocaleString()}</td>
                    <td className="num mono">{fmtUSD((points * effective) / 100, { cents: false })}</td>
                    <td className="num nowrap">
                      {ed ? (
                        <>
                          <button className="sm" onClick={saveEdit}>Save</button>{' '}
                          <button className="ghost sm" onClick={() => setEditing(null)}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <button className="ghost sm" onClick={() => startEdit(p)}>Edit</button>{' '}
                          <button className="danger sm" onClick={() => deleteProgram(p)}>Delete</button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}><strong>Lifetime value at these rates</strong></td>
                <td className="num mono"><strong>{fmtUSD(preview(drafts), { cents: false })}</strong></td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="muted small" style={{ marginTop: 10, marginBottom: 0 }}>
          Currently redeemed {redeemed.totalPoints.toLocaleString()} points and holding {held.totalPoints.toLocaleString()}.
        </p>
      </div>

      <div className="card pad-lg" style={{ marginBottom: 16 }}>
        <h2>Add a program</h2>
        <form onSubmit={addProgram}>
          <div className="row">
            <div className="field">
              <label>Name</label>
              <input value={newProgram.name} onChange={(e) => setNewProgram((n) => ({ ...n, name: e.target.value }))} placeholder="Marriott Bonvoy" />
            </div>
            <div className="field">
              <label>Issuer</label>
              <input value={newProgram.issuer} onChange={(e) => setNewProgram((n) => ({ ...n, issuer: e.target.value }))} placeholder="Marriott" />
            </div>
            <div className="field" style={{ maxWidth: 140 }}>
              <label>Cents per point</label>
              <input type="number" step="0.05" min="0" value={newProgram.cpp} onChange={(e) => setNewProgram((n) => ({ ...n, cpp: e.target.value }))} />
            </div>
            <div className="field" style={{ maxWidth: 120 }}>
              <label>Color</label>
              <div className="color-field">
                <input
                  type="color"
                  className="color-pick"
                  aria-label="Color"
                  value={newProgram.color}
                  onChange={(e) => setNewProgram((n) => ({ ...n, color: e.target.value }))}
                />
                <span className="mono small muted">{newProgram.color.toUpperCase()}</span>
              </div>
            </div>
            <div className="field" style={{ maxWidth: 120, display: 'flex', alignItems: 'flex-end' }}>
              <button type="submit">Add</button>
            </div>
          </div>
        </form>
      </div>

      <div className="card pad-lg">
        <h2>Data</h2>
        <p className="muted small">
          Your data lives in this browser. Nothing leaves the device unless you export it or turn on gist sync below.
          Because it's per-browser, <strong>Export app data</strong> is your backup and the way to move everything to
          another browser or device — export here, then <strong>Import app data</strong> there.
        </p>
        <div className="row" style={{ alignItems: 'center' }}>
          <div style={{ flex: '0 0 auto' }}>
            <button onClick={exportData}>Export app data</button>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Import app data (replaces everything on this device)</label>
            <input type="file" accept="application/json,.json" onChange={(e) => { importData(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
        </div>
        <p className="muted small" style={{ marginTop: 12, marginBottom: 0 }}>
          Every import snapshots the current data first, so a wrong file is undoable — and a backup is written before a
          gist pull, too. Clearing this site's browser data erases everything here, so keep an exported file somewhere
          safe.
        </p>
      </div>

      <div className="card pad-lg" style={{ marginTop: 16 }} id="gist-sync" ref={gistCard}>
        <h2>Sync to a private gist</h2>
        <p className="muted small">
          Optional, and off until you fill this in. Make a <strong>classic</strong> token at{' '}
          <code>github.com/settings/tokens/new</code> with only the <strong>gist</strong> scope checked — that's the one
          the gist API accepts (fine-grained tokens don't work with gists). The token stays in this browser and is sent
          only to <code>api.github.com</code>. Leave the gist id blank the first time and a private one gets created for
          you.
        </p>

        <div className="row">
          <div className="field">
            <label>Token</label>
            <input
              type="password"
              value={sync.token}
              onChange={setSyncField('token')}
              placeholder="ghp_…"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="field">
            <label>Gist id</label>
            <input
              className="mono"
              value={sync.gistId}
              onChange={setSyncField('gistId')}
              placeholder="created on first push"
              spellCheck={false}
            />
          </div>
        </div>

        <div className="row" style={{ alignItems: 'center' }}>
          <div style={{ flex: '0 0 auto' }}>
            <button onClick={() => push()} disabled={!!syncBusy || !sync.token}>
              {syncBusy === 'push' ? 'Pushing…' : 'Push to gist'}
            </button>
          </div>
          <div style={{ flex: '0 0 auto' }}>
            <button className="ghost" onClick={pull} disabled={!!syncBusy || !sync.token || !sync.gistId}>
              {syncBusy === 'pull' ? 'Pulling…' : 'Pull from gist'}
            </button>
          </div>
          <div style={{ flex: '0 0 auto' }}>
            <button className="danger" onClick={forget} disabled={!!syncBusy}>Forget token</button>
          </div>
          <div />{/* spacer: keeps the buttons from stretching across the row */}
        </div>

        <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
          <input type="checkbox" checked={autoSync} onChange={(e) => setAutoSync(e.target.checked)} style={{ width: 'auto' }} />
          Auto-sync — push to the gist on every save, and load the latest from it when the page opens
        </label>

        {!syncMsg && (syncStatus.state === 'conflict' || syncStatus.state === 'error') && (
          <div className="error" style={{ marginTop: 14, marginBottom: 0 }}>{syncStatus.message}</div>
        )}

        {syncMsg && (
          <div className={syncMsg.ok ? 'notice' : 'error'} style={{ marginTop: 14, marginBottom: 0 }}>
            {syncMsg.text}
          </div>
        )}

        <p className="muted small" style={{ marginTop: 14, marginBottom: 0 }}>
          Once a gist is set up, auto-sync keeps it current on its own: every save is pushed a moment later, and opening
          the page pulls the gist's copy if another device changed it. The buttons are still here for doing it by hand.
          Push overwrites the gist; pull overwrites this device, snapshotting the current data first. If the gist moved
          since this device last synced, nothing is overwritten without asking.
        </p>
      </div>
    </>
  );
}
