import React, { useState, useEffect, useRef } from 'react';
import { useGlobalSettings } from '../../services/settings/globalSettingsService';
import { breakService } from '../../services/attendance/breakService';
import { realtimeService } from '../../services/realtime/realtimeService';
import { FileText, Trash2, StopCircle, AlertCircle } from 'lucide-react';
import { buildBreakReportRows, matchesReportFilter, REPORT_STATUS_LABEL, API_ROW_LIMIT, type BreakReportStatus, type BreakReportRow } from '../../services/attendance/breakReportRules';
import { COMPANY_TIMEZONE, companyDateStr, previousDateStr } from '../../utils/companyDate';
import { resolveStaleMinutes } from '../../services/location/trackingStatus';
import { useAuth } from '../../context/AuthContext';
import { isAdminPortalRole } from '../../lib/roles';
import TrackingStatus from '../../components/tracking/TrackingStatus';
import './breakManagement.css';

/** At this width and below the details panel opens as a dialog over the list (not beside it). */
const DETAILS_DIALOG_QUERY = '(max-width: 1024px)';

const AdminBreaks: React.FC = () => {
  const { settings } = useGlobalSettings();
  const { role } = useAuth();
  // Same roles the /admin routes allow; the server still decides whether the change is permitted.
  const canEndBreaks = isAdminPortalRole(role);
  const appSettings = settings.app;
  const payrollSettings = settings.payroll;

  const [breaks, setBreaks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  // Break being ended right now: its buttons show "Ending…" and stay disabled. The ref blocks a
  // second request synchronously (a double tap can arrive before React re-renders).
  const [endingBreakId, setEndingBreakId] = useState<string | null>(null);
  const endingRef = useRef<string | null>(null);
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

  // Tracking applies to today, and to yesterday while an overnight shift is still open
  const tracksDate = (d: string) => { const t = companyDateStr(); return d === t || d === previousDateStr(t); };
  const staleMinutes = resolveStaleMinutes(appSettings?.trackingStaleMinutes);
  const loadContext = async () => {
    const ctx = await breakService.getBreakReportContext(filterDate, tracksDate(filterDate));
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
    if (!canEndBreaks || endingRef.current) return;
    endingRef.current = breakId;
    if (!window.confirm('Are you sure you want to end this active break now?')) { endingRef.current = null; return; }
    setEndingBreakId(breakId);
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
      endingRef.current = null;
      setEndingBreakId(null);
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

  const handleCorrectBreak = async (breakId: string, attendanceId: string) => {
    const reason = window.prompt('Enter reason for correcting this tracking enforcement break:');
    if (reason === null) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      setActionNotice({ type: 'error', text: 'A correction reason is required.' });
      return;
    }
    setActionLoading(true);
    setActionNotice(null);
    try {
      const { success, error } = await breakService.correctTrackingEnforcementBreak({
        breakId,
        attendanceId,
        correctionReason: trimmed,
      });
      if (!success) {
        setActionNotice({ type: 'error', text: `Failed to correct break: ${error?.message || 'Unknown error'}` });
      } else if (error) {
        setActionNotice({ type: 'error', text: error.message });
        await fetchBreaks(true);
      } else {
        setActionNotice({ type: 'success', text: 'Tracking break corrected and totals recalculated.' });
        await fetchBreaks();
      }
    } catch (e: any) {
      setActionNotice({ type: 'error', text: e.message || 'Error correcting break' });
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
    const trackingTimer = setInterval(() => { if (tracksDate(filterDate)) loadContext(); }, 60000);
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
    staleMinutes,
  }).map(r => ({
    ...r,
    isDeductionApplicable: (r.summary?.excessMins || 0) > 0 && !!payrollSettings?.enableBreakOverrunDeduction,
  })), [breaks, context, filterDate, appSettings, payrollSettings, nowMs, staleMinutes]);

  // Apply Filters
  const filteredSummary = reportRows.filter(r => matchesReportFilter(r.status, filterStatus));
  const counts = {
    withAttendance: reportRows.filter(r => r.attendanceId).length,
    onBreak: reportRows.filter(r => r.status === 'ON_BREAK').length,
    noAttendance: reportRows.filter(r => r.status === 'NO_ATTENDANCE').length,
    trackingIssues: reportRows.filter(r => ['STALE', 'LOCATION_PROBLEM', 'NO_DATA'].includes(r.tracking.state)).length,
  };

  const selectedDetails = reportRows.find(r => r.key === selectedKey);

  // Narrow screens: the details panel is a dialog over the list. On wide screens it stays beside the
  // table as before. Focus moves into the panel when it opens and back to its trigger when it closes.
  const [detailsAsDialog, setDetailsAsDialog] = useState(() => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(DETAILS_DIALOG_QUERY).matches);
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(DETAILS_DIALOG_QUERY);
    const onChange = () => setDetailsAsDialog(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  const detailsTriggerRef = useRef<HTMLElement | null>(null);
  const detailsHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const openDetails = (key: string, trigger: HTMLElement) => { detailsTriggerRef.current = trigger; setSelectedKey(key); };
  const closeDetails = () => {
    setSelectedKey(null);
    const trigger = detailsTriggerRef.current;
    detailsTriggerRef.current = null;
    if (trigger?.isConnected) requestAnimationFrame(() => trigger.focus());
  };
  // As a dialog it is a .modal-overlay, so the app-wide dialog behaviour applies (role="dialog",
  // Escape = backdrop click, Tab kept inside, focus returned) — see useOverlayDialogA11y.
  useEffect(() => { if (selectedKey) detailsHeadingRef.current?.focus({ preventScroll: !detailsAsDialog }); }, [selectedKey]);

  const employeeName = (r: BreakReportRow) => [r.employee?.first_name, r.employee?.last_name].filter(Boolean).join(' ') || 'employee';
  const activeSessionOf = (r: BreakReportRow) => r.summary?.sessions.find(sess => sess.state === 'ACTIVE' && sess.id) ?? null;

  const formatTime = (isoString: string | null) => {
    if (!isoString || !Number.isFinite(new Date(isoString).getTime())) return '—';
    return new Date(isoString).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: COMPANY_TIMEZONE });
  };
  const mins = (v: number | null) => (v === null ? 'Not configured' : `${v} min`);
  const statusBadge = (st: BreakReportStatus) => {
    const cls = st === 'ON_BREAK' ? 'badge-warning' : st === 'EXCESS' ? 'badge-danger' : (st === 'UNVERIFIED' || st === 'NO_ATTENDANCE') ? 'badge-gray' : 'badge-success';
    return <span className={`badge ${cls}`}>{REPORT_STATUS_LABEL[st]}</span>;
  };
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
              onChange={(e) => setFilterDate(e.target.value)} aria-label="Date" />
          </div>
          <div style={{ flex: 1, minWidth: '200px' }}>
            <label className="form-label">Status Filter</label>
            <select className="form-select" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} aria-label="Status Filter">
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
          <button type="button" aria-label="Dismiss message" className="break-notice-close" style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: '1.25rem' }} onClick={() => setActionNotice(null)}>×</button>
        </div>
      )}

      <div className={`break-layout${selectedDetails && !detailsAsDialog ? ' has-details' : ''}`} style={{ display: 'grid', gridTemplateColumns: selectedDetails && !detailsAsDialog ? '2fr 1fr' : '1fr', gap: '1.5rem' }}>

        {/* Main Table — a table on tablets/desktop, one card per employee on phones (same cells, labelled) */}
        <div className="card break-table-card">
          <div className="table-responsive">
            <table className="table break-table" role="table" aria-label="Employee breaks">
              <thead role="rowgroup">
                <tr role="row">
                  <th role="columnheader" scope="col">Employee</th>
                  <th role="columnheader" scope="col">Shift</th>
                  <th role="columnheader" scope="col">Allowed</th>
                  <th role="columnheader" scope="col">Break Time (live)</th>
                  <th role="columnheader" scope="col">Completed</th>
                  <th role="columnheader" scope="col" title="attendance.break_minutes: the value payroll uses">Stored (payroll)</th>
                  <th role="columnheader" scope="col">Excess</th>
                  <th role="columnheader" scope="col">Status</th>
                  <th role="columnheader" scope="col">Tracking</th>
                  <th role="columnheader" scope="col">Actions</th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {loading ? (
                  <tr role="row" className="bt-message-row">
                    <td role="cell" colSpan={10} style={{ textAlign: 'center', padding: '3rem' }}>
                      <div className="spinner" style={{ margin: '0 auto' }}></div>
                    </td>
                  </tr>
                ) : loadError ? (
                  <tr role="row" className="bt-message-row">
                    <td role="cell" colSpan={10} style={{ textAlign: 'center', padding: '3rem', color: 'var(--danger)' }}>
                      <span role="alert">Break records could not be loaded: {loadError}</span>
                    </td>
                  </tr>
                ) : filteredSummary.length === 0 ? (
                  <tr role="row" className="bt-message-row">
                    <td role="cell" colSpan={10} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                      {reportRows.length === 0 ? 'No employees or attendance records for this date.' : 'No employees match this status filter.'}
                    </td>
                  </tr>
                ) : (
                  filteredSummary.map(r => {
                    const activeSess = activeSessionOf(r);
                    const canEndThis = canEndBreaks && !!activeSess?.id && !!r.attendanceId;
                    const isEnding = !!activeSess?.id && endingBreakId === activeSess.id;
                    return (
                    <tr role="row" key={r.key} className={`bt-row bt-row--${r.status.toLowerCase()}`}>
                      <td role="cell" className="bt-employee" data-label="Employee">
                        <div className="bt-name">{r.employee?.first_name} {r.employee?.last_name}</div>
                        <div className="bt-sub">{r.employee?.employee_code}{r.employee?.departments?.name ? ` • ${r.employee.departments.name}` : ''}{r.attendanceId ? ` • Att ${r.attendanceId.slice(0, 8)}` : ''}</div>
                      </td>
                      <td role="cell" className="bt-shift" data-label="Shift">
                        {r.attendance
                          ? <span className="badge badge-primary">{r.shiftName || 'Standard'}</span>
                          : <span style={{ color: 'var(--text-secondary)' }}>—</span>}
                      </td>
                      <td role="cell" className="bt-num" data-label="Allowed">{r.summary ? mins(r.summary.allowedMins) : '—'}</td>
                      <td role="cell" className="bt-num" data-label="Break time (live)">
                        {!r.summary ? (
                          <span style={{ color: 'var(--text-secondary)' }}>—</span>
                        ) : r.summary.breaksUnavailable ? (
                          <span style={{ color: 'var(--danger)' }} title={r.summary.notes[0]}>Not loaded</span>
                        ) : (
                          <>
                            <span style={{ fontWeight: 600, color: (r.summary.excessMins || 0) > 0 ? 'var(--danger)' : 'inherit' }}>
                              {r.summary.totalMins} min
                            </span>
                            {r.summary.activeCount > 0 && <div className="bt-note" style={{ color: 'var(--warning)' }}>in progress</div>}
                            {r.summary.sessions.length > 0 && <div className="bt-note">{r.summary.sessions.length} session{r.summary.sessions.length === 1 ? '' : 's'}{r.firstStartAt ? ` · ${formatTime(r.firstStartAt)} → ${r.summary.activeCount > 0 ? 'now' : formatTime(r.lastEndAt)}` : ''}</div>}
                            {Object.keys(r.gapReturns).length > 0 && <div className="bt-note" style={{ color: 'var(--warning)' }} title="The return was only seen after the phone stopped reporting; the actual return may have been earlier">return seen after tracking gap</div>}
                          </>
                        )}
                      </td>
                      <td role="cell" className="bt-num" data-label="Completed">
                        {!r.summary || r.summary.breaksUnavailable ? <span style={{ color: 'var(--text-secondary)' }}>—</span> : `${r.summary.completedMins} min`}
                      </td>
                      <td role="cell" className="bt-num" data-label="Stored (payroll)">{storedCell(r)}</td>
                      <td role="cell" className="bt-num" data-label="Excess">
                        <span style={{ fontWeight: 600, color: (r.summary?.excessMins || 0) > 0 ? 'var(--danger)' : 'var(--text-secondary)' }}>
                          {!r.summary || r.summary.excessMins === null ? '—' : `${r.summary.excessMins} min`}
                        </span>
                      </td>
                      <td role="cell" className="bt-status" data-label="Status">{statusBadge(r.status)}</td>
                      <td role="cell" className="bt-tracking" data-label="Tracking">
                        <TrackingStatus tracking={r.tracking} nowMs={nowMs} staleMinutes={staleMinutes} />
                      </td>
                      <td role="cell" className="bt-actions" data-label="Actions">
                        <div className="bt-action-group">
                          {r.summary && (
                            <button
                              type="button"
                              className="btn btn-outline bt-action"
                              aria-label={`View break details for ${employeeName(r)}`}
                              onClick={(e) => openDetails(r.key, e.currentTarget)}
                            >
                              View Details
                            </button>
                          )}
                          {canEndThis && (
                            <button
                              type="button"
                              className="btn btn-warning bt-action"
                              title="Force end active break"
                              aria-label={`End active break for ${employeeName(r)}`}
                              disabled={actionLoading || isEnding}
                              aria-busy={isEnding || undefined}
                              onClick={() => handleEndBreak(activeSess!.id!, r.attendanceId!)}
                            >
                              <StopCircle size={14} aria-hidden={true} />
                              {isEnding ? 'Ending…' : 'End Break'}
                            </button>
                          )}
                          {!r.summary && <span className="bt-no-action" aria-hidden="true">—</span>}
                        </div>
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Details Pane */}
        {selectedDetails && selectedDetails.summary && (() => {
          const d = selectedDetails;
          const sum = d.summary!;
          const pane = (
          <div className="card break-details-pane" style={{ alignSelf: 'start', position: 'sticky', top: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3 ref={detailsHeadingRef} tabIndex={-1} className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <FileText size={18} aria-hidden={true} />
                Break Details
              </h3>
              <button type="button" className="icon-button" aria-label="Close break details" onClick={closeDetails}>×</button>
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
                <div style={{ gridColumn: '1 / -1' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Location tracking</div>
                  <TrackingStatus tracking={d.tracking} nowMs={nowMs} staleMinutes={staleMinutes} expanded />
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
                      {session.started_at ? formatTime(session.started_at) : '—'} → {session.state === 'ACTIVE' ? 'Now' : formatTime(session.ended_at)}
                      {session.break_type === 'AUTO_GPS' && <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}> · automatic (GPS)</span>}
                      {session.break_type === 'AUTO_TRACKING' && <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}> · automatic (tracking enforcement)</span>}
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
                  {session.id && d.attendanceId && canEndBreaks && (
                    <div className="bt-action-group bt-session-actions" style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', paddingTop: '0.5rem', borderTop: '1px solid var(--border-color)' }}>
                      {session.state === 'ACTIVE' && (
                        <button
                          type="button"
                          className="btn btn-warning bt-action"
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                          disabled={actionLoading || endingBreakId === session.id}
                          aria-busy={endingBreakId === session.id || undefined}
                          onClick={() => handleEndBreak(session.id!, d.attendanceId!)}
                        >
                          <StopCircle size={13} aria-hidden={true} />
                          {endingBreakId === session.id ? 'Ending…' : 'End Now'}
                        </button>
                      )}
                      {session.break_type === 'AUTO_TRACKING' && (
                        <button
                          type="button"
                          className="btn btn-outline bt-action"
                          style={{
                            padding: '0.25rem 0.5rem',
                            fontSize: '0.75rem',
                            color: 'var(--primary)',
                            borderColor: 'var(--primary)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.25rem'
                          }}
                          disabled={actionLoading}
                          title="Correct erroneous tracking enforcement break with an auditable reason"
                          onClick={() => handleCorrectBreak(session.id!, d.attendanceId!)}
                        >
                          <FileText size={13} />
                          Correct Break
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-outline bt-action"
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
          // Narrow screens: shown as a dialog over the list (clicking the backdrop closes it)
          return detailsAsDialog ? (
            <div className="modal-overlay break-details-overlay" onClick={(e) => { if (e.target === e.currentTarget) closeDetails(); }}>
              {pane}
            </div>
          ) : pane;
        })()}

      </div>
    </div>
  );
};

export default AdminBreaks;
