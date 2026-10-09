import { useDepartments } from '../../hooks/useDepartments';
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { employeeService } from '../../services/employees/employeeService';
import { rosterService } from '../../services/shifts/rosterService';
import { cellFromForm, cellFromAssignment } from '../../services/shifts/rosterRules';
import { rosterToday, weekRange, monthRange, navigate as moveAnchor, dayLabel } from '../../services/shifts/rosterDates';
import { 
  CalendarDays, Calendar, ChevronLeft, ChevronRight, Search, 
  Filter, MoreVertical, X, CheckCircle2, AlertTriangle, Users, 
  Eye, Edit, Copy, Trash2, Moon, Lock, Unlock, UploadCloud,
  Check, History, Clock, MapPin, Sun
} from 'lucide-react';

const AdminRoster: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [employees, setEmployees] = useState<any[]>([]);
  const [shifts, setShifts] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  
  const [rosterData, setRosterData] = useState<any>({});
  const [viewMode, setViewMode] = useState('Week');
  // Saved roster for the visible week (rosters / roster_assignments) and every saved entry in view
  const [periodRoster, setPeriodRoster] = useState<any>(null);
  const [rosterEntries, setRosterEntries] = useState<Record<string, Record<string, any>>>({});
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [rosterBusy, setRosterBusy] = useState(false);
  const status = periodRoster?.status === 'PUBLISHED' ? 'Published' : 'Draft';
  const [isLocked, setIsLocked] = useState(false);
  
  const [search, setSearch] = useState('');
  const [filterDept, setFilterDept] = useState('All');
  const { departments, loading: deptLoading } = useDepartments();
  
  // Modals & Drawers
  const [assignModal, setAssignModal] = useState<any>(null); 
  const [conflictModal, setConflictModal] = useState<any>(null); 
  const [bulkModal, setBulkModal] = useState(false);
  const [copyModal, setCopyModal] = useState(false);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [rotationModal, setRotationModal] = useState(false);
  const [historyModal, setHistoryModal] = useState(false);
  const [empDrawer, setEmpDrawer] = useState<any>(null);
  const [dayDrawer, setDayDrawer] = useState<string | null>(null);

  // Form State
  const [formData, setFormData] = useState<any>({});

  // Date State
  // Company date (Asia/Kolkata) the view is anchored on — a plain YYYY-MM-DD string, never a local-clock Date
  const [anchorDate, setAnchorDate] = useState<string>(() => rosterToday());

  const fetchData = async () => {
    setLoading(true);
    const [empRes, shiftRes, assignRes] = await Promise.all([
      employeeService.getEmployees(),
      employeeService.getShifts(),
      employeeService.getShiftAssignments()
    ]);
    
    if (empRes.data) {
      setEmployees(empRes.data.map((e: any) => ({
        id: e.id,
        empCode: e.employee_code || '-',
        name: `${e.first_name} ${e.last_name}`,
        dept: e.department?.name || 'Unassigned',
          department_id: e.department_id || null,
        office: e.office?.name || '-'
      })));
    }
    
    if (shiftRes.data) {
      setShifts(shiftRes.data);
    }
    
    if (assignRes.data) {
      setAssignments(assignRes.data);
      const newRoster: any = {};
      assignRes.data.forEach((a: any) => {
        if (!newRoster[a.employee_id]) newRoster[a.employee_id] = {};
        newRoster[a.employee_id][a.effective_date] = {
          shift: a.shift_template_id,
          mode: 'Office',
          shiftData: a.shift_templates
        };
      });
      setRosterData(newRoster);
    }
    setLoading(false);
  };

  const getEffectiveCellData = (empId: string, dateStr: string) => {
    // A saved roster entry for the date (WORK with shift + mode, or Week Off) wins over the default shift
    if (rosterEntries[empId]?.[dateStr]) {
      const r = rosterEntries[empId][dateStr];
      return r.shift ? { ...r, shiftData: shifts.find(s => s.id === r.shift) } : r;
    }
    if (rosterData[empId]?.[dateStr]) {
      return rosterData[empId][dateStr];
    }
    const empAssignments = assignments.filter(a => a.employee_id === empId && new Date(a.effective_date) <= new Date(dateStr));
    if (empAssignments.length > 0) {
      const mostRecent = empAssignments.sort((a, b) => new Date(b.effective_date).getTime() - new Date(a.effective_date).getTime())[0];
      return {
        shift: mostRecent.shift_template_id,
        mode: 'Office',
        shiftData: mostRecent.shift_templates
      };
    }
    return null;
  };

  useEffect(() => {

    
    
    fetchData();
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const filteredEmployees = useMemo(() => employees.filter(emp => {
    const matchesSearch = emp.name.toLowerCase().includes(search.toLowerCase()) || emp.empCode.toLowerCase().includes(search.toLowerCase());
    const matchesDept = filterDept === 'All' ? true : filterDept === 'Unassigned' ? emp.department_id === null : emp.department_id === filterDept;
    return matchesSearch && matchesDept;
  }), [employees, search, filterDept]);

  const getShiftDetails = (shiftId: string) => {
    const s = shifts.find(sh => sh.id === shiftId);
    if (!s) return null;
    return {
      name: s.name,
      time: `${s.start_time?.slice(0,5) || ''} - ${s.end_time?.slice(0,5) || ''}`,
      overnight: s.crosses_midnight || false
    };
  };

  const handleCellClick = (empId: string, date: string) => {
    if (isLocked) return showToast('Roster is locked. Unlock to make changes.');
    
    if (periodRoster?.status === 'PUBLISHED') return showToast('This roster is published. Unpublish it before making changes.');
    const existing = rosterEntries[empId]?.[date] || rosterData[empId]?.[date];
    if (existing?.type === 'Leave' || existing?.type === 'Holiday') {
      setConflictModal({ empId, date, type: existing.type });
    } else {
      setAssignModal({ empId, date, existing });
      if (existing?.type === 'Week Off') {
        setFormData({ shift: shifts[0]?.id || '', mode: 'Week Off' });
      } else if (existing?.shift) {
        setFormData({ shift: existing.shift, mode: existing.mode || 'Office' });
      } else {
        setFormData({ shift: shifts[0]?.id || '', mode: 'Office' });
      }
    }
  };

  const handleSaveAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.shift && formData.mode !== 'Week Off') return;
    
    const { empId, date } = assignModal;
    const cell = cellFromForm(formData.mode, formData.shift);
    if ('error' in cell) { showToast(cell.error); return; }
    // Saved to this week's roster (rosters / roster_assignments) — Week Off and WFH are stored too
    const { error } = await rosterService.saveCell(weekDates[0].date, weekDates[6].date, empId, date, cell);
    if (error) { showToast('Roster not saved: ' + error.message); return; }
    await loadRosters();
    setAssignModal(null);
    showToast(cell.dayType === 'WEEK_OFF' ? 'Week off saved to the draft roster' : 'Shift saved to the draft roster');
  };

  const handlePublish = async () => {
    if (!periodRoster) return showToast('Save at least one roster entry before publishing.');
    setRosterBusy(true);
    const { error } = await rosterService.publish(periodRoster.id);
    setRosterBusy(false);
    if (error) return showToast(error.message);
    await loadRosters();
    showToast('Roster published. Payroll now uses it for this week.');
  };

  const handleUnpublish = async () => {
    if (!periodRoster) return;
    setRosterBusy(true);
    const { error } = await rosterService.unpublish(periodRoster.id);
    setRosterBusy(false);
    if (error) return showToast(error.message);
    await loadRosters();
    showToast('Roster unpublished (back to draft).');
  };

  // Calendar Math — pure company-date strings (see services/shifts/rosterDates.ts)
  const monthInfo = monthRange(anchorDate);
  const year = monthInfo.year;
  const month = monthInfo.month - 1; // 0-based, as used by the month grid below
  const daysInMonth = monthInfo.daysInMonth;
  const firstDay = monthInfo.firstWeekdayIndex; // 0 = Mon, 6 = Sun
  
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  
  const handlePrev = () => setAnchorDate(a => moveAnchor(a, viewMode === 'Week' ? 'Week' : 'Month', -1));
  const handleNext = () => setAnchorDate(a => moveAnchor(a, viewMode === 'Week' ? 'Week' : 'Month', 1));
  const handleToday = () => setAnchorDate(rosterToday());

  // The roster week (Monday → Sunday) containing the anchor date — the same period for every visit
  const weekDates = weekRange(anchorDate).dates.map(ds => ({ date: ds, display: dayLabel(ds) }));

  // Visible range: the week in Grid view, the whole month in Calendar view
  const rangeStart = viewMode === 'Week' ? weekDates[0].date : `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const rangeEnd = viewMode === 'Week' ? weekDates[6].date : `${year}-${String(month + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

  const loadRosters = async () => {
    const [list, period] = await Promise.all([
      rosterService.getRosters(rangeStart, rangeEnd),
      rosterService.getPeriodRoster(weekDates[0].date, weekDates[6].date),
    ]);
    const err = list.error || period.error;
    setRosterError(err ? err.message : null);
    setPeriodRoster(period.roster);
    const map: Record<string, Record<string, any>> = {};
    for (const a of list.assignments) {
      const owner = list.rosters.find((r: any) => r.id === a.roster_id);
      (map[a.employee_id] ||= {})[String(a.assignment_date).slice(0, 10)] = { ...cellFromAssignment(a), rosterStatus: owner?.status };
    }
    setRosterEntries(map);
  };

  useEffect(() => { loadRosters(); }, [rangeStart, rangeEnd]); // eslint-disable-line react-hooks/exhaustive-deps

  const getDayAssignments = (dateStr: string) => {
    const dayAss: any = {};
    filteredEmployees.forEach(emp => {
      const cell = getEffectiveCellData(emp.id, dateStr);
      if (cell && cell.shift) {
         const s = getShiftDetails(cell.shift);
         if (s) {
           const key = s.name;
           if (!dayAss[key]) dayAss[key] = { count: 0, time: s.time, overnight: s.overnight, shiftId: cell.shift };
           dayAss[key].count++;
         }
      }
    });
    return dayAss;
  };

  const getEmployeesForDay = (dateStr: string) => {
    return filteredEmployees.map(emp => {
      const cell = getEffectiveCellData(emp.id, dateStr);
      if (cell && cell.shift) {
        return { emp, cell, details: getShiftDetails(cell.shift) };
      }
      return null;
    }).filter(Boolean);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', position: 'relative' }}>
      {toast && (
        <div style={{ position: 'fixed', top: '24px', left: '50%', transform: 'translateX(-50%)', backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)', padding: '0.75rem 1.5rem', borderRadius: 'var(--radius-full)', zIndex: 1000, display: 'flex', alignItems: 'center', gap: '0.5rem', boxShadow: 'var(--shadow-lg)', animation: 'slideDown 0.3s forwards' }}>
          <CheckCircle2 size={18} color="var(--success)" />
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="page-header" style={{ marginBottom: 0, flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: 'clamp(1.4rem, 2vw, 2rem)' }}>Shift Roster</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 'clamp(0.875rem, 0.3vw + 0.8rem, 1rem)', marginTop: '0.25rem' }}>Plan and manage employee shifts, work modes, and date-wise assignments.</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {isLocked ? (
            <button onClick={() => { setIsLocked(false); showToast('Roster unlocked'); }} className="btn btn-outline" style={{ color: 'var(--warning)', borderColor: 'var(--warning-300)', backgroundColor: 'var(--warning-50)' }}><Lock size={16}/> Locked</button>
          ) : (
            <button onClick={() => { setIsLocked(true); showToast('Roster locked successfully'); }} className="btn btn-outline"><Unlock size={16}/> Lock Roster</button>
          )}
          
          <div style={{ display: 'flex', backgroundColor: 'var(--gray-100)', borderRadius: 'var(--radius-md)', padding: '0.25rem' }}>
            <button onClick={() => setViewMode('Week')} className={`btn ${viewMode === 'Week' ? 'btn-primary' : ''}`} style={{ padding: '0.25rem 0.75rem', fontSize: '0.875rem', backgroundColor: viewMode === 'Week' ? 'var(--bg-surface-solid)' : 'transparent', color: viewMode === 'Week' ? 'var(--text-primary)' : 'var(--text-secondary)', border: 'none', boxShadow: viewMode === 'Week' ? 'var(--shadow-sm)' : 'none' }}>Grid View</button>
            <button onClick={() => setViewMode('Month')} className={`btn ${viewMode === 'Month' ? 'btn-primary' : ''}`} style={{ padding: '0.25rem 0.75rem', fontSize: '0.875rem', backgroundColor: viewMode === 'Month' ? 'var(--bg-surface-solid)' : 'transparent', color: viewMode === 'Month' ? 'var(--text-primary)' : 'var(--text-secondary)', border: 'none', boxShadow: viewMode === 'Month' ? 'var(--shadow-sm)' : 'none' }}>Calendar View</button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-surface)' }}>
            <button onClick={handlePrev} className="icon-button" style={{ borderRight: '1px solid var(--border-color)', borderRadius: 'var(--radius-md) 0 0 var(--radius-md)' }}><ChevronLeft size={18}/></button>
            <button onClick={handleToday} className="btn" style={{ backgroundColor: 'transparent', border: 'none', padding: '0.5rem 1rem', fontSize: '0.875rem', fontWeight: 600 }}>{monthNames[month]} {year}</button>
            <button onClick={handleNext} className="icon-button" style={{ borderLeft: '1px solid var(--border-color)', borderRadius: '0 var(--radius-md) var(--radius-md) 0' }}><ChevronRight size={18}/></button>
            <button onClick={handleToday} className="btn" style={{ backgroundColor: 'var(--bg-surface-elevated)', border: 'none', borderLeft: '1px solid var(--border-color)', padding: '0.5rem 1rem', fontSize: '0.875rem', borderRadius: '0 var(--radius-md) var(--radius-md) 0' }}>Today</button>
          </div>
          
          {status === 'Published' ? (
            <button onClick={handleUnpublish} className="btn btn-outline" style={{ fontSize: '0.875rem' }} disabled={rosterBusy} title="Return this week's roster to draft">
              <UploadCloud size={16}/> Published — Unpublish
            </button>
          ) : (
            <button onClick={handlePublish} className="btn btn-primary" style={{ fontSize: '0.875rem' }} disabled={rosterBusy || !periodRoster}>
              <UploadCloud size={16}/> Publish Roster
            </button>
          )}
        </div>
      </div>
      <div style={{ fontSize: '0.8125rem', color: rosterError ? 'var(--danger)' : 'var(--text-secondary)' }} role={rosterError ? 'alert' : undefined}>
        {rosterError
          ? `Roster data unavailable: ${rosterError}`
          : `Week ${weekDates[0].date} to ${weekDates[6].date}: ${periodRoster ? (periodRoster.status === 'PUBLISHED' ? `published${periodRoster.published_at ? ` ${new Date(periodRoster.published_at).toLocaleString('en-IN')}` : ''} — payroll uses this roster` : 'draft (not used by payroll until published)') : 'no roster saved yet — payroll uses the company working days'}.`}
      </div>

      {loading ? (
        <div className="skeleton-container" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '1rem' }}>
          {[...Array(6)].map((_, i) => <div key={i} className="skeleton" style={{ height: '70px', borderRadius: 'var(--radius-md)' }} />)}
        </div>
      ) : (() => {
        let scheduled = 0, morning = 0, evening = 0, night = 0, wfh = 0;
        let unassigned = 0;
        
        filteredEmployees.forEach(emp => {
          let hasAssignment = false;
          weekDates.forEach(d => {
            const cell = getEffectiveCellData(emp.id, d.date);
            if (cell && cell.shift) {
               hasAssignment = true;
               const type = cell.shiftData?.shift_type;
               if (type === 'MORNING') morning++;
               if (type === 'EVENING') evening++;
               if (type === 'NIGHT') night++;
               if (cell.mode === 'WFH') wfh++;
            }
          });
          if (hasAssignment) scheduled++; else unassigned++;
        });
        
        return (
        <div className="kpi-grid">
          <div className="tracking-kpi-card">
            <div className="sc-header"><div className="sc-icon"><Users size={16} /></div></div>
            <div className="sc-val">{scheduled}</div>
            <div className="sc-title">Scheduled</div>
          </div>
          <div className="tracking-kpi-card">
            <div className="sc-header"><div className="sc-icon" style={{ backgroundColor: 'var(--warning-50)', color: 'var(--warning-600)' }}><Sun size={16} /></div></div>
            <div className="sc-val" style={{ color: 'var(--warning)' }}>{morning}</div>
            <div className="sc-title">Morning</div>
          </div>
          <div className="tracking-kpi-card">
            <div className="sc-header"><div className="sc-icon" style={{ backgroundColor: 'var(--primary-50)', color: 'var(--primary-600)' }}><Clock size={16} /></div></div>
            <div className="sc-val" style={{ color: 'var(--primary-700)' }}>{evening}</div>
            <div className="sc-title">Evening</div>
          </div>
          <div className="tracking-kpi-card">
            <div className="sc-header"><div className="sc-icon" style={{ backgroundColor: 'var(--purple-50)', color: 'var(--purple-600)' }}><Moon size={16} /></div></div>
            <div className="sc-val" style={{ color: 'var(--purple-700)' }}>{night}</div>
            <div className="sc-title">Night</div>
          </div>
          <div className="tracking-kpi-card">
            <div className="sc-header"><div className="sc-icon" style={{ backgroundColor: 'var(--success-50)', color: 'var(--success-600)' }}><MapPin size={16} /></div></div>
            <div className="sc-val" style={{ color: 'var(--success)' }}>{wfh}</div>
            <div className="sc-title">WFH</div>
          </div>
          <div className="tracking-kpi-card">
            <div className="sc-header"><div className="sc-icon" style={{ backgroundColor: 'var(--gray-100)', color: 'var(--text-secondary)' }}><AlertTriangle size={16} /></div></div>
            <div className="sc-val" style={{ color: 'var(--text-primary)' }}>{unassigned}</div>
            <div className="sc-title">Unassigned</div>
          </div>
        </div>
        );
      })()}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {/* Toolbar */}
        <div style={{ padding: '1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', flex: 1 }}>
            <div style={{ position: 'relative', width: '220px' }}>
              <Search size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
              <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search employee..." className="form-control" style={{ paddingLeft: '2.25rem', fontSize: '0.875rem' }} />
            </div>
            <select value={filterDept} onChange={e => setFilterDept(e.target.value)} className="form-control" style={{ width: 'auto', fontSize: '0.875rem' }}>
              <option value="All">All Departments</option>
              {deptLoading ? (
                <option disabled>Loading...</option>
              ) : (
                <>
                  {departments.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                  <option value="Unassigned">Unassigned</option>
                </>
              )}
            </select>
            <button className="btn btn-outline" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}><Filter size={14} style={{ marginRight: '0.25rem' }}/> More Filters</button>
            {(search || filterDept !== 'All') && (
              <button onClick={() => { setSearch(''); setFilterDept('All'); }} className="btn btn-outline" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>Clear</button>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <div className="dropdown" style={{ position: 'relative' }}>
              <button className="btn btn-outline" style={{ fontSize: '0.875rem' }} onClick={() => setActiveMenu(activeMenu === 'actions' ? null : 'actions')}>
                Roster Actions <MoreVertical size={14} style={{ marginLeft: '0.25rem' }}/>
              </button>
              {activeMenu === 'actions' && (
                <div className="dropdown-menu" style={{ position: 'absolute', right: 0, top: '100%', marginTop: '0.25rem', zIndex: 10, background: 'var(--bg-surface-solid)', borderColor: 'var(--border-color)' }}>
                  <button onClick={() => { setActiveMenu(null); setBulkModal(true); }} className="dropdown-item"><Users size={14}/> Bulk Assign</button>
                  <button onClick={() => { setActiveMenu(null); setCopyModal(true); }} className="dropdown-item"><Copy size={14}/> Copy Previous Week</button>
                  <button onClick={() => { setActiveMenu(null); setRotationModal(true); }} className="dropdown-item"><CalendarDays size={14}/> Create Rotation Pattern</button>
                  <div className="dropdown-divider" style={{ backgroundColor: 'var(--border-color)' }}></div>
                  <button onClick={() => { setActiveMenu(null); setHistoryModal(true); }} className="dropdown-item"><History size={14}/> Roster History</button>
                </div>
              )}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="skeleton" style={{ height: '400px', margin: '1rem' }} />
        ) : filteredEmployees.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
            <Users size={48} style={{ margin: '0 auto 1rem auto', opacity: 0.3 }} />
            <h3 style={{ fontSize: '1.125rem', color: 'var(--text-primary)' }}>No employees found</h3>
            <p style={{ marginTop: '0.5rem' }}>Try changing your filters or search criteria.</p>
          </div>
        ) : (
          viewMode === 'Week' ? (
            <div className="roster-container">
              <div className="desktop-roster">
                <table className="roster-table">
                  <thead>
                    <tr>
                      <th className="sticky-col">Employee</th>
                      {weekDates.map(d => (
                        <th key={d.date} style={{ textAlign: 'center', minWidth: '130px' }}>{d.display}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEmployees.map(emp => (
                      <tr key={emp.id}>
                        <td className="sticky-col" onClick={() => setEmpDrawer(emp)} style={{ cursor: 'pointer' }}>
                          <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 'clamp(0.85rem, 0.5vw + 0.5rem, 1rem)' }}>{emp.name}</div>
                          <div style={{ fontSize: 'clamp(0.7rem, 0.3vw + 0.5rem, 0.8rem)', color: 'var(--text-secondary)' }}>{emp.empCode} • {emp.dept}</div>
                        </td>
                        {weekDates.map(d => {
                          const cellData = getEffectiveCellData(emp.id, d.date);
                          return (
                            <td key={d.date} className="roster-cell" onClick={() => handleCellClick(emp.id, d.date)}>
                              {cellData ? (
                                cellData.type === 'Leave' || cellData.type === 'Holiday' || cellData.type === 'Week Off' ? (
                                  <div className={`roster-badge ${cellData.type === 'Leave' ? 'bg-leave' : cellData.type === 'Holiday' ? 'bg-holiday' : 'bg-gray'}`}>
                                    {cellData.type}
                                  </div>
                                ) : (
                                  <div className={`roster-shift ${getShiftDetails(cellData.shift)?.overnight ? 'bg-overnight' : 'bg-normal'}`}>
                                    <div className="shift-name">{getShiftDetails(cellData.shift)?.name}</div>
                                    <div className="shift-time">
                                      {getShiftDetails(cellData.shift)?.time} 
                                      {getShiftDetails(cellData.shift)?.overnight && <span style={{ color: 'var(--purple-700)', fontWeight: 600 }}> +1d</span>}
                                    </div>
                                    <div className={`shift-mode ${cellData.mode === 'WFH' ? 'text-primary' : 'text-gray'}`}>{cellData.mode}</div>
                                  </div>
                                )
                              ) : (
                                <div className="roster-empty">+ Assign</div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="calendar-container">
              <div className="calendar-grid">
                {['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map(day => (
                  <div key={day} className="cal-header">{day}</div>
                ))}
                
                {Array.from({ length: firstDay }).map((_, i) => (
                  <div key={`empty-${i}`} className="cal-cell empty"></div>
                ))}
                
                {Array.from({ length: daysInMonth }).map((_, i) => {
                  const day = i + 1;
                  const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
                  const isToday = rosterToday() === dateStr;
                  const dayAss = getDayAssignments(dateStr);
                  const keys = Object.keys(dayAss);
                  const hasMore = keys.length > 3;
                  const displayKeys = keys.slice(0, 3);
                  
                  return (
                    <div key={day} className={`cal-cell ${isToday ? 'today' : ''}`} onClick={() => setDayDrawer(dateStr)}>
                      <div className="cal-date">{day}</div>
                      <div className="cal-shifts">
                        {displayKeys.map(k => (
                          <div key={k} className={`cal-shift-pill ${dayAss[k].overnight ? 'pill-purple' : 'pill-primary'}`}>
                            <span className="cal-s-name">{k}</span>
                            <span className="cal-s-count">{dayAss[k].count}</span>
                          </div>
                        ))}
                        {hasMore && (
                          <div className="cal-more">+{keys.length - 3} more</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )
        )}
      </div>

      {dayDrawer && (
        <div className="drawer-overlay" onClick={() => setDayDrawer(null)}>
          <div className="drawer wide-drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Assignments for {dayLabel(dayDrawer, { day: 'numeric', month: 'short', year: 'numeric' })}</h2>
              <button className="icon-button" onClick={() => setDayDrawer(null)}><X size={20} /></button>
            </div>
            <div className="drawer-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {getEmployeesForDay(dayDrawer).length === 0 ? (
                  <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '2rem 0' }}>No shifts assigned.</div>
                ) : (
                  getEmployeesForDay(dayDrawer).map((data: any, idx: number) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '1rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-surface)' }}>
                      <div>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{data.emp.name}</div>
                        <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{data.emp.empCode} • {data.emp.dept}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 600, color: data.details.overnight ? 'var(--purple-700)' : 'var(--primary-700)' }}>
                          {data.details.name} {data.details.overnight && '+1d'}
                        </div>
                        <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{data.details.time}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{data.cell.mode}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {assignModal && (
        <div className="modal-overlay" onClick={() => setAssignModal(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <h2 className="modal-title">{assignModal.existing ? 'Edit Shift' : 'Assign Shift'}</h2>
            <p className="modal-subtitle">For {employees.find(e => e.id === assignModal.empId)?.name} on {assignModal.date}</p>
            
            <form onSubmit={handleSaveAssign} style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label className="form-label">Shift Template</label>
                <select className="form-control" value={formData.shift} onChange={e => setFormData({...formData, shift: e.target.value})} disabled={formData.mode === 'Week Off'}>
                  {shifts.map(s => (
                    <option key={s.id} value={s.id}>{s.name} ({s.start_time?.slice(0,5)} - {s.end_time?.slice(0,5)})</option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="form-label">Work Mode / Exception</label>
                <select className="form-control" value={formData.mode} onChange={e => setFormData({...formData, mode: e.target.value})}>
                  <option>Office</option>
                  <option>WFH</option>
                  <option>Week Off</option>
                </select>
              </div>
              
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
                <button type="button" className="btn btn-outline" onClick={() => setAssignModal(null)} style={{ flex: 1 }}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>Save</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style>{`
        .roster-container { width: 100%; overflow-x: auto; }
        .desktop-roster { display: block; }
        
        .roster-table { width: 100%; border-collapse: collapse; min-width: 900px; }
        .roster-table th { background-color: var(--bg-surface-elevated); border: 1px solid var(--border-color); padding: 0.75rem; font-size: clamp(0.75rem, 0.4vw + 0.65rem, 1rem); text-transform: uppercase; color: var(--text-secondary); font-weight: 600; }
        .roster-table td { border: 1px solid var(--border-color); padding: 0.5rem; vertical-align: top; }
        
        .sticky-col { position: sticky; left: 0; background-color: var(--bg-surface-solid); z-index: 2; border-right: 2px solid var(--border-strong) !important; min-width: 150px; }
        .roster-table th.sticky-col { background-color: var(--bg-surface-elevated); z-index: 3; }
        
        .roster-cell { height: 70px; cursor: pointer; transition: background-color 0.1s; position: relative; }
        .roster-cell:hover { background-color: var(--bg-glass-hover); }
        
        .roster-shift { padding: 0.5rem; border-radius: var(--radius-sm); border-left: 3px solid transparent; height: 100%; display: flex; flex-direction: column; gap: 0.25rem; }
        .roster-shift.bg-normal { background-color: var(--primary-50); border-left-color: var(--primary-500); }
        .roster-shift.bg-overnight { background-color: var(--purple-50); border-left-color: var(--purple-500); }
        .shift-name { font-size: clamp(0.75rem, 0.4vw + 0.65rem, 1rem); font-weight: 600; color: var(--text-primary); }
        .shift-time { font-size: clamp(0.65rem, 0.3vw + 0.5rem, 0.8rem); color: var(--text-secondary); }
        .shift-mode { font-size: 0.7rem; font-weight: 600; text-transform: uppercase; }
        .text-primary { color: var(--primary-700); }
        .text-gray { color: var(--text-secondary); }
        
        .roster-empty { height: 100%; display: flex; align-items: center; justify-content: center; color: transparent; font-size: 0.75rem; font-weight: 500; transition: color 0.2s; }
        .roster-cell:hover .roster-empty { color: var(--text-secondary); }
        
        /* Calendar CSS */
        .calendar-container { padding: 1rem; }
        .calendar-grid {
          display: grid;
          grid-template-columns: repeat(7, minmax(0, 1fr));
          gap: 1px;
          background-color: var(--border-color);
          border: 1px solid var(--border-color);
          border-radius: var(--radius-md);
          overflow: hidden;
        }
        .cal-header {
          background-color: var(--bg-surface-elevated);
          padding: 0.75rem;
          text-align: center;
          font-weight: 600;
          font-size: clamp(0.75rem, 0.4vw + 0.65rem, 1rem);
          color: var(--text-secondary);
        }
        .cal-cell {
          background-color: var(--bg-surface-solid);
          min-height: 120px;
          padding: 0.5rem;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          cursor: pointer;
          transition: background-color 0.2s;
        }
        .cal-cell:hover { background-color: var(--bg-glass-hover); }
        .cal-cell.empty { background-color: var(--bg-secondary); cursor: default; }
        .cal-cell.today { background-color: var(--primary-50); }
        .cal-date { font-weight: 600; font-size: clamp(0.875rem, 0.5vw + 0.75rem, 1rem); color: var(--text-primary); }
        .cal-cell.today .cal-date { color: var(--primary-600); }
        .cal-shifts { display: flex; flex-direction: column; gap: 0.25rem; }
        .cal-shift-pill {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.25rem 0.5rem;
          border-radius: var(--radius-sm);
          font-size: clamp(0.65rem, 0.3vw + 0.55rem, 0.8rem);
          font-weight: 500;
        }
        .pill-primary { background-color: var(--primary-100); color: var(--primary-700); }
        .pill-purple { background-color: var(--purple-100); color: var(--purple-700); }
        .cal-s-count { background: rgba(0,0,0,0.1); padding: 0.1rem 0.3rem; border-radius: var(--radius-sm); }
        .cal-more { font-size: 0.7rem; color: var(--text-muted); text-align: center; font-weight: 500; }

        .dropdown-menu { background: var(--bg-surface-solid); border: 1px solid var(--border-color); border-radius: var(--radius-md); box-shadow: var(--shadow-lg); padding: 0.5rem 0; min-width: 180px; }
        .dropdown-item { width: 100%; text-align: left; padding: 0.5rem 1rem; font-size: 0.875rem; display: flex; align-items: center; gap: 0.5rem; background: none; border: none; cursor: pointer; color: var(--text-primary); }
        .dropdown-item:hover { background-color: var(--bg-glass-hover); color: var(--text-primary); }

        .drawer-overlay { position: fixed; inset: 0; background-color: rgba(0,0,0,0.4); z-index: 100; display: flex; justify-content: flex-end; }
        .drawer { background-color: var(--bg-surface-solid); width: 100%; height: 100%; display: flex; flex-direction: column; box-shadow: var(--shadow-xl); animation: slideInRight 0.3s forwards; }
        .wide-drawer { max-width: min(520px, 100vw); }
        .drawer-header { padding: 1.5rem; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: flex-start; }
        .drawer-body { padding: 1.5rem; overflow-y: auto; flex: 1; }
        
        @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes slideDown { from { transform: translate(-50%, -100%); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }

        @media (max-width: 900px) {
          .cal-cell { min-height: 80px; padding: 0.25rem; }
          .cal-shift-pill { flex-direction: column; text-align: center; gap: 0.1rem; padding: 0.25rem; }
          .cal-s-name { font-size: 0.65rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
        }
      `}</style>
    </div>
  );
};

export default AdminRoster;
