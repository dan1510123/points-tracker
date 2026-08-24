// Helpers for bulk-backfilling redemption history from CSVs you assemble by hand
// (airline activity pages, statement exports, an old spreadsheet).

/**
 * A pattern match alone would happily accept 2023-13-45, so the parts are
 * range-checked against the actual month length before being trusted.
 */
function assemble(y, m, d) {
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (!year || month < 1 || month > 12 || day < 1) return '';
  const daysInMonth = new Date(year, month, 0).getDate();
  if (day > daysInMonth) return '';
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Accepts MM/DD/YYYY, M/D/YY, YYYY-MM-DD, "12 Jan 2024" and similar; returns YYYY-MM-DD or ''. */
export function normalizeDate(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  if (!s) return '';

  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return assemble(iso[1], iso[2], iso[3]);

  const slash = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (slash) {
    let [, m, d, y] = slash;
    if (y.length === 2) y = Number(y) > 70 ? `19${y}` : `20${y}`;
    return assemble(y, m, d);
  }

  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
  }
  return '';
}

/** Handles "$1,234.56", "(45.00)" for negatives, and stray whitespace. */
export function parseNumber(raw) {
  if (raw === null || raw === undefined) return 0;
  let s = String(raw).trim();
  if (!s) return 0;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[$,\s]/g, '');
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  }
  const n = parseFloat(s);
  if (Number.isNaN(n)) return 0;
  return negative ? -n : n;
}

const PATTERNS = {
  date: [/^date$/i, /transaction\s*date/i, /^post(ed)?\s*date/i, /activity\s*date/i, /^date\b/i],
  description: [/^description$/i, /^merchant/i, /^payee/i, /^details?$/i, /^activity$/i, /description/i, /^name$/i],
  points: [/^points?$/i, /^miles?$/i, /points?\s*(used|spent|redeemed)/i, /miles?\s*(used|spent|redeemed)/i, /^redeemed/i, /points?/i, /miles?/i],
  category: [/^category$/i, /^type$/i, /^kind$/i],
};

/** Best-guess column mapping so a tidy sheet needs no manual fiddling. */
export function detectMapping(headers = []) {
  const map = { date: '', description: '', points: '', category: '' };
  for (const field of Object.keys(PATTERNS)) {
    for (const pattern of PATTERNS[field]) {
      const hit = headers.find((h) => pattern.test(String(h).trim()));
      if (hit && !Object.values(map).includes(hit)) {
        map[field] = hit;
        break;
      }
    }
  }
  return map;
}

/**
 * Turn parsed CSV rows into redemption records.
 * opts: { mapping, programId, defaultCategory, onlyNegative }
 *
 * Airline activity pages list awards as negative miles and earnings as positive.
 * With `onlyNegative` on, positive rows are treated as earning activity and skipped,
 * so you can paste a whole statement in and get just the redemptions out.
 */
export function buildRedemptions(data, opts) {
  const { mapping, programId, defaultCategory = 'Other', onlyNegative = false } = opts;

  const redemptions = [];
  let skipped = 0;

  for (const raw of data) {
    const date = normalizeDate(raw[mapping.date]);
    const points = mapping.points ? parseNumber(raw[mapping.points]) : 0;

    if (!date || points === 0) {
      skipped += 1;
      continue;
    }
    if (onlyNegative && points > 0) {
      skipped += 1;
      continue;
    }

    redemptions.push({
      date,
      programId,
      description: String(raw[mapping.description] ?? '').trim() || 'Imported redemption',
      points: Math.abs(Math.round(points)),
      category: (mapping.category ? String(raw[mapping.category] ?? '').trim() : '') || defaultCategory,
      notes: '',
    });
  }

  return { redemptions, skipped };
}
