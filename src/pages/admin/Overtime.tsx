import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Hourglass, Search, CheckCircle2, XCircle, X, RefreshCw, AlertTriangle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { overtimeService, OT_NOT_SET_UP } from '../../services/overtime/overtimeService';
import { validateOvertimeApproval, formatHours } from '../../services/overtime/overtimeRules';
import { formatDay } from '../../services/notifications/notificationRules';
import { formatShiftClock } from '../../services/attendance/employeeDashboardRules';
import { companyDateStr, COMPANY_TIMEZONE } from '../../utils/companyDate';
import RecordsModal from '../../components/common/RecordsModal';
import { clickableCardProps } from '../../services/common/cardDetails';
import { overtimeCards, type OvertimeCard } from '../../services/overtime/overtimeCardRules';

const STATUS_BADGE: Record<string, string> = { PENDING: 'badge-warning', APPROVED: 'badge-success', REJECTED: 'badge-danger', CANCELLED: 'badge-gray' };
const fmtTs = (iso?: string | null) => iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: COMPANY_TIMEZONE }) : '—';

const AdminOvertime: React.FC = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [status, setStatus] = useState('PENDING');
  const [search, setSearch] = useState('');

  const [approveRow, setApproveRow] = useState<any>(null);
  const [rejectRow, setRejectRow] = useState<any>(null);
  const [hours, setHours] = useState('');
  const [remarks, setRemarks] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data, error: err } = await overtimeService.getAllRequests();
    if (data) setRows(data);
    setError(err ? err.message : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const channel = supabase.channel('admin:overtime_requests')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'overtime_requests' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  const month = companyDateStr().slice(0, 7);
  // Card numbers and their detail views come from the same builder
  const otCards = useMemo(() => overtimeCards(rows, month), [rows, month]);
  const kpi = { pending: otCards.pending.count, approvedHours: otCards.approved.hours, rejected: otCards.rejected.count };
  const [openCard, setOpenCard] = useState<OvertimeCard | null>(null);

  const filtered = rows.filter(r => {
    if (status !== 'All' && r.status !== status) return false;
    if (!search) return true;
    const name = `${r.employee?.first_name ?? ''} ${r.employee?.last_name ?? ''} ${r.employee?.employee_code ?? ''}`.toLowerCase();
    return name.includes(search.toLowerCase());
  });

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 3000); };

  const openApprove = (r: any) => {
    setApproveRow(r);
    setHours(''); // the admin must type the hours: the requested amount is never approved automatically
    setRemarks(''); setFormError('');
  };
  const openReject = (r: any) => { setRejectRow(r); setRemarks(''); setFormError(''); };

  const approve = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!approveRow || saving) return;
    const h = Number(hours);
    const invalid = validateOvertimeApproval(h, Number(approveRow.requested_overtime_hours), Number(approveRow.eligible_overtime_hours));
    if (invalid) { setFormError(invalid); return; }
    setSaving(true);
    const { error: err, notifyError } = await overtimeService.reviewRequest(approveRow.id, 'APPROVED', h, remarks) as any;
    setSaving(false);
    if (err) { setFormError(err.message); return; }
    setApproveRow(null); flash(notifyError ? notifyError.message : `Approved ${formatHours(h)} of overtime. The employee has been notified.`); load();
  };

  const reject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectRow || saving) return;
    if (!remarks.trim()) { setFormError('Please give a reason for rejecting.'); return; }
    setSaving(true);
    const { error: err, notifyError } = await overtimeService.reviewRequest(rejectRow.id, 'REJECTED', null, remarks) as any;
    setSaving(false);
    if (err) { setFormError(err.message); return; }
    setRejectRow(null); flash(notifyError ? notifyError.message : 'Overtime request rejected. The employee has been notified.'); load();
  };

  const name = (r: any) => r.employee ? `${r.employee.first_name} ${r.employee.last_name}` : '—';
  const shift = (r: any) => r.shift ? `${r.shift.name} (${formatShiftClock(r.shift.start_time)} – ${formatShiftClock(r.shift.end_time)})` : '—';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div className="page-header" style={{ marginBottom: 0, flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="page-title">Overtime Requests</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
            Only the hours you approve here count as overtime. Requested and possible hours are never paid automatically.
          </p>
        </div>
        <button className="btn btn-outline" onClick={() => { setLoading(true); load(); }}><RefreshCw size={16} /> Refresh</button>
      </div>

      {error && (
        <div className="card" role="alert" style={{ borderLeft: `4px solid ${error === OT_NOT_SET_UP ? 'var(--warning)' : 'var(--danger)'}`, display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <AlertTriangle size={20} color={error === OT_NOT_SET_UP ? 'var(--warning)' : 'var(--danger)'} /> {error === OT_NOT_SET_UP ? 'The overtime_requests table has not been created yet (see docs/proposals/PROPOSED_overtime_requests.sql).' : error}
        </div>
      )}
      {toast && <div className="card" role="status" style={{ borderLeft: '4px solid var(--success)', color: 'var(--success)' }}>{toast}</div>}

      <div className="tracking-kpi-grid">
        <div className="tracking-kpi-card" {...clickableCardProps('Pending review', () => setOpenCard('pending'))}><div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Pending review</div><div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{kpi.pending}</div></div>
        <div className="tracking-kpi-card" {...clickableCardProps('Approved this month', () => setOpenCard('approved'))}><div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Approved this month</div><div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{formatHours(kpi.approvedHours)}</div></div>
        <div className="tracking-kpi-card" {...clickableCardProps('Rejected this month', () => setOpenCard('rejected'))}><div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Rejected this month</div><div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{kpi.rejected}</div></div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          <div style={{ position: 'relative', flex: '1 1 220px' }}>
            <Search size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
            <input className="form-control" style={{ paddingLeft: '2.25rem', fontSize: '0.875rem' }} placeholder="Search employee…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="form-control" style={{ width: 'auto', fontSize: '0.875rem' }} value={status} onChange={e => setStatus(e.target.value)}>
            {['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'All'].map(s => <option key={s} value={s}>{s === 'All' ? 'All statuses' : s.charAt(0) + s.slice(1).toLowerCase()}</option>)}
          </select>
        </div>

        {loading ? <div style={{ color: 'var(--text-secondary)' }}>Loading…</div> : filtered.length === 0 ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', padding: '1.5rem 0', textAlign: 'center' }}>
            <Hourglass size={32} color="var(--gray-300)" style={{ display: 'block', margin: '0 auto 0.5rem' }} />No overtime requests.
          </div>
        ) : (
          <div className="table-container">
            <table className="table" style={{ width: '100%', minWidth: '1200px' }}>
              <thead><tr>
                <th>Employee</th><th>Work date</th><th>Shift</th><th>Scheduled</th><th>Worked</th><th>Possible</th><th>Requested</th><th>Approved</th><th>Status</th><th>Reason</th><th>Admin remarks</th><th>Requested on</th><th>Reviewed</th><th></th>
              </tr></thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id}>
                    <td><div style={{ fontWeight: 600 }}>{name(r)}</div><div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{r.employee?.employee_code}</div></td>
                    <td>{formatDay(r.work_date)}</td>
                    <td style={{ fontSize: '0.8125rem' }}>{shift(r)}</td>
                    <td>{formatHours(Number(r.scheduled_hours))}</td>
                    <td>{formatHours(Number(r.actual_working_hours))}</td>
                    <td>{formatHours(Number(r.eligible_overtime_hours))}</td>
                    <td>{formatHours(Number(r.requested_overtime_hours))}</td>
                    <td style={{ fontWeight: 600 }}>{formatHours(r.status === 'APPROVED' ? Number(r.approved_overtime_hours) : 0)}</td>
                    <td><span className={`badge ${STATUS_BADGE[r.status] || 'badge-gray'}`}>{r.status}</span></td>
                    <td style={{ maxWidth: '200px', overflowWrap: 'anywhere', fontSize: '0.8125rem' }}>{r.employee_reason}</td>
                    <td style={{ maxWidth: '200px', overflowWrap: 'anywhere', fontSize: '0.8125rem' }}>{r.admin_remarks || '—'}</td>
                    <td style={{ fontSize: '0.75rem' }}>{fmtTs(r.created_at)}</td>
                    <td style={{ fontSize: '0.75rem' }}>{fmtTs(r.reviewed_at)}</td>
                    <td>{r.status === 'PENDING' && (
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button className="btn btn-primary" style={{ padding: '0.25rem 0.625rem', fontSize: '0.75rem' }} onClick={() => openApprove(r)}><CheckCircle2 size={14} /> Approve</button>
                        <button className="btn btn-outline" style={{ padding: '0.25rem 0.625rem', fontSize: '0.75rem', color: 'var(--danger)' }} onClick={() => openReject(r)}><XCircle size={14} /> Reject</button>
                      </div>
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {approveRow && (
        <div className="drawer-overlay" style={{ alignItems: 'center', zIndex: 120 }}>
          <div className="card" style={{ margin: 'auto', width: '100%', maxWidth: '460px', animation: 'slideUp 0.3s' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>Approve overtime</h3>
              <button className="icon-button" onClick={() => setApproveRow(null)} aria-label="Close"><X size={20} /></button>
            </div>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1rem', lineHeight: 1.6 }}>
              {name(approveRow)} · {formatDay(approveRow.work_date)}<br />
              Requested <strong>{formatHours(Number(approveRow.requested_overtime_hours))}</strong> · Possible <strong>{formatHours(Number(approveRow.eligible_overtime_hours))}</strong>
            </p>
            <form onSubmit={approve} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {formError && <div role="alert" style={{ padding: '0.75rem', backgroundColor: 'var(--danger-50)', color: 'var(--danger)', borderRadius: 'var(--radius-md)', fontSize: '0.875rem' }}>{formError}</div>}
              <div>
                <label className="form-label" htmlFor="ot-approve-hours">Hours to approve * (max {Math.min(Number(approveRow.requested_overtime_hours), Number(approveRow.eligible_overtime_hours))})</label>
                <input id="ot-approve-hours" type="number" min="0.01" step="0.01" max={Math.min(Number(approveRow.requested_overtime_hours), Number(approveRow.eligible_overtime_hours))} className="form-control" value={hours} onChange={e => setHours(e.target.value)} disabled={saving} />
              </div>
              <div>
                <label className="form-label" htmlFor="ot-approve-remarks">Remarks</label>
                <textarea id="ot-approve-remarks" className="form-control" rows={2} value={remarks} onChange={e => setRemarks(e.target.value)} disabled={saving} />
              </div>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={() => setApproveRow(null)} disabled={saving}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={saving}>{saving ? 'Saving…' : hours ? `Approve ${hours} h` : 'Approve'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {rejectRow && (
        <div className="drawer-overlay" style={{ alignItems: 'center', zIndex: 120 }}>
          <div className="card" style={{ margin: 'auto', width: '100%', maxWidth: '460px', animation: 'slideUp 0.3s', borderTop: '4px solid var(--danger)' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>Reject overtime</h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>{name(rejectRow)} · {formatDay(rejectRow.work_date)} · requested {formatHours(Number(rejectRow.requested_overtime_hours))}</p>
            <form onSubmit={reject} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {formError && <div role="alert" style={{ padding: '0.75rem', backgroundColor: 'var(--danger-50)', color: 'var(--danger)', borderRadius: 'var(--radius-md)', fontSize: '0.875rem' }}>{formError}</div>}
              <div><label className="form-label" htmlFor="ot-reject-remarks">Reason *</label><textarea id="ot-reject-remarks" className="form-control" rows={3} value={remarks} onChange={e => setRemarks(e.target.value)} disabled={saving} /></div>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={() => setRejectRow(null)} disabled={saving}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1, backgroundColor: 'var(--danger-600)', borderColor: 'var(--danger-600)' }} disabled={saving}>{saving ? 'Saving…' : 'Reject'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
      <style>{`@keyframes slideUp { from { transform: translateY(40px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`}</style>
      {openCard && (() => {
        const cols = [{ key: 'employee', label: 'Employee' }, { key: 'code', label: 'Employee ID' }, { key: 'workDate', label: 'Work Date' }, { key: 'shift', label: 'Shift' },
          { key: 'requested', label: 'Requested', align: 'right' as const, format: (v: any) => formatHours(v) }, { key: 'eligible', label: 'Eligible', align: 'right' as const, format: (v: any) => formatHours(v) },
          { key: 'approved', label: 'Approved', align: 'right' as const, format: (v: any) => (v === null ? '—' : formatHours(v)) }, { key: 'status', label: 'Status' }, { key: 'remarks', label: 'Remarks' }];
        const meta: Record<OvertimeCard, { title: string; total: React.ReactNode; label: string; explain: string; empty: string }> = {
          pending: { title: 'Overtime Pending Review', total: otCards.pending.count, label: 'Requests', empty: 'No overtime requests are awaiting review.', explain: 'Every PENDING overtime request. Approve or reject from the request list — the admin types the approved hours.' },
          approved: { title: `Overtime Approved — ${month}`, total: formatHours(otCards.approved.hours), label: `Approved hours (${otCards.approved.count} requests)`, empty: 'No overtime approved for this month.', explain: 'APPROVED requests whose work date is in this company month; the total is the sum of the approved hours only (requested or eligible hours are never counted).' },
          rejected: { title: `Overtime Rejected — ${month}`, total: otCards.rejected.count, label: 'Requests', empty: 'No overtime rejected this month.', explain: 'REJECTED requests whose work date is in this company month.' },
        };
        const m = meta[openCard];
        return <RecordsModal open title={m.title} total={m.total} totalLabel={m.label} columns={cols} rows={otCards[openCard].rows} loading={loading} error={error}
          emptyMessage={m.empty} explanation={[m.explain, 'Overtime pay is worked out in Payroll using the configured overtime rate; it is not calculated here. Opening this view does not approve or reject anything.']}
          onClose={() => setOpenCard(null)} />;
      })()}
    </div>
  );
};

export default AdminOvertime;
