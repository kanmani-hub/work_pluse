import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { employeeService } from '../../services/employees/employeeService';
import { 
  CalendarDays, Calendar, ChevronLeft, ChevronRight, Search, 
  Filter, MoreVertical, X, CheckCircle2, AlertTriangle, Users, 
  Eye, Edit, Copy, Trash2, Moon, Lock, Unlock, UploadCloud,
  Check, History, Clock, MapPin, Sun
} from 'lucide-react';

// Removed mockShifts


const initialRoster: any = {};

const weekDates = [
  { date: '2026-09-22', display: 'Mon 22' },
  { date: '2026-09-23', display: 'Tue 23' },
  { date: '2026-09-24', display: 'Wed 24' },
  { date: '2026-09-25', display: 'Thu 25' },
  { date: '2026-09-26', display: 'Fri 26' },
  { date: '2026-09-27', display: 'Sat 27' },
  { date: '2026-09-28', display: 'Sun 28' },
];

const AdminRoster: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [employees, setEmployees] = useState<any[]>([]);
  const [shifts, setShifts] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  
  const [rosterData, setRosterData] = useState(initialRoster);
  const [viewMode, setViewMode] = useState('Week');
  const [status, setStatus] = useState('Draft');
  const [isLocked, setIsLocked] = useState(false);
  
  const [search, setSearch] = useState('');
  const [filterDept, setFilterDept] = useState('All');
  
  // Modals & Drawers
  const [assignModal, setAssignModal] = useState<any>(null); // { empId, date, existing }
  const [conflictModal, setConflictModal] = useState<any>(null); 
  const [bulkModal, setBulkModal] = useState(false);
  const [copyModal, setCopyModal] = useState(false);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [rotationModal, setRotationModal] = useState(false);
  const [historyModal, setHistoryModal] = useState(false);
  const [empDrawer, setEmpDrawer] = useState<any>(null);

  // Form State
  const [formData, setFormData] = useState<any>({});

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
        office: e.office?.name || '-'
      })));
    }
    
    if (shiftRes.data) {
      setShifts(shiftRes.data);
    }
    
    if (assignRes.data) {
      setAssignments(assignRes.data);
      // We store all assignments in rosterData for quick lookup, but the UI should resolve effective dates
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
    // Exact match for the date (e.g. Leave, Holiday overrides could exist here later)
    if (rosterData[empId]?.[dateStr]) {
      return rosterData[empId][dateStr];
    }
    // Fallback to the most recent 'PERMANENT' assignment before or on this date
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

  const filteredEmployees = employees.filter(emp => {
    const matchesSearch = emp.name.toLowerCase().includes(search.toLowerCase()) || emp.id.toLowerCase().includes(search.toLowerCase());
    const matchesDept = filterDept === 'All' || emp.dept === filterDept;
    return matchesSearch && matchesDept;
  });

  const getShiftDetails = (shiftId: string) => {
    const s = shifts.find(sh => sh.id === shiftId);
    if (!s) return null;
    return {
      name: s.name,
      time: `${s.start_time?.slice(0,5) || ''} - ${s.end_time?.slice(0,5) || ''}`,
      overnight: false // Simplified for now since schema might not have is_night_shift
    };
  };

  const handleCellClick = (empId: string, date: string) => {
    if (isLocked) return showToast('Roster is locked. Unlock to make changes.');
    
    const existing = rosterData[empId]?.[date];
    if (existing?.type === 'Leave' || existing?.type === 'Holiday') {
      setConflictModal({ empId, date, type: existing.type });
    } else {
      setAssignModal({ empId, date, existing });
      if (existing?.shift) {
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
    
    if (formData.mode !== 'Week Off') {
      const { error } = await employeeService.assignShift(empId, formData.shift, date);
      if (error) {
        showToast('Error saving shift: ' + error.message);
        return;
      }
    }
    
    await fetchData();
    setAssignModal(null);
    showToast(assignModal.existing ? 'Shift assignment updated' : 'Shift assigned successfully');
  };

  const handleRemoveAssign = () => {
    const { empId, date } = assignModal;
    const newRoster = { ...rosterData };
    if (newRoster[empId] && newRoster[empId][date]) {
      delete newRoster[empId][date];
    }
    setRosterData(newRoster);
    setAssignModal(null);
    showToast('Assignment removed');
  };

  const handlePublish = () => {
    setStatus('Published');
    showToast('Roster published successfully');
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
          <h1 className="page-title">Shift Roster</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>Plan and manage employee shifts, work modes, and date-wise assignments.</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {isLocked ? (
            <button onClick={() => { setIsLocked(false); showToast('Roster unlocked'); }} className="btn btn-outline" style={{ color: 'var(--warning)', borderColor: 'var(--warning-300)', backgroundColor: 'var(--warning-50)' }}><Lock size={16}/> Locked</button>
          ) : (
            <button onClick={() => { setIsLocked(true); showToast('Roster locked successfully'); }} className="btn btn-outline"><Unlock size={16}/> Lock Roster</button>
          )}
          
          <div style={{ display: 'flex', backgroundColor: 'var(--gray-100)', borderRadius: 'var(--radius-md)', padding: '0.25rem' }}>
            <button onClick={() => setViewMode('Week')} className={`btn ${viewMode === 'Week' ? 'btn-primary' : ''}`} style={{ padding: '0.25rem 0.75rem', fontSize: '0.875rem', backgroundColor: viewMode === 'Week' ? 'var(--bg-surface)' : 'transparent', color: viewMode === 'Week' ? 'var(--gray-900)' : 'var(--gray-600)', border: 'none', boxShadow: viewMode === 'Week' ? 'var(--shadow-sm)' : 'none' }}>Week</button>
            <button onClick={() => setViewMode('Month')} className={`btn ${viewMode === 'Month' ? 'btn-primary' : ''}`} style={{ padding: '0.25rem 0.75rem', fontSize: '0.875rem', backgroundColor: viewMode === 'Month' ? 'var(--bg-surface)' : 'transparent', color: viewMode === 'Month' ? 'var(--gray-900)' : 'var(--gray-600)', border: 'none', boxShadow: viewMode === 'Month' ? 'var(--shadow-sm)' : 'none' }}>Month</button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)' }}>
            <button className="icon-button" style={{ borderRight: '1px solid var(--border-color)', borderRadius: 'var(--radius-md) 0 0 var(--radius-md)' }}><ChevronLeft size={18}/></button>
            <button className="btn" style={{ backgroundColor: 'var(--bg-surface-elevated)', border: 'none', padding: '0.5rem 1rem', fontSize: '0.875rem', fontWeight: 600 }}>Today</button>
            <button className="icon-button" style={{ borderLeft: '1px solid var(--border-color)', borderRadius: '0 var(--radius-md) var(--radius-md) 0' }}><ChevronRight size={18}/></button>
          </div>
          
          <button onClick={handlePublish} className="btn btn-primary" style={{ fontSize: '0.875rem' }} disabled={status === 'Published'}>
            <UploadCloud size={16}/> {status === 'Published' ? 'Published' : 'Publish Roster'}
          </button>
        </div>
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
          
          if (hasAssignment) {
            scheduled++;
          } else {
            unassigned++;
          }
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
            <div className="sc-val" style={{ color: 'var(--gray-700)' }}>{unassigned}</div>
            <div className="sc-title">Unassigned</div>
          </div>
        </div>
        );
      })()}

      {/* Main Roster Card */}
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
              <option>Development</option>
              <option>HR</option>
              <option>Finance</option>
              <option>Support</option>
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
                <div className="dropdown-menu" style={{ position: 'absolute', right: 0, top: '100%', marginTop: '0.25rem', zIndex: 10 }}>
                  <button onClick={() => { setActiveMenu(null); setBulkModal(true); }} className="dropdown-item"><Users size={14}/> Bulk Assign</button>
                  <button onClick={() => { setActiveMenu(null); setCopyModal(true); }} className="dropdown-item"><Copy size={14}/> Copy Previous Week</button>
                  <button onClick={() => { setActiveMenu(null); setRotationModal(true); }} className="dropdown-item"><CalendarDays size={14}/> Create Rotation Pattern</button>
                  <div className="dropdown-divider"></div>
                  <button onClick={() => { setActiveMenu(null); setHistoryModal(true); }} className="dropdown-item"><History size={14}/> Roster History</button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Roster Grid */}
        {loading ? (
          <div className="skeleton" style={{ height: '400px', margin: '1rem' }} />
        ) : filteredEmployees.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
            <Users size={48} style={{ margin: '0 auto 1rem auto', opacity: 0.3 }} />
            <h3 style={{ fontSize: '1.125rem', color: 'var(--text-primary)' }}>No employees found</h3>
            <p style={{ marginTop: '0.5rem' }}>Try changing your filters or search criteria.</p>
          </div>
        ) : (
          <div className="roster-container">
            {/* Desktop Table View */}
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
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{emp.name}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{emp.empCode} • {emp.dept}</div>
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
                                  {viewMode === 'Week' && (
                                    <>
                                      <div className="shift-time">
                                        {getShiftDetails(cellData.shift)?.time} 
                                        {getShiftDetails(cellData.shift)?.overnight && <span style={{ color: 'var(--purple-700)', fontWeight: 600 }}> +1d</span>}
                                      </div>
                                      <div className={`shift-mode ${cellData.mode === 'WFH' ? 'text-primary' : 'text-gray'}`}>{cellData.mode}</div>
                                    </>
                                  )}
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

            {/* Mobile Card View */}
            <div className="mobile-roster">
              <div style={{ padding: '1rem', backgroundColor: 'var(--gray-50)', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600 }}>Tue 23 Sep 2026</span>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button className="icon-button  border"><ChevronLeft size={16}/></button>
                  <button className="icon-button  border"><ChevronRight size={16}/></button>
                </div>
              </div>
              <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {filteredEmployees.map(emp => {
                  const cellData = getEffectiveCellData(emp.id, '2026-09-23');
                  return (
                    <div key={emp.id} className="card" style={{ padding: '1rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                        <div>
                          <div style={{ fontWeight: 600 }}>{emp.name}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{emp.empCode}</div>
                        </div>
                        <button onClick={() => setEmpDrawer(emp)} className="btn btn-outline" style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}>View Schedule</button>
                      </div>
                      
                      <div onClick={() => handleCellClick(emp.id, '2026-09-23')} style={{ border: '1px dashed var(--border-color)', borderRadius: 'var(--radius-md)', padding: '1rem', cursor: 'pointer', backgroundColor: cellData ? 'transparent' : 'var(--gray-50)' }}>
                        {cellData ? (
                          cellData.type === 'Leave' || cellData.type === 'Holiday' || cellData.type === 'Week Off' ? (
                            <div className="badge badge-gray" style={{ width: '100%', textAlign: 'center', padding: '0.5rem' }}>{cellData.type}</div>
                          ) : (
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div>
                                <div style={{ fontWeight: 600, color: getShiftDetails(cellData.shift)?.overnight ? 'var(--purple-700)' : 'var(--primary-700)' }}>{getShiftDetails(cellData.shift)?.name} Shift</div>
                                <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{getShiftDetails(cellData.shift)?.time} {getShiftDetails(cellData.shift)?.overnight && <span style={{ color: 'var(--purple-700)', fontSize: '0.75rem' }}>+1 Day</span>}</div>
                              </div>
                              <div style={{ textAlign: 'right' }}>
                                <div className="badge badge-gray">{cellData.mode}</div>
                                {cellData.mode === 'Office' && <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>{emp.office}</div>}
                              </div>
                            </div>
                          )
                        ) : (
                          <div style={{ textAlign: 'center', color: 'var(--primary-600)', fontWeight: 500 }}>+ Assign Shift</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Assign / Edit Assignment Drawer */}
      {assignModal && (
        <div className="drawer-overlay" onClick={() => setAssignModal(null)}>
          <div className="drawer wide-drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <div>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>{assignModal.existing ? 'Edit Assignment' : 'Assign Shift'}</h2>
                <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>{assignModal.date}</div>
              </div>
              <button className="icon-button" onClick={() => setAssignModal(null)}><X size={20} /></button>
            </div>
            
            <form onSubmit={handleSaveAssign} className="drawer-body" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              
              {assignModal.existing && (
                <div style={{ padding: '0.75rem', backgroundColor: 'var(--warning-50)', color: 'var(--warning-800)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.875rem' }}>
                  <AlertTriangle size={16} style={{ marginTop: '0.125rem' }} /> 
                  <div>
                    <strong>Warning:</strong> Changing this assignment may affect attendance and payroll calculations if the employee has already clocked in for this date.
                  </div>
                </div>
              )}

              <div>
                <label className="form-label">Work Mode</label>
                <select className="form-control" value={formData.mode || 'Office'} onChange={e => setFormData({...formData, mode: e.target.value})}>
                  <option>Office</option>
                  <option>WFH</option>
                  <option>Week Off</option>
                </select>
              </div>

              {formData.mode !== 'Week Off' && (
                <>
                  <div>
                    <label className="form-label">Shift *</label>
                    <select required className="form-control" value={formData.shift || ''} onChange={e => setFormData({...formData, shift: e.target.value})}>
                      {shifts.map(s => (
                        <option key={s.id} value={s.id}>{s.name} ({s.start_time?.slice(0,5)} - {s.end_time?.slice(0,5)})</option>
                      ))}
                    </select>
                  </div>

                  {formData.mode === 'Office' && (
                    <div>
                      <label className="form-label">Office Location</label>
                      <input className="form-control" value="Office" disabled style={{ backgroundColor: 'var(--gray-100)' }} />
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>Employee's default assigned office.</div>
                    </div>
                  )}
                  
                  {formData.shift === 's4' && (
                    <div style={{ padding: '1rem', backgroundColor: 'var(--purple-50)', border: '1px solid var(--purple-200)', borderRadius: 'var(--radius-md)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--purple-800)', fontWeight: 600, marginBottom: '0.5rem' }}>
                        <Moon size={16} /> Overnight Shift Warning
                      </div>
                      <p style={{ fontSize: '0.875rem', color: 'var(--purple-700)' }}>
                        This shift is configured as an overnight shift. The employee's working hours will span across midnight and conclude on the following calendar day.
                      </p>
                    </div>
                  )}
                </>
              )}

              <div>
                <label className="form-label">Notes (Optional)</label>
                <textarea className="form-control" rows={2} placeholder="Add any special instructions..."></textarea>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem', borderTop: '1px solid var(--gray-200)', paddingTop: '1.5rem' }}>
                {assignModal.existing ? (
                  <button type="button" onClick={handleRemoveAssign} className="btn btn-outline" style={{ color: 'var(--danger-600)', borderColor: 'var(--danger-300)' }}>Remove Assignment</button>
                ) : <div></div>}
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <button type="button" onClick={() => setAssignModal(null)} className="btn btn-outline">Cancel</button>
                  <button type="submit" className="btn btn-primary">{assignModal.existing ? 'Update Assignment' : 'Assign Shift'}</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Conflict Modal */}
      {conflictModal && (
        <div className="drawer-overlay" style={{ alignItems: 'center', zIndex: 120 }}>
          <div className="card" style={{ margin: 'auto', width: '100%', maxWidth: '450px', animation: 'slideUp 0.3s', borderTop: '4px solid var(--danger)' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <AlertTriangle size={20} color="var(--danger-600)" /> Schedule Conflict
            </h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--gray-700)', marginBottom: '1.5rem' }}>
              <strong>Employee</strong> has approved <strong>{conflictModal.type}</strong> on <strong>{conflictModal.date}</strong>.
            </p>
            <div style={{ backgroundColor: 'var(--gray-50)', padding: '1rem', borderRadius: 'var(--radius-md)', fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
              Assigning a shift will override the approved leave/holiday record in the roster visual. Are you sure you want to proceed?
            </div>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button type="button" onClick={() => setConflictModal(null)} className="btn btn-outline" style={{ flex: 1 }}>Cancel</button>
              <button onClick={() => { 
                setAssignModal({ empId: conflictModal.empId, date: conflictModal.date, existing: { type: conflictModal.type } }); 
                setFormData({ shift: 's2', mode: 'Office' });
                setConflictModal(null);
              }} className="btn btn-primary" style={{ flex: 1, backgroundColor: 'var(--danger-600)', borderColor: 'var(--danger-600)' }}>Override</button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk / Copy / Pattern Modals (Placeholders) */}
      {bulkModal && (
        <div className="drawer-overlay" style={{ alignItems: 'center' }}>
          <div className="card" style={{ margin: 'auto', width: '100%', maxWidth: '450px', animation: 'slideUp 0.3s' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem' }}>Bulk Assign Shifts</h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>Mock interaction for selecting multiple employees and dates.</p>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button onClick={() => setBulkModal(false)} className="btn btn-outline" style={{ flex: 1 }}>Cancel</button>
              <button onClick={() => { setBulkModal(false); showToast('Bulk assignment applied'); }} className="btn btn-primary" style={{ flex: 1 }}>Confirm</button>
            </div>
          </div>
        </div>
      )}

      {/* Copy Previous Week */}
      {copyModal && (
        <div className="drawer-overlay" style={{ alignItems: 'center' }}>
          <div className="card" style={{ margin: 'auto', width: '100%', maxWidth: '450px', animation: 'slideUp 0.3s' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem' }}>Copy Previous Week Roster</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
              <div style={{ backgroundColor: 'var(--gray-50)', padding: '1rem', borderRadius: 'var(--radius-md)' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Source</div>
                <div style={{ fontWeight: 600 }}>15 Sep 2026 - 21 Sep 2026</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>Destination</div>
                <div style={{ fontWeight: 600 }}>22 Sep 2026 - 28 Sep 2026</div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}><input type="checkbox" defaultChecked /> Copy shifts</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}><input type="checkbox" defaultChecked /> Copy work modes</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}><input type="checkbox" /> Skip existing assignments</label>
            </div>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button onClick={() => setCopyModal(false)} className="btn btn-outline" style={{ flex: 1 }}>Cancel</button>
              <button onClick={() => { setCopyModal(false); showToast("Previous week's roster copied successfully."); }} className="btn btn-primary" style={{ flex: 1 }}>Copy Roster</button>
            </div>
          </div>
        </div>
      )}

      {/* Employee Roster Drawer */}
      {empDrawer && (
        <div className="drawer-overlay" onClick={() => setEmpDrawer(null)}>
          <div className="drawer wide-drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header" style={{ paddingBottom: '1.5rem' }}>
              <div>
                <h2 style={{ fontSize: '1.5rem', fontWeight: 600 }}>{empDrawer.name}</h2>
                <div style={{ display: 'flex', gap: '1rem', fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                  <span>{empDrawer.id}</span>
                  <span>•</span>
                  <span>{empDrawer.dept}</span>
                </div>
              </div>
              <button className="icon-button" onClick={() => setEmpDrawer(null)}><X size={20} /></button>
            </div>
            
            <div className="drawer-body">
              <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '1rem' }}>This Week's Schedule</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {weekDates.map(d => {
                  const cellData = rosterData[empDrawer.id]?.[d.date];
                  return (
                    <div key={d.date} style={{ display: 'flex', alignItems: 'center', padding: '1rem', backgroundColor: 'var(--gray-50)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)' }}>
                      <div style={{ width: '100px' }}>
                        <div style={{ fontWeight: 600 }}>{d.display.split(' ')[0]}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{d.date.split('-').reverse().join('-')}</div>
                      </div>
                      <div style={{ flex: 1 }}>
                        {cellData ? (
                          cellData.type ? (
                            <span className={`badge ${cellData.type === 'Leave' ? 'badge-primary' : 'badge-gray'}`}>{cellData.type}</span>
                          ) : (
                            <div>
                              <div style={{ fontWeight: 600, color: getShiftDetails(cellData.shift)?.overnight ? 'var(--purple-700)' : 'var(--gray-900)' }}>
                                {getShiftDetails(cellData.shift)?.name} Shift
                              </div>
                              <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{getShiftDetails(cellData.shift)?.time} {getShiftDetails(cellData.shift)?.overnight && <span style={{ color: 'var(--purple-700)', fontSize: '0.75rem' }}>+1d</span>}</div>
                            </div>
                          )
                        ) : (
                          <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Unassigned</span>
                        )}
                      </div>
                      <div>
                        {cellData && !cellData.type && (
                          <span className="badge badge-gray">{cellData.mode}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* History Modal */}
      {historyModal && (
        <div className="drawer-overlay" onClick={() => setHistoryModal(false)}>
          <div className="drawer wide-drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Roster History</h2>
              <button className="icon-button" onClick={() => setHistoryModal(false)}><X size={20} /></button>
            </div>
            <div className="drawer-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <div style={{ display: 'flex', gap: '1rem', fontSize: '0.875rem' }}>
                  <div style={{ color: 'var(--text-secondary)', width: '60px' }}>Sep 24</div>
                  <div>
                    <div style={{ fontWeight: 500 }}>Published Week 39 Roster</div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>By Admin User</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '1rem', fontSize: '0.875rem' }}>
                  <div style={{ color: 'var(--text-secondary)', width: '60px' }}>Sep 23</div>
                  <div>
                    <div style={{ fontWeight: 500 }}>Updated Shift: Employee A → Night</div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>By HR Manager</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}


      <style>{`
        
        
        
        
        
        
        .summary-card-small:hover { transform: translateY(-2px); box-shadow: var(--shadow-sm); }
        
        
        
        
        
        .roster-container { width: 100%; overflow-x: auto; }
        .desktop-roster { display: block; }
        .mobile-roster { display: none; }
        
        .roster-table { width: 100%; border-collapse: collapse; min-width: 900px; }
        .roster-table th { background-color: var(--gray-50); border: 1px solid var(--border-color); padding: 0.75rem; font-size: 0.75rem; text-transform: uppercase; color: var(--gray-600); font-weight: 600; }
        .roster-table td { border: 1px solid var(--border-color); padding: 0.5rem; vertical-align: top; }
        
        .sticky-col { position: sticky; left: 0; background-color: white; z-index: 2; border-right: 2px solid var(--gray-200) !important; min-width: 150px; }
        .roster-table th.sticky-col { background-color: var(--gray-50); z-index: 3; }
        
        .roster-cell { height: 70px; cursor: pointer; transition: background-color 0.1s; position: relative; }
        .roster-cell:hover { background-color: var(--gray-50); }
        
        .roster-shift { padding: 0.5rem; border-radius: var(--radius-sm); border-left: 3px solid transparent; height: 100%; display: flex; flex-direction: column; gap: 0.25rem; }
        .roster-shift.bg-normal { background-color: var(--primary-50); border-left-color: var(--primary-500); }
        .roster-shift.bg-overnight { background-color: var(--purple-50); border-left-color: var(--purple-500); }
        .shift-name { font-size: 0.875rem; font-weight: 600; color: var(--gray-900); }
        .shift-time { font-size: 0.7rem; color: var(--gray-600); }
        .shift-mode { font-size: 0.75rem; font-weight: 600; text-transform: uppercase; }
        .text-primary { color: var(--primary-700); }
        .text-gray { color: var(--gray-500); }
        
        .roster-empty { height: 100%; display: flex; align-items: center; justify-content: center; color: transparent; font-size: 0.75rem; font-weight: 500; transition: color 0.2s; }
        .roster-cell:hover .roster-empty { color: var(--primary-600); }
        
        .roster-badge { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; border-radius: var(--radius-sm); }
        .bg-leave { background-color: var(--danger-50); color: var(--danger); }
        .bg-holiday { background-color: var(--warning-50); color: var(--warning); }
        .bg-gray { background-color: var(--gray-100); color: var(--gray-600); }
        
        .dropdown-menu { background: white; border: 1px solid var(--border-color); border-radius: var(--radius-md); box-shadow: var(--shadow-lg); padding: 0.5rem 0; min-width: 180px; }
        .dropdown-item { width: 100%; text-align: left; padding: 0.5rem 1rem; font-size: 0.875rem; display: flex; align-items: center; gap: 0.5rem; background: none; border: none; cursor: pointer; color: var(--gray-700); }
        .dropdown-item:hover { background-color: var(--gray-50); color: var(--gray-900); }
        .dropdown-divider { height: 1px; background-color: var(--gray-200); margin: 0.25rem 0; }
        
        .drawer-overlay { position: fixed; inset: 0; background-color: rgba(0,0,0,0.4); z-index: 100; display: flex; justify-content: flex-end; }
        .drawer { background-color: var(--bg-surface); width: 100%; height: 100%; display: flex; flex-direction: column; box-shadow: var(--shadow-xl); animation: slideInRight 0.3s forwards; }
        .wide-drawer { max-width: min(520px, 100vw); }
        .drawer-header { padding: 1.5rem; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; alignItems: flex-start; }
        .drawer-body { padding: 1.5rem; overflow-y: auto; flex: 1; }
        
        @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes slideDown { from { transform: translate(-50%, -100%); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }
        
        @media (max-width: 900px) {
          .desktop-roster { display: none; }
          .mobile-roster { display: block; }
          
        }
        @media (max-width: 600px) {
          
          .drawer-overlay { align-items: flex-end; }
          .drawer, .wide-drawer { height: 90vh; border-top-left-radius: var(--radius-xl); border-top-right-radius: var(--radius-xl); animation: slideUp 0.3s forwards; }
        }
        
        .skeleton { background: linear-gradient(90deg, var(--gray-200) 25%, var(--gray-100) 50%, var(--gray-200) 75%); background-size: 200% 100%; animation: skeleton-loading 1.5s infinite; }
        @keyframes skeleton-loading { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
      `}</style>
    </div>
  );
};

export default AdminRoster;



