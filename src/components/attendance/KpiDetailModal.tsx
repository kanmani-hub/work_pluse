import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Search } from 'lucide-react';
import { KPI_PREDICATES, KPI_LABELS, KPI_EMPTY_MESSAGES, formatTime, type AttendanceKpiFilter } from '../../services/attendance/adminAttendanceRules';

/**
 * Admin Attendance KPI detail modal.
 * Rows are the page's rows for the selected date; they are filtered ONLY with KPI_PREDICATES,
 * the same predicates that produce the KPI counts, so the modal count always equals the card.
 */

type Column = { key: string; label: string; render: (r: any) => React.ReactNode };

const dash = (v: any) => (v === null || v === undefined || v === '' || v === '--:--' ? '--' : v);
const shiftStart = (r: any) => (r.shiftTime && r.shiftTime !== '- - -' ? r.shiftTime.split(' - ')[0] : '--');
const halfDayReason = (r: any) =>
  r.leave?.isHalfDay
    ? `Half-day leave${r.leave.halfDayType ? ` (${String(r.leave.halfDayType).replace('_', ' ').toLowerCase()})` : ''}`
    : 'Worked under 50% of required hours';
const breakStatus = (r: any) => (r.status === 'ON_BREAK' ? 'On break' : 'No active break');
const locationStatus = (r: any) => {
  if (!r.lastLocationAt) return 'No location today';
  const s = r.lastLocationStatus === 'INSIDE_GEOFENCE' ? 'Inside office'
    : r.lastLocationStatus === 'OUTSIDE_GEOFENCE' ? 'Outside office'
    : r.lastLocationStatus === 'LOW_ACCURACY' ? 'Low GPS accuracy'
    : r.lastLocationStatus === 'WFH' ? 'WFH' : (r.lastLocationStatus || 'Unknown');
  return r.locationStale ? `${s} (stale)` : s;
};

const C = {
  employee: { key: 'employee', label: 'Employee', render: (r: any) => <strong>{r.name}</strong> },
  empId: { key: 'empId', label: 'Employee ID', render: (r: any) => r.empId },
  dept: { key: 'dept', label: 'Department', render: (r: any) => dash(r.dept === '-' ? null : r.dept) },
  office: { key: 'office', label: 'Office', render: (r: any) => dash(r.office === '-' ? null : r.office) },
  shift: { key: 'shift', label: 'Shift', render: (r: any) => <>{r.shift}<div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{r.shiftTime !== '- - -' ? r.shiftTime : ''}{r.overnight ? ' +1d' : ''}</div></> },
  mode: { key: 'mode', label: 'Work Mode', render: (r: any) => dash(r.mode === '-' ? null : r.mode) },
  clockIn: { key: 'clockIn', label: 'Clock In', render: (r: any) => dash(r.clockIn) },
  clockOut: { key: 'clockOut', label: 'Clock Out', render: (r: any) => <>{dash(r.clockOut)}{r.missingOut && <div style={{ fontSize: '0.7rem', color: 'var(--danger)', fontWeight: 600 }}>MISSING</div>}</> },
  hours: { key: 'hours', label: 'Working Hours', render: (r: any) => dash(r.workHours === '-' ? null : r.workHours) },
  late: { key: 'late', label: 'Late', render: (r: any) => dash(r.late === '-' ? null : r.late) },
  early: { key: 'early', label: 'Early', render: (r: any) => dash(r.early === '-' ? null : r.early) },
  status: { key: 'status', label: 'Status', render: (r: any) => <span className="badge badge-gray">{r.status === 'ON_BREAK' ? 'ON BREAK' : r.status}</span> },
  expectedStart: { key: 'expectedStart', label: 'Expected Shift Start', render: shiftStart },
  scheduledStart: { key: 'scheduledStart', label: 'Scheduled Start', render: shiftStart },
  actualIn: { key: 'actualIn', label: 'Actual Clock In', render: (r: any) => dash(r.clockIn) },
  lateMins: { key: 'lateMins', label: 'Late Minutes', render: (r: any) => `${r.late_minutes} min` },
  leaveType: { key: 'leaveType', label: 'Leave Type', render: (r: any) => r.leave?.type ?? '--' },
  leaveDate: { key: 'leaveDate', label: 'Leave Date', render: (_r: any, ) => '' },
  leaveStatus: { key: 'leaveStatus', label: 'Leave Status', render: () => 'APPROVED' }, // KPI only includes approved leave
  wfhDate: { key: 'wfhDate', label: 'WFH Date', render: () => '' },
  halfReason: { key: 'halfReason', label: 'Half Day Reason', render: halfDayReason },
  hoursSoFar: { key: 'hoursSoFar', label: 'Working Hours So Far', render: (r: any) => dash(r.workHours === '-' ? null : r.workHours) },
  breakStatus: { key: 'breakStatus', label: 'Break Status', render: breakStatus },
  locStatus: { key: 'locStatus', label: 'Location Status', render: locationStatus },
  lastLoc: { key: 'lastLoc', label: 'Last Location', render: (r: any) => (r.lastLocationAt ? formatTime(r.lastLocationAt) : '--') },
  currentStatus: { key: 'currentStatus', label: 'Current Status', render: (r: any) => <span className={`badge ${r.status === 'ON_BREAK' ? 'badge-warning' : 'badge-success'}`}>{r.status === 'ON_BREAK' ? 'ON BREAK' : 'WORKING'}</span> },
} satisfies Record<string, Column>;

function columnsFor(k: AttendanceKpiFilter, dateLabel: string): Column[] {
  const withDate = (col: Column): Column => ({ ...col, render: () => dateLabel });
  switch (k) {
    case 'ALL': return [C.employee, C.empId, C.dept, C.office, C.shift, C.mode, C.clockIn, C.clockOut, C.hours, C.late, C.early, C.status];
    case 'PRESENT': return [C.employee, C.empId, C.dept, C.office, C.shift, C.clockIn, C.clockOut, C.hours, C.status];
    case 'ABSENT': return [C.employee, C.empId, C.dept, C.office, C.shift, C.expectedStart, C.clockIn, C.clockOut, C.status];
    case 'LATE': return [C.employee, C.empId, C.dept, C.office, C.shift, C.scheduledStart, C.actualIn, C.lateMins, C.status];
    case 'ON_LEAVE': return [C.employee, C.empId, C.dept, C.leaveType, withDate(C.leaveDate), C.leaveStatus];
    case 'WFH': return [C.employee, C.empId, C.dept, withDate(C.wfhDate), C.shift, C.mode, C.status];
    case 'HALF_DAY': return [C.employee, C.empId, C.dept, C.office, C.shift, C.clockIn, C.clockOut, C.hours, C.halfReason, C.status];
    case 'CURRENTLY_WORKING': return [C.employee, C.empId, C.dept, C.office, C.shift, C.clockIn, C.hoursSoFar, C.mode, C.breakStatus, C.locStatus, C.lastLoc, C.currentStatus];
  }
}

interface Props {
  kpi: AttendanceKpiFilter;
  rows: any[];
  expectedCount: number;
  dateLabel: string;
  onClose: () => void;
}

const KpiDetailModal: React.FC<Props> = ({ kpi, rows, expectedCount, dateLabel, onClose }) => {
  const [search, setSearch] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);
  const kpiRows = useMemo(() => rows.filter(KPI_PREDICATES[kpi]), [rows, kpi]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? kpiRows.filter(r => r.name.toLowerCase().includes(q) || String(r.empId).toLowerCase().includes(q)) : kpiRows;
  }, [kpiRows, search]);
  const columns = columnsFor(kpi, dateLabel);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; // only the modal scrolls
    closeRef.current?.focus();
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prevOverflow; };
  }, [onClose]);

  if (kpiRows.length !== expectedCount) {
    console.error(`[KPI] ${kpi}: modal rows ${kpiRows.length} != KPI count ${expectedCount}`);
  }

  return (
    <div className="kpi-modal-overlay" onClick={onClose} data-testid="kpi-detail-modal">
      <div className="kpi-modal" role="dialog" aria-modal="true" aria-labelledby="kpi-modal-title" onClick={e => e.stopPropagation()}>
        <div className="kpi-modal-header">
          <div>
            <h2 id="kpi-modal-title" style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>{KPI_LABELS[kpi].toUpperCase()}{kpi === 'ALL' ? '' : ' EMPLOYEES'}</h2>
            <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
              <span data-testid="kpi-modal-count">{kpiRows.length} {kpiRows.length === 1 ? 'Employee' : 'Employees'}</span> • {dateLabel}
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
            <div style={{ padding: '3rem 1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>{KPI_EMPTY_MESSAGES[kpi]}</div>
          ) : shown.length === 0 ? (
            <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>No employees match “{search}”.</div>
          ) : (
            <table className="table kpi-modal-table" style={{ width: '100%' }}>
              <thead>
                <tr>{columns.map(c => <th key={c.key} style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>{c.label}</th>)}</tr>
              </thead>
              <tbody>
                {shown.map(r => (
                  <tr key={r.id} data-testid="kpi-modal-row">
                    {columns.map(c => <td key={c.key} data-label={c.label}>{c.render(r)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="kpi-modal-footer">
          <button className="btn btn-outline" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};

export default KpiDetailModal;
