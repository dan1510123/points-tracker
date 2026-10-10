// All value math flows through here. Cents-per-point is a user setting only —
// nothing in this file ever infers or back-solves a cpp from redemption data.

export function cppFor(program, settings) {
  const raw = program?.cpp;
  if (raw === null || raw === undefined || raw === '' || Number.isNaN(Number(raw))) {
    return Number(settings?.defaultCpp ?? 0);
  }
  return Number(raw);
}

export function valueOf(points, program, settings) {
  return ((Number(points) || 0) * cppFor(program, settings)) / 100;
}

// --- Transfers -------------------------------------------------------------
// A transfer moves points from a transferable currency to a partner program.
// It is stored in `redemptions` alongside real redemptions because the points
// genuinely leave the source program, but it is worth $0: you haven't gotten
// anything yet, and pricing it would double-count the award you later book
// with the miles it produced.

export const TRANSFER_CATEGORY = 'Transfer out';

export const isTransfer = (r) => r?.type === 'transfer';

/** Miles that landed at the partner. Explicit `received` wins; else points × bonus. */
export function receivedPoints(r) {
  if (r?.received !== undefined && r.received !== null && r.received !== '') return Number(r.received) || 0;
  const sent = Number(r?.points) || 0;
  return Math.round(sent * (1 + (Number(r?.bonusPct) || 0) / 100));
}

/** What a ledger row is worth. Transfers are always zero. */
export function rowValue(r, programs, settings) {
  if (isTransfer(r)) return 0;
  const pm = Array.isArray(programs) ? programMap(programs) : programs;
  return valueOf(r.points, pm[r.programId], settings);
}

export function programMap(programs = []) {
  return Object.fromEntries(programs.map((p) => [p.id, p]));
}

export const fmtPoints = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');

export const fmtUSD = (n, opts = {}) =>
  (Number(n) || 0).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: opts.cents === false ? 0 : 2,
    minimumFractionDigits: opts.cents === false ? 0 : 2,
  });

export const yearOf = (dateStr) => (dateStr ? String(dateStr).slice(0, 4) : 'unknown');
export const monthOf = (dateStr) => (dateStr ? String(dateStr).slice(0, 7) : 'unknown');

/**
 * Roll the ledger up per program. Points out counts transfers — they really do
 * leave the source program — but only genuine redemptions carry value, so a
 * program whose outflow is all transfers shows points used and $0 used.
 */
export function redemptionSummary(store) {
  const { redemptions = [], programs = [], settings = {} } = store;
  const byProgram = programs.map((p) => {
    const rows = redemptions.filter((r) => r.programId === p.id);
    const spent = rows.filter((r) => !isTransfer(r));
    const moved = rows.filter(isTransfer);
    const spentPoints = spent.reduce((s, r) => s + (Number(r.points) || 0), 0);
    const transferredOut = moved.reduce((s, r) => s + (Number(r.points) || 0), 0);
    return {
      program: p,
      programId: p.id,
      name: p.name,
      color: p.color,
      count: rows.length,
      redemptionCount: spent.length,
      transferCount: moved.length,
      spentPoints,
      transferredOut,
      points: spentPoints + transferredOut,
      value: valueOf(spentPoints, p, settings),
      cpp: cppFor(p, settings),
    };
  });
  const totalPoints = byProgram.reduce((s, r) => s + r.points, 0);
  const totalValue = byProgram.reduce((s, r) => s + r.value, 0);
  return {
    byProgram,
    totalPoints,
    totalValue,
    totalSpentPoints: byProgram.reduce((s, r) => s + r.spentPoints, 0),
    totalTransferred: byProgram.reduce((s, r) => s + r.transferredOut, 0),
    count: redemptions.filter((r) => !isTransfer(r)).length,
    transferCount: redemptions.filter(isTransfer).length,
  };
}

/** Current holdings priced at the user's cpp. */
export function holdingsSummary(store) {
  const { programs = [], settings = {} } = store;
  const byProgram = programs.map((p) => ({
    program: p,
    programId: p.id,
    name: p.name,
    color: p.color,
    points: Number(p.balance) || 0,
    value: valueOf(p.balance, p, settings),
    cpp: cppFor(p, settings),
    updatedAt: p.balanceUpdatedAt,
  }));
  return {
    byProgram,
    totalPoints: byProgram.reduce((s, r) => s + r.points, 0),
    totalValue: byProgram.reduce((s, r) => s + r.value, 0),
  };
}

/**
 * Every transfer, with both ends resolved and the bonus broken out.
 * Sorted newest first.
 */
export function transferSummary(store) {
  const { redemptions = [], programs = [] } = store;
  const pm = programMap(programs);
  const rows = redemptions
    .filter(isTransfer)
    .map((r) => {
      const sent = Number(r.points) || 0;
      const received = receivedPoints(r);
      return {
        ...r,
        from: pm[r.programId],
        to: pm[r.toProgramId],
        sent,
        received,
        bonus: received - sent,
        ratio: sent > 0 ? received / sent : 0,
      };
    })
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  return {
    rows,
    count: rows.length,
    totalSent: rows.reduce((s, r) => s + r.sent, 0),
    totalReceived: rows.reduce((s, r) => s + r.received, 0),
    totalBonus: rows.reduce((s, r) => s + r.bonus, 0),
  };
}

/**
 * Points earned in each program under its own steam — card spend, flying,
 * promos — as opposed to points that arrived by transfer from somewhere else.
 *
 * Balances are the source of truth and are never written to by this app, so
 * earning has to be backed out of what's left plus everything that flowed out:
 *
 *   earned = balance + spent + transferredOut − transferredIn
 *
 * It is a floor, not an exact figure: any redemption or transfer missing from
 * the ledger understates the program's earning by exactly that much.
 */
export function earnedSummary(store) {
  const { redemptions = [], programs = [], settings = {} } = store;
  const byProgram = programs.map((p) => {
    const out = redemptions.filter((r) => r.programId === p.id);
    const spent = out.filter((r) => !isTransfer(r)).reduce((s, r) => s + (Number(r.points) || 0), 0);
    const transferredOut = out.filter(isTransfer).reduce((s, r) => s + (Number(r.points) || 0), 0);
    const transferredIn = redemptions
      .filter((r) => isTransfer(r) && r.toProgramId === p.id)
      .reduce((s, r) => s + receivedPoints(r), 0);
    const balance = Number(p.balance) || 0;
    const earned = balance + spent + transferredOut - transferredIn;
    return {
      program: p,
      programId: p.id,
      name: p.name,
      color: p.color,
      balance,
      spent,
      transferredOut,
      transferredIn,
      earned,
      earnedValue: valueOf(earned, p, settings),
      // A ledger with gaps can push this negative; surface it rather than hide it.
      suspect: earned < 0,
    };
  });
  return {
    byProgram,
    totalEarned: byProgram.reduce((s, r) => s + r.earned, 0),
    totalEarnedValue: byProgram.reduce((s, r) => s + r.earnedValue, 0),
    totalTransferredIn: byProgram.reduce((s, r) => s + r.transferredIn, 0),
    totalTransferredOut: byProgram.reduce((s, r) => s + r.transferredOut, 0),
    // Transferred points priced where they left vs. where they landed. Their
    // difference is exactly why total Earned $ and total Lifetime $ disagree:
    // earned prices a moved point at its source's cpp, lifetime at its
    // destination's.
    transferredOutValue: byProgram.reduce((s, r) => s + valueOf(r.transferredOut, r.program, settings), 0),
    transferredInValue: byProgram.reduce((s, r) => s + valueOf(r.transferredIn, r.program, settings), 0),
  };
}

/** Redemption value per year, one key per program — feeds the stacked bar chart. */
export function redeemedByYear(store) {
  const { redemptions = [], programs = [], settings = {} } = store;
  const pm = programMap(programs);
  const years = {};
  for (const r of redemptions) {
    if (isTransfer(r)) continue; // $0 — would add an empty stack segment
    const y = yearOf(r.date);
    years[y] = years[y] || { year: y, __points: 0, __value: 0 };
    const p = pm[r.programId];
    const v = valueOf(r.points, p, settings);
    const key = p?.name || 'Unassigned';
    years[y][key] = (years[y][key] || 0) + v;
    years[y].__points += Number(r.points) || 0;
    years[y].__value += v;
  }
  return Object.values(years).sort((a, b) => a.year.localeCompare(b.year));
}

/** Running total of redeemed value over time. */
export function cumulativeRedeemed(store) {
  const { redemptions = [], programs = [], settings = {} } = store;
  const pm = programMap(programs);
  const sorted = [...redemptions]
    .filter((r) => r.date && !isTransfer(r))
    .sort((a, b) => a.date.localeCompare(b.date));
  const byMonth = {};
  for (const r of sorted) {
    const m = monthOf(r.date);
    byMonth[m] = (byMonth[m] || 0) + valueOf(r.points, pm[r.programId], settings);
  }
  let running = 0;
  return Object.entries(byMonth)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, v]) => {
      running += v;
      return { month, value: v, cumulative: running };
    });
}

/** Redemptions grouped by the category the user tagged them with. */
export function redeemedByCategory(store) {
  const { redemptions = [], programs = [], settings = {} } = store;
  const pm = programMap(programs);
  const cats = {};
  for (const r of redemptions) {
    // Transfers are worth $0, so they'd only ever be an invisible slice with a
    // legend entry. The dashboard's transfer panel covers them instead.
    if (isTransfer(r)) continue;
    const key = r.category || 'Uncategorized';
    cats[key] = cats[key] || { category: key, points: 0, value: 0, count: 0 };
    cats[key].points += Number(r.points) || 0;
    cats[key].value += valueOf(r.points, pm[r.programId], settings);
    cats[key].count += 1;
  }
  return Object.values(cats).sort((a, b) => b.value - a.value);
}

/** Biggest single redemptions, for the dashboard highlight list. */
export function topRedemptions(store, limit = 8) {
  const { redemptions = [], programs = [], settings = {} } = store;
  const pm = programMap(programs);
  return redemptions
    .filter((r) => !isTransfer(r))
    .map((r) => ({ ...r, program: pm[r.programId], value: valueOf(r.points, pm[r.programId], settings) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

export const REDEMPTION_CATEGORIES = [
  'Flight',
  'Hotel',
  // No "Transfer partner" here on purpose: a transfer is its own row type now,
  // logged at $0, so offering it as a category would invite pricing transfers
  // as if they were redemptions and double-counting the award they pay for.
  'Cash back / statement credit',
  'Gift card',
  'Merchandise',
  'Rent / Bilt',
  'Other',
];
