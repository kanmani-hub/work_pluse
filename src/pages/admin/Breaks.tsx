import React, { useState, useEffect } from 'react';
import { useGlobalSettings } from '../../services/settings/globalSettingsService';
import { breakService } from '../../services/attendance/breakService';
import { realtimeService } from '../../services/realtime/realtimeService';
import { FileText, Trash2, StopCircle, AlertCircle } from 'lucide-react';
import { buildBreakReportRows, matchesReportFilter, REPORT_STATUS_LABEL, trackingLabel, API_ROW_LIMIT, type BreakReportStatus, type BreakReportRow } from '../../services/attendance/breakReportRules';
import { COMPANY_TIMEZONE, companyDateStr } from '../../utils/companyDate';

const AdminBreaks: React.FC = () => {
  const { settings } = useGlobalSettings();
  const appSettings = settings.app;
  const payrollSettings = settings.payroll;

  const [breaks, setBreaks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionNotice, setActionNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  // Re-render every minute so an in-progress break's elapsed time stays current
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNowMs(Date.now()), 60000); return () => clearInterval(t); }, []);

  const [filterDate, setFilterDate] = useState(() => {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  });

  const [filterStatus, setFilterStatus] = useState('ALL');
  // Row key (attendance day or employee without attendance), not employee id: two attendance rows
  // for one employee on one date must not show each other's details.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Employees without attendance + tracking freshness (each part may fail on its own)
  const [context, setContext] = useState<{ employees: any[] | null; liveLocations: any[] | null; locationProblems: any[] | null; breakEndEvents: any[] | null }>({ employees: null, liveLocations: null, locationProblems: null, breakEndEvents: null });
  const [contextErrors, setContextErrors] = useState<string[]>([]);
  const isToday = filterDate === companyDateStr();

  const loadContext = async () => {
    const ctx = await breakService.getBreakReportContext(filterDate, filterDate === companyDateStr());
    setContext({ employees: ctx.employees, liveLocations: ctx.liveLocations, locationProblems: ctx.locationProblems, breakEndEvents: ctx.breakEndEvents });
    setContextErrors(ctx.errors);
  };

  const fetchBreaks = async (silent = false) => {
    if (!silent) setLoading(true);
    const [{ data, error }] = await Promise.all([breakService.getBreakReport(filterDate), loadContext()]);
    setLoadError(error ? error.message : null);
    setBreaks(error ? [] : (data || [])); // attendance rows for the date, each with its attendance_breaks
    setNowMs(Date.now());
    setLoading(false);
  };

  const handleEndBreak = async (breakId: string, attendanceId: string) => {
    if (!window.confirm('Are you sure you want to end this active break now?')) return;
    setActionLoading(true);
    setActionNotice(null);
    try {
      const { data, error } = await breakService.adminEndBreak(breakId, attendanceId);
      if (error && !data) {
        setActionNotice({ type: 'error', text: `Failed to end break: ${error.message}` });
        await fetchBreaks(true);
      } else if (error) {
        setActionNotice({ type: 'error', text: error.message }); // ended, but a follow-up step failed
        await fetchBreaks(true);
      } else {
        setActionNotice({ type: 'success', text: 'Active break successfully ended.' });
        await fetchBreaks();
      }
    } catch (e: any) {
      setActionNotice({ type: 'error', text: e.message || 'Error ending break' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteBreak = async (breakId: string, attendanceId: string) => {
    if (!window.confirm('Discard this break session? This will remove the break time and recalculate any excess deduction.')) return;
    setActionLoading(true);
    setActionNotice(null);
    try {
      const { success, error } = await breakService.adminDeleteBreak(breakId, attendanceId);
      if (!success) {
        setActionNotice({ type: 'error', text: `Failed to discard session: ${error?.message || 'Unknown error'}` });
      } else if (error) {
        setActionNotice({ type: 'error', text: error.message }); // discarded, but totals not updated
        await fetchBreaks(true);
      } else {
        setActionNotice({ type: 'success', text: 'Break session discarded and totals recalculated.' });
        await fetchBreaks();
      }
    } catch (e: any) {
      setActionNotice({ type: 'error', text: e.message || 'Error discarding break' });
    } finally {
      setActionLoading(false);
    }
  };

  useEffect(() => {
    fetchBreaks();
    // Break start/end, clock-in/out and stored totals: refetch (debounced, no spinner)
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefetch = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { fetchBreaks(true); }, 800);
    };
    const breaksChannel = realtimeService.subscribeToAdminBreaks(scheduleRefetch);
    const attendanceChannel = realtimeService.subscribeToAdminAttendance(scheduleRefetch);
    // Tracking freshness changes with time and is not pushed: reload it every minute for today
    const trackingTimer = setInterval(() => { if (filterDate === companyDateStr()) loadContext(); }, 60000);
    return () => {
      if (timer) clearTimeout(timer);
      clearInterval(trackingTimer);
      realtimeService.unsubscribe(breaksChannel);
      realtimeService.unsubscribe(attendanceChannel);
    };
  }, [filterDate]);

  // One row per attendance day (from the actual break sessions) + employees without attendance
  const reportRows = React.useMemo(() => buildBreakReportRows({
    date: filterDate,
    today: companyDateStr(nowMs),
    attendanceRows: breaks,
    employees: context.employees,
    liveLocations: context.liveLocations,
    locationProblems: context.locationProblems,
    breakEndEvents: context.breakEndEvents,
    settingBreakMins: appSettings?.breakDurationMins,
    nowMs,
  }).map(r => ({
    ...r,
    isDeductionApplicable: (r.summary?.excessMins || 0) > 0 && !!payrollSettings?.enableBreakOverrunDeduction,
  })), [breaks, context, filterDate, appSettings, payrollSettings, nowMs]);

  // Apply Filters
  const filteredSummary = reportRows.filter(r => matchesReportFilter(r.status, filterStatus));
  const counts = {
    withAttendance: reportRows.filter(r => r.attendanceId).length,
    onBreak: reportRows.filter(r => r.status === 'ON_BREAK').length,
    noAttendance: reportRows.filter(r => r.status === 'NO_ATTENDANCE').length,
    trackingIssues: reportRows.filter(r => ['STALE', 'LOCATION_PROBLEM', 'NO_DATA'].includes(r.tracking.state)).length,
  };

  const selectedDetails = reportRows.find(r => r.key === selectedKey);

  const formatTime = (isoString: string | null) => {
    if (!isoString || !Number.isFinite(new Date(isoString).getTime())) return '—';
    return new Date(isoString).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: COMPANY_TIMEZONE });
  };
  const mins = (v: number | null) => (v === null ? 'Not configured' : `${v} min`);
  const statusBadge = (st: BreakReportStatus) => {
    const cls = st === 'ON_BREAK' ? 'badge-warning' : st === 'EXCESS' ? 'badge-danger' : (st === 'UNVERIFIED' || st === 'NO_ATTENDANCE') ? 'badge-gray' : 'badge-success';
    return <span className={`badge ${cls}`}>{REPORT_STATUS_LABEL[st]}</span>;
  };
  const trackingColor = (r: BreakReportRow) =>
    r.tracking.state === 'LIVE' ? 'var(--success)'
    : r.tracking.state === 'NOT_APPLICABLE' ? 'var(--text-secondary)'
    : (r.status === 'ON_BREAK' ? 'var(--danger)' : 'var(--warning)');
  const storedCell = (r: BreakReportRow) => {
    if (!r.summary) return <span style={{ color: 'var(--text-secondary)' }}>—</span>;
    return (
      <>
        <span>{r.storedBreakMins === null ? '—' : `${r.storedBreakMins} min`}</span>
        {r.summary.activeCount > 0 && <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>updated when the break ends</div>}
        {r.storedDiffers && <div style={{ fontSize: '0.7rem', color: 'var(--danger)' }} title="Completed break time from the sessions differs from the stored attendance value used by payroll">differs from sessions ({r.summary.completedMins} min)</div>}
      </>
    );
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
              <option value="NO_ATTENDANCE">No Attendance</option>
            </select>
          </div>
        </div>
      </div>

      {!loading && !loadError && (
        <div style={{ marginBottom: '1rem', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
          Business date {filterDate.split('-').reverse().join('-')} (company time, {COMPANY_TIMEZONE}) · {counts.withAttendance} with attendance · {counts.onBreak} on break now · {counts.noAttendance} without attendance
          {isToday && ` · ${counts.trackingIssues} with location not updating`}
        </div>
      )}
      {!loading && !loadError && breaks.length >= API_ROW_LIMIT && (
        <div role="alert" style={{ marginBottom: '1rem', padding: '0.75rem 1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--warning)', fontSize: '0.8125rem' }}>
          {breaks.length} attendance rows were returned, which is the API row limit: some attendance days may be missing from this list.
        </div>
      )}

      {contextErrors.length > 0 && (
        <div role="alert" style={{ marginBottom: '1rem', padding: '0.75rem 1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--warning)', fontSize: '0.8125rem' }}>
          {contextErrors.map((e, i) => <div key={i}>{e}</div>)}
        </div>
      )}

      {actionNotice && (
        <div style={{
          marginBottom: '1.5rem',
          padding: '0.75rem 1rem',
          borderRadius: 'var(--radius-md)',
          backgroundColor: actionNotice.type === 'success' ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
          border: `1px solid ${actionNotice.type === 'success' ? 'var(--success)' : 'var(--danger)'}`,
          color: actionNotice.type === 'success' ? 'var(--success)' : 'var(--danger)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          fontSize: '0.875rem'
        }}>
          <AlertCircle size={16} />
          <span>{actionNotice.text}</span>
          <button style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: '1.25rem' }} onClick={() => setActionNotice(null)}>×</button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: selectedDetails ? '2fr 1fr' : '1fr', gap: '1.5rem' }}>

        {/* Main Table */}
        <div className="card">
          <div className="table-responsive">
            <table className="table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Shift</th>
                  <th>Allowed</th>
                  <th>Break Time (live)</th>
                  <th>Completed</th>
                  <th title="attendance.break_minutes: the value payroll uses">Stored (payroll)</th>
                  <th>Excess</th>
                  <th>Status</th>
                  <th>Tracking</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={10} style={{ textAlign: 'center', padding: '3rem' }}>
                      <div className="spinner" style={{ margin: '0 auto' }}></div>
                    </td>
                  </tr>
                ) : loadError ? (
                  <tr>
                    <td colSpan={10} role="alert" style={{ textAlign: 'center', padding: '3rem', color: 'var(--danger)' }}>
                      Break records could not be loaded: {loadError}
                    </td>
                  </tr>
                ) : filteredSummary.length === 0 ? (
                  <tr>
                    <td colSpan={10} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                      {reportRows.length === 0 ? 'No employees or attendance records for this date.' : 'No employees match this status filter.'}
                    </td>
                  </tr>
                ) : (
                  filteredSummary.map(r => (
                    <tr key={r.key}>
                      <td>
                        <div style={{ fontWeight: 500 }}>{r.employee?.first_name} {r.employee?.last_name}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{r.employee?.employee_code}{r.employee?.departments?.name ? ` • ${r.employee.departments.name}` : ''}{r.attendanceId ? ` • Att ${r.attendanceId.slice(0, 8)}` : ''}</div>
                      </td>
                      <td>
                        {r.attendance
                          ? <span className="badge badge-primary">{r.shiftName || 'Standard'}</span>
                          : <span style={{ color: 'var(--text-secondary)' }}>—</span>}
                      </td>
                      <td>{r.summary ? mins(r.summary.allowedMins) : '—'}</td>
                      <td>
                        {!r.summary ? (
                          <span style={{ color: 'var(--text-secondary)' }}>—</span>
                        ) : r.summary.breaksUnavailable ? (
                          <span style={{ color: 'var(--danger)' }} title={r.summary.notes[0]}>Not loaded</span>
                        ) : (
                          <>
                            <span style={{ fontWeight: 600, color: (r.summary.excessMins || 0) > 0 ? 'var(--danger)' : 'inherit' }}>
                              {r.summary.totalMins} min
                            </span>
                            {r.summary.activeCount > 0 && <div style={{ fontSize: '0.7rem', color: 'var(--warning)' }}>in progress</div>}
                            {r.summary.sessions.length > 0 && <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{r.summary.sessions.length} session{r.summary.sessions.length === 1 ? '' : 's'}{r.firstStartAt ? ` · ${formatTime(r.firstStartAt)} → ${r.summary.activeCount > 0 ? 'now' : formatTime(r.lastEndAt)}` : ''}</div>}
                            {Object.keys(r.gapReturns).length > 0 && <div style={{ fontSize: '0.7rem', color: 'var(--warning)' }} title="The return was only seen after the phone stopped reporting; the actual return may have been earlier">return seen after tracking gap</div>}
                          </>
                        )}
                      </td>
                      <td>
                        {!r.summary || r.summary.breaksUnavailable ? <span style={{ color: 'var(--text-secondary)' }}>—</span> : `${r.summary.completedMins} min`}
                      </td>
                      <td>{storedCell(r)}</td>
                      <td>
                        <span style={{ fontWeight: 600, color: (r.summary?.excessMins || 0) > 0 ? 'var(--danger)' : 'var(--text-secondary)' }}>
                          {!r.summary || r.summary.excessMins === null ? '—' : `${r.summary.excessMins} min`}
                        </span>
                      </td>
                      <td>{statusBadge(r.status)}</td>
                      <td style={{ fontSize: '0.75rem', maxWidth: '14rem', color: trackingColor(r) }}>
                        {trackingLabel(r.tracking, formatTime)}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          {r.summary && (
                            <button
                              className="btn btn-outline"
                              style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem' }}
                              onClick={() => setSelectedKey(r.key)}
                            >
                              View Details
                            </button>
                          )}
                          {r.summary && r.summary.activeCount > 0 && r.attendanceId && (
                            <button
                              className="btn btn-warning"
                              style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                              title="Force end active break"
                              disabled={actionLoading}
                              onClick={() => {
                                const activeSess = r.summary!.sessions.find(sess => sess.state === 'ACTIVE');
                                if (activeSess?.id) handleEndBreak(activeSess.id, r.attendanceId!);
                              }}
                            >
                              <StopCircle size={13} />
                              End Break
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Details Pane */}
        {selectedDetails && selectedDetails.summary && (() => {
          const d = selectedDetails;
          const sum = d.summary!;
          return (
          <div className="card" style={{ alignSelf: 'start', position: 'sticky', top: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <FileText size={18} />
                Break Details
              </h3>
              <button className="icon-button" onClick={() => setSelectedKey(null)}>×</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
              <div style={{ paddingBottom: '0.75rem', borderBottom: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Employee</div>
                <div style={{ fontWeight: 600, fontSize: '1.125rem' }}>{d.employee?.first_name} {d.employee?.last_name}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  {d.employee?.employee_code} · Attendance {d.attendanceId} ({d.attendance?.attendance_date}) · {d.shiftName || 'Standard'} · Clock in {formatTime(d.attendance?.clock_in_at ?? null)}{d.attendance?.clock_out_at ? ` · Clock out ${formatTime(d.attendance.clock_out_at)}` : ''}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Allowed Break</div>
                  <div style={{ fontWeight: 600 }}>{mins(sum.allowedMins)}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Total Used (live)</div>
                  <div style={{ fontWeight: 600, color: (sum.excessMins || 0) > 0 ? 'var(--danger)' : 'inherit' }}>{sum.breaksUnavailable ? 'Not loaded' : `${sum.totalMins} min${sum.activeCount > 0 ? ' (in progress)' : ''}`}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Excess</div>
                  <div style={{ fontWeight: 600, color: (sum.excessMins || 0) > 0 ? 'var(--danger)' : 'inherit' }}>{sum.excessMins === null ? '—' : `${sum.excessMins} min`}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Stored (payroll)</div>
                  <div style={{ fontWeight: 600 }}>{storedCell(d)}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Deduction</div>
                  <div style={{ fontWeight: 600, color: d.isDeductionApplicable ? 'var(--danger)' : 'var(--text-secondary)' }}>
                    {d.isDeductionApplicable ? 'Applicable (calculated in Payroll)' : 'Not applicable'}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Location tracking</div>
                  <div style={{ fontWeight: 600, fontSize: '0.8125rem', color: trackingColor(d) }}>{trackingLabel(d.tracking, formatTime)}</div>
                </div>
              </div>
            </div>

            {(sum.notes.length > 0 || (sum.activeCount > 0 && ['STALE', 'LOCATION_PROBLEM', 'NO_DATA'].includes(d.tracking.state))) && (
              <div role="note" style={{ marginBottom: '1rem', padding: '0.75rem', border: '1px solid var(--warning)', borderRadius: 'var(--radius-md)', fontSize: '0.8125rem' }}>
                {sum.notes.map((n, i) => <div key={i}>{n}</div>)}
                {sum.activeCount > 0 && ['STALE', 'LOCATION_PROBLEM', 'NO_DATA'].includes(d.tracking.state) && (
                  <div>This employee's location is not updating, so a return to the office cannot be detected. The break stays open until a return is detected, the employee clocks out, or an admin ends it.</div>
                )}
              </div>
            )}
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              Total = sum of each session (end − start, whole minutes); an active break counts up to now. Excess = max(0, total − allowed). Stored = attendance break minutes used by payroll, written when a break ends or at clock-out.
            </div>

            <h4 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '1rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Sessions</h4>
            {sum.sessions.length === 0 && (
              <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{sum.breaksUnavailable ? 'Break sessions could not be loaded for this attendance day.' : 'No break sessions were recorded for this attendance day.'}</div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {sum.sessions.map((session, i) => (
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
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', marginBottom: session.id ? '0.75rem' : '0' }}>
                    <div>
                      {formatTime(session.started_at)} → {session.state === 'ACTIVE' ? 'Now' : formatTime(session.ended_at)}
                      {session.break_type === 'AUTO_GPS' && <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}> · automatic (GPS)</span>}
                      {session.id && session.id in d.gapReturns && (
                        <div style={{ fontSize: '0.7rem', color: 'var(--warning)' }}>
                          Return seen only after a tracking gap (last location before: {formatTime(d.gapReturns[session.id])}). The actual return may have been earlier.
                        </div>
                      )}
                    </div>
                    <div style={{ fontWeight: 600 }}>
                      {session.minutes === null ? (session.invalidReason || '—') : `${session.minutes} min`}
                    </div>
                  </div>
                  {session.id && d.attendanceId && (
                    <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', paddingTop: '0.5rem', borderTop: '1px solid var(--border-color)' }}>
                      {session.state === 'ACTIVE' && (
                        <button
                          className="btn btn-warning"
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                          disabled={actionLoading}
                          onClick={() => handleEndBreak(session.id!, d.attendanceId!)}
                        >
                          <StopCircle size={13} />
                          End Now
                        </button>
                      )}
                      <button
                        className="btn btn-outline"
                        style={{
                          padding: '0.25rem 0.5rem',
                          fontSize: '0.75rem',
                          color: 'var(--danger)',
                          borderColor: 'rgba(239, 68, 68, 0.4)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.25rem'
                        }}
                        disabled={actionLoading}
                        title="Discard this session and recalculate excess"
                        onClick={() => handleDeleteBreak(session.id!, d.attendanceId!)}
                      >
                        <Trash2 size={13} />
                        Discard Session
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

          </div>
          );
        })()}

      </div>
    </div>
  );
};

export default AdminBreaks;
