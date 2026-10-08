import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Search } from 'lucide-react';
import { liveKpiPredicate, locationStatusLabel, isLocationStale, type LiveTrackingKpi } from '../../services/location/liveTrackingRules';
import { computeWorkTimer } from '../../services/attendance/breakRules';
import { COMPANY_TIMEZONE, companyDateStr } from '../../utils/companyDate';

/**
 * Live Tracking KPI detail modal. Rows are filtered ONLY with liveKpiPredicate — the same
 * predicate that produces the KPI card count — so count == rows. Same look as the Attendance KPI modal.
 */

const TITLES: Record<LiveTrackingKpi, string> = {
  CURRENTLY_WORKING: 'CURRENTLY WORKING', IN_OFFICE: 'IN OFFICE', WFH: 'WFH EMPLOYEES', OUTSIDE_GEOFENCE: 'OUTSIDE GEOFENCE',
};
const EMPTY: Record<LiveTrackingKpi, string> = {
  CURRENTLY_WORKING: 'No employees are currently working.',
  IN_OFFICE: 'No employees are currently inside the office geofence.',
  WFH: 'No employees are working from home today.',
  OUTSIDE_GEOFENCE: 'No employees are currently outside the office geofence.',
};

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: COMPANY_TIMEZONE }) : '--');
const hms = (s: number | null) => {
  if (s === null || s === undefined) return '--';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
};
const ago = (iso: string | null, now: number) => {
  if (!iso) return '';
  const m = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`;
};
const coord = (v: number | null) => (v === null || v === undefined ? '--' : Number(v).toFixed(6));

type Col = { label: string; render: (r: any, now: number) => React.ReactNode };

const C: Record<string, Col> = {
  employee: { label: 'Employee', render: r => <strong>{r.name}</strong> },
  empId: { label: 'Employee ID', render: r => r.empId },
  dept: { label: 'Department', render: r => (r.department === '-' ? '--' : r.department) },
  office: { label: 'Office', render: r => (r.office === '-' ? '--' : r.office) },
  shift: { label: 'Shift', render: r => <>{r.shift}<div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{r.shiftTime}</div></> },
  clockIn: { label: 'Clock In', render: r => time(r.clockInAt) },
  working: { label: 'Working Duration', render: (r, now) => (r.attendance ? hms(computeWorkTimer(r.attendance, r.breaks, now).workSeconds) : '--') },
  status: { label: 'Current Status', render: r => <span className={`badge ${r.status === 'On Break' ? 'badge-warning' : r.status === 'Outside Geofence' ? 'badge-danger' : 'badge-success'}`}>{String(r.status).toUpperCase()}</span> },
  locStatus: { label: 'Location Status', render: (r, now) => locationStatusLabel(r, now) },
  lastGps: { label: 'Last GPS Update', render: (r, now) => (r.lastSeenAt ? <>{time(r.lastSeenAt)}<div style={{ fontSize: '0.7rem', color: isLocationStale(r, now) ? 'var(--warning)' : 'var(--text-secondary)' }}>{ago(r.lastSeenAt, now)}</div></> : '--') },
  lat: { label: 'Latitude', render: r => coord(r.lat) },
  lng: { label: 'Longitude', render: r => coord(r.lng) },
  accuracy: { label: 'GPS Accuracy', render: r => (r.accuracy != null ? `±${Math.round(r.accuracy)} m` : '--') },
  distance: { label: 'Distance from Office', render: r => (r.distanceMeters != null ? `${Math.round(r.distanceMeters)} m` : '--') },
  geofence: { label: 'Geofence Status', render: (r, now) => (r.workMode === 'WFH' ? 'Not applicable (WFH)' : !r.geofence ? '--' : `${r.geofence === 'INSIDE' ? 'Inside' : r.geofence === 'OUTSIDE' ? 'Outside' : r.geofence}${isLocationStale(r, now) ? ' (stale)' : ''}`) },
  outside: { label: 'Outside Geofence', render: r => <span className="badge badge-danger">OUTSIDE{r.officeRadius ? ` ${r.officeRadius} m RADIUS` : ''}</span> },
  leftAt: { label: 'Time Since Leaving', render: (r, now) => (r.leftGeofenceAt ? <>{ago(r.leftGeofenceAt, now)}<div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>left {time(r.leftGeofenceAt)}</div></> : '--') },
  breakStatus: { label: 'Break Status', render: r => (r.activeBreak ? (r.activeBreak.break_type === 'AUTO_GPS' ? 'On automatic break' : 'On break') : 'No active break') },
  breakDur: { label: 'Break Duration', render: (r, now) => (r.activeBreak ? hms(Math.floor((now - new Date(r.activeBreak.started_at).getTime()) / 1000)) : '--') },
  mode: { label: 'Work Mode', render: r => r.workMode },
  wfhStatus: { label: 'WFH Approval', render: r => (r.wfhApproved ? 'APPROVED' : '--') },
  wfhDate: { label: 'Approved WFH Date', render: () => companyDateStr() },
  attStatus: { label: 'Attendance Status', render: r => (r.attendanceStatus ? String(r.attendanceStatus).replace('_', ' ') : 'Not clocked in') },
  lastActivity: { label: 'Last Activity', render: (r, now) => (r.lastActivity ? <>{r.lastActivity.label}<div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{time(r.lastActivity.at)} · {ago(r.lastActivity.at, now)}</div></> : '--') },
};

const COLUMNS: Record<LiveTrackingKpi, Col[]> = {
  CURRENTLY_WORKING: [C.employee, C.empId, C.dept, C.office, C.shift, C.clockIn, C.working, C.status, C.locStatus, C.lastGps, C.lat, C.lng, C.accuracy, C.geofence, C.breakStatus, C.breakDur, C.mode, C.lastActivity],
  IN_OFFICE: [C.employee, C.empId, C.dept, C.office, C.shift, C.clockIn, C.locStatus, C.lastGps, C.lat, C.lng, C.accuracy, C.distance, C.geofence, C.breakStatus, C.lastActivity],
  WFH: [C.employee, C.empId, C.dept, C.office, C.wfhStatus, C.wfhDate, C.mode, C.shift, C.attStatus, C.clockIn, C.lastActivity],
  OUTSIDE_GEOFENCE: [C.employee, C.empId, C.dept, C.office, C.shift, C.clockIn, C.outside, C.lastGps, C.lat, C.lng, C.accuracy, C.distance, C.leftAt, C.breakStatus, C.lastActivity],
};

interface Props {
  kpi: LiveTrackingKpi;
  rows: any[];
  nowMs: number;
  expectedCount: number;
  onClose: () => void;
  onViewEmployee?: (row: any) => void;
}

const LiveTrackingKpiModal: React.FC<Props> = ({ kpi, rows, nowMs, expectedCount, onClose, onViewEmployee }) => {
  const [search, setSearch] = useState('');
  const [now, setNow] = useState(Date.now());
  const closeRef = useRef<HTMLButtonElement>(null);

  // Same predicate + same reference time as the card count
  const kpiRows = useMemo(() => rows.filter(liveKpiPredicate(kpi, nowMs)), [rows, kpi, nowMs]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? kpiRows.filter(r => r.name.toLowerCase().includes(q) || String(r.empId).toLowerCase().includes(q)) : kpiRows;
  }, [kpiRows, search]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const t = setInterval(() => setNow(Date.now()), 1000); // live durations only
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; clearInterval(t); };
  }, [onClose]);

  if (kpiRows.length !== expectedCount) console.error(`[Live Tracking KPI] ${kpi}: modal rows ${kpiRows.length} != card ${expectedCount}`);
  const cols = COLUMNS[kpi];

  return (
    <div className="kpi-modal-overlay" onClick={onClose} data-testid="live-kpi-modal">
      <div className="kpi-modal" role="dialog" aria-modal="true" aria-labelledby="live-kpi-title" onClick={e => e.stopPropagation()}>
        <div className="kpi-modal-header">
          <div>
            <h2 id="live-kpi-title" style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>{TITLES[kpi]}</h2>
            <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
              <span data-testid="live-kpi-count">{kpiRows.length} {kpiRows.length === 1 ? 'Employee' : 'Employees'}</span> • Today
            </div>
          </div>
          <button ref={closeRef} className="icon-button" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        {kpiRows.length > 5 && (
          <div style={{ padding: '0.75rem 1.25rem', borderBottom: '1px solid var(--border-color)' }}>
            <div style={{ position: 'relative', maxWidth: '320px' }}>
              <Search size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
              <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search employees..." className="form-control" style={{ paddingLeft: '2.25rem', fontSize: '0.875rem' }} aria-label="Search employees by name or ID" />
            </div>
          </div>
        )}
        <div className="kpi-modal-body">
          {kpiRows.length === 0 ? (
            <div style={{ padding: '3rem 1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>{EMPTY[kpi]}</div>
          ) : shown.length === 0 ? (
            <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>No employees match “{search}”.</div>
          ) : (
            <table className="table kpi-modal-table" style={{ width: '100%' }}>
              <thead><tr>{cols.map(c => <th key={c.label} style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>{c.label}</th>)}{onViewEmployee && <th />}</tr></thead>
              <tbody>
                {shown.map(r => (
                  <tr key={r.id} data-testid="live-kpi-row">
                    {cols.map(c => <td key={c.label} data-label={c.label}>{c.render(r, now)}</td>)}
                    {onViewEmployee && <td data-label=""><button className="btn btn-outline" style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }} onClick={() => onViewEmployee(r)}>View</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="kpi-modal-footer"><button className="btn btn-outline" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
};

export default LiveTrackingKpiModal;
