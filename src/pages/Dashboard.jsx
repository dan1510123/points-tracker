import React from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  AreaChart, Area, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { useStore } from '../StoreContext.jsx';
import {
  redemptionSummary, holdingsSummary, redeemedByYear,
  cumulativeRedeemed, redeemedByCategory, topRedemptions,
  transferSummary, earnedSummary, fmtPoints, fmtUSD,
} from '../lib/calc.js';

function Kpi({ label, value, note, tone }) {
  return (
    <div className="card">
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value${tone ? ' ' + tone : ''}`}>{value}</div>
      {note && <div className="kpi-note">{note}</div>}
    </div>
  );
}

const usdTick = (v) => (Math.abs(v) >= 1000 ? `$${Math.round(v / 1000)}k` : `$${Math.round(v)}`);
const CAT_COLORS = ['#4f9cf9', '#3ec97a', '#f0b429', '#f2545b', '#a06cd5', '#2dd4bf', '#fb923c', '#94a3b8'];

export default function Dashboard() {
  const { store } = useStore();
  const redeemed = redemptionSummary(store);
  const held = holdingsSummary(store);
  const byYear = redeemedByYear(store);
  const cumulative = cumulativeRedeemed(store);
  const byCategory = redeemedByCategory(store);
  const top = topRedemptions(store);
  const transfers = transferSummary(store);
  const earned = earnedSummary(store);

  const activePrograms = store.programs.filter((p) => !p.archived);
  const hasRedemptions = redeemed.count > 0;
  // Points that arrived by transfer were already counted when they were earned
  // in the source program, so netting them out is what stops one Amex point
  // from being counted twice. This is exactly earnedSummary's total.
  const lifetime = earned.totalEarned;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Points held &amp; points used</h1>
          <p className="sub">
            Every dollar figure is points multiplied by the cents-per-point you set in{' '}
            <Link to="/settings">Settings</Link>. Nothing is inferred from the data.
          </p>
        </div>
        <Link to="/redemptions/new"><button>Log a redemption</button></Link>
      </div>

      <div className="grid kpi" style={{ marginBottom: 16 }}>
        <Kpi
          label="Points I've used"
          value={fmtPoints(redeemed.totalPoints)}
          note={
            transfers.count > 0
              ? `${redeemed.count} redemption${redeemed.count === 1 ? '' : 's'} + ${fmtPoints(transfers.totalSent)} transferred out`
              : `${redeemed.count} redemption${redeemed.count === 1 ? '' : 's'} logged`
          }
        />
        <Kpi
          label="Value of what I used"
          value={fmtUSD(redeemed.totalValue, { cents: false })}
          tone="good"
          note={transfers.count > 0 ? 'transfers count as points out, not value' : undefined}
        />
        <Kpi
          label="Points I have"
          value={fmtPoints(held.totalPoints)}
          note={`worth ${fmtUSD(held.totalValue, { cents: false })} at your rates`}
        />
        <Kpi
          label="Points earned all time"
          value={fmtPoints(lifetime)}
          tone="accent"
          note={
            transfers.count > 0
              ? `held + used, less ${fmtPoints(transfers.totalReceived)} that arrived by transfer`
              : 'held + used — a floor, gaps in the ledger read low'
          }
        />
      </div>

      {!hasRedemptions && (
        <div className="notice">
          <strong>No redemptions logged yet.</strong> Add them one at a time on the{' '}
          <Link to="/redemptions/new">Log a redemption</Link> page, or backfill a batch at once via{' '}
          <Link to="/import">Import CSV</Link>. Set your current balances under{' '}
          <Link to="/balances">Points I have</Link>.
        </div>
      )}

      <div className="grid two" style={{ marginBottom: 16 }}>
        <div className="card pad-lg">
          <h2>Value used by year</h2>
          {byYear.length === 0 ? (
            <div className="empty">Nothing used yet.</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={byYear} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a3240" vertical={false} />
                <XAxis dataKey="year" />
                <YAxis tickFormatter={usdTick} />
                <Tooltip
                  formatter={(v, n) => [fmtUSD(v), n]}
                  contentStyle={{ background: '#1d2430', border: '1px solid #2a3240', borderRadius: 8 }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {activePrograms.map((p) => (
                  <Bar key={p.id} dataKey={p.name} stackId="v" fill={p.color} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card pad-lg">
          <h2>Cumulative value used</h2>
          {cumulative.length === 0 ? (
            <div className="empty">Nothing used yet.</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={cumulative} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="cumFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3ec97a" stopOpacity={0.55} />
                    <stop offset="100%" stopColor="#3ec97a" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a3240" vertical={false} />
                <XAxis dataKey="month" />
                <YAxis tickFormatter={usdTick} />
                <Tooltip
                  formatter={(v) => fmtUSD(v)}
                  contentStyle={{ background: '#1d2430', border: '1px solid #2a3240', borderRadius: 8 }}
                />
                <Area type="monotone" dataKey="cumulative" stroke="#3ec97a" fill="url(#cumFill)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="grid split" style={{ marginBottom: 16 }}>
        <div className="card pad-lg">
          <h2>Where the points went</h2>
          {byCategory.length === 0 ? (
            <div className="empty">Tag redemptions with a category to see this split.</div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={150}>
                <PieChart>
                  <Pie data={byCategory} dataKey="value" nameKey="category" innerRadius={38} outerRadius={62} paddingAngle={2}>
                    {byCategory.map((c, i) => <Cell key={c.category} fill={CAT_COLORS[i % CAT_COLORS.length]} />)}
                  </Pie>
                  <Tooltip
                    formatter={(v, n) => [fmtUSD(v), n]}
                    contentStyle={{ background: '#1d2430', border: '1px solid #2a3240', borderRadius: 8 }}
                  />
                </PieChart>
              </ResponsiveContainer>
              {/* A list rather than recharts' legend: in a narrow column the
                  legend wraps and still shows nothing but the labels, and the
                  dollars and share are the point of the panel. */}
              <table style={{ marginTop: 6 }}>
                <tbody>
                  {byCategory.map((c, i) => (
                    <tr key={c.category}>
                      <td className="nowrap">
                        <span className="dot" style={{ background: CAT_COLORS[i % CAT_COLORS.length] }} />
                        {c.category}
                        <div className="muted small">{fmtPoints(c.points)} pts · {c.count} row{c.count === 1 ? '' : 's'}</div>
                      </td>
                      <td className="num mono nowrap">
                        {fmtUSD(c.value, { cents: false })}
                        <div className="muted small">
                          {redeemed.totalValue > 0 ? `${Math.round((c.value / redeemed.totalValue) * 100)}%` : '—'}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>

        <div className="card pad-lg">
          <h2>Program breakdown</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Program</th>
                  <th className="num">Your cpp</th>
                  <th className="num">Spent</th>
                  <th className="num">Value used</th>
                  <th className="num">Held</th>
                  <th className="num">Earned</th>
                  <th className="num">Lifetime</th>
                </tr>
              </thead>
              <tbody>
                {redeemed.byProgram.map((r) => {
                  const h = held.byProgram.find((x) => x.programId === r.programId);
                  const e = earned.byProgram.find((x) => x.programId === r.programId);
                  return (
                    <tr key={r.programId}>
                      <td className="nowrap"><span className="dot" style={{ background: r.color }} />{r.name}</td>
                      <td className="num mono">{r.cpp.toFixed(2)}¢</td>
                      <td className="num mono">
                        {fmtPoints(r.spentPoints)}
                        {r.transferredOut > 0 && (
                          <div className="muted small">+{fmtPoints(r.transferredOut)} moved out</div>
                        )}
                      </td>
                      <td className="num mono good">{fmtUSD(r.value, { cents: false })}</td>
                      {/* Points on top, the same figure in dollars underneath —
                          nine columns of numbers didn't fit the panel. */}
                      <td className="num mono">
                        {fmtPoints(h?.points || 0)}
                        <div className="muted small">{fmtUSD(h?.value || 0, { cents: false })}</div>
                      </td>
                      <td className="num mono">
                        <span style={e?.suspect ? { color: 'var(--bad)' } : undefined}>{fmtPoints(e?.earned || 0)}</span>
                        <div className="muted small">{fmtUSD(e?.earnedValue || 0, { cents: false })}</div>
                        {e?.transferredIn > 0 && (
                          <div className="muted small">{fmtPoints(e.transferredIn)} in by transfer</div>
                        )}
                      </td>
                      {/* What the program has been worth to you: the awards you
                          took plus what's still sitting there, priced the same way. */}
                      <td className="num mono"><strong>{fmtUSD(r.value + (h?.value || 0), { cents: false })}</strong></td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td><strong>Total</strong></td>
                  <td />
                  <td className="num mono"><strong>{fmtPoints(redeemed.totalSpentPoints)}</strong></td>
                  <td className="num mono good"><strong>{fmtUSD(redeemed.totalValue, { cents: false })}</strong></td>
                  <td className="num mono">
                    <strong>{fmtPoints(held.totalPoints)}</strong>
                    <div className="muted small">{fmtUSD(held.totalValue, { cents: false })}</div>
                  </td>
                  <td className="num mono">
                    <strong>{fmtPoints(earned.totalEarned)}</strong>
                    <div className="muted small">{fmtUSD(earned.totalEarnedValue, { cents: false })}</div>
                  </td>
                  <td className="num mono">
                    <strong>{fmtUSD(redeemed.totalValue + held.totalValue, { cents: false })}</strong>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="muted small" style={{ marginTop: 10, marginBottom: 0 }}>
            <strong>Earned</strong> is held + spent + transferred out − transferred in: what the program gave you
            on its own, rather than what you moved into it. <strong>Lifetime</strong> is value used plus value held. Every dollar figure — including the muted ones under the point totals — is priced at your cpp for
            that program.
          </p>
          <TransferGap earned={earned} lifetimeValue={redeemed.totalValue + held.totalValue} />
        </div>
      </div>

      {transfers.count > 0 && (
        <div className="card pad-lg" style={{ marginBottom: 16 }}>
          <div className="spread" style={{ marginBottom: 12 }}>
            <h2 style={{ margin: 0 }}>Transfers to partners</h2>
            <Link to="/redemptions" className="small">see all →</Link>
          </div>
          <div className="grid kpi" style={{ marginBottom: 14 }}>
            <div>
              <div className="kpi-label">Points transferred out</div>
              <div className="kpi-value sm">{fmtPoints(transfers.totalSent)}</div>
              <div className="kpi-note">across {transfers.count} transfer{transfers.count === 1 ? '' : 's'}</div>
            </div>
            <div>
              <div className="kpi-label">Miles received</div>
              <div className="kpi-value sm">{fmtPoints(transfers.totalReceived)}</div>
            </div>
            <div>
              <div className="kpi-label">Gained to bonuses</div>
              <div className="kpi-value sm good">{fmtPoints(transfers.totalBonus)}</div>
              <div className="kpi-note">
                {transfers.totalSent > 0
                  ? `${((transfers.totalReceived / transfers.totalSent - 1) * 100).toFixed(1)}% above 1:1 overall`
                  : '—'}
              </div>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>From</th>
                  <th>To</th>
                  <th className="num">Out</th>
                  <th className="num">In</th>
                  <th className="num">Bonus</th>
                </tr>
              </thead>
              <tbody>
                {transfers.rows.slice(0, 8).map((t) => (
                  <tr key={t.id}>
                    <td className="mono nowrap">{t.date}</td>
                    <td className="nowrap"><span className="dot" style={{ background: t.from?.color || '#666' }} />{t.from?.name || '—'}</td>
                    <td className="nowrap"><span className="dot" style={{ background: t.to?.color || '#666' }} />{t.to?.name || '—'}</td>
                    <td className="num mono">{fmtPoints(t.sent)}</td>
                    <td className="num mono">{fmtPoints(t.received)}</td>
                    <td className="num mono">
                      {t.bonus > 0 ? <span className="good">+{fmtPoints(t.bonus)}</span> : <span className="muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {top.length > 0 && (
        <div className="card pad-lg">
          <div className="spread" style={{ marginBottom: 12 }}>
            <h2 style={{ margin: 0 }}>Biggest redemptions</h2>
            <Link to="/redemptions" className="small">see all →</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Date</th><th>Program</th><th>Description</th><th className="num">Points</th><th className="num">Value</th></tr>
              </thead>
              <tbody>
                {top.map((r) => (
                  <tr key={r.id}>
                    <td className="mono nowrap">{r.date}</td>
                    <td className="nowrap"><span className="dot" style={{ background: r.program?.color || '#666' }} />{r.program?.name || '—'}</td>
                    <td>{r.description}</td>
                    <td className="num mono">{fmtPoints(r.points)}</td>
                    <td className="num mono">{fmtUSD(r.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * One line reconciling the Earned and Lifetime dollar totals, which differ only
 * because a transferred point is priced at its source's cpp in Earned and at
 * its destination's cpp in Lifetime.
 */
function TransferGap({ earned, lifetimeValue }) {
  // Work from the figures as displayed so the sentence matches the table to
  // the dollar, rather than drifting by one from separate rounding.
  const gap = Math.round(earned.totalEarnedValue) - Math.round(lifetimeValue);
  if (earned.totalTransferredOut === 0 || gap === 0) return null;
  const before = Math.round(earned.transferredOutValue);
  const after = before - gap;
  const usd = (n) => fmtUSD(n, { cents: false });
  return (
    <p className="muted small" style={{ marginTop: 8, marginBottom: 0 }}>
      <strong>Why Earned and Lifetime totals differ:</strong> transfers. At your rates, the{' '}
      {fmtPoints(earned.totalTransferredOut)} points you moved out were worth {usd(before)} before the transfer and{' '}
      {usd(after)} after: {gap > 0 ? (
        <><strong>{usd(gap)} lost</strong> in the move, because some landed in programs you value lower than the ones they left.</>
      ) : (
        <><strong className="good">{usd(-gap)} gained</strong> in the move, thanks to transfer bonuses or programs you value higher.</>
      )}
    </p>
  );
}
