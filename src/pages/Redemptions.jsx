import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import { useStore } from '../StoreContext.jsx';
import { api } from '../api.js';
import {
  valueOf, programMap, fmtPoints, fmtUSD, isTransfer, receivedPoints, rowValue, yearOf,
} from '../lib/calc.js';
import { duplicateGroups, describeRow } from '../lib/dupes.js';

const usdTick = (v) => (Math.abs(v) >= 1000 ? `$${Math.round(v / 1000)}k` : `$${Math.round(v)}`);

function Kpi({ label, value, note, tone }) {
  return (
    <div className="card">
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value sm${tone ? ' ' + tone : ''}`}>{value}</div>
      {note && <div className="kpi-note">{note}</div>}
    </div>
  );
}

export default function Redemptions() {
  const { store, mutate } = useStore();
  const navigate = useNavigate();
  const pm = programMap(store.programs);
  const [filterProgram, setFilterProgram] = useState('all');
  const [filterYear, setFilterYear] = useState('all');
  const [filterKind, setFilterKind] = useState('all'); // all | redemption | transfer
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterBatch, setFilterBatch] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [minPoints, setMinPoints] = useState('');
  const [maxPoints, setMaxPoints] = useState('');
  const [search, setSearch] = useState('');
  const [showMore, setShowMore] = useState(false);
  const [sort, setSort] = useState({ key: 'date', dir: 'desc' });

  const years = useMemo(
    () => [...new Set(store.redemptions.map((r) => String(r.date || '').slice(0, 4)).filter(Boolean))].sort().reverse(),
    [store.redemptions]
  );

  // Categories actually present in the ledger, not the master list — a filter
  // that returns nothing on every pick is worse than not offering it.
  const categories = useMemo(
    () => [...new Set(store.redemptions.filter((r) => !isTransfer(r)).map((r) => r.category || 'Uncategorized'))].sort(),
    [store.redemptions]
  );

  // One filtered set feeds every number on this page, so the stats always
  // describe exactly the rows listed below them.
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const lo = minPoints === '' ? null : Number(minPoints);
    const hi = maxPoints === '' ? null : Number(maxPoints);
    return store.redemptions
      // A transfer matches its program filter from either end.
      .filter((r) => filterProgram === 'all' || r.programId === filterProgram || r.toProgramId === filterProgram)
      .filter((r) => filterYear === 'all' || String(r.date || '').startsWith(filterYear))
      .filter((r) => filterKind === 'all' || (filterKind === 'transfer') === isTransfer(r))
      // Transfers carry a fixed category label, so a category pick is a
      // redemption question: asking it excludes them.
      .filter((r) => filterCategory === 'all' || (!isTransfer(r) && (r.category || 'Uncategorized') === filterCategory))
      .filter((r) => filterBatch === 'all' || (filterBatch === 'manual' ? !r.batchId : r.batchId === filterBatch))
      // Both ends inclusive, and either end can be left open.
      .filter((r) => !from || String(r.date || '') >= from)
      .filter((r) => !to || String(r.date || '') <= to)
      .filter((r) => lo === null || (Number(r.points) || 0) >= lo)
      .filter((r) => hi === null || (Number(r.points) || 0) <= hi)
      .filter((r) => {
        if (!q) return true;
        const dest = isTransfer(r) ? pm[r.toProgramId]?.name || '' : '';
        const src = pm[r.programId]?.name || '';
        return `${r.description} ${r.notes} ${r.category} ${src} ${dest}`.toLowerCase().includes(q);
      });
  }, [
    store.redemptions, filterProgram, filterYear, filterKind, filterCategory, filterBatch,
    from, to, minPoints, maxPoints, search, pm,
  ]);

  /** The table's own ordering. Stats and charts don't care, so it sits apart. */
  const sortedRows = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1;
    const key = (r) => {
      switch (sort.key) {
        case 'points': return Number(r.points) || 0;
        case 'value': return rowValue(r, pm, store.settings);
        case 'program': return (pm[r.programId]?.name || '').toLowerCase();
        case 'category': return (isTransfer(r) ? 'Transfer' : r.category || 'Uncategorized').toLowerCase();
        case 'description': return String(r.description || '').toLowerCase();
        default: return String(r.date || '');
      }
    };
    return [...rows].sort((a, b) => {
      const x = key(a);
      const y = key(b);
      if (x === y) return String(b.date || '').localeCompare(String(a.date || '')); // stable-ish: newest first
      return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y))) * dir;
    });
  }, [rows, sort, pm, store.settings]);

  const filtered =
    filterProgram !== 'all' || filterYear !== 'all' || filterKind !== 'all' || filterCategory !== 'all' ||
    filterBatch !== 'all' || from !== '' || to !== '' || minPoints !== '' || maxPoints !== '' || search.trim() !== '';

  const stats = useMemo(() => {
    const spent = rows.filter((r) => !isTransfer(r));
    const moved = rows.filter(isTransfer);
    const spentPoints = spent.reduce((s, r) => s + (Number(r.points) || 0), 0);
    const value = spent.reduce((s, r) => s + valueOf(r.points, pm[r.programId], store.settings), 0);
    const movedPoints = moved.reduce((s, r) => s + (Number(r.points) || 0), 0);
    const receivedTotal = moved.reduce((s, r) => s + receivedPoints(r), 0);
    // Transfers match the program filter from either end, so under a program
    // filter the totals have to be split: points that left this program vs.
    // miles that arrived at it. Lumping them together would credit Delta with
    // an outflow that actually came out of Amex.
    const scoped = filterProgram !== 'all';
    const outOfProgram = scoped
      ? moved.filter((r) => r.programId === filterProgram).reduce((s, r) => s + (Number(r.points) || 0), 0)
      : movedPoints;
    const intoProgram = scoped
      ? moved.filter((r) => r.toProgramId === filterProgram).reduce((s, r) => s + receivedPoints(r), 0)
      : 0;
    return {
      spentPoints,
      value,
      movedPoints,
      outOfProgram,
      intoProgram,
      bonus: receivedTotal - movedPoints,
      redemptionCount: spent.length,
      transferCount: moved.length,
      // Blended rate across genuine redemptions only — transfers would drag it
      // to zero without meaning anything.
      blendedCpp: spentPoints > 0 ? (value * 100) / spentPoints : 0,
      biggest: spent
        .map((r) => ({ ...r, value: valueOf(r.points, pm[r.programId], store.settings) }))
        .sort((a, b) => b.value - a.value)[0],
    };
  }, [rows, pm, store.settings, filterProgram]);

  /** Points out per program, split into what was spent vs. merely moved. */
  const byProgram = useMemo(() => {
    const acc = {};
    for (const r of rows) {
      const id = r.programId;
      acc[id] = acc[id] || {
        program: pm[id],
        programId: id,
        name: pm[id]?.name || 'Unassigned',
        color: pm[id]?.color || '#666',
        spent: 0,
        moved: 0,
        value: 0,
        count: 0,
        received: 0,
      };
      const pts = Number(r.points) || 0;
      acc[id].count += 1;
      if (isTransfer(r)) acc[id].moved += pts;
      else {
        acc[id].spent += pts;
        acc[id].value += valueOf(pts, pm[id], store.settings);
      }
    }
    // Credit miles arriving by transfer to the destination program so a
    // filtered view of, say, Delta still shows where its miles came from.
    for (const r of rows.filter(isTransfer)) {
      const id = r.toProgramId;
      if (!id) continue;
      acc[id] = acc[id] || {
        program: pm[id],
        programId: id,
        name: pm[id]?.name || 'Unassigned',
        color: pm[id]?.color || '#666',
        spent: 0,
        moved: 0,
        value: 0,
        count: 0,
        received: 0,
      };
      acc[id].received += receivedPoints(r);
    }
    const list = Object.values(acc).sort((a, b) => b.spent + b.moved - (a.spent + a.moved));
    const max = Math.max(1, ...list.map((r) => r.spent + r.moved));
    return list.map((r) => ({ ...r, share: (r.spent + r.moved) / max }));
  }, [rows, pm, store.settings]);

  /** Value by year, stacked per program — only genuine redemptions carry value. */
  const byYear = useMemo(() => {
    const years = {};
    for (const r of rows) {
      if (isTransfer(r)) continue;
      const y = yearOf(r.date);
      years[y] = years[y] || { year: y };
      const p = pm[r.programId];
      const key = p?.name || 'Unassigned';
      years[y][key] = (years[y][key] || 0) + valueOf(r.points, p, store.settings);
    }
    return Object.values(years).sort((a, b) => a.year.localeCompare(b.year));
  }, [rows, pm, store.settings]);

  const chartPrograms = useMemo(() => {
    const names = new Set();
    for (const row of byYear) for (const k of Object.keys(row)) if (k !== 'year') names.add(k);
    return store.programs.filter((p) => names.has(p.name));
  }, [byYear, store.programs]);

  const batches = useMemo(() => {
    const m = {};
    for (const r of store.redemptions) {
      if (!r.batchId) continue;
      m[r.batchId] = m[r.batchId] || { batchId: r.batchId, label: r.source || r.batchId, count: 0, date: r.createdAt };
      m[r.batchId].count += 1;
    }
    return Object.values(m).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }, [store.redemptions]);

  // New entries are blocked before they land, but anything logged before that
  // check existed — or waved through with the override — can still be sitting
  // in the ledger twice. This is the sweep over what's already there.
  const dupeGroups = useMemo(() => duplicateGroups(store.redemptions), [store.redemptions]);
  const dupeExtras = dupeGroups.reduce((s, g) => s + g.count - 1, 0);
  const [showDupes, setShowDupes] = useState(false);

  /** Keep the entry that was logged first, drop the copies. */
  async function dropCopies(group) {
    const extras = group.rows.slice(1);
    if (!confirm(`Delete ${extras.length} duplicate cop${extras.length === 1 ? 'y' : 'ies'}, keeping the first?`)) return;
    await mutate(async () => {
      for (const r of extras) await api.remove('redemptions', r.id);
    });
  }

  async function undoBatch(batchId, label) {
    if (!confirm(`Remove every redemption imported from "${label}"?`)) return;
    await mutate(() => api.removeBatch(batchId));
    // Don't leave the table filtered to a source that no longer exists.
    if (filterBatch === batchId) setFilterBatch('all');
  }

  async function remove(r) {
    if (!confirm(`Delete this ${isTransfer(r) ? 'transfer' : 'redemption'}?`)) return;
    await mutate(() => api.remove('redemptions', r.id));
  }

  function resetFilters() {
    setFilterProgram('all');
    setFilterYear('all');
    setFilterKind('all');
    setFilterCategory('all');
    setFilterBatch('all');
    setFrom('');
    setTo('');
    setMinPoints('');
    setMaxPoints('');
    setSearch('');
  }

  /** Click a column to sort by it; click it again to flip the direction. */
  function sortBy(key) {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : // Dates and amounts are most useful biggest-first; text reads A→Z.
          { key, dir: key === 'description' || key === 'program' || key === 'category' ? 'asc' : 'desc' }
    );
  }

  const SortHead = ({ label, col, className }) => (
    <th className={className}>
      <button type="button" className="th-sort" onClick={() => sortBy(col)} aria-label={`Sort by ${label}`}>
        {label}
        <span className={`sort-caret${sort.key === col ? ' on' : ''}`}>
          {sort.key === col ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}
        </span>
      </button>
    </th>
  );

  const nothingLogged = store.redemptions.length === 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Points I've used</h1>
          <p className="sub">
            Everything that left a program: redemptions valued at your cents-per-point, and transfers to partners
            at $0. Every figure below describes the rows currently filtered.
          </p>
        </div>
        <div className="row" style={{ flex: '0 0 auto' }}>
          <Link to="/import"><button className="ghost">Bulk import</button></Link>
          <Link to="/redemptions/new?type=transfer"><button className="ghost">Log a transfer</button></Link>
          <Link to="/redemptions/new"><button>Log a redemption</button></Link>
        </div>
      </div>

      {nothingLogged ? (
        <div className="notice">
          <strong>Nothing logged yet.</strong> Add entries one at a time on the{' '}
          <Link to="/redemptions/new">Log a redemption</Link> page, or backfill a batch at once via{' '}
          <Link to="/import">Import CSV</Link>.
        </div>
      ) : (
        <>
          <div className="toolbar">
            <div>
              <label>Program</label>
              <select value={filterProgram} onChange={(e) => setFilterProgram(e.target.value)}>
                <option value="all">All programs</option>
                {store.programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label>Year</label>
              <select value={filterYear} onChange={(e) => setFilterYear(e.target.value)}>
                <option value="all">All years</option>
                {years.map((y) => <option key={y}>{y}</option>)}
              </select>
            </div>
            <div>
              <label>Kind</label>
              <select
                value={filterKind}
                onChange={(e) => {
                  setFilterKind(e.target.value);
                  // Transfers have no category, so keeping one selected here
                  // would silently filter everything out.
                  if (e.target.value === 'transfer') setFilterCategory('all');
                }}
              >
                <option value="all">Everything</option>
                <option value="redemption">Redemptions only</option>
                <option value="transfer">Transfers only</option>
              </select>
            </div>
            <div className="grow">
              <label>Search</label>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Description, notes, category, program…" />
            </div>
            <div>
              <label>&nbsp;</label>
              <button className="ghost" onClick={() => setShowMore((s) => !s)}>
                {showMore ? 'Fewer filters' : 'More filters'}
              </button>
            </div>
            {filtered && (
              <div>
                <label>&nbsp;</label>
                <button className="ghost" onClick={resetFilters}>Clear filters</button>
              </div>
            )}
          </div>

          {showMore && (
            <div className="toolbar">
              <div>
                <label>Category</label>
                <select
                  value={filterCategory}
                  onChange={(e) => setFilterCategory(e.target.value)}
                  disabled={filterKind === 'transfer'}
                  title={filterKind === 'transfer' ? 'Transfers have no category' : undefined}
                >
                  <option value="all">All categories</option>
                  {categories.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label>From</label>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div>
                <label>To</label>
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
              <div>
                <label>Points at least</label>
                <input
                  type="number" min="0" step="1000" className="mono" style={{ width: 120 }}
                  value={minPoints} onChange={(e) => setMinPoints(e.target.value)} placeholder="0"
                />
              </div>
              <div>
                <label>Points at most</label>
                <input
                  type="number" min="0" step="1000" className="mono" style={{ width: 120 }}
                  value={maxPoints} onChange={(e) => setMaxPoints(e.target.value)} placeholder="any"
                />
              </div>
              {batches.length > 0 && (
                <div>
                  <label>Source</label>
                  <select value={filterBatch} onChange={(e) => setFilterBatch(e.target.value)}>
                    <option value="all">Any source</option>
                    <option value="manual">Entered by hand</option>
                    {batches.map((b) => <option key={b.batchId} value={b.batchId}>{b.label}</option>)}
                  </select>
                </div>
              )}
            </div>
          )}

          {filtered && (
            <div className="notice">
              Showing <strong>{rows.length}</strong> of {store.redemptions.length} entries
              {filterProgram !== 'all' && <> · {pm[filterProgram]?.name}</>}
              {filterYear !== 'all' && <> · {filterYear}</>}
              {filterKind !== 'all' && <> · {filterKind === 'transfer' ? 'transfers' : 'redemptions'}</>}
              {filterCategory !== 'all' && <> · {filterCategory}</>}
              {(from || to) && <> · {from || 'the start'} → {to || 'today'}</>}
              {minPoints !== '' && <> · ≥ {fmtPoints(minPoints)} pts</>}
              {maxPoints !== '' && <> · ≤ {fmtPoints(maxPoints)} pts</>}
              {filterBatch !== 'all' && (
                <> · {filterBatch === 'manual' ? 'entered by hand' : batches.find((b) => b.batchId === filterBatch)?.label}</>
              )}
              {search.trim() !== '' && <> · “{search.trim()}”</>}
            </div>
          )}

          <div className="grid kpi" style={{ marginBottom: 16 }}>
            <Kpi
              label="Points spent"
              value={fmtPoints(stats.spentPoints)}
              note={`${stats.redemptionCount} redemption${stats.redemptionCount === 1 ? '' : 's'}`}
            />
            <Kpi
              label="Value received"
              value={fmtUSD(stats.value, { cents: false })}
              tone="good"
              note={stats.spentPoints > 0 ? `${stats.blendedCpp.toFixed(2)}¢ blended` : undefined}
            />
            <Kpi
              label={filterProgram === 'all' ? 'Transferred out' : 'Transferred'}
              value={
                filterProgram === 'all'
                  ? fmtPoints(stats.movedPoints)
                  : stats.outOfProgram > 0 || stats.intoProgram === 0
                    ? fmtPoints(stats.outOfProgram)
                    : `+${fmtPoints(stats.intoProgram)}`
              }
              note={
                stats.transferCount === 0
                  ? 'no transfers in view'
                  : filterProgram === 'all'
                    ? // A partner worse than 1:1 (Marriott's 3:1) makes this
                      // negative, where "bonus miles" would read as nonsense.
                      `${stats.transferCount} transfer${stats.transferCount === 1 ? '' : 's'} · ${
                        stats.bonus >= 0
                          ? `${fmtPoints(stats.bonus)} bonus miles`
                          : `${fmtPoints(Math.abs(stats.bonus))} lost to ratio`
                      }`
                    : [
                        stats.outOfProgram > 0 ? `${fmtPoints(stats.outOfProgram)} out` : null,
                        stats.intoProgram > 0 ? `${fmtPoints(stats.intoProgram)} in` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')
              }
            />
            <Kpi
              label="Biggest redemption"
              value={stats.biggest ? fmtUSD(stats.biggest.value, { cents: false }) : '—'}
              tone="accent"
              note={stats.biggest ? stats.biggest.description || pm[stats.biggest.programId]?.name : undefined}
            />
          </div>

          <div className="grid two" style={{ marginBottom: 16 }}>
            <div className="card pad-lg">
              <h2>Points out by program</h2>
              {byProgram.length === 0 ? (
                <div className="empty">Nothing matches the filters.</div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Program</th>
                        <th style={{ width: 90 }} />
                        <th className="num">Spent</th>
                        <th className="num">Value</th>
                        <th className="num">Moved out</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byProgram.map((r) => (
                        <tr key={r.programId}>
                          <td className="nowrap">
                            <span className="dot" style={{ background: r.color }} />{r.name}
                            {r.received > 0 && (
                              <div className="muted small">+{fmtPoints(r.received)} in by transfer</div>
                            )}
                          </td>
                          <td>
                            <div className="bar-track">
                              <div className="bar-fill" style={{ width: `${Math.round(r.share * 100)}%`, background: r.color }} />
                            </div>
                          </td>
                          <td className="num mono">{fmtPoints(r.spent)}</td>
                          <td className="num mono">{fmtUSD(r.value, { cents: false })}</td>
                          <td className="num mono muted">{r.moved > 0 ? fmtPoints(r.moved) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td><strong>Total</strong></td>
                        <td />
                        <td className="num mono"><strong>{fmtPoints(stats.spentPoints)}</strong></td>
                        <td className="num mono"><strong>{fmtUSD(stats.value, { cents: false })}</strong></td>
                        <td className="num mono"><strong>{stats.movedPoints > 0 ? fmtPoints(stats.movedPoints) : '—'}</strong></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
              <p className="muted small" style={{ marginTop: 10, marginBottom: 0 }}>
                The bar is total points out, spent and moved together. Only spent points carry value.
              </p>
            </div>

            <div className="card pad-lg">
              <h2>Value received by year</h2>
              {byYear.length === 0 ? (
                <div className="empty">No valued redemptions in view.</div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={byYear} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a3240" vertical={false} />
                    <XAxis dataKey="year" />
                    <YAxis tickFormatter={usdTick} />
                    <Tooltip
                      formatter={(v, n) => [fmtUSD(v), n]}
                      contentStyle={{ background: '#1d2430', border: '1px solid #2a3240', borderRadius: 8 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {/*
                      Animation off on purpose: changing a filter swaps which
                      Bars exist, and recharts leaves the entering animation
                      parked at zero height, so the chart renders empty.
                    */}
                    {chartPrograms.map((p) => (
                      <Bar key={p.id} dataKey={p.name} stackId="v" fill={p.color} isAnimationActive={false} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="spread">
              <div>
                <h3 style={{ margin: 0 }}>Duplicate check</h3>
                <div className="muted small" style={{ marginTop: 4 }}>
                  {dupeExtras === 0 ? (
                    <>No duplicates. Every entry differs from the rest in something other than its notes.</>
                  ) : (
                    <>
                      <strong style={{ color: 'var(--bad)' }}>
                        {dupeGroups.length} entr{dupeGroups.length === 1 ? 'y' : 'ies'} logged more than once
                      </strong>{' '}
                      · {dupeExtras} extra cop{dupeExtras === 1 ? 'y' : 'ies'} to clear. Matched on every field except
                      notes.
                    </>
                  )}
                </div>
              </div>
              {dupeExtras > 0 && (
                <button className="ghost" onClick={() => setShowDupes((s) => !s)}>
                  {showDupes ? 'Hide' : 'Review'} duplicates
                </button>
              )}
            </div>

            {showDupes && dupeExtras > 0 && (
              <div className="table-wrap" style={{ marginTop: 12 }}>
                <table>
                  <thead>
                    <tr><th>Entry</th><th className="num">Copies</th><th>Logged</th><th /></tr>
                  </thead>
                  <tbody>
                    {dupeGroups.map((g) => (
                      <tr key={g.key}>
                        <td className="small">{describeRow(g.rows[0], store.programs)}</td>
                        <td className="num mono">{g.count}</td>
                        <td className="muted mono small">
                          {g.rows.map((r) => (
                            <div key={r.id}>
                              {String(r.createdAt || '').slice(0, 16).replace('T', ' ') || 'unknown'}{' '}
                              <button className="ghost sm" onClick={() => navigate(`/redemptions/${r.id}`)}>open</button>{' '}
                              <button className="danger sm" onClick={() => remove(r)}>delete</button>
                            </div>
                          ))}
                        </td>
                        <td className="num nowrap">
                          <button className="danger sm" onClick={() => dropCopies(g)}>
                            Keep first, delete {g.count - 1}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {batches.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <h3>Imported batches</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Source file</th><th className="num">Rows</th><th>Imported</th><th /></tr>
                  </thead>
                  <tbody>
                    {batches.map((b) => (
                      <tr key={b.batchId}>
                        <td>{b.label}</td>
                        <td className="num mono">{b.count.toLocaleString()}</td>
                        <td className="muted mono small">{String(b.date || '').slice(0, 16).replace('T', ' ')}</td>
                        <td className="num nowrap">
                          <button
                            className="ghost sm"
                            onClick={() => {
                              setFilterBatch(b.batchId);
                              setShowMore(true);
                            }}
                          >
                            Show rows
                          </button>{' '}
                          <button className="danger sm" onClick={() => undoBatch(b.batchId, b.label)}>Undo import</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="card">
            <div className="spread" style={{ marginBottom: 10 }}>
              <span className="muted small">
                {rows.length} entr{rows.length === 1 ? 'y' : 'ies'}
                {stats.movedPoints > 0 && <> · {fmtPoints(stats.movedPoints)} pts transferred, not spent</>}
              </span>
              <span className="small mono">
                {fmtPoints(stats.spentPoints + stats.movedPoints)} pts out · <strong>{fmtUSD(stats.value)}</strong>
              </span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <SortHead label="Date" col="date" />
                    <SortHead label="Program" col="program" />
                    <SortHead label="Description" col="description" />
                    <SortHead label="Category" col="category" />
                    <SortHead label="Points" col="points" className="num" />
                    <SortHead label="Value" col="value" className="num" />
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="empty">
                        Nothing matches these filters.{' '}
                        <button className="ghost sm" onClick={resetFilters}>Clear them</button>
                      </td>
                    </tr>
                  )}
                  {sortedRows.map((r) => {
                    const p = pm[r.programId];
                    const transfer = isTransfer(r);
                    const dest = transfer ? pm[r.toProgramId] : null;
                    const got = transfer ? receivedPoints(r) : 0;
                    return (
                      <tr key={r.id}>
                        <td className="mono nowrap">{r.date}</td>
                        <td className="nowrap">
                          <span className="dot" style={{ background: p?.color || '#666' }} />{p?.name || '—'}
                          {transfer && (
                            <div className="muted small" style={{ marginTop: 2 }}>
                              → <span className="dot" style={{ background: dest?.color || '#666' }} />
                              {dest?.name || 'unknown program'}
                            </div>
                          )}
                        </td>
                        <td>
                          {transfer ? (
                            <>
                              <span className="mono">{fmtPoints(r.points)}</span> out →{' '}
                              <span className="mono">{fmtPoints(got)}</span> in
                              {Number(r.bonusPct) > 0 && <> · {Number(r.bonusPct)}% bonus</>}
                              {r.description && <div className="muted small">{r.description}</div>}
                            </>
                          ) : (
                            r.description || <span className="muted">—</span>
                          )}
                          {r.notes && <div className="muted small">{r.notes}</div>}
                        </td>
                        <td><span className="pill">{transfer ? 'Transfer' : r.category || 'Uncategorized'}</span></td>
                        <td className="num mono">{fmtPoints(r.points)}</td>
                        <td className="num mono">
                          {transfer ? <span className="muted">$0</span> : fmtUSD(rowValue(r, pm, store.settings))}
                        </td>
                        <td className="num nowrap">
                          <button className="ghost sm" onClick={() => navigate(`/redemptions/${r.id}`)}>Edit</button>{' '}
                          <button className="danger sm" onClick={() => remove(r)}>Delete</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}
