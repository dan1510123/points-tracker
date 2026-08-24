import React, { useState } from 'react';
import { useStore } from '../StoreContext.jsx';
import { api } from '../api.js';
import { holdingsSummary, redemptionSummary, fmtUSD } from '../lib/calc.js';

const PALETTE = ['#2E77BC', '#117ACA', '#C8102E', '#111111', '#01426A', '#3ec97a', '#f0b429', '#a06cd5'];

export default function Settings() {
  const { store, mutate, refresh } = useStore();
  const [drafts, setDrafts] = useState({});
  const [defaultCpp, setDefaultCpp] = useState(store.settings.defaultCpp ?? 1.5);
  const [newProgram, setNewProgram] = useState({ name: '', issuer: '', cpp: 1.5, color: PALETTE[5] });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

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
    setNewProgram({ name: '', issuer: '', cpp: 1.5, color: PALETTE[5] });
  }

  async function deleteProgram(p) {
    const rdms = store.redemptions.filter((r) => r.programId === p.id).length;
    const warn = rdms > 0 ? `\n\n${rdms} redemption${rdms === 1 ? '' : 's'} reference it and will be orphaned.` : '';
    if (!confirm(`Delete "${p.name}"?${warn}`)) return;
    await mutate(() => api.remove('programs', p.id));
  }

  async function makeBackup() {
    const res = await api.backup();
    setMsg(res.backup ? `Backup written to ${res.backup}` : 'Nothing to back up yet.');
  }

  async function importStore(file) {
    if (!file) return;
    const text = await file.text();
    try {
      const parsed = JSON.parse(text);
      if (!confirm('Replace all current data with this file? Your existing data is backed up first.')) return;
      await api.importStore(parsed);
      await refresh();
      setMsg('Data restored from file.');
    } catch (err) {
      setMsg(`Could not read that file: ${err.message}`);
    }
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
                return (
                  <tr key={p.id}>
                    <td className="nowrap"><span className="dot" style={{ background: p.color }} />{p.name}</td>
                    <td className="muted small">{p.issuer}</td>
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
                    <td className="num"><button className="danger sm" onClick={() => deleteProgram(p)}>Delete</button></td>
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
              <select value={newProgram.color} onChange={(e) => setNewProgram((n) => ({ ...n, color: e.target.value }))}>
                {PALETTE.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
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
          Everything lives in <code>data/store.json</code> next to this project — no cloud, no credentials, no third
          party. Back it up or copy it anywhere.
        </p>
        <div className="row" style={{ alignItems: 'center' }}>
          <div style={{ flex: '0 0 auto' }}>
            <button className="ghost" onClick={makeBackup}>Write a backup</button>
          </div>
          <div style={{ flex: '0 0 auto' }}>
            <a href="/api/export"><button className="ghost">Download JSON</button></a>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Restore from a JSON export</label>
            <input type="file" accept="application/json,.json" onChange={(e) => importStore(e.target.files?.[0])} />
          </div>
        </div>
      </div>
    </>
  );
}
