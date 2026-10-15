/**
 * Employee: missing clock-out alerts + correction / overtime request form.
 * Everything shown before an admin decides is labelled UNVERIFIED; the database re-checks every rule.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { missingClockOutService, MCO_NOT_SET_UP, type MissingClockOutCase } from '../../services/attendance/missingClockOutService';
import {
  companyLocalToIso, isoToCompanyLocal, formatCompanyDateTime, validateMissingClockOutSubmission, MIN_REASON_LENGTH, caseStatusLabel,
  type ClaimEvaluation,
} from '../../services/attendance/missingClockOutRules';
import { formatHours, minutesToHours } from '../../services/overtime/overtimeRules';
import { formatShiftClock } from '../../services/attendance/employeeDashboardRules';
import { formatDay } from '../../services/notifications/notificationRules';

const STATUS_BADGE: Record<string, string> = { PENDING: 'badge-warning', APPROVED: 'badge-success', REJECTED: 'badge-danger', CANCELLED: 'badge-gray' };
const shiftText = (s: any) => (s ? `${s.name} (${formatShiftClock(s.start_time)} – ${formatShiftClock(s.end_time)})` : 'No shift');

interface Props {
  /** Compact alert only (dashboard); the full list + form otherwise. */
  compact?: boolean;
  onOpenFull?: () => void;
  onChanged?: () => void;
}

const MissingClockOutEmployeePanel: React.FC<Props> = ({ compact, onOpenFull, onChanged }) => {
  const [cases, setCases] = useState<MissingClockOutCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notSetUp, setNotSetUp] = useState(false);
  const [toast, setToast] = useState('');

  const [active, setActive] = useState<MissingClockOutCase | null>(null);
  const [claimed, setClaimed] = useState('');
  const [hours, setHours] = useState('');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<ClaimEvaluation | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: err } = await missingClockOutService.getMyCases(45);
    if (data) setCases(data);
    setNotSetUp(err?.message === MCO_NOT_SET_UP);
    setError(err && err.message !== MCO_NOT_SET_UP ? err.message : null);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Live preview of the (unverified) claim, computed from the database records
  // (state is only changed inside the timer; typing clears the old preview in the input's onChange)
  useEffect(() => {
    if (!active) return;
    const iso = companyLocalToIso(claimed);
    let stale = false;
    const t = setTimeout(async () => {
      if (!iso) { setPreviewing(false); return; }
      setPreviewing(true);
      const { data, error: err } = await missingClockOutService.previewClaim(active.attendance.id, iso);
      if (stale) return;
      setPreviewing(false);
      if (err) { setPreview(null); setFormError(err.message); return; }
      setFormError('');
      setPreview(data);
      if (data?.ok) setHours(h => (h === '' || Number(h) > data.eligibleHours ? String(data.eligibleHours) : h));
    }, iso ? 350 : 0);
    return () => { stale = true; clearTimeout(t); };
  }, [active, claimed]);

  const open = (c: MissingClockOutCase) => {
    setActive(c);
    setClaimed(c.detection.shiftEndMs ? isoToCompanyLocal(c.detection.shiftEndMs) : '');
    setHours('');
    setReason('');
    setPreview(null);
    setFormError('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!active || submitting) return;
    const iso = companyLocalToIso(claimed);
    if (!iso) { setFormError('Enter a valid clock-out date and time.'); return; }
    if (!preview) { setFormError('Please wait for the check of your clock-out time.'); return; }
    const h = hours === '' ? 0 : Number(hours);
    const invalid = validateMissingClockOutSubmission(preview, h, reason);
    if (invalid) { setFormError(invalid); return; }
    setSubmitting(true);
    const { error: err } = await missingClockOutService.submit(active.attendance.id, iso, h, reason);
    setSubmitting(false);
    if (err) { setFormError(err.message); return; }
    setActive(null);
    setToast('Correction submitted. It stays unverified until an administrator approves it.');
    setTimeout(() => setToast(''), 4000);
    await load();
    onChanged?.();
  };

  const cancel = async (requestId: string) => {
    if (cancellingId) return;
    setCancellingId(requestId);
    const { error: err } = await missingClockOutService.cancel(requestId);
    setCancellingId(null);
    if (err) setError(err.message); else { await load(); onChanged?.(); }
  };

  const openCases = cases.filter(c => c.detection.state === 'MISSING_CLOCK_OUT' && !c.request);
  const pending = cases.filter(c => c.request?.status === 'PENDING');

  if (compact) {
    if (loading || notSetUp || (openCases.length === 0 && pending.length === 0 && !error)) return null;
    return (
      <div className="card" role="alert" style={{ borderLeft: '4px solid var(--warning)', display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <AlertTriangle size={20} color="var(--warning)" />
        <div style={{ flex: 1, minWidth: '200px', fontSize: '0.875rem' }}>
          {error ? error : (
            <>
              {openCases.length > 0 && <div><strong>Missing clock-out:</strong> {openCases.map(c => formatDay(c.attendance.attendance_date)).join(', ')}. Submit a correction with the time you actually left.</div>}
              {pending.length > 0 && <div>{pending.length} correction{pending.length === 1 ? '' : 's'} pending approval.</div>}
            </>
          )}
        </div>
        {onOpenFull && <button className="btn btn-outline" style={{ fontSize: '0.8125rem', padding: '0.375rem 0.75rem' }} onClick={onOpenFull}>Review</button>}
      </div>
    );
  }

  return (
    <div className="card">
      <h3 className="card-title" style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><AlertTriangle size={18} /> Missing clock-outs</h3>
      <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
        A day without a clock-out is not counted as worked until you submit the time you actually left and an administrator verifies it.
        Additional time after your shift is limited for this correction; any time beyond the limit is shown to the administrator for review.
      </p>
      {notSetUp && <div role="alert" style={{ fontSize: '0.875rem', color: 'var(--warning-800, #92400e)' }}>{MCO_NOT_SET_UP}</div>}
      {error && <div role="alert" style={{ fontSize: '0.875rem', color: 'var(--danger)' }}>{error}</div>}
      {toast && <div role="status" style={{ fontSize: '0.875rem', color: 'var(--success)', marginBottom: '0.75rem' }}>{toast}</div>}
      {loading ? <div style={{ color: 'var(--text-secondary)' }}>Loading…</div> : cases.length === 0 ? (
        !error && <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>No missing clock-outs in the last 45 days.</div>
      ) : (
        <div className="table-container">
          <table className="table" style={{ width: '100%', minWidth: '880px' }}>
            <thead><tr><th>Date</th><th>Shift</th><th>Clock in</th><th>Claimed clock-out</th><th>Verified clock-out</th><th>Requested OT</th><th>Approved OT</th><th>Status</th><th>Payroll</th><th></th></tr></thead>
            <tbody>
              {cases.map(c => (
                <tr key={c.attendance.id}>
                  <td>{formatDay(c.attendance.attendance_date)}</td>
                  <td>{shiftText(c.shift)}</td>
                  <td>{formatCompanyDateTime(c.attendance.clock_in_at)}</td>
                  <td>{c.request ? <>{formatCompanyDateTime(c.request.claimed_clock_out_at)}{c.request.status === 'PENDING' && <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>unverified</div>}</> : '—'}</td>
                  <td>{c.request?.verified_clock_out_at ? formatCompanyDateTime(c.request.verified_clock_out_at) : '—'}</td>
                  <td>{c.request ? formatHours(Number(c.request.requested_overtime_hours)) : '—'}</td>
                  <td>{c.request?.status === 'APPROVED' ? formatHours(Number(c.request.approved_overtime_hours)) : '—'}</td>
                  <td>
                    <span className={`badge ${c.request && c.request.status !== 'CANCELLED' ? STATUS_BADGE[c.request.status] || 'badge-gray' : 'badge-danger'}`}>{caseStatusLabel(c)}</span>
                    {c.request?.status === 'REJECTED' && c.request.admin_remarks && <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', maxWidth: '200px', overflowWrap: 'anywhere' }}>Reason: {c.request.admin_remarks}</div>}
                  </td>
                  <td style={{ fontSize: '0.75rem', maxWidth: '220px' }}>{c.payrollStatus}</td>
                  <td>
                    {c.canSubmit && <button className="btn btn-primary" style={{ padding: '0.375rem 0.75rem', fontSize: '0.8125rem' }} disabled={notSetUp} onClick={() => open(c)}>Submit correction</button>}
                    {!c.canSubmit && !c.request && c.cannotSubmitReason && <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{c.cannotSubmitReason}</span>}
                    {c.request?.status === 'PENDING' && (
                      <button className="btn btn-outline" style={{ padding: '0.25rem 0.625rem', fontSize: '0.75rem' }} disabled={cancellingId === c.request.id} onClick={() => cancel(c.request.id)}>
                        {cancellingId === c.request.id ? 'Cancelling…' : 'Cancel'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {active && (
        <div className="drawer-overlay" style={{ alignItems: 'center', zIndex: 120 }}>
          <div className="card" style={{ margin: 'auto', width: '100%', maxWidth: '560px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>Missing clock-out correction</h3>
              <button className="icon-button" onClick={() => setActive(null)} aria-label="Close"><X size={20} /></button>
            </div>
            <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '0.875rem', fontSize: '0.8125rem', display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                <div><span style={{ color: 'var(--text-secondary)' }}>Work date:</span> <strong>{formatDay(active.attendance.attendance_date)}</strong></div>
                <div><span style={{ color: 'var(--text-secondary)' }}>Scheduled shift:</span> <strong>{shiftText(active.shift)}</strong>{preview?.scheduledMinutes != null && <> ({formatHours(minutesToHours(preview.scheduledMinutes))})</>}</div>
                <div><span style={{ color: 'var(--text-secondary)' }}>Clock in:</span> <strong>{formatCompanyDateTime(active.attendance.clock_in_at)}</strong> · <span style={{ color: 'var(--text-secondary)' }}>Clock out:</span> <strong style={{ color: 'var(--danger)' }}>missing</strong></div>
              </div>

              <div>
                <label className="form-label" htmlFor="mco-claimed">Time you actually clocked out (company time) *</label>
                <input id="mco-claimed" type="datetime-local" className="form-control" value={claimed} onChange={e => { setClaimed(e.target.value); setPreview(null); }} disabled={submitting} />
              </div>

              {previewing && <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>Checking…</div>}
              {preview && !previewing && (preview.ok ? (
                <div style={{ fontSize: '0.8125rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.375rem 1rem', background: 'var(--bg-surface, #f9fafb)', padding: '0.75rem', borderRadius: 'var(--radius-md)' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Worked (claimed, unverified)</span><strong>{formatHours(minutesToHours(preview.workedMinutes))}</strong>
                  <span style={{ color: 'var(--text-secondary)' }}>Additional time after shift</span><strong>{formatHours(preview.claimedAdditionalHours)}</strong>
                  <span style={{ color: 'var(--text-secondary)' }}>Limit for this correction</span><strong>{formatHours(preview.limitHours)}</strong>
                  <span style={{ color: 'var(--text-secondary)' }}>You can request up to</span><strong>{formatHours(preview.eligibleHours)}</strong>
                  {preview.excessHours > 0 && <span style={{ gridColumn: '1 / -1', color: 'var(--warning-800, #92400e)' }}>{formatHours(preview.excessHours)} beyond the limit will be shown to the administrator for review. It is not discarded, but it cannot be requested here.</span>}
                </div>
              ) : <div role="alert" style={{ fontSize: '0.8125rem', color: 'var(--danger)' }}>{preview.error}</div>)}

              <div>
                <label className="form-label" htmlFor="mco-hours">Requested overtime hours {preview?.ok ? `(0 – ${preview.eligibleHours})` : ''}</label>
                <input id="mco-hours" type="number" min="0" step="0.01" max={preview?.ok ? preview.eligibleHours : undefined} className="form-control" value={hours} onChange={e => setHours(e.target.value)} disabled={submitting || !preview?.ok} placeholder="0 if you only want the clock-out corrected" />
              </div>
              <div>
                <label className="form-label" htmlFor="mco-reason">Reason / work done *</label>
                <textarea id="mco-reason" className="form-control" rows={3} value={reason} onChange={e => setReason(e.target.value)} disabled={submitting} placeholder={`Why the clock-out is missing and what you worked on (at least ${MIN_REASON_LENGTH} characters)`} />
              </div>
              {formError && <div role="alert" style={{ padding: '0.75rem', backgroundColor: 'var(--danger-50)', color: 'var(--danger)', borderRadius: 'var(--radius-md)', fontSize: '0.875rem' }}>{formError}</div>}
              <div style={{ display: 'flex', gap: '1rem' }}>
                <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={() => setActive(null)} disabled={submitting}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={submitting || previewing || !preview?.ok}>{submitting ? 'Submitting…' : 'Submit for approval'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default MissingClockOutEmployeePanel;
