import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Hourglass, Clock, AlertTriangle, X, RefreshCw } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { overtimeService, OT_NOT_SET_UP, type OvertimeDay } from '../../services/overtime/overtimeService';
import { OT_REASON_TEXT, validateOvertimeRequest, formatHours, minutesToHours } from '../../services/overtime/overtimeRules';
import { formatDay } from '../../services/notifications/notificationRules';
import { formatShiftClock } from '../../services/attendance/employeeDashboardRules';
import { companyDateStr } from '../../utils/companyDate';

const STATUS_BADGE: Record<string, string> = { PENDING: 'badge-warning', APPROVED: 'badge-success', REJECTED: 'badge-danger', CANCELLED: 'badge-gray' };

const EmployeeOvertime: React.FC = () => {
  const { employee } = useAuth();
  const [days, setDays] = useState<OvertimeDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notSetUp, setNotSetUp] = useState(false);
  const [toast, setToast] = useState('');

  const [requestDay, setRequestDay] = useState<OvertimeDay | null>(null);
  const [hours, setHours] = useState('');
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: err } = await overtimeService.getMyOvertimeDays(31);
    if (data) setDays(data);
    setNotSetUp(err?.message === OT_NOT_SET_UP);
    setError(err && err.message !== OT_NOT_SET_UP ? err.message : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    if (!employee?.id) return;
    // Live: the admin's decision shows up without a refresh (table must be in the realtime publication)
    const channel = supabase.channel(`overtime:emp_${employee.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'overtime_requests', filter: `employee_id=eq.${employee.id}` }, () => load())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_employee_id=eq.${employee.id}` }, (p: any) => {
        if (p?.new?.notification_type === 'OVERTIME') load();
      })
      .subscribe();
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { document.removeEventListener('visibilitychange', onVisible); supabase.removeChannel(channel); };
  }, [employee?.id, load]);

  const requestable = useMemo(() => days.filter(d => d.estimate.eligible && (!d.request || ['REJECTED', 'CANCELLED'].includes(d.request.status))), [days]);
  const requests = useMemo(() => days.filter(d => d.request).map(d => ({ ...d.request, day: d })), [days]);
  const thisMonth = companyDateStr().slice(0, 7);
  const kpi = useMemo(() => ({
    pending: requests.filter(r => r.status === 'PENDING').length,
    approvedHours: requests.filter(r => r.status === 'APPROVED' && String(r.work_date).startsWith(thisMonth)).reduce((s, r) => s + Number(r.approved_overtime_hours || 0), 0),
    potentialDays: requestable.length,
  }), [requests, requestable, thisMonth]);

  const openRequest = (d: OvertimeDay) => {
    setRequestDay(d); setHours(String(d.estimate.potentialHours)); setReason(''); setFormError('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requestDay || submitting) return;
    const h = Number(hours);
    const invalid = validateOvertimeRequest(h, requestDay.estimate.potentialHours, reason);
    if (invalid) { setFormError(invalid); return; }
    setSubmitting(true);
    const { error: err } = await overtimeService.createRequest(requestDay.attendance.id, h, reason);
    setSubmitting(false);
    if (err) { setFormError(err.message); return; }
    setRequestDay(null);
    setToast('Overtime request submitted for review.');
    setTimeout(() => setToast(''), 3000);
    load();
  };

  const cancel = async (id: string) => {
    if (cancellingId) return;
    setCancellingId(id);
    const { error: err } = await overtimeService.cancelMyRequest(id);
    setCancellingId(null);
    if (err) setError(err.message); else load();
  };

  const shiftText = (d: OvertimeDay) => d.shift ? `${d.shift.name} (${formatShiftClock(d.shift.start_time)} – ${formatShiftClock(d.shift.end_time)})` : '—';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div className="page-header" style={{ marginBottom: 0, flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="page-title">My Overtime</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
            Extra time is not overtime until you request it and an administrator approves the hours.
          </p>
        </div>
        <button className="btn btn-outline" onClick={() => { setLoading(true); load(); }}><RefreshCw size={16} /> Refresh</button>
      </div>

      {notSetUp && (
        <div className="card" role="alert" style={{ borderLeft: '4px solid var(--warning)', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <AlertTriangle size={20} color="var(--warning)" /> <span>{OT_NOT_SET_UP}</span>
        </div>
      )}
      {error && (
        <div className="card" role="alert" style={{ borderLeft: '4px solid var(--danger)', color: 'var(--danger)' }}>{error}</div>
      )}
      {toast && <div className="card" role="status" style={{ borderLeft: '4px solid var(--success)', color: 'var(--success)' }}>{toast}</div>}

      <div className="tracking-kpi-grid">
        <div className="tracking-kpi-card"><div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Pending requests</div><div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{kpi.pending}</div></div>
        <div className="tracking-kpi-card"><div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Approved this month</div><div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{formatHours(Math.round(kpi.approvedHours * 100) / 100)}</div></div>
        <div className="tracking-kpi-card"><div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Days you can request</div><div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{kpi.potentialDays}</div></div>
      </div>

      <div className="card">
        <h3 className="card-title" style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Hourglass size={18} /> Days with possible overtime (last 31 days)</h3>
        {loading ? <div style={{ color: 'var(--text-secondary)' }}>Loading…</div> : requestable.length === 0 ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>No days with work beyond your scheduled shift.</div>
        ) : (
          <div className="table-container">
            <table className="table" style={{ width: '100%', minWidth: '720px' }}>
              <thead><tr><th>Date</th><th>Shift</th><th>Scheduled</th><th>Worked</th><th>Breaks</th><th>Possible OT</th><th></th></tr></thead>
              <tbody>
                {requestable.map(d => (
                  <tr key={d.attendance.id}>
                    <td>{formatDay(d.attendance.attendance_date)}</td>
                    <td>{shiftText(d)}</td>
                    <td>{formatHours(minutesToHours(d.estimate.scheduledMinutes ?? 0))}</td>
                    <td>{formatHours(minutesToHours(d.estimate.workedMinutes))}</td>
                    <td>{formatHours(minutesToHours(d.estimate.breakMinutes))}</td>
                    <td style={{ fontWeight: 600 }}>{formatHours(d.estimate.potentialHours)}</td>
                    <td><button className="btn btn-primary" style={{ padding: '0.375rem 0.75rem', fontSize: '0.8125rem' }} disabled={notSetUp} onClick={() => openRequest(d)}>Request</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h3 className="card-title" style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Clock size={18} /> My requests</h3>
        {loading ? <div style={{ color: 'var(--text-secondary)' }}>Loading…</div> : requests.length === 0 ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>You have not requested overtime in the last 31 days.</div>
        ) : (
          <div className="table-container">
            <table className="table" style={{ width: '100%', minWidth: '760px' }}>
              <thead><tr><th>Date</th><th>Possible</th><th>Requested</th><th>Approved</th><th>Status</th><th>Your reason</th><th>Admin remarks</th><th>Created</th><th></th></tr></thead>
              <tbody>
                {requests.map(r => (
                  <tr key={r.id}>
                    <td>{formatDay(r.work_date)}</td>
                    <td>{formatHours(Number(r.eligible_overtime_hours))}</td>
                    <td>{formatHours(Number(r.requested_overtime_hours))}</td>
                    <td style={{ fontWeight: 600 }}>{formatHours(r.status === 'APPROVED' ? Number(r.approved_overtime_hours) : 0)}</td>
                    <td><span className={`badge ${STATUS_BADGE[r.status] || 'badge-gray'}`}>{r.status}</span></td>
                    <td style={{ maxWidth: '220px', overflowWrap: 'anywhere' }}>{r.employee_reason}</td>
                    <td style={{ maxWidth: '220px', overflowWrap: 'anywhere' }}>{r.admin_remarks || '—'}</td>
                    <td style={{ fontSize: '0.75rem' }}>{r.created_at ? new Date(r.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '—'}</td>
                    <td>{r.status === 'PENDING' && (
                      <button className="btn btn-outline" style={{ padding: '0.25rem 0.625rem', fontSize: '0.75rem' }} disabled={cancellingId === r.id} onClick={() => cancel(r.id)}>
                        {cancellingId === r.id ? 'Cancelling…' : 'Cancel'}
                      </button>
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && days.some(d => !d.estimate.eligible && d.attendance.clock_out_at && d.estimate.reason !== 'NO_EXTRA_TIME') && (
          <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.75rem' }}>
            Some days are not eligible: {[...new Set(days.filter(d => !d.estimate.eligible && d.attendance.clock_out_at && d.estimate.reason !== 'NO_EXTRA_TIME').map(d => OT_REASON_TEXT[d.estimate.reason!]))].join(' ')}
          </p>
        )}
      </div>

      {requestDay && (
        <div className="drawer-overlay" style={{ alignItems: 'center', zIndex: 120 }}>
          <div className="card" style={{ margin: 'auto', width: '100%', maxWidth: '460px', animation: 'slideUp 0.3s' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>Request overtime</h3>
              <button className="icon-button" onClick={() => setRequestDay(null)} aria-label="Close"><X size={20} /></button>
            </div>
            <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1rem', lineHeight: 1.6 }}>
              {formatDay(requestDay.attendance.attendance_date)} · {shiftText(requestDay)}<br />
              Scheduled {formatHours(minutesToHours(requestDay.estimate.scheduledMinutes ?? 0))} · Worked {formatHours(minutesToHours(requestDay.estimate.workedMinutes))} · Possible overtime (not approved) <strong>{formatHours(requestDay.estimate.potentialHours)}</strong>
            </div>
            <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {formError && <div role="alert" style={{ padding: '0.75rem', backgroundColor: 'var(--danger-50)', color: 'var(--danger)', borderRadius: 'var(--radius-md)', fontSize: '0.875rem' }}>{formError}</div>}
              <div>
                <label className="form-label" htmlFor="ot-hours">Hours to request (max {requestDay.estimate.potentialHours})</label>
                <input id="ot-hours" type="number" min="0.01" step="0.01" max={requestDay.estimate.potentialHours} className="form-control" value={hours} onChange={e => setHours(e.target.value)} disabled={submitting} />
              </div>
              <div>
                <label className="form-label" htmlFor="ot-reason">Reason *</label>
                <textarea id="ot-reason" className="form-control" rows={3} value={reason} onChange={e => setReason(e.target.value)} disabled={submitting} placeholder="What did you work on?" />
              </div>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={() => setRequestDay(null)} disabled={submitting}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={submitting}>{submitting ? 'Submitting…' : 'Submit Overtime Request'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
      <style>{`@keyframes slideUp { from { transform: translateY(40px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`}</style>
    </div>
  );
};

export default EmployeeOvertime;
