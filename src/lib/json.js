// Bulk import from JSON. Unlike a CSV, a JSON file names its own fields, so
// there is no column-mapping step — the file either matches the documented
// schema or it reports exactly which rows don't.

import { normalizeDate, parseNumber } from './csv.js';
import { receivedPoints } from './calc.js';

/** The shape this importer accepts, shown in the UI and the README. */
export const SCHEMA_EXAMPLE = `{
  "redemptions": [
    {
      "date": "2024-06-02",
      "program": "Delta SkyMiles",
      "points": 120000,
      "description": "JFK–NRT business",
      "category": "Flight",
      "notes": "booked 11 months out"
    },
    {
      "type": "transfer",
      "date": "2024-03-11",
      "program": "Amex Membership Rewards",
      "to": "Delta SkyMiles",
      "points": 100000,
      "bonusPct": 30
    }
  ]
}`;

/**
 * Resolve a program by id first, then by name (case- and space-insensitive),
 * so a file can use either and hand-typed names still land.
 */
function findProgram(programs, ref) {
  if (ref === null || ref === undefined || ref === '') return null;
  const s = String(ref).trim();
  const byId = programs.find((p) => p.id === s);
  if (byId) return byId;
  const key = s.toLowerCase().replace(/\s+/g, ' ');
  return programs.find((p) => String(p.name).toLowerCase().replace(/\s+/g, ' ') === key) || null;
}

/** Pull the row array out of any of the accepted top-level shapes. */
function extractRows(parsed) {
  if (Array.isArray(parsed)) return { rows: parsed, wrapper: 'array' };
  if (parsed && typeof parsed === 'object') {
    // A full store export works too — we take its redemptions and ignore the rest.
    if (Array.isArray(parsed.redemptions)) return { rows: parsed.redemptions, wrapper: 'redemptions' };
    if (Array.isArray(parsed.entries)) return { rows: parsed.entries, wrapper: 'entries' };
  }
  return { rows: null, wrapper: null };
}

/**
 * Validate and normalize a JSON import.
 *
 * opts: { programs, defaultProgramId, defaultCategory }
 * Returns { rows, errors, wrapper } where `rows` are ready to POST and
 * `errors` is one entry per rejected row, with the reason and its index.
 */
export function parseJsonImport(text, opts) {
  const { programs = [], defaultProgramId = '', defaultCategory = 'Other' } = opts || {};

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { fatal: `That file isn't valid JSON: ${err.message}`, rows: [], errors: [] };
  }

  const { rows: raw, wrapper } = extractRows(parsed);
  if (!raw) {
    return {
      fatal: 'Expected a top-level array of entries, or an object with a "redemptions" array.',
      rows: [],
      errors: [],
    };
  }

  const fallback = programs.find((p) => p.id === defaultProgramId) || null;
  const rows = [];
  const errors = [];

  raw.forEach((item, i) => {
    const at = i + 1;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push({ at, reason: 'not an object' });
      return;
    }

    const transfer = String(item.type || '').toLowerCase() === 'transfer';

    const date = normalizeDate(item.date);
    if (!date) {
      errors.push({ at, reason: item.date ? `unreadable date "${item.date}"` : 'missing "date"' });
      return;
    }

    const points = Math.abs(Math.round(parseNumber(item.points)));
    if (!points) {
      errors.push({ at, reason: 'missing or zero "points"' });
      return;
    }

    const ref = item.program ?? item.programId;
    const program = ref ? findProgram(programs, ref) : fallback;
    if (!program) {
      errors.push({
        at,
        reason: ref ? `no program matches "${ref}"` : 'no "program" and no fallback selected',
      });
      return;
    }

    const base = {
      date,
      programId: program.id,
      points,
      description: String(item.description ?? '').trim(),
      notes: String(item.notes ?? '').trim(),
    };

    if (!transfer) {
      rows.push({
        ...base,
        type: 'redemption',
        description: base.description || 'Imported redemption',
        category: String(item.category ?? '').trim() || defaultCategory,
      });
      return;
    }

    const destRef = item.to ?? item.toProgramId ?? item.toProgram;
    const dest = findProgram(programs, destRef);
    if (!dest) {
      errors.push({
        at,
        reason: destRef ? `transfer destination "${destRef}" is not a program` : 'transfer needs "to"',
      });
      return;
    }
    if (dest.id === program.id) {
      errors.push({ at, reason: 'transfer source and destination are the same program' });
      return;
    }

    const bonusPct = Number(item.bonusPct) || 0;
    rows.push({
      ...base,
      type: 'transfer',
      category: 'Transfer out',
      toProgramId: dest.id,
      bonusPct,
      // Same rule as the form: an explicit `received` wins, else points × bonus.
      received: receivedPoints({ points, bonusPct, received: item.received }),
    });
  });

  return { rows, errors, wrapper, total: raw.length };
}
