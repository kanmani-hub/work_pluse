/**
 * Admin: missing clock-outs, corrections (approve with a verified clock-out time / reject with a reason),
 * deductions and reversals, and the audit trail of each case. All decisions run in database functions.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, XCircle, X, History, MinusCircle } from 'lucide-react';
import { missingClockOutService, type MissingClockOutCase } from '../../services/attendance/missingClockOutService';
import { companyLocalToIso, isoToCompanyLocal, formatCompanyDateTime, caseStatusLabel, type ClaimEvaluation } from '../../services/attendance/missingClockOutRules';
import { formatHours, minutesToHours } from '../../services/overtime/overtimeRules';
import { formatShiftClock } from '../../services/attendance/employeeDashboardRules';
import { formatDay } from '../../services/notifications/notificationRules';

const BADGE: Record<string, string> = { 'Pending Approval': 'badge-warning', Approved: 'badge-success', Rejected: 'badge-danger', 'Missing Clock-Out': 'badge-danger' };
const name = (c: MissingClockOutCase) => (c.employee ? `${c.employee.first_name} ${c.employee.last_name}` : '—');
const shiftText = (s: any) => (s ? `${s.name} (${formatShiftClock(s.start_time)} – ${formatShiftClock(s.end_time)})` : 'No shift');
const money = (n: unknown) => `₹${(Number(n) || 0).toLocaleString('en-IN')}`;

const MissingClockOutAdminPanel: React.FC<{ onChanged?: () => void }> = ({ onChanged }) => {
  const [cases, setCases] = useState<MissingClockOutCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notSetUp, setNotSetUp] = useState(false);
  const [toast, setToast] = useState('');
  const [filter, setFilter] = useState<'OPEN' | 'ALL'>('OPEN');

  const [approveCase, setApproveCase] = useState<MissingClockOutCase | null>(null);
  const [rejectCase, setRejectCase] = useState<MissingClockOutCase | null>(null);
  const [deductCase, setDeductCase] = useState<MissingClockOutCase | null>(null);
  const [auditCase, setAuditCase] = useState<MissingClockOutCase | null>(null);
  const [audit, setAudit] = useState<{ at: string; action: string; description: string; actor: string }[] | null>(null);
  const [auditError, setAuditError] = useState('');

  const [verified, setVerified] = useState('');
  const [verifiedEval, setVerifiedEval] = useState<ClaimEvaluation | null>(null);
  const [hours, setHours] = useState('');
  const [remarks, setRemarks] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data, error: err, notSetUp: ns } = await missingClockOutService.listCases(62);
    if (data) setCases(data);
    setNotSetUp(ns);
    setError(err ? err.message : null);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 4000); };
  const shown = useMemo(() => cases.filter(c => filter === 'ALL' || !c.request || ['PENDING', 'CANCELLED'].includes(c.request.status)), [cases, filter]);

  // Re-evaluate the verified clock-out with the same rules as the database
  useEffect(() => {
    if (!approveCase) return;
    const iso = companyLocalToIso(verified);
    let stale = false;
    const t = setTimeout(async () => {
      if (!iso) return;
      const { data, error: err } = await missingClockOutService.previewVerified(approveCase.attendance.id, iso);
      if (stale) return;
      if (err) { setVerifiedEval(null); setFormError(err.message); return; }
      setFormError('');
      setVerifiedEval(data);
    }, iso ? 350 : 0);
    return () => { stale = true; clearTimeout(t); };
  }, [approveCase, verified]);

  const openApprove = (c: MissingClockOutCase) => {
    setApproveCase(c); setVerified(isoToCompanyLocal(c.request?.claimed_clock_out_at)); setHours(''); setRemarks(''); setFormError(''); setVerifiedEval(null);
  };
  const openReject = (c: MissingClockOutCase) => { setRejectCase(c); setRemarks(''); setFormError(''); };
  const openDeduct = (c: MissingClockOutCase) => { setDeductCase(c); setRemarks(''); setFormError(''); };
  const openAudit = async (c: MissingClockOutCase) => {
    setAuditCase(c); setAudit(null); setAuditError('');
    const { data, error: err } = await missingClockOutService.getAuditTrail(c);
    if (err) setAuditError(err.message); else setAudit(data);
  };

  const approve = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!approveCase?.request || saving) return;
    const iso = companyLocalToIso(verified);
    if (!iso) { setFormError('Enter the verified clock-out date and time.'); return; }
    if (hours === '') { setFormError('Enter the overtime hours to approve (0 if none).'); return; }
    setSaving(true);
    const { error: err } = await missingClockOutService.review(approveCase.request.id, 'APPROVED', iso, Number(hours), remarks);
    setSaving(false);
    if (err) { setFormError(err.message); return; }
    setApproveCase(null); flash('Correction approved. The clock-out was set to the verified time.'); await load(); onChanged?.();
  };

  const reject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectCase?.request || saving) return;
    if (!remarks.trim()) { setFormError('Please give a reason for rejecting.'); return; }
    setSaving(true);
    const { data, error: err } = await missingClockOutService.review(rejectCase.request.id, 'REJECTED', null, null, remarks);
    setSaving(false);
    if (err) { setFormError(err.message); return; }
    setRejectCase(null);
    flash(data?.deduction ? `Correction rejected. A deduction of ${money(data.deduction)} will be applied in payroll.` : 'Correction rejected. No deduction is configured.');
    await load(); onChanged?.();
  };

  const deduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deductCase || saving) return;
    if (!remarks.trim()) { setFormError('Please give a reason.'); return; }
    setSaving(true);
    const { data, error: err } = await missingClockOutService.applyDeduction(deductCase.attendance.id, remarks);
    setSaving(false);
    if (err) { setFormError(err.message); return; }
    setDeductCase(null);
    flash(data?.created === false ? 'A deduction was already recorded for this day: nothing new was added.' : `Deduction of ${money(data?.amount)} recorded for payroll.`);
    await load(); onChanged?.();
  };

  // A cancelled correction leaves the day a plain missing clock-out (no claim to show or decide)
  const r = (c: MissingClockOutCase) => (c.request?.status === 'CANCELLED' ? null : c.request);
  const errorBox = formError && <div role="alert" style={{ padding: '0.75rem', backgroundColor: 'var(--danger-50)', color: 'var(--danger)', borderRadius: 'var(--radius-md)', fontSize: '0.875rem' }}>{formError}</div>;

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <h3 className="card-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}><AlertTriangle size={18} /> Missing Clock-Outs</h3>
        <select className="form-control" style={{ width: 'auto', fontSize: '0.875rem' }} value={filter} onChange={e => setFilter(e.target.value as any)} aria-label="Status">
          <option value="OPEN">Open and pending</option>
          <option value="ALL">All (last 62 days)</option>
        </select>
      </div>
      <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
        No clock-out time or working time is assumed. Approve with the verified clock-out time, or reject with a reason.
        The additional-time limit and the deduction amount are separate settings (Settings → Payroll → Missing Clock-Out).
      </p>
      {notSetUp && <div role="alert" style={{ fontSize: '0.875rem', color: 'var(--warning-800, #92400e)', marginBottom: '0.75rem' }}>Corrections are not set up in the database yet (docs/proposals/PROPOSED_missing_clock_out_workflow.sql). Open clock-outs are listed, but no action is possible.</div>}
      {error && <div role="alert" style={{ fontSize: '0.875rem', color: 'var(--danger)', marginBottom: '0.75rem' }}>{error}</div>}
      {toast && <div role="status" style={{ fontSize: '0.875rem', color: 'var(--success)', marginBottom: '0.75rem' }}>{toast}</div>}

      {loading ? <div style={{ color: 'var(--text-secondary)' }}>Loading…</div> : shown.length === 0 ? (
        !error && <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>No missing clock-outs.</div>
      ) : (
        <div className="table-container">
          <table className="table" style={{ width: '100%', minWidth: '1300px' }}>
            <thead><tr>
              <th>Employee</th><th>Date</th><th>Shift</th><th>Scheduled</th><th>Clock in</th><th>Claimed out (unverified)</th><th>Worked (claimed)</th>
              <th>Additional (claimed)</th><th>Limit</th><th>Excess</th><th>Requested OT</th><th>Verified out</th><th>Approved OT</th><th>Status</th><th>Deduction / payroll</th><th></th>
            </tr></thead>
            <tbody>
              {shown.map(c => (
                <tr key={c.attendance.id}>
                  <td><div style={{ fontWeight: 600 }}>{name(c)}</div><div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{c.employee?.employee_code}</div>
                    {c.duplicateOpen && <div style={{ fontSize: '0.7rem', color: 'var(--danger)' }}>More than one open clock-in</div>}</td>
                  <td>{formatDay(c.attendance.attendance_date)}</td>
                  <td style={{ fontSize: '0.8125rem' }}>{shiftText(c.shift)}</td>
                  <td>{r(c) ? formatHours(Number(r(c).scheduled_hours)) : c.attendance.required_hours != null ? formatHours(Number(c.attendance.required_hours)) : '—'}</td>
                  <td style={{ fontSize: '0.8125rem' }}>{formatCompanyDateTime(c.attendance.clock_in_at)}</td>
                  <td style={{ fontSize: '0.8125rem' }}>{r(c) ? formatCompanyDateTime(r(c).claimed_clock_out_at) : '—'}</td>
                  <td>{r(c) ? formatHours(Number(r(c).actual_working_hours)) : '—'}</td>
                  <td>{r(c) ? formatHours(Number(r(c).claimed_additional_hours)) : '—'}</td>
                  <td>{r(c) ? formatHours(Number(r(c).additional_limit_hours)) : '—'}</td>
                  <td style={{ color: Number(r(c)?.excess_hours) > 0 ? 'var(--danger)' : undefined, fontWeight: Number(r(c)?.excess_hours) > 0 ? 600 : undefined }}>{r(c) ? formatHours(Number(r(c).excess_hours)) : '—'}</td>
                  <td>{r(c) ? formatHours(Number(r(c).requested_overtime_hours)) : '—'}</td>
                  <td style={{ fontSize: '0.8125rem' }}>{r(c)?.verified_clock_out_at ? formatCompanyDateTime(r(c).verified_clock_out_at) : '—'}</td>
                  <td>{r(c)?.status === 'APPROVED' ? formatHours(Number(r(c).approved_overtime_hours)) : '—'}</td>
                  <td><span className={`badge ${BADGE[caseStatusLabel(c)] || 'badge-gray'}`}>{caseStatusLabel(c)}</span>
                    {r(c)?.employee_reason && <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', maxWidth: '200px', overflowWrap: 'anywhere' }}>{r(c).employee_reason}</div>}
                    {r(c)?.admin_remarks && <div style={{ fontSize: '0.7rem', maxWidth: '200px', overflowWrap: 'anywhere' }}>Admin: {r(c).admin_remarks}</div>}</td>
                  <td style={{ fontSize: '0.75rem', maxWidth: '220px' }}>{c.payrollStatus}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
                      {r(c)?.status === 'PENDING' && !notSetUp && <>
                        <button className="btn btn-primary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }} onClick={() => openApprove(c)}><CheckCircle2 size={14} /> Approve</button>
                        <button className="btn btn-outline" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', color: 'var(--danger)' }} onClick={() => openReject(c)}><XCircle size={14} /> Reject</button>
                      </>}
                      {!r(c) && c.detection.state === 'MISSING_CLOCK_OUT' && !notSetUp && !c.adjustments.some(a => a.kind === 'MISSING_CLOCK_OUT_DEDUCTION') && (
                        <button className="btn btn-outline" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }} onClick={() => openDeduct(c)}><MinusCircle size={14} /> Apply deduction</button>
                      )}
                      {!notSetUp && <button className="btn btn-outline" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }} onClick={() => openAudit(c)}><History size={14} /> History</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {approveCase?.request && (
        <div className="drawer-overlay" style={{ alignItems: 'center', zIndex: 120 }}>
          <div className="card" style={{ margin: 'auto', width: '100%', maxWidth: '520px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>Approve correction</h3>
              <button className="icon-button" onClick={() => setApproveCase(null)} aria-label="Close"><X size={20} /></button>
            </div>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1rem', lineHeight: 1.6 }}>
              {name(approveCase)} · {formatDay(approveCase.attendance.attendance_date)} · {shiftText(approveCase.shift)}<br />
              Claimed clock-out <strong>{formatCompanyDateTime(approveCase.request.claimed_clock_out_at)}</strong> · requested <strong>{formatHours(Number(approveCase.request.requested_overtime_hours))}</strong>
              {Number(approveCase.request.excess_hours) > 0 && <><br /><span style={{ color: 'var(--danger)' }}>Claimed time exceeds the {formatHours(Number(approveCase.request.additional_limit_hours))} limit by {formatHours(Number(approveCase.request.excess_hours))}. The excess cannot be approved through this correction.</span></>}
            </p>
            <form onSubmit={approve} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {errorBox}
              <div>
                <label className="form-label" htmlFor="mco-verified">Verified clock-out (company time) *</label>
                <input id="mco-verified" type="datetime-local" className="form-control" value={verified} onChange={e => { setVerified(e.target.value); setVerifiedEval(null); }} disabled={saving} />
              </div>
              {verifiedEval && (verifiedEval.ok ? (
                <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                  Worked {formatHours(minutesToHours(verifiedEval.workedMinutes))} · additional {formatHours(verifiedEval.claimedAdditionalHours)} · approvable up to <strong>{formatHours(Math.min(verifiedEval.eligibleHours, Number(approveCase.request.requested_overtime_hours)))}</strong>
                  {verifiedEval.excessHours > 0 && <> · excess {formatHours(verifiedEval.excessHours)}</>}
                </div>
              ) : <div role="alert" style={{ fontSize: '0.8125rem', color: 'var(--danger)' }}>{verifiedEval.error}</div>)}
              <div>
                <label className="form-label" htmlFor="mco-approve-hours">Overtime hours to approve * (0 – {formatHours(Number(approveCase.request.requested_overtime_hours))})</label>
                <input id="mco-approve-hours" type="number" min="0" step="0.01" max={Number(approveCase.request.requested_overtime_hours)} className="form-control" value={hours} onChange={e => setHours(e.target.value)} disabled={saving} />
              </div>
              <div>
                <label className="form-label" htmlFor="mco-approve-remarks">Remarks</label>
                <textarea id="mco-approve-remarks" className="form-control" rows={2} value={remarks} onChange={e => setRemarks(e.target.value)} disabled={saving} />
              </div>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={() => setApproveCase(null)} disabled={saving}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={saving}>{saving ? 'Saving…' : 'Approve'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {rejectCase?.request && (
        <div className="drawer-overlay" style={{ alignItems: 'center', zIndex: 120 }}>
          <div className="card" style={{ margin: 'auto', width: '100%', maxWidth: '460px', borderTop: '4px solid var(--danger)' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>Reject correction</h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              {name(rejectCase)} · {formatDay(rejectCase.attendance.attendance_date)}. The clock-out stays missing, the overtime is not paid, and the configured missing clock-out deduction (if any) applies in payroll.
            </p>
            <form onSubmit={reject} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {errorBox}
              <div><label className="form-label" htmlFor="mco-reject-remarks">Reason *</label><textarea id="mco-reject-remarks" className="form-control" rows={3} value={remarks} onChange={e => setRemarks(e.target.value)} disabled={saving} /></div>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={() => setRejectCase(null)} disabled={saving}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1, backgroundColor: 'var(--danger-600)', borderColor: 'var(--danger-600)' }} disabled={saving}>{saving ? 'Saving…' : 'Reject'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deductCase && (
        <div className="drawer-overlay" style={{ alignItems: 'center', zIndex: 120 }}>
          <div className="card" style={{ margin: 'auto', width: '100%', maxWidth: '460px', borderTop: '4px solid var(--warning)' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>Apply missing clock-out deduction</h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              {name(deductCase)} · {formatDay(deductCase.attendance.attendance_date)}. No correction was submitted. The fixed amount from Payroll Settings is recorded once for this day. If the employee later submits a correction and it is approved, the deduction is cancelled, or reversed if it was already paid out.
            </p>
            <form onSubmit={deduct} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {errorBox}
              <div><label className="form-label" htmlFor="mco-deduct-remarks">Reason *</label><textarea id="mco-deduct-remarks" className="form-control" rows={3} value={remarks} onChange={e => setRemarks(e.target.value)} disabled={saving} /></div>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={() => setDeductCase(null)} disabled={saving}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={saving}>{saving ? 'Saving…' : 'Record deduction'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {auditCase && (
        <div className="drawer-overlay" style={{ alignItems: 'center', zIndex: 120 }}>
          <div className="card" style={{ margin: 'auto', width: '100%', maxWidth: '640px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>History · {name(auditCase)} · {formatDay(auditCase.attendance.attendance_date)}</h3>
              <button className="icon-button" onClick={() => setAuditCase(null)} aria-label="Close"><X size={20} /></button>
            </div>
            {auditError ? <div role="alert" style={{ color: 'var(--danger)' }}>{auditError}</div> : audit === null ? <div style={{ color: 'var(--text-secondary)' }}>Loading…</div> : audit.length === 0 ? (
              <div style={{ color: 'var(--text-secondary)' }}>No recorded actions yet.</div>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {audit.map((a, i) => (
                  <li key={i} style={{ borderLeft: '3px solid var(--border-color)', paddingLeft: '0.75rem', fontSize: '0.8125rem' }}>
                    <div style={{ fontWeight: 600 }}>{a.action.replace(/_/g, ' ').toLowerCase().replace(/^./, ch => ch.toUpperCase())}</div>
                    <div style={{ color: 'var(--text-secondary)' }}>{formatCompanyDateTime(a.at)} · {a.actor}</div>
                    <div style={{ overflowWrap: 'anywhere' }}>{a.description}</div>
                  </li>
                ))}
              </ul>
            )}
            {auditCase.adjustments.length > 0 && (
              <div style={{ marginTop: '1rem', fontSize: '0.8125rem' }}>
                <div style={{ fontWeight: 600, marginBottom: '0.375rem' }}>Payroll adjustments</div>
                {auditCase.adjustments.map(a => (
                  <div key={a.id}>{a.reference} · {a.kind.replace(/_/g, ' ').toLowerCase()} · {a.kind === 'DEFERRED_OVERTIME' ? formatHours(Number(a.hours)) : money(a.amount)} · {a.status.toLowerCase()}{a.settled_month ? ` (${a.settled_month}/${a.settled_year})` : ''}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default MissingClockOutAdminPanel;
