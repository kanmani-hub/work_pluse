import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Clock, Search, Plus, Filter, MoreVertical, X, CheckCircle2, 
  AlertTriangle, Users, Eye, Edit, Copy, Trash2, Moon, Sun, 
  Settings, UserPlus, Info, CalendarClock, Activity
} from 'lucide-react';

import { shiftService } from '../../services/shifts/shiftService';

const AdminShifts: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  
  const [shifts, setShifts] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterOvernight, setFilterOvernight] = useState('All');
  
  const [activeMenu, setActiveMenu] = useState<string | null>(null);

  // Drawers & Modals
  const [showForm, setShowForm] = useState<string | boolean>(false); // false | true (add) | id (edit) | id (duplicate)
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [showDetail, setShowDetail] = useState<any>(null);
  const [assignModal, setAssignModal] = useState<any>(null);
  const [conflictModal, setConflictModal] = useState<any>(null);
  const [deactivateModal, setDeactivateModal] = useState<any>(null);
  const [deleteModal, setDeleteModal] = useState<any>(null);
  const [deleteError, setDeleteError] = useState<any>(null);

  // Form State
  const [formData, setFormData] = useState<any>({});
  const [formError, setFormError] = useState('');

  const fetchShifts = async () => {
    setLoading(true);
    const { data } = await shiftService.getShifts();
    if (data) {
      setShifts(data.map((d: any) => ({
        id: d.id,
        name: d.name,
        code: d.code,
        start: d.start_time ? d.start_time.substring(0, 5) : '',
        end: d.end_time ? d.end_time.substring(0, 5) : '',
        reqHours: d.required_hours,
        breakMins: d.break_duration_minutes,
        grace: d.grace_period_minutes,
        overnight: d.crosses_midnight,
        employees: 0,
        status: d.is_active ? 'Active' : 'Inactive',
        mode: d.is_wfh_allowed ? 'Flexible' : 'Office'
      })));
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchShifts();
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const filteredShifts = shifts.filter(s => {
    const matchesSearch = s.name.toLowerCase().includes(search.toLowerCase()) || s.code.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = filterStatus === 'All' || s.status === filterStatus;
    const matchesGeo = filterOvernight === 'All' || (filterOvernight === 'Overnight' && s.overnight) || (filterOvernight === 'Non-Overnight' && !s.overnight);
    return matchesSearch && matchesStatus && matchesGeo;
  });

  const handleActionClick = (action: string, shift: any) => {
    setActiveMenu(null);
    switch(action) {
      case 'view': setShowDetail(shift); break;
      case 'edit': setIsDuplicating(false); setFormData(shift); setShowForm(shift.id); break;
      case 'duplicate': setIsDuplicating(true); setFormData({...shift, name: `${shift.name} (Copy)`, code: `${shift.code}_COPY`}); setShowForm(true); break;
      case 'deactivate': setDeactivateModal(shift); break;
      case 'delete': setDeleteModal(shift); setDeleteError(null); break;
      case 'reactivate': handleReactivate(shift); break;
    }
  };

  const handleSaveForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!formData.name || !formData.code || !formData.start || !formData.end) return setFormError('Name, Code, Start Time, and End Time are required.');
    if (!formData.reqHours) return setFormError('Required hours must be configured.');
    
    const startHour = parseInt(formData.start.split(':')[0], 10);
    let shiftType = 'GENERAL';
    if (startHour >= 4 && startHour < 9) shiftType = 'MORNING';
    else if (startHour >= 9 && startHour < 14) shiftType = 'GENERAL';
    else if (startHour >= 14 && startHour < 20) shiftType = 'EVENING';
    else shiftType = 'NIGHT';

    const dbPayload = {
      name: formData.name,
      code: formData.code.toUpperCase(),
      shift_type: shiftType,
      start_time: formData.start,
      end_time: formData.end,
      required_hours: parseFloat(formData.reqHours) || 8,
      break_duration_minutes: parseInt(formData.breakMins) || 0,
      grace_period_minutes: parseInt(formData.grace) || 15,
      crosses_midnight: formData.overnight || false,
      is_active: formData.status === 'Inactive' ? false : true,
      is_wfh_allowed: formData.mode === 'WFH' || formData.mode === 'Flexible'
    };
    
    if (showForm === true || isDuplicating) {
      const { error } = await shiftService.createShift(dbPayload);
      if (error) return setFormError(error.message);
      showToast(isDuplicating ? 'Shift duplicated successfully' : 'Shift created successfully');
    } else {
      const { error } = await shiftService.updateShift(showForm as string, dbPayload);
      if (error) return setFormError(error.message);
      showToast('Shift updated successfully');
    }
    setShowForm(false);
    setIsDuplicating(false);
    fetchShifts();
  };

  const handleDeactivate = async () => {
    const target = deactivateModal || deleteModal;
    if (target) {
      await shiftService.deactivateShift(target.id);
      setDeactivateModal(null);
      setDeleteModal(null);
      setDeleteError(null);
      showToast('Shift deactivated successfully');
      fetchShifts();
    }
  };

  const handleReactivate = async (shift: any) => {
    await shiftService.activateShift(shift.id);
    showToast('Shift reactivated successfully');
    fetchShifts();
  };

  const handleDelete = async () => {
    const { success, reason, assignmentCount, error } = await shiftService.deleteShift(deleteModal.id);
    if (!success) {
      if (reason === 'ASSIGNMENTS_EXIST') {
        setDeleteError({ message: `Cannot delete this shift because it is currently assigned to employees. This shift is currently assigned to ${assignmentCount} employees.`, isDependency: false, isAssigned: true });
      } else if (reason === 'HISTORICAL_DEPENDENCY') {
        setDeleteError({ message: 'This shift cannot be permanently deleted because historical records depend on it.', isDependency: true });
      } else {
        setDeleteError({ message: error || 'Failed to delete shift.', isDependency: false });
      }
      return;
    }
    showToast('Shift deleted successfully');
    setDeleteModal(null);
    setDeleteError(null);
    fetchShifts();
  };

  const triggerMockConflict = (e: React.FormEvent) => {
    e.preventDefault();
    setConflictModal(assignModal);
  };

  const resolveConflict = () => {
    setConflictModal(null);
    setAssignModal(null);
    showToast('Shift assigned successfully (Overridden)');
  };

  const formatTimeAMPM = (timeStr: string) => {
    if (!timeStr) return '';
    const [h, m] = timeStr.split(':');
    let hours = parseInt(h);
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    return `${hours < 10 ? '0'+hours : hours}:${m} ${ampm}`;
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
          <h1 className="page-title">Shift Management</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>Create and configure employee shifts and attendance rules.</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button className="btn btn-outline" style={{ fontSize: '0.875rem' }}><Settings size={16}/> Shift Settings</button>
          <button onClick={() => { setIsDuplicating(false); setFormData({ overnight: false, start: '09:00', end: '18:00', reqHours: 8, breakMins: 60, grace: 15 }); setFormError(''); setShowForm(true); }} className="btn btn-primary" style={{ fontSize: '0.875rem' }}><Plus size={16}/> Create Shift</button>
        </div>
      </div>

      {loading ? (
        <div className="skeleton-container" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem' }}>
          {[...Array(5)].map((_, i) => <div key={i} className="skeleton" style={{ height: '90px', borderRadius: 'var(--radius-md)' }} />)}
        </div>
      ) : (
        <div className="kpi-grid">
          <div className="tracking-kpi-card">
            <div className="sc-header"><div className="sc-icon"><Clock size={18} /></div></div>
            <div className="sc-val">5</div>
            <div className="sc-title">Total Shifts</div>
          </div>
          <div className="tracking-kpi-card">
            <div className="sc-header"><div className="sc-icon" style={{ backgroundColor: 'var(--success-100)', color: 'var(--success)' }}><CheckCircle2 size={18} /></div></div>
            <div className="sc-val" style={{ color: 'var(--success)' }}>4</div>
            <div className="sc-title">Active Shifts</div>
          </div>
          <div className="tracking-kpi-card" onClick={() => navigate('/admin/employees')} style={{ cursor: 'pointer' }}>
            <div className="sc-header"><div className="sc-icon" style={{ backgroundColor: 'var(--primary-100)', color: 'var(--primary-700)' }}><Users size={18} /></div></div>
            <div className="sc-val" style={{ color: 'var(--primary-700)' }}>128</div>
            <div className="sc-title">Employees Assigned</div>
          </div>
          <div className="tracking-kpi-card" onClick={() => setFilterOvernight('Overnight')} style={{ cursor: 'pointer' }}>
            <div className="sc-header"><div className="sc-icon" style={{ backgroundColor: 'var(--purple-100)', color: 'var(--purple-700)' }}><Moon size={18} /></div></div>
            <div className="sc-val" style={{ color: 'var(--purple-700)' }}>1</div>
            <div className="sc-title">Overnight Shifts</div>
          </div>
          <div className="tracking-kpi-card" onClick={() => navigate('/admin/roster')} style={{ cursor: 'pointer' }}>
            <div className="sc-header"><div className="sc-icon" style={{ backgroundColor: 'var(--warning-100)', color: 'var(--warning)' }}><Activity size={18} /></div></div>
            <div className="sc-val" style={{ color: 'var(--warning)' }}>64</div>
            <div className="sc-title">Rotational Employees</div>
          </div>
        </div>
      )}

      {/* Main Table Card */}
      <div className="card" style={{ padding: 0 }}>
        {/* Toolbar */}
        <div style={{ padding: '1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          
          <div style={{ position: 'relative', width: '250px', flex: '1 1 auto', maxWidth: '300px' }}>
            <Search size={18} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search shift name or code..." className="form-control" style={{ paddingLeft: '2.25rem' }} />
          </div>
          
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="form-control" style={{ width: 'auto' }}>
            <option value="All">All Statuses</option>
            <option>Active</option>
            <option>Inactive</option>
          </select>

          <select value={filterOvernight} onChange={e => setFilterOvernight(e.target.value)} className="form-control" style={{ width: 'auto' }}>
            <option value="All">All Types</option>
            <option>Non-Overnight</option>
            <option>Overnight</option>
          </select>
          
          {(search || filterStatus !== 'All' || filterOvernight !== 'All') && (
            <button onClick={() => { setSearch(''); setFilterStatus('All'); setFilterOvernight('All'); }} className="btn btn-outline" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>Clear</button>
          )}
        </div>

        {loading ? (
          <div className="skeleton" style={{ height: '300px', margin: '1rem' }} />
        ) : filteredShifts.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
            <Clock size={48} style={{ margin: '0 auto 1rem auto', opacity: 0.3 }} />
            <h3 style={{ fontSize: '1.125rem', color: 'var(--text-primary)' }}>No shifts configured</h3>
            <p style={{ marginTop: '0.5rem' }}>Create a shift to start assigning working schedules.</p>
            <button onClick={() => { setSearch(''); setFilterStatus('All'); setFilterOvernight('All'); }} className="btn btn-outline" style={{ marginTop: '1rem' }}>Clear Filters</button>
          </div>
        ) : (
          <div className="table-container">
            <table className="table" style={{ width: '100%', minWidth: '1000px' }}>
              <thead>
                <tr>
                  <th>Shift</th>
                  <th>Code</th>
                  <th>Start</th>
                  <th>End</th>
                  <th style={{ textAlign: 'right' }}>Req. Hrs</th>
                  <th style={{ textAlign: 'right' }}>Break</th>
                  <th style={{ textAlign: 'right' }}>Grace</th>
                  <th style={{ textAlign: 'center' }}>Overnight</th>
                  <th style={{ textAlign: 'right' }}>Employees</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredShifts.map(shift => (
                  <tr key={shift.id}>
                    <td><div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{shift.name}</div></td>
                    <td style={{ fontWeight: 600, fontFamily: 'monospace' }}>{shift.code}</td>
                    <td style={{ fontSize: '0.875rem' }}>{formatTimeAMPM(shift.start)}</td>
                    <td style={{ fontSize: '0.875rem' }}>{formatTimeAMPM(shift.end)} {shift.overnight && <span style={{ color: 'var(--purple-600)', fontSize: '0.75rem', fontWeight: 600 }}>+1d</span>}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{shift.reqHours}h</td>
                    <td style={{ textAlign: 'right', fontSize: '0.875rem' }}>{shift.breakMins}m</td>
                    <td style={{ textAlign: 'right', fontSize: '0.875rem' }}>{shift.grace}m</td>
                    <td style={{ textAlign: 'center' }}>
                      {shift.overnight ? <span className="badge" style={{ backgroundColor: 'var(--purple-100)', color: 'var(--purple-700)' }}>Yes</span> : <span className="badge badge-gray">No</span>}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{shift.employees}</td>
                    <td>
                      <span className={`badge ${shift.status === 'Active' ? 'badge-success' : 'badge-gray'}`}>
                        {shift.status}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', position: 'relative' }}>
                      <button onClick={() => setActiveMenu(activeMenu === shift.id ? null : shift.id)} className="icon-button"><MoreVertical size={18}/></button>
                      
                      {activeMenu === shift.id && (
                        <div className="dropdown-menu" style={{ position: 'absolute', right: '30px', top: '12px', zIndex: 10 }}>
                          <button onClick={() => handleActionClick('view', shift)} className="dropdown-item"><Eye size={14}/> View Details</button>
                          <button onClick={() => handleActionClick('edit', shift)} className="dropdown-item"><Edit size={14}/> Edit Shift</button>
                          <button onClick={() => handleActionClick('duplicate', shift)} className="dropdown-item"><Copy size={14}/> Duplicate Shift</button>
                          <div className="dropdown-divider"></div>
                          <button onClick={() => handleActionClick('delete', shift)} className="dropdown-item danger" style={{ color: 'var(--danger-700)' }}><Trash2 size={14}/> Delete Shift</button>
                          {shift.status === 'Active' ? (
                            <button onClick={() => handleActionClick('deactivate', shift)} className="dropdown-item"><Trash2 size={14} color="var(--gray-500)"/> Deactivate</button>
                          ) : (
                            <button onClick={() => handleActionClick('reactivate', shift)} className="dropdown-item"><CheckCircle2 size={14}/> Reactivate</button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Rotational Shift Info Card */}
      <div className="card" style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start', backgroundColor: 'var(--primary-50)', borderColor: 'var(--primary-200)', borderStyle: 'dashed' }}>
        <div style={{ padding: '0.75rem', backgroundColor: 'var(--primary-100)', borderRadius: '50%', color: 'var(--primary-700)' }}><CalendarClock size={24} /></div>
        <div style={{ flex: 1 }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--primary-800)', marginBottom: '0.25rem' }}>Rotational Shifts & Dynamic Assignments</h3>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1rem', maxWidth: '600px' }}>
            Employees can be assigned different shifts on different dates. A shift defined here is a reusable template. You do not need to create identical shifts for every employee.
          </p>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <div style={{ backgroundColor: 'var(--bg-surface-elevated)', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--primary-200)', fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--gray-700)' }}>
              <div>Employee A</div>
              <div style={{ color: 'var(--primary-600)' }}>24 Sep → Morning</div>
              <div style={{ color: 'var(--primary-600)' }}>25 Sep → Evening</div>
              <div style={{ color: 'var(--purple-600)' }}>26 Sep → Night</div>
            </div>
            <button onClick={() => navigate('/admin/roster')} className="btn btn-outline" style={{ backgroundColor: 'var(--bg-surface-elevated)' }}>Manage Shift Roster</button>
          </div>
        </div>
      </div>

      {/* Add / Edit / Duplicate Form Drawer */}
      {showForm && (
        <div className="drawer-overlay" onClick={() => setShowForm(false)}>
          <div className="drawer wide-drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header" style={{ paddingBottom: '1rem' }}>
              <div>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>{isDuplicating ? 'Duplicate Shift' : typeof showForm === 'string' ? 'Edit Shift' : 'Create Shift'}</h2>
                {typeof showForm === 'string' && !isDuplicating && (
                  <p style={{ fontSize: '0.75rem', color: 'var(--warning)', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <Info size={14} /> Changes apply to future assignments. Historical attendance uses original rules.
                  </p>
                )}
              </div>
              <button className="icon-button" onClick={() => setShowForm(false)}><X size={20} /></button>
            </div>
            
            <form onSubmit={handleSaveForm} className="drawer-body" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
              
              {formError && (
                <div style={{ padding: '0.75rem', backgroundColor: 'var(--danger-50)', color: 'var(--danger)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}>
                  <AlertTriangle size={16} /> {formError}
                </div>
              )}

              {/* Preview Block */}
              <div style={{ padding: '1.25rem', backgroundColor: 'var(--gray-50)', borderRadius: 'var(--radius-md)', border: '1px solid var(--gray-200)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)' }}>{formatTimeAMPM(formData.start) || '00:00'}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Shift Start</div>
                </div>
                <div style={{ flex: 1, padding: '0 1.5rem', position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{ width: '100%', height: '2px', backgroundColor: 'var(--primary-300)', position: 'absolute', top: '50%', zIndex: 0 }}></div>
                  <div style={{ backgroundColor: formData.overnight ? 'var(--purple-100)' : 'var(--primary-100)', color: formData.overnight ? 'var(--purple-700)' : 'var(--primary-700)', padding: '0.25rem 0.75rem', borderRadius: 'var(--radius-full)', fontSize: '0.75rem', fontWeight: 600, position: 'relative', zIndex: 1 }}>
                    {formData.reqHours || 0}h Required
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>{formData.breakMins || 0}m Break • {formData.grace || 0}m Grace</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)' }}>{formatTimeAMPM(formData.end) || '00:00'} {formData.overnight && <span style={{ color: 'var(--purple-600)', fontSize: '0.75rem' }}>+1d</span>}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Shift End</div>
                </div>
              </div>

              <section>
                <h3 className="section-title">Basic Information</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <label className="form-label">Shift Name *</label>
                    <input required className="form-control" value={formData.name || ''} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="e.g. Morning Shift" />
                  </div>
                  <div>
                    <label className="form-label">Shift Code *</label>
                    <input required className="form-control" style={{ textTransform: 'uppercase' }} value={formData.code || ''} onChange={e => setFormData({...formData, code: e.target.value})} placeholder="e.g. MORNING" />
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label className="form-label">Description</label>
                    <textarea className="form-control" rows={2} value={formData.desc || ''} onChange={e => setFormData({...formData, desc: e.target.value})} placeholder="Brief description..." />
                  </div>
                </div>
              </section>

              <section>
                <h3 className="section-title">Shift Timing & Hours</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
                  
                  <div>
                    <label className="form-label">Start Time *</label>
                    <input required type="time" className="form-control" value={formData.start || ''} onChange={e => setFormData({...formData, start: e.target.value})} />
                  </div>
                  
                  <div>
                    <label className="form-label">End Time *</label>
                    <input required type="time" className="form-control" value={formData.end || ''} onChange={e => setFormData({...formData, end: e.target.value})} />
                    
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
                      <input type="checkbox" id="overnight" checked={formData.overnight || false} onChange={e => setFormData({...formData, overnight: e.target.checked})} style={{ cursor: 'pointer' }} />
                      <label htmlFor="overnight" style={{ fontSize: '0.75rem', color: formData.overnight ? 'var(--purple-700)' : 'var(--gray-600)', cursor: 'pointer', fontWeight: formData.overnight ? 600 : 400 }}>
                        {formData.overnight ? 'Overnight Shift (Ends on the following calendar day)' : 'Overnight Shift'}
                      </label>
                    </div>
                  </div>

                  <div>
                    <label className="form-label">Required Working Hours *</label>
                    <input required type="number" step="0.5" min="1" className="form-control" value={formData.reqHours || ''} onChange={e => setFormData({...formData, reqHours: e.target.value})} placeholder="e.g. 8" />
                  </div>

                  <div style={{ display: 'flex', gap: '1rem' }}>
                    <div style={{ flex: 1 }}>
                      <label className="form-label">Min. Hours</label>
                      <input type="number" step="0.5" className="form-control" placeholder="4" />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label className="form-label">Max. Hours</label>
                      <input type="number" step="0.5" className="form-control" placeholder="12" />
                    </div>
                  </div>
                </div>
              </section>

              <section>
                <h3 className="section-title">Attendance Rules</h3>
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', marginBottom: '1.25rem' }}>
                  <div className="rule-box">
                    <label className="form-label">Grace Period (Mins)</label>
                    <input type="number" className="form-control" value={formData.grace || ''} onChange={e => setFormData({...formData, grace: e.target.value})} placeholder="15" />
                    <div className="rule-desc">Clock-in within this period is not treated as late.</div>
                  </div>
                  
                  <div className="rule-box">
                    <label className="form-label">Break Duration (Mins)</label>
                    <input type="number" className="form-control" value={formData.breakMins || ''} onChange={e => setFormData({...formData, breakMins: e.target.value})} placeholder="60" />
                    <div className="rule-desc">Required break tracking or automatic deduction.</div>
                  </div>
                </div>

                {/* Late Login Logic Flow */}
                <div className="rule-box" style={{ marginBottom: '1.25rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                    <input type="checkbox" id="late_rule" defaultChecked style={{ cursor: 'pointer' }} />
                    <label htmlFor="late_rule" style={{ fontWeight: 600, fontSize: '0.875rem' }}>Enable Late Login Detection</label>
                  </div>
                  
                  <div style={{ display: 'flex', alignItems: 'center', backgroundColor: 'var(--bg-surface-elevated)', padding: '1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', gap: '1rem', overflowX: 'auto' }}>
                    <div style={{ textAlign: 'center', minWidth: '80px' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Shift Start</div>
                      <div style={{ fontWeight: 600 }}>{formatTimeAMPM(formData.start) || '00:00'}</div>
                    </div>
                    <div style={{ color: 'var(--primary-500)' }}>→</div>
                    <div style={{ textAlign: 'center', minWidth: '80px', backgroundColor: 'var(--primary-50)', padding: '0.5rem', borderRadius: '4px' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Grace</div>
                      <div style={{ fontWeight: 600, color: 'var(--primary-700)' }}>{formData.grace || 0}m</div>
                    </div>
                    <div style={{ color: 'var(--danger)' }}>→</div>
                    <div style={{ textAlign: 'center', minWidth: '80px' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Status</div>
                      <div style={{ fontWeight: 600, color: 'var(--danger-600)' }}>LATE</div>
                    </div>
                  </div>
                </div>

                {/* Auto Logout Rule */}
                <div className="rule-box">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                    <input type="checkbox" id="auto_logout" defaultChecked style={{ cursor: 'pointer' }} />
                    <label htmlFor="auto_logout" style={{ fontWeight: 600, fontSize: '0.875rem' }}>Enable Auto Logout</label>
                  </div>
                  <div className="rule-desc" style={{ marginBottom: '1rem' }}>If the employee forgets to clock out, automatically close the session.</div>
                  
                  <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <select className="form-control" defaultValue="shift_end">
                      <option value="shift_end">At Shift End Time</option>
                      <option value="grace">Grace Period After End</option>
                    </select>
                    {formData.overnight && (
                      <span className="badge" style={{ backgroundColor: 'var(--purple-100)', color: 'var(--purple-700)', whiteSpace: 'nowrap' }}>+1 Day Evaluated</span>
                    )}
                  </div>
                </div>

              </section>

              <section>
                <h3 className="section-title">Overtime & Work Mode</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
                  <div className="rule-box">
                    <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <input type="checkbox" defaultChecked /> Enable Overtime
                    </label>
                    <div style={{ marginTop: '0.75rem' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Starts after Required Hours</div>
                      <input type="text" className="form-control" disabled value={`${formData.reqHours || 8}h`} />
                    </div>
                  </div>
                  <div>
                    <label className="form-label">Default Work Mode</label>
                    <select className="form-control" value={formData.mode || 'Office'} onChange={e => setFormData({...formData, mode: e.target.value})}>
                      <option>Office</option>
                      <option>WFH</option>
                      <option>Hybrid</option>
                      <option>Flexible</option>
                    </select>
                    <div className="rule-desc" style={{ marginTop: '0.5rem' }}>Individual rosters can override this default.</div>
                  </div>
                </div>
              </section>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1rem', borderTop: '1px solid var(--gray-200)', paddingTop: '1.5rem' }}>
                <button type="button" onClick={() => setShowForm(false)} className="btn btn-outline">Cancel</button>
                <button type="submit" className="btn btn-primary">{isDuplicating ? 'Create Duplicate Shift' : typeof showForm === 'string' ? 'Update Shift' : 'Create Shift'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Shift Detail / Assign Drawer */}
      {showDetail && (
        <div className="drawer-overlay" onClick={() => setShowDetail(null)}>
          <div className="drawer wide-drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header" style={{ paddingBottom: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', width: '100%' }}>
                <div>
                  <h2 style={{ fontSize: '1.5rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    {showDetail.name} 
                    <span className="badge badge-gray" style={{ fontFamily: 'monospace' }}>{showDetail.code}</span>
                  </h2>
                  <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '0.5rem', alignItems: 'center' }}>
                    <Clock size={14} /> {formatTimeAMPM(showDetail.start)} - {formatTimeAMPM(showDetail.end)} {showDetail.overnight && <span style={{ color: 'var(--purple-600)', fontWeight: 600 }}> (+1 Day)</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <span className={`badge ${showDetail.status === 'Active' ? 'badge-success' : 'badge-gray'}`}>{showDetail.status}</span>
                  <button className="icon-button" onClick={() => setShowDetail(null)}><X size={20} /></button>
                </div>
              </div>
            </div>
            
            <div className="drawer-body" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
              
              <div className="card" style={{ padding: '1.5rem', border: '1px solid var(--border-color)', boxShadow: 'none' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>Rules Configuration</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                  <div className="detail-item"><span className="detail-label">Required Hours</span><span className="detail-value">{showDetail.reqHours} hours</span></div>
                  <div className="detail-item"><span className="detail-label">Break Duration</span><span className="detail-value">{showDetail.breakMins} minutes</span></div>
                  <div className="detail-item"><span className="detail-label">Grace Period</span><span className="detail-value">{showDetail.grace} minutes</span></div>
                  <div className="detail-item"><span className="detail-label">Default Mode</span><span className="detail-value">{showDetail.mode}</span></div>
                  <div className="detail-item"><span className="detail-label">Auto Logout</span><span className="detail-value">Enabled (At Shift End)</span></div>
                  <div className="detail-item"><span className="detail-label">Overtime</span><span className="detail-value">Enabled (After {showDetail.reqHours}h)</span></div>
                </div>
              </div>

              <div>
                <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  Employees Assigned
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <span className="badge badge-primary">{showDetail.employees} Total</span>
                    <button onClick={() => setAssignModal(showDetail)} className="btn btn-outline" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}><UserPlus size={14}/> Assign</button>
                  </div>
                </h3>
                
                {showDetail.employees > 0 ? (
                  <div className="table-container" style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)' }}>
                    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                      Employees view will be implemented using real data.
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)', border: '1px dashed var(--gray-300)', borderRadius: 'var(--radius-md)' }}>
                    No employees currently assigned to this shift.
                  </div>
                )}
              </div>
              
              <div>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>Shift History (Audit)</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div style={{ display: 'flex', gap: '1rem', fontSize: '0.875rem' }}>
                    <div style={{ color: 'var(--text-secondary)', width: '60px' }}>24 Sep</div>
                    <div>
                      <div style={{ fontWeight: 500 }}>Grace period changed from 10m to 15m</div>
                      <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>By Admin User</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '1rem', fontSize: '0.875rem' }}>
                    <div style={{ color: 'var(--text-secondary)', width: '60px' }}>20 Sep</div>
                    <div>
                      <div style={{ fontWeight: 500 }}>Shift created</div>
                      <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>By Admin User</div>
                    </div>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* Assign Shift Modal */}
      {assignModal && !conflictModal && (
        <div className="drawer-overlay" style={{ alignItems: 'center', zIndex: 110 }}>
          <div className="card" style={{ margin: 'auto', width: '100%', maxWidth: '450px', animation: 'slideUp 0.3s' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>Assign Shift</h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>Assign <strong>{assignModal.name}</strong> to employees.</p>
            
            <form onSubmit={triggerMockConflict} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label className="form-label">Effective Date(s)</label>
                <input required type="date" className="form-control" defaultValue="2026-09-25" />
              </div>
              
              <div style={{ position: 'relative' }}>
                <Search size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
                <input type="text" className="form-control" placeholder="Search employees..." style={{ paddingLeft: '2.25rem' }} />
              </div>
              
              <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', maxHeight: '150px', overflowY: 'auto' }}>
                {[
                  { id: 'EMP044', name: 'Vivek Sharma', dept: 'Marketing' },
                  { id: 'EMP045', name: 'Kavitha N', dept: 'Sales' }
                ].map((emp, i) => (
                  <label key={emp.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem', borderBottom: '1px solid var(--border-color)', cursor: 'pointer' }}>
                    <input type="checkbox" defaultChecked={i===0} style={{ width: '16px', height: '16px' }} />
                    <div>
                      <div style={{ fontWeight: 500, fontSize: '0.875rem' }}>{emp.name} ({emp.id})</div>
                    </div>
                  </label>
                ))}
              </div>

              <div>
                <label className="form-label">Work Mode Override</label>
                <select className="form-control" defaultValue="Use Default">
                  <option>Use Default ({assignModal.mode})</option>
                  <option>Office</option>
                  <option>WFH</option>
                </select>
              </div>

              <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                <button type="button" onClick={() => setAssignModal(null)} className="btn btn-outline" style={{ flex: 1 }}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>Assign Shift</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Conflict Modal */}
      {conflictModal && (
        <div className="drawer-overlay" style={{ alignItems: 'center', zIndex: 120 }}>
          <div className="card" style={{ margin: 'auto', width: '100%', maxWidth: '450px', animation: 'slideUp 0.3s', borderTop: '4px solid var(--warning)' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <AlertTriangle size={20} color="var(--warning-600)" /> Shift Conflict Detected
            </h3>
            <div style={{ backgroundColor: 'var(--warning-50)', padding: '1rem', borderRadius: 'var(--radius-md)', color: 'var(--warning-800)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
              <strong>Vivek Sharma</strong> already has <strong>Morning Shift</strong> assigned for <strong>25 September 2026</strong>.
            </div>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button type="button" onClick={() => setConflictModal(null)} className="btn btn-outline" style={{ flex: 1 }}>Cancel Assignment</button>
              <button onClick={resolveConflict} className="btn btn-primary" style={{ flex: 1 }}>Replace Existing</button>
            </div>
          </div>
        </div>
      )}

      {/* Deactivate Modal */}
      {deactivateModal && (
        <div className="drawer-overlay" style={{ alignItems: 'center', zIndex: 110 }}>
          <div className="card" style={{ margin: 'auto', width: '100%', maxWidth: '400px', animation: 'slideUp 0.3s', borderTop: '4px solid var(--danger-600)' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem' }}>Deactivate Shift?</h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
              Are you sure you want to deactivate <strong>{deactivateModal.name}</strong>? <br/><br/>
              <strong>Warning:</strong> Historical attendance records using this shift will remain unchanged, but it cannot be assigned to future dates.
            </p>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button type="button" onClick={() => setDeactivateModal(null)} className="btn btn-outline" style={{ flex: 1 }}>Cancel</button>
              <button onClick={handleDeactivate} className="btn btn-primary" style={{ flex: 1, backgroundColor: 'var(--danger-600)', borderColor: 'var(--danger-600)' }}>Deactivate</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Modal */}
      {deleteModal && (
        <div className="drawer-overlay" style={{ alignItems: 'center', zIndex: 110 }}>
          <div className="card" style={{ margin: 'auto', width: '100%', maxWidth: '450px', animation: 'slideUp 0.3s', borderTop: '4px solid var(--danger-600)' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem' }}>Delete Shift?</h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
              Are you sure you want to delete <strong>{deleteModal.name}</strong>?
            </p>

            <div style={{ padding: '1rem', backgroundColor: 'var(--gray-50)', borderRadius: 'var(--radius-md)', marginBottom: '1.5rem', border: '1px solid var(--gray-200)', fontSize: '0.875rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '0.5rem' }}>
                <div style={{ color: 'var(--text-secondary)' }}>Shift Name</div>
                <div style={{ fontWeight: 500 }}>{deleteModal.name}</div>
                <div style={{ color: 'var(--text-secondary)' }}>Shift Code</div>
                <div style={{ fontWeight: 500, fontFamily: 'monospace' }}>{deleteModal.code}</div>
                <div style={{ color: 'var(--text-secondary)' }}>Timing</div>
                <div style={{ fontWeight: 500 }}>{formatTimeAMPM(deleteModal.start)} - {formatTimeAMPM(deleteModal.end)}</div>
              </div>
            </div>

            {deleteError ? (
              <div style={{ marginBottom: '1.5rem', padding: '1rem', backgroundColor: 'var(--danger-50)', borderRadius: 'var(--radius-md)', border: '1px solid var(--danger-200)' }}>
                <p style={{ color: 'var(--danger-800)', fontSize: '0.875rem', fontWeight: 500, marginBottom: '1rem' }}>
                  {deleteError.message}
                </p>
                {deleteError.isDependency ? (
                  <div style={{ display: 'flex', gap: '1rem' }}>
                    <button type="button" onClick={() => { setDeleteModal(null); setDeleteError(null); }} className="btn btn-outline" style={{ flex: 1, borderColor: 'var(--danger-300)' }}>Cancel</button>
                    <button onClick={handleDeactivate} className="btn btn-primary" style={{ flex: 1 }}>Deactivate Shift</button>
                  </div>
                ) : deleteError.isAssigned ? (
                  <div style={{ display: 'flex', gap: '1rem' }}>
                    <button type="button" onClick={() => { setDeleteModal(null); setDeleteError(null); }} className="btn btn-outline" style={{ flex: 1, borderColor: 'var(--danger-300)' }}>Cancel</button>
                    <button onClick={() => navigate('/admin/roster')} className="btn btn-primary" style={{ flex: 1 }}>View Assignments</button>
                  </div>
                ) : (
                  <button type="button" onClick={() => { setDeleteModal(null); setDeleteError(null); }} className="btn btn-outline" style={{ width: '100%', borderColor: 'var(--danger-300)' }}>Cancel</button>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '1rem' }}>
                <button type="button" onClick={() => setDeleteModal(null)} className="btn btn-outline" style={{ flex: 1 }}>Cancel</button>
                <button onClick={handleDelete} className="btn btn-primary" style={{ flex: 1, backgroundColor: 'var(--danger-600)', borderColor: 'var(--danger-600)' }}>Delete Shift</button>
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        
        
        
        
        .rule-box { background-color: var(--gray-50); padding: 1rem; border-radius: var(--radius-md); border: 1px solid var(--gray-200); }
        .rule-desc { font-size: 0.75rem; color: var(--gray-500); margin-top: 0.5rem; }
        
        
        
        .summary-card-small:hover { transform: translateY(-2px); box-shadow: var(--shadow-sm); }
        
        
        
        
        
        .dropdown-menu { background: white; border: 1px solid var(--border-color); border-radius: var(--radius-md); box-shadow: var(--shadow-lg); padding: 0.5rem 0; min-width: 170px; }
        .dropdown-item { width: 100%; text-align: left; padding: 0.5rem 1rem; font-size: 0.875rem; display: flex; align-items: center; gap: 0.5rem; background: none; border: none; cursor: pointer; color: var(--gray-700); }
        .dropdown-item:hover { background-color: var(--gray-50); color: var(--gray-900); }
        .dropdown-item.danger { color: var(--danger-600); }
        .dropdown-item.danger:hover { background-color: var(--danger-50); }
        .dropdown-divider { height: 1px; background-color: var(--gray-200); margin: 0.25rem 0; }
        
        .drawer-overlay { position: fixed; inset: 0; background-color: rgba(0,0,0,0.4); z-index: 100; display: flex; justify-content: flex-end; }
        .drawer { background-color: var(--bg-surface); width: 100%; height: 100%; display: flex; flex-direction: column; box-shadow: var(--shadow-xl); animation: slideInRight 0.3s forwards; }
        .wide-drawer { max-width: min(520px, 100vw); }
        .drawer-header { padding: 1.5rem; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; alignItems: flex-start; }
        .drawer-body { padding: 1.5rem; overflow-y: auto; flex: 1; }
        
        .detail-item { display: flex; flex-direction: column; gap: 0.25rem; }
        .detail-label { font-size: 0.75rem; color: var(--gray-500); }
        .detail-value { font-size: 0.875rem; font-weight: 500; color: var(--gray-900); }
        
        @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes slideDown { from { transform: translate(-50%, -100%); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }
        
        @media (max-width: 768px) {
          .drawer-overlay { align-items: flex-end; }
          .drawer, .wide-drawer { height: 95vh; border-top-left-radius: var(--radius-xl); border-top-right-radius: var(--radius-xl); animation: slideUp 0.3s forwards; }
        }
        
        .skeleton { background: linear-gradient(90deg, var(--gray-200) 25%, var(--gray-100) 50%, var(--gray-200) 75%); background-size: 200% 100%; animation: skeleton-loading 1.5s infinite; }
        @keyframes skeleton-loading { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
      `}</style>
    </div>
  );
};

export default AdminShifts;



