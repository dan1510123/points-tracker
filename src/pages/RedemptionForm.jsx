import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useStore } from '../StoreContext.jsx';
import { api } from '../api.js';
import {
  valueOf, cppFor, programMap, fmtPoints, fmtUSD, REDEMPTION_CATEGORIES,
  isTransfer, receivedPoints, TRANSFER_CATEGORY,
} from '../lib/calc.js';
import { findDuplicate, describeRow } from '../lib/dupes.js';

const today = () => new Date().toISOString().slice(0, 10);

const blankForm = () => ({
  date: today(),
  programId: '',
  description: '',
  points: '',
  category: 'Flight',
  notes: '',
  // transfer-only
  toProgramId: '',
  bonusPct: '',
  received: '',
});

function fromRow(r) {
  return {
    date: r.date || today(),
    programId: r.programId || '',
    description: r.description || '',
    points: r.points ?? '',
    category: r.category || 'Other',
    notes: r.notes || '',
    toProgramId: r.toProgramId || '',
    bonusPct: r.bonusPct ?? '',
    received: r.received ?? '',
  };
}

export default function RedemptionForm() {
  const { store, mutate } = useStore();
  const navigate = useNavigate();
  const { id } = useParams();
  const [params] = useSearchParams();
  const pm = programMap(store.programs);

  const existing = id ? store.redemptions.find((r) => r.id === id) : null;
  const editing = Boolean(id);

  const [form, setForm] = useState(() =>
    existing ? fromRow(existing) : { ...blankForm(), programId: store.programs[0]?.id || '' }
  );
  const [mode, setMode] = useState(() => {
    if (existing) return isTransfer(existing) ? 'transfer' : 'redemption';
    return params.get('type') === 'transfer' ? 'transfer' : 'redemption';
  });
  const [busy, setBusy] = useState(false);

  // The store loads asynchronously, so a deep link to /redemptions/:id can
  // render before the row exists. Sync once it arrives.
  useEffect(() => {
    if (existing) {
      setForm(fromRow(existing));
      setMode(isTransfer(existing) ? 'transfer' : 'redemption');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing?.id]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Received defaults to points × bonus, but the typed value wins so a
  // non-1:1 partner (Marriott's 3:1, say) can be entered directly.
  const previewReceived = receivedPoints({
    points: form.points,
    bonusPct: form.bonusPct,
    received: form.received,
  });

  const previewProgram = pm[form.programId];
  const previewValue = valueOf(form.points, previewProgram, store.settings);
  const transferInvalid = mode === 'transfer' && form.toProgramId && form.toProgramId === form.programId;

  const payload = useMemo(() => {
    const base = {
      date: form.date,
      programId: form.programId,
      description: form.description.trim(),
      points: Number(form.points),
      notes: form.notes.trim(),
    };
    return mode === 'transfer'
      ? {
          ...base,
          type: 'transfer',
          category: TRANSFER_CATEGORY,
          toProgramId: form.toProgramId,
          bonusPct: Number(form.bonusPct) || 0,
          received: previewReceived,
          // Clear redemption-only leftovers when converting an existing row.
        }
      : {
          ...base,
          type: 'redemption',
          category: form.category,
          toProgramId: null,
          bonusPct: null,
          received: null,
        };
  }, [form, mode, previewReceived]);

  // Everything but the notes has to match for this to be the same entry. The
  // server refuses it too; checking here means the block lands before the click
  // rather than as an error afterwards.
  const duplicate = useMemo(
    () => (form.programId && form.points ? findDuplicate(store.redemptions, payload, { ignoreId: id }) : null),
    [store.redemptions, payload, id, form.programId, form.points]
  );
  const [override, setOverride] = useState(false);
  const blocked = Boolean(duplicate) && !override;

  // Editing a different row, or the row changing under us, retracts a
  // previously granted override — it was granted for one specific entry.
  useEffect(() => {
    setOverride(false);
  }, [duplicate?.id]);

  if (editing && !existing) {
    return (
      <>
        <div className="page-head">
          <h1>Not found</h1>
        </div>
        <div className="notice">
          That entry no longer exists. Back to <Link to="/redemptions">Points I've used</Link>.
        </div>
      </>
    );
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.programId || !form.points) return;
    if (mode === 'transfer' && (!form.toProgramId || transferInvalid)) return;
    if (blocked) return;
    setBusy(true);
    const opts = duplicate ? { allowDuplicate: true } : undefined;
    try {
      if (editing) await mutate(() => api.update('redemptions', id, payload, opts));
      else await mutate(() => api.create('redemptions', payload, opts));
      navigate('/redemptions');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete this ${mode === 'transfer' ? 'transfer' : 'redemption'}?`)) return;
    await mutate(() => api.remove('redemptions', id));
    navigate('/redemptions');
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>
            {editing ? 'Edit ' : 'Log a '}
            {mode === 'transfer' ? 'transfer' : 'redemption'}
          </h1>
          <p className="sub">
            {mode === 'transfer'
              ? "Moving points to a partner. Worth $0 — log the award you book with the miles separately."
              : 'Something you actually got with points. Value is points × your rate for that program.'}
          </p>
        </div>
        <Link to="/redemptions"><button className="ghost">← Back to the ledger</button></Link>
      </div>

      <div className="card pad-lg" style={{ maxWidth: 900 }}>
        <div className="spread" style={{ marginBottom: 14 }}>
          <h2 style={{ margin: 0 }}>What kind of entry?</h2>
          <div className="row" style={{ flex: '0 0 auto' }}>
            <button type="button" className={mode === 'redemption' ? '' : 'ghost'} onClick={() => setMode('redemption')}>
              Redemption
            </button>
            <button type="button" className={mode === 'transfer' ? '' : 'ghost'} onClick={() => setMode('transfer')}>
              Transfer
            </button>
          </div>
        </div>

        {mode === 'transfer' && (
          <p className="muted small" style={{ marginTop: 0 }}>
            A transfer moves points to a partner. It's worth <strong>$0</strong> — you haven't gotten anything
            yet — so log the award you book with the miles separately, against the destination program. Its job is
            to keep transferred miles from being counted as miles you earned.
          </p>
        )}

        {duplicate && (
          <div className="notice" style={{ borderLeftColor: blocked ? 'var(--bad)' : 'var(--warn)' }}>
            <strong>
              {blocked
                ? `This is already in the ledger — saving is blocked.`
                : 'Duplicate override on — this will be saved as a second copy.'}
            </strong>
            <div className="small mono" style={{ margin: '6px 0' }}>
              {describeRow(duplicate, store.programs)}
            </div>
            <div className="small">
              Every field except notes matches that entry.{' '}
              {blocked ? (
                <>
                  <Link to={`/redemptions/${duplicate.id}`}>Open it</Link>, change something here, or{' '}
                  <button type="button" className="ghost sm" onClick={() => setOverride(true)}>
                    save it anyway
                  </button>
                </>
              ) : (
                <button type="button" className="ghost sm" onClick={() => setOverride(false)}>
                  block it again
                </button>
              )}
            </div>
          </div>
        )}

        <form onSubmit={submit}>
          <div className="row">
            <div className="field" style={{ maxWidth: 170 }}>
              <label>Date</label>
              <input type="date" value={form.date} onChange={set('date')} required />
            </div>
            <div className="field">
              <label>{mode === 'transfer' ? 'From program' : 'Program'}</label>
              <select value={form.programId} onChange={set('programId')} required>
                <option value="">Select…</option>
                {store.programs.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="field" style={{ maxWidth: 170 }}>
              <label>{mode === 'transfer' ? 'Points out' : 'Points spent'}</label>
              <input type="number" min="0" step="1" value={form.points} onChange={set('points')} placeholder="60000" required />
            </div>
            {mode === 'transfer' ? (
              <div className="field">
                <label>To program</label>
                <select value={form.toProgramId} onChange={set('toProgramId')} required>
                  <option value="">Select…</option>
                  {store.programs
                    .filter((p) => p.id !== form.programId)
                    .map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                </select>
              </div>
            ) : (
              <div className="field">
                <label>Category</label>
                <select value={form.category} onChange={set('category')}>
                  {REDEMPTION_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
            )}
          </div>

          {mode === 'transfer' && (
            <div className="row">
              <div className="field" style={{ maxWidth: 170 }}>
                <label>Transfer bonus %</label>
                <input type="number" min="0" step="1" value={form.bonusPct} onChange={set('bonusPct')} placeholder="30" />
              </div>
              <div className="field" style={{ maxWidth: 200 }}>
                <label>Miles received</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={form.received}
                  onChange={set('received')}
                  placeholder={form.points ? String(previewReceived) : '130000'}
                  className="mono"
                />
              </div>
              <div className="field">
                <label>&nbsp;</label>
                <div className="muted small">
                  Leave <em>received</em> blank to take points × bonus. Type a number to override it — that's how
                  you enter a partner that isn't 1:1.
                </div>
              </div>
            </div>
          )}

          <div className="row">
            <div className="field">
              <label>Description</label>
              <input
                value={form.description}
                onChange={set('description')}
                placeholder={mode === 'transfer' ? '30% transfer bonus promo' : 'JFK–NRT business, ANA via Amex transfer'}
              />
            </div>
            <div className="field">
              <label>Notes (optional)</label>
              <input value={form.notes} onChange={set('notes')} placeholder="Booked 11 months out" />
            </div>
          </div>

          <div className="spread">
            <div className="muted small">
              {transferInvalid ? (
                <span style={{ color: 'var(--bad)' }}>A transfer needs two different programs.</span>
              ) : blocked ? (
                <span style={{ color: 'var(--bad)' }}>Duplicate of an entry you've already logged.</span>
              ) : mode === 'transfer' ? (
                form.points && previewProgram ? (
                  <>
                    <strong className="mono">{fmtPoints(form.points)}</strong> {previewProgram.name} out →{' '}
                    <strong className="mono">{fmtPoints(previewReceived)}</strong>{' '}
                    {pm[form.toProgramId]?.name || 'partner'} in
                    {previewReceived !== Number(form.points) && (
                      <> ({fmtPoints(previewReceived - Number(form.points))} bonus miles)</>
                    )}
                    . Counts as points out, valued at <strong>$0</strong>.
                  </>
                ) : (
                  'Pick both programs and enter points out.'
                )
              ) : form.points && previewProgram ? (
                <>Valued at <strong className="mono">{fmtUSD(previewValue)}</strong> using your {cppFor(previewProgram, store.settings).toFixed(2)}¢ rate for {previewProgram.name}.</>
              ) : (
                'Pick a program and enter points to preview the value.'
              )}
            </div>
            <div className="row" style={{ flex: '0 0 auto' }}>
              {editing && (
                <button type="button" className="danger" onClick={remove}>Delete</button>
              )}
              <Link to="/redemptions"><button type="button" className="ghost">Cancel</button></Link>
              <button type="submit" disabled={busy || transferInvalid || blocked}>
                {blocked
                  ? 'Blocked — duplicate'
                  : editing
                    ? 'Save changes'
                    : mode === 'transfer'
                      ? 'Add transfer'
                      : 'Add redemption'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </>
  );
}
