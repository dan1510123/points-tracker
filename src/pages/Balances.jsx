import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useStore } from '../StoreContext.jsx';
import { api } from '../api.js';
import { holdingsSummary, earnedSummary, cppFor, fmtPoints, fmtUSD } from '../lib/calc.js';

export default function Balances() {
  const { store, mutate } = useStore();
  const held = holdingsSummary(store);
  const earned = earnedSummary(store);
  const earnedBy = Object.fromEntries(earned.byProgram.map((e) => [e.programId, e]));
  const anyTransfers = earned.totalTransferredIn > 0;
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState(false);

  const dirty = Object.keys(drafts).length > 0;

  function setDraft(id, val) {
    setDrafts((d) => ({ ...d, [id]: val }));
  }

  async function saveAll() {
    setBusy(true);
    const stamp = new Date().toISOString();
    try {
      for (const [id, raw] of Object.entries(drafts)) {
        const program = store.programs.find((p) => p.id === id);
        if (!program) continue;
        const balance = Number(String(raw).replace(/,/g, '')) || 0;
        if (balance === Number(program.balance)) continue;
        const history = [...(program.history || []), { date: stamp, balance }];
        await mutate(() => api.update('programs', id, { balance, balanceUpdatedAt: stamp, history }));
      }
      setDrafts({});
    } finally {
      setBusy(false);
    }
  }

  // Stitch every program's snapshots into one timeline of total held value.
  const trend = useMemo(() => {
    const stamps = new Set();
    for (const p of store.programs) for (const h of p.history || []) stamps.add(String(h.date).slice(0, 10));
    const sorted = [...stamps].sort();
    return sorted.map((day) => {
      let value = 0;
      let points = 0;
      for (const p of store.programs) {
        const upTo = (p.history || []).filter((h) => String(h.date).slice(0, 10) <= day);
        if (upTo.length === 0) continue;
        const bal = Number(upTo[upTo.length - 1].balance) || 0;
        points += bal;
        value += (bal * cppFor(p, store.settings)) / 100;
      }
      return { day, value, points };
    });
  }, [store.programs, store.settings]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Points I have</h1>
          <p className="sub">
            None of these programs offer a consumer API, so balances are entered by hand. Each save records a snapshot
            so you can see the trend over time.
          </p>
        </div>
        <button onClick={saveAll} disabled={!dirty || busy}>{busy ? 'Saving…' : 'Save balances'}</button>
      </div>

      <div className="grid kpi" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="kpi-label">Total points held</div>
          <div className="kpi-value">{fmtPoints(held.totalPoints)}</div>
        </div>
        <div className="card">
          <div className="kpi-label">Value held</div>
          <div className="kpi-value accent">{fmtUSD(held.totalValue, { cents: false })}</div>
          <div className="kpi-note">at your cents-per-point settings</div>
        </div>
      </div>

      <div className="card pad-lg" style={{ marginBottom: 16 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Program</th>
                <th style={{ width: 180 }}>Current balance</th>
                <th className="num">Your cpp</th>
                <th className="num">Value</th>
                <th className="num">Earned all time</th>
                <th>Last updated</th>
              </tr>
            </thead>
            <tbody>
              {store.programs.map((p) => {
                const draft = drafts[p.id];
                const shown = draft !== undefined ? draft : p.balance ?? 0;
                const previewValue = ((Number(String(shown).replace(/,/g, '')) || 0) * cppFor(p, store.settings)) / 100;
                const earn = earnedBy[p.id];
                return (
                  <tr key={p.id}>
                    <td className="nowrap"><span className="dot" style={{ background: p.color }} />{p.name}</td>
                    <td>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={shown}
                        onChange={(e) => setDraft(p.id, e.target.value)}
                        className="mono"
                      />
                    </td>
                    <td className="num mono">{cppFor(p, store.settings).toFixed(2)}¢</td>
                    <td className="num mono">{fmtUSD(previewValue, { cents: false })}</td>
                    <td
                      className="num mono"
                      title={
                        earn
                          ? `${fmtPoints(earn.balance)} held + ${fmtPoints(earn.spent)} spent + ${fmtPoints(earn.transferredOut)} transferred out − ${fmtPoints(earn.transferredIn)} transferred in`
                          : ''
                      }
                    >
                      {earn?.suspect ? (
                        <span style={{ color: 'var(--bad)' }} title="More miles arrived by transfer than this balance and ledger can account for — a redemption is probably missing.">
                          {fmtPoints(earn.earned)}
                        </span>
                      ) : (
                        fmtPoints(earn?.earned || 0)
                      )}
                      {earn?.transferredIn > 0 && (
                        <div className="muted small">+{fmtPoints(earn.transferredIn)} in by transfer</div>
                      )}
                    </td>
                    <td className="muted small mono">
                      {p.balanceUpdatedAt ? String(p.balanceUpdatedAt).slice(0, 10) : 'never'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted small" style={{ marginTop: 12, marginBottom: 0 }}>
          <strong>Earned all time</strong> is what you earned in the program itself — card spend, flying, promos —
          backed out as <span className="mono">balance + spent + transferred out − transferred in</span>. It's a floor:
          a redemption or transfer you haven't logged makes it read low
          {anyTransfers ? '' : ', and until you log transfers it just equals balance + spent'}. Hover a figure to see
          the arithmetic. Adjust your rates on the <Link to="/settings">Settings</Link> page.
        </p>
      </div>

      <div className="card pad-lg">
        <h2>Held value over time</h2>
        {trend.length < 2 ? (
          <div className="empty">Save balances on at least two different days to build a trend.</div>
        ) : (
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={trend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a3240" vertical={false} />
              <XAxis dataKey="day" />
              <YAxis tickFormatter={(v) => (Math.abs(v) >= 1000 ? `$${Math.round(v / 1000)}k` : `$${Math.round(v)}`)} />
              <Tooltip
                formatter={(v, n) => (n === 'value' ? fmtUSD(v) : fmtPoints(v))}
                contentStyle={{ background: '#1d2430', border: '1px solid #2a3240', borderRadius: 8 }}
              />
              <Line type="monotone" dataKey="value" stroke="#4f9cf9" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </>
  );
}
