import React, { useState, useEffect } from 'react';
import { useGlobalSettings } from '../../services/settings/globalSettingsService';
import { breakService } from '../../services/attendance/breakService';
import { realtimeService } from '../../services/realtime/realtimeService';
import { Coffee, Search, Clock, FileText } from 'lucide-react';
import { summarizeBreakDay, matchesBreakFilter, BREAK_STATUS_LABEL } from '../../services/attendance/breakSummaryRules';
import { COMPANY_TIMEZONE } from '../../utils/companyDate';

const AdminBreaks: React.FC = () => {
  const { settings } = useGlobalSettings();
  const appSettings = settings.app;
  const payrollSettings = settings.payroll;
  
  const [breaks, setBreaks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Re-render every minute so an in-progress break's elapsed time stays current
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNowMs(Date.now()), 60000); return () => clearInterval(t); }, []);
  
  const [filterDate, setFilterDate] = useState(() => {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  });
  
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);

  const fetchBreaks = async () => {
    setLoading(true);
    const { data, error } = await breakService.getBreakReport(filterDate);
    setLoadError(error ? error.message : null);
    if (data) {
      setBreaks(data); // attendance rows for the date, each with its attendance_breaks
    }
    setNowMs(Date.now());
    setLoading(false);
  };

  useEffect(() => {
    fetchBreaks();
    const subscription = realtimeService.subscribeToAdminBreaks(() => {
      fetchBreaks();
    });
    return () => {
      realtimeService.unsubscribe(subscription);
    };
  }, [filterDate]);

  // One summary per attendance day, from the actual break sessions (see breakSummaryRules)
  const employeeBreakSummary = React.useMemo(() => {
    return breaks.map(att => {
      const sum = summarizeBreakDay(att, appSettings?.breakDurationMins, nowMs);
      const isDeductionApplicable = (sum.excessMins || 0) > 0 && !!payrollSettings?.enableBreakOverrunDeduction;
      return {
        employee_id: att.employee_id,
        attendance_id: att.id,
        employee: att.employees,
        attendance: att,
        ...sum,
        isDeductionApplicable,
      };
    });
  }, [breaks, appSettings, payrollSettings, nowMs]);

  // Apply Filters
  const filteredSummary = employeeBreakSummary.filter(s => matchesBreakFilter(s.status, filterStatus));

  const selectedDetails = employeeBreakSummary.find(s => s.employee_id === selectedEmployee);

  const formatTime = (isoString: string | null) => {
    if (!isoString || !Number.isFinite(new Date(isoString).getTime())) return '—';
    return new Date(isoString).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: COMPANY_TIMEZONE });
  };
  const mins = (v: number | null) => (v === null ? 'Not configured' : `${v} min`);
  const statusBadge = (st: keyof typeof BREAK_STATUS_LABEL) => {
    const cls = st === 'ON_BREAK' ? 'badge-warning' : st === 'EXCESS' ? 'badge-danger' : st === 'UNVERIFIED' ? 'badge-gray' : 'badge-success';
    return <span className={`badge ${cls}`}>{BREAK_STATUS_LABEL[st]}</span>;
  };

  return (
    <div className="page-container">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="page-title">Break Management</h1>
          <p className="page-subtitle">Monitor employee break sessions and excess durations.</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '200px' }}>
            <label className="form-label">Date</label>
            <input 
              type="date" 
              className="form-control" 
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
            />
          </div>
          <div style={{ flex: 1, minWidth: '200px' }}>
            <label className="form-label">Status Filter</label>
            <select className="form-select" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="ALL">All Break Statuses</option>
              <option value="WITHIN">Within Limit</option>
              <option value="EXCESS">Excess Break</option>
              <option value="ON_BREAK">On Break</option>
              <option value="NO_BREAKS">No Breaks Recorded</option>
              <option value="UNVERIFIED">Unverified</option>
            </select>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selectedEmployee ? '2fr 1fr' : '1fr', gap: '1.5rem' }}>
        
        {/* Main Table */}
        <div className="card">
          <div className="table-responsive">
            <table className="table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Shift</th>
                  <th>Allowed</th>
                  <th>Total Break</th>
                  <th>Excess</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: '3rem' }}>
                      <div className="spinner" style={{ margin: '0 auto' }}></div>
                    </td>
                  </tr>
                ) : loadError ? (
                  <tr>
                    <td colSpan={7} role="alert" style={{ textAlign: 'center', padding: '3rem', color: 'var(--danger)' }}>
                      Break records could not be loaded: {loadError}
                    </td>
                  </tr>
                ) : filteredSummary.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                      {breaks.length === 0 ? 'No attendance records for this date.' : 'No employees match this status filter.'}
                    </td>
                  </tr>
                ) : (
                  filteredSummary.map(s => (
                    <tr key={`${s.employee_id}_${s.attendance_id}`}>
                      <td>
                        <div style={{ fontWeight: 500 }}>{s.employee?.first_name} {s.employee?.last_name}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{s.employee?.employee_code} • {s.employee?.departments?.name}</div>
                      </td>
                      <td>
                        <span className="badge badge-primary">{s.attendance?.shift_template?.name || 'Standard'}</span>
                      </td>
                      <td>{mins(s.allowedMins)}</td>
                      <td>
                        <span style={{ fontWeight: 600, color: (s.excessMins || 0) > 0 ? 'var(--danger)' : 'inherit' }}>
                          {s.totalMins} min
                        </span>
                        {s.activeCount > 0 && <div style={{ fontSize: '0.7rem', color: 'var(--warning)' }}>in progress</div>}
                        {s.sessions.length > 0 && <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{s.sessions.length} session{s.sessions.length === 1 ? '' : 's'}</div>}
                      </td>
                      <td>
                        <span style={{ fontWeight: 600, color: (s.excessMins || 0) > 0 ? 'var(--danger)' : 'var(--text-secondary)' }}>
                          {s.excessMins === null ? '—' : `${s.excessMins} min`}
                        </span>
                      </td>
                      <td>{statusBadge(s.status)}</td>
                      <td>
                        <button 
                          className="btn btn-outline" 
                          style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem' }}
                          onClick={() => setSelectedEmployee(s.employee_id)}
                        >
                          View Details
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Details Pane */}
        {selectedDetails && (
          <div className="card" style={{ alignSelf: 'start', position: 'sticky', top: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <FileText size={18} />
                Break Details
              </h3>
              <button className="icon-button" onClick={() => setSelectedEmployee(null)}>×</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
              <div style={{ paddingBottom: '0.75rem', borderBottom: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Employee</div>
                <div style={{ fontWeight: 600, fontSize: '1.125rem' }}>{selectedDetails.employee?.first_name} {selectedDetails.employee?.last_name}</div>
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Allowed Break</div>
                  <div style={{ fontWeight: 600 }}>{mins(selectedDetails.allowedMins)}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Total Used</div>
                  <div style={{ fontWeight: 600, color: (selectedDetails.excessMins || 0) > 0 ? 'var(--danger)' : 'inherit' }}>{selectedDetails.totalMins} min{selectedDetails.activeCount > 0 ? ' (in progress)' : ''}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Excess</div>
                  <div style={{ fontWeight: 600, color: (selectedDetails.excessMins || 0) > 0 ? 'var(--danger)' : 'inherit' }}>{selectedDetails.excessMins === null ? '—' : `${selectedDetails.excessMins} min`}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Deduction</div>
                  <div style={{ fontWeight: 600, color: selectedDetails.isDeductionApplicable ? 'var(--danger)' : 'var(--text-secondary)' }}>
                    {selectedDetails.isDeductionApplicable ? 'Applicable (calculated in Payroll)' : 'Not applicable'}
                  </div>
                </div>
              </div>
            </div>

            {selectedDetails.notes.length > 0 && (
              <div role="note" style={{ marginBottom: '1rem', padding: '0.75rem', border: '1px solid var(--warning)', borderRadius: 'var(--radius-md)', fontSize: '0.8125rem' }}>
                {selectedDetails.notes.map((n, i) => <div key={i}>{n}</div>)}
              </div>
            )}
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              Total = sum of each session (end − start, whole minutes); an active break counts up to now. Excess = max(0, total − allowed).
            </div>

            <h4 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '1rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Sessions</h4>
            {selectedDetails.sessions.length === 0 && (
              <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>No break sessions were recorded for this attendance day.</div>
            )}
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {selectedDetails.sessions.map((session: any, i: number) => (
                <div key={session.id || i} style={{ padding: '0.75rem', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
                    <span style={{ fontWeight: 600 }}>Session {i + 1}</span>
                    {session.state === 'COMPLETED' ? (
                      <span className="badge badge-success" style={{ fontSize: '0.7rem' }}>Completed</span>
                    ) : session.state === 'ACTIVE' ? (
                      <span className="badge badge-warning" style={{ fontSize: '0.7rem' }}>In progress</span>
                    ) : (
                      <span className="badge badge-gray" style={{ fontSize: '0.7rem' }} title={session.invalidReason}>Invalid — not counted</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem' }}>
                    <div>
                      {formatTime(session.started_at)} → {session.state === 'ACTIVE' ? 'Now' : formatTime(session.ended_at)}
                      {session.break_type === 'AUTO_GPS' && <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}> · automatic (GPS)</span>}
                    </div>
                    <div style={{ fontWeight: 600 }}>
                      {session.minutes === null ? (session.invalidReason || '—') : `${session.minutes} min`}
                    </div>
                  </div>
                </div>
              ))}
            </div>

          </div>
        )}

      </div>
    </div>
  );
};

export default AdminBreaks;
