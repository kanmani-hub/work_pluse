import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Plus, Search, Filter, Download, Upload, MoreVertical, X, CheckCircle2, 
  AlertTriangle, Users, UserCheck, UserX, Home, Settings, MapPin, Briefcase, 
  FileText, CalendarClock, Activity, Eye, Edit, CalendarOff, Clock, Wallet
} from 'lucide-react';

const initialEmployees = [
  { id: 'EMP001', firstName: 'Arun', lastName: 'Kumar', dept: 'Development', desig: 'Software Developer', office: 'Chennai Main Office', shift: 'Evening Shift', mode: 'Office', status: 'Active', email: 'arun@example.com', mobile: '9876543210' },
  { id: 'EMP002', firstName: 'Meena', lastName: 'Krishnan', dept: 'HR', desig: 'HR Executive', office: 'Chennai Main Office', shift: 'General Shift', mode: 'WFH', status: 'Active', email: 'meena@example.com', mobile: '9876543211' },
  { id: 'EMP003', firstName: 'Rahul', lastName: 'Sharma', dept: 'Marketing', desig: 'Marketing Lead', office: 'Chennai Branch', shift: 'Morning Shift', mode: 'Hybrid', status: 'On Leave', email: 'rahul@example.com', mobile: '9876543212' },
  { id: 'EMP004', firstName: 'Priya', lastName: 'Singh', dept: 'Sales', desig: 'Sales Exec', office: 'Remote', shift: 'General Shift', mode: 'WFH', status: 'Inactive', email: 'priya@example.com', mobile: '9876543213' }
];

const AdminEmployees: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  
  const [employees, setEmployees] = useState(initialEmployees);
  const [search, setSearch] = useState('');
  const [filterDept, setFilterDept] = useState('All');
  const [filterStatus, setFilterStatus] = useState('All');
  
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);

  // Drawers & Modals
  const [showAddForm, setShowAddForm] = useState(false);
  const [showEditForm, setShowEditForm] = useState<string | null>(null);
  const [showProfile, setShowProfile] = useState<any>(null);
  const [profileTab, setProfileTab] = useState('Overview');
  
  const [deactivateModal, setDeactivateModal] = useState<any>(null);
  const [reactivateModal, setReactivateModal] = useState<any>(null);
  const [assignShiftModal, setAssignShiftModal] = useState<any>(null);
  const [assignOfficeModal, setAssignOfficeModal] = useState<any>(null);
  const [importModal, setImportModal] = useState(false);
  const [importState, setImportState] = useState<'idle' | 'uploading' | 'done'>('idle');

  // Form State
  const [formData, setFormData] = useState<any>({});

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 800);
    return () => clearTimeout(timer);
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  // Filter Logic
  const filteredEmployees = employees.filter(emp => {
    const matchesSearch = (emp.firstName + ' ' + emp.lastName).toLowerCase().includes(search.toLowerCase()) || emp.id.toLowerCase().includes(search.toLowerCase());
    const matchesDept = filterDept === 'All' || emp.dept === filterDept;
    const matchesStatus = filterStatus === 'All' || emp.status === filterStatus;
    return matchesSearch && matchesDept && matchesStatus;
  });

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };
  const toggleAll = () => {
    if (selectedIds.length === filteredEmployees.length) setSelectedIds([]);
    else setSelectedIds(filteredEmployees.map(e => e.id));
  };

  const handleActionClick = (action: string, emp: any) => {
    setActiveMenu(null);
    switch(action) {
      case 'profile': setShowProfile(emp); break;
      case 'edit': setFormData(emp); setShowEditForm(emp.id); break;
      case 'deactivate': setDeactivateModal(emp); break;
      case 'reactivate': setReactivateModal(emp); break;
      case 'shift': setAssignShiftModal(emp); break;
      case 'office': setAssignOfficeModal(emp); break;
      case 'attend': navigate('/admin/attendance'); break;
      case 'leave': navigate('/admin/leave'); break;
      case 'wfh': navigate('/admin/wfh'); break;
      case 'payroll': navigate('/admin/payroll'); break;
    }
  };

  const handleSaveForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.firstName || !formData.id) return alert('First Name and ID required.');
    
    if (showEditForm) {
      setEmployees(prev => prev.map(emp => emp.id === showEditForm ? { ...emp, ...formData } : emp));
      showToast('Employee updated successfully');
      setShowEditForm(null);
    } else {
      setEmployees(prev => [{ ...formData, status: formData.status || 'Active' }, ...prev]);
      showToast('Employee added successfully');
      setShowAddForm(false);
    }
  };

  const handleDeactivate = () => {
    setEmployees(prev => prev.map(e => e.id === deactivateModal.id ? { ...e, status: 'Inactive' } : e));
    setDeactivateModal(null);
    showToast('Employee deactivated successfully');
  };

  const handleReactivate = () => {
    setEmployees(prev => prev.map(e => e.id === reactivateModal.id ? { ...e, status: 'Active' } : e));
    setReactivateModal(null);
    showToast('Employee reactivated successfully');
  };

  const handleAssignShift = (e: React.FormEvent) => {
    e.preventDefault();
    setEmployees(prev => prev.map(emp => emp.id === assignShiftModal.id ? { ...emp, shift: formData.shift || emp.shift, mode: formData.mode || emp.mode } : emp));
    setAssignShiftModal(null);
    showToast('Shift assigned successfully');
  };

  const handleAssignOffice = (e: React.FormEvent) => {
    e.preventDefault();
    setEmployees(prev => prev.map(emp => emp.id === assignOfficeModal.id ? { ...emp, office: formData.office || emp.office } : emp));
    setAssignOfficeModal(null);
    showToast('Office assignment updated successfully');
  };

  const simulateImport = () => {
    setImportState('uploading');
    setTimeout(() => setImportState('done'), 1500);
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
          <h1 className="page-title">Employees</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>Manage profiles, departments, offices, shifts and status.</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button onClick={() => setImportModal(true)} className="btn btn-outline" style={{ fontSize: '0.875rem' }}><Upload size={16}/> Import Employees</button>
          <button onClick={() => { showToast('Employee export started'); }} className="btn btn-outline" style={{ fontSize: '0.875rem' }}><Download size={16}/> Export Employees</button>
          <button onClick={() => { setFormData({}); setShowAddForm(true); }} className="btn btn-primary" style={{ fontSize: '0.875rem' }}><Plus size={16}/> Add Employee</button>
        </div>
      </div>

      {loading ? (
        <div className="skeleton-container" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
          {[...Array(5)].map((_, i) => <div key={i} className="skeleton" style={{ height: '90px', borderRadius: 'var(--radius-md)' }} />)}
        </div>
      ) : (
        <div className="kpi-grid">
          <div className="tracking-kpi-card" onClick={() => setFilterStatus('All')} style={{ cursor: 'pointer', borderColor: filterStatus==='All' ? 'var(--primary-300)' : '' }}>
            <div className="sc-header"><div className="sc-icon"><Users size={18} /></div></div>
            <div className="sc-val">128</div>
            <div className="sc-title">Total Employees</div>
          </div>
          <div className="tracking-kpi-card" onClick={() => setFilterStatus('Active')} style={{ cursor: 'pointer', borderColor: filterStatus==='Active' ? 'var(--success-300)' : '' }}>
            <div className="sc-header"><div className="sc-icon" style={{ backgroundColor: 'var(--success-100)', color: 'var(--success)' }}><UserCheck size={18} /></div></div>
            <div className="sc-val" style={{ color: 'var(--success)' }}>118</div>
            <div className="sc-title">Active</div>
          </div>
          <div className="tracking-kpi-card" onClick={() => setFilterStatus('Inactive')} style={{ cursor: 'pointer', borderColor: filterStatus==='Inactive' ? 'var(--gray-300)' : '' }}>
            <div className="sc-header"><div className="sc-icon" style={{ backgroundColor: 'var(--gray-200)', color: 'var(--gray-700)' }}><UserX size={18} /></div></div>
            <div className="sc-val" style={{ color: 'var(--gray-700)' }}>6</div>
            <div className="sc-title">Inactive</div>
          </div>
          <div className="tracking-kpi-card" onClick={() => setFilterStatus('On Leave')} style={{ cursor: 'pointer', borderColor: filterStatus==='On Leave' ? 'var(--warning-300)' : '' }}>
            <div className="sc-header"><div className="sc-icon" style={{ backgroundColor: 'var(--warning-100)', color: 'var(--warning)' }}><CalendarOff size={18} /></div></div>
            <div className="sc-val" style={{ color: 'var(--warning)' }}>4</div>
            <div className="sc-title">On Leave</div>
          </div>
          <div className="tracking-kpi-card">
            <div className="sc-header"><div className="sc-icon" style={{ backgroundColor: 'var(--primary-100)', color: 'var(--primary-700)' }}><Home size={18} /></div></div>
            <div className="sc-val" style={{ color: 'var(--primary-700)' }}>18</div>
            <div className="sc-title">WFH Today</div>
          </div>
        </div>
      )}

      {/* Main Table Card */}
      <div className="card" style={{ padding: 0 }}>
        {/* Toolbar */}
        <div style={{ padding: '1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: '1rem', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' }}>
          
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', flex: 1 }}>
            <div style={{ position: 'relative', width: '250px' }}>
              <Search size={18} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
              <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search employees..." className="form-control" style={{ paddingLeft: '2.25rem' }} />
            </div>
            
            <select value={filterDept} onChange={e => setFilterDept(e.target.value)} className="form-control" style={{ width: 'auto' }}>
              <option value="All">All Departments</option>
              <option>Development</option>
              <option>HR</option>
              <option>Marketing</option>
              <option>Sales</option>
            </select>
            
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="form-control" style={{ width: 'auto' }}>
              <option value="All">All Statuses</option>
              <option>Active</option>
              <option>Inactive</option>
              <option>On Leave</option>
            </select>
            
            {(search || filterDept !== 'All' || filterStatus !== 'All') && (
              <button onClick={() => { setSearch(''); setFilterDept('All'); setFilterStatus('All'); }} className="btn btn-outline" style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}>Clear</button>
            )}
          </div>

          {selectedIds.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.5rem 1rem', backgroundColor: 'var(--primary-50)', borderRadius: 'var(--radius-md)', border: '1px solid var(--primary-200)' }}>
              <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--primary-700)' }}>{selectedIds.length} Selected</span>
              <select className="form-control" style={{ width: 'auto', padding: '0.25rem 0.5rem', fontSize: '0.75rem' }} defaultValue="">
                <option value="" disabled>Bulk Actions</option>
                <option>Assign Shift</option>
                <option>Change Work Mode</option>
                <option>Deactivate</option>
              </select>
            </div>
          )}
        </div>

        {/* Table / List */}
        {loading ? (
          <div className="skeleton" style={{ height: '300px', margin: '1rem' }} />
        ) : filteredEmployees.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
            <Users size={48} style={{ margin: '0 auto 1rem auto', opacity: 0.3 }} />
            <h3 style={{ fontSize: '1.125rem', color: 'var(--text-primary)' }}>No employees found</h3>
            <p style={{ marginTop: '0.5rem' }}>Try changing your search or filters.</p>
            <button onClick={() => { setSearch(''); setFilterDept('All'); setFilterStatus('All'); }} className="btn btn-outline" style={{ marginTop: '1rem' }}>Clear Filters</button>
          </div>
        ) : (
          <div className="table-container">
            <table className="table" style={{ width: '100%', minWidth: '900px' }}>
              <thead>
                <tr>
                  <th style={{ width: '40px' }}><input type="checkbox" onChange={toggleAll} checked={selectedIds.length === filteredEmployees.length && filteredEmployees.length > 0} /></th>
                  <th>Employee</th>
                  <th>ID</th>
                  <th>Department</th>
                  <th>Office</th>
                  <th>Shift & Mode</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredEmployees.map(emp => (
                  <tr key={emp.id} className={selectedIds.includes(emp.id) ? 'selected-row' : ''}>
                    <td><input type="checkbox" checked={selectedIds.includes(emp.id)} onChange={() => toggleSelection(emp.id)} /></td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div className="avatar" style={{ backgroundColor: emp.status === 'Inactive' ? 'var(--gray-300)' : 'var(--primary-100)', color: emp.status === 'Inactive' ? 'var(--gray-700)' : 'var(--primary-700)' }}>
                          {emp.firstName[0]}{emp.lastName[0]}
                        </div>
                        <div>
                          <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{emp.firstName} {emp.lastName}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 500 }}>{emp.id} • {emp.dept}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ fontSize: '0.875rem' }}>{emp.id}</td>
                    <td style={{ fontSize: '0.875rem' }}>{emp.dept}</td>
                    <td style={{ fontSize: '0.875rem' }}>{emp.office}</td>
                    <td style={{ fontSize: '0.875rem' }}>
                      <div>{emp.shift}</div>
                      <span className="badge badge-gray" style={{ fontSize: '0.75rem' }}>{emp.mode}</span>
                    </td>
                    <td>
                      <span className={`badge ${emp.status === 'Active' ? 'badge-success' : emp.status === 'Inactive' ? 'badge-gray' : 'badge-warning'}`}>
                        {emp.status}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', position: 'relative' }}>
                      <button onClick={() => setActiveMenu(activeMenu === emp.id ? null : emp.id)} className="icon-button"><MoreVertical size={18}/></button>
                      
                      {activeMenu === emp.id && (
                        <div className="dropdown-menu" style={{ position: 'absolute', right: '30px', top: '12px', zIndex: 10 }}>
                          <button onClick={() => handleActionClick('profile', emp)} className="dropdown-item"><Eye size={14}/> View Profile</button>
                          <button onClick={() => handleActionClick('edit', emp)} className="dropdown-item"><Edit size={14}/> Edit Employee</button>
                          {emp.status !== 'Inactive' && (
                            <>
                              <button onClick={() => handleActionClick('shift', emp)} className="dropdown-item"><Clock size={14}/> Assign Shift</button>
                              <button onClick={() => handleActionClick('office', emp)} className="dropdown-item"><MapPin size={14}/> Assign Office</button>
                              <div className="dropdown-divider"></div>
                              <button onClick={() => handleActionClick('attend', emp)} className="dropdown-item"><CalendarClock size={14}/> View Attendance</button>
                              <button onClick={() => handleActionClick('leave', emp)} className="dropdown-item"><CalendarOff size={14}/> View Leave</button>
                              <button onClick={() => handleActionClick('payroll', emp)} className="dropdown-item"><Wallet size={14}/> View Payroll</button>
                              <div className="dropdown-divider"></div>
                              <button onClick={() => handleActionClick('deactivate', emp)} className="dropdown-item danger"><UserX size={14}/> Deactivate</button>
                            </>
                          )}
                          {emp.status === 'Inactive' && (
                            <>
                              <div className="dropdown-divider"></div>
                              <button onClick={() => handleActionClick('reactivate', emp)} className="dropdown-item"><UserCheck size={14}/> Reactivate</button>
                            </>
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

      {/* Add / Edit Form Drawer */}
      {(showAddForm || showEditForm) && (
        <div className="drawer-overlay" onClick={() => { setShowAddForm(false); setShowEditForm(null); }}>
          <div className="drawer wide-drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>{showEditForm ? 'Edit Employee' : 'Add Employee'}</h2>
              <button className="icon-button" onClick={() => { setShowAddForm(false); setShowEditForm(null); }}><X size={20} /></button>
            </div>
            
            <form onSubmit={handleSaveForm} className="drawer-body" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
              
              <section>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, borderBottom: '1px solid var(--gray-200)', paddingBottom: '0.5rem', marginBottom: '1rem' }}>Personal Information</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <label className="form-label">First Name *</label>
                    <input required className="form-control" value={formData.firstName || ''} onChange={e => setFormData({...formData, firstName: e.target.value})} placeholder="e.g. Arun" />
                  </div>
                  <div>
                    <label className="form-label">Last Name</label>
                    <input className="form-control" value={formData.lastName || ''} onChange={e => setFormData({...formData, lastName: e.target.value})} placeholder="e.g. Kumar" />
                  </div>
                  <div>
                    <label className="form-label">Email *</label>
                    <input required type="email" className="form-control" value={formData.email || ''} onChange={e => setFormData({...formData, email: e.target.value})} placeholder="arun@example.com" />
                  </div>
                  <div>
                    <label className="form-label">Mobile Number *</label>
                    <input required className="form-control" value={formData.mobile || ''} onChange={e => setFormData({...formData, mobile: e.target.value})} placeholder="9876543210" />
                  </div>
                </div>
              </section>

              <section>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, borderBottom: '1px solid var(--gray-200)', paddingBottom: '0.5rem', marginBottom: '1rem' }}>Employment Information</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <label className="form-label">Employee ID *</label>
                    <input required className="form-control" value={formData.id || ''} onChange={e => setFormData({...formData, id: e.target.value})} disabled={!!showEditForm} placeholder="e.g. EMP005" />
                  </div>
                  <div>
                    <label className="form-label">Date of Joining *</label>
                    <input required type="date" className="form-control" value={formData.doj || ''} onChange={e => setFormData({...formData, doj: e.target.value})} />
                  </div>
                  <div>
                    <label className="form-label">Department *</label>
                    <select required className="form-control" value={formData.dept || ''} onChange={e => setFormData({...formData, dept: e.target.value})}>
                      <option value="">Select Dept</option>
                      <option>Development</option>
                      <option>HR</option>
                      <option>Sales</option>
                      <option>Marketing</option>
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Designation *</label>
                    <input required className="form-control" value={formData.desig || ''} onChange={e => setFormData({...formData, desig: e.target.value})} placeholder="e.g. Software Developer" />
                  </div>
                  <div>
                    <label className="form-label">Employment Type</label>
                    <select className="form-control" value={formData.type || ''} onChange={e => setFormData({...formData, type: e.target.value})}>
                      <option>Full Time</option>
                      <option>Part Time</option>
                      <option>Contract</option>
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Employment Status</label>
                    <select className="form-control" value={formData.status || 'Active'} onChange={e => setFormData({...formData, status: e.target.value})}>
                      <option>Active</option>
                      <option>Inactive</option>
                    </select>
                  </div>
                </div>
              </section>

              <section>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, borderBottom: '1px solid var(--gray-200)', paddingBottom: '0.5rem', marginBottom: '1rem' }}>Work Information</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <label className="form-label">Office</label>
                    <select className="form-control" value={formData.office || ''} onChange={e => setFormData({...formData, office: e.target.value})}>
                      <option>Chennai Main Office</option>
                      <option>Chennai Branch</option>
                      <option>Remote</option>
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Default Work Mode</label>
                    <select className="form-control" value={formData.mode || ''} onChange={e => setFormData({...formData, mode: e.target.value})}>
                      <option>Office</option>
                      <option>WFH</option>
                      <option>Hybrid</option>
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Default Shift</label>
                    <select className="form-control" value={formData.shift || ''} onChange={e => setFormData({...formData, shift: e.target.value})}>
                      <option>General Shift</option>
                      <option>Morning Shift</option>
                      <option>Evening Shift</option>
                    </select>
                  </div>
                </div>
              </section>

              <section>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, borderBottom: '1px solid var(--gray-200)', paddingBottom: '0.5rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  Account Information <span className="badge badge-gray" style={{ fontSize: '0.75rem' }}>Prototype Only</span>
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <label className="form-label">App Role</label>
                    <select className="form-control" value={formData.role || 'Employee'} onChange={e => setFormData({...formData, role: e.target.value})}>
                      <option>Employee</option>
                      <option>HR / Staff</option>
                      <option>Admin</option>
                    </select>
                  </div>
                </div>
              </section>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '2rem', borderTop: '1px solid var(--gray-200)', paddingTop: '1.5rem' }}>
                <button type="button" onClick={() => { setShowAddForm(false); setShowEditForm(null); }} className="btn btn-outline">Cancel</button>
                <button type="submit" className="btn btn-primary">{showEditForm ? 'Update Employee' : 'Confirm & Add Employee'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Employee Profile Full/Wide Drawer */}
      {showProfile && (
        <div className="drawer-overlay" onClick={() => setShowProfile(null)}>
          <div className="drawer profile-drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header" style={{ borderBottom: 'none', paddingBottom: 0 }}>
              <button className="icon-button" onClick={() => setShowProfile(null)} style={{ position: 'absolute', right: '1.5rem', top: '1.5rem' }}><X size={20} /></button>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', marginBottom: '1.5rem' }}>
                <div className="avatar" style={{ width: '80px', height: '80px', fontSize: '2rem', backgroundColor: showProfile.status === 'Inactive' ? 'var(--gray-200)' : 'var(--primary-100)', color: showProfile.status === 'Inactive' ? 'var(--gray-500)' : 'var(--primary-700)' }}>
                  {showProfile.firstName[0]}{showProfile.lastName[0]}
                </div>
                <div>
                  <h2 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: '0.25rem' }}>{showProfile.firstName} {showProfile.lastName}</h2>
                  <div style={{ display: 'flex', gap: '1rem', color: 'var(--text-secondary)', fontSize: '0.875rem', flexWrap: 'wrap' }}>
                    <span>{showProfile.id}</span>
                    <span>•</span>
                    <span>{showProfile.dept}</span>
                    <span>•</span>
                    <span>{showProfile.desig}</span>
                    <span className={`badge ${showProfile.status === 'Active' ? 'badge-success' : showProfile.status === 'Inactive' ? 'badge-gray' : 'badge-warning'}`}>{showProfile.status}</span>
                  </div>
                </div>
              </div>
              
              <div style={{ display: 'flex', gap: '1.5rem', borderBottom: '1px solid var(--border-color)', overflowX: 'auto', paddingBottom: '1px' }}>
                {['Overview', 'Attendance', 'Leave', 'WFH', 'Payroll', 'Documents', 'Activity'].map(tab => (
                  <button 
                    key={tab} 
                    onClick={() => setProfileTab(tab)}
                    style={{ padding: '0.75rem 0', fontWeight: profileTab === tab ? 600 : 500, color: profileTab === tab ? 'var(--primary-700)' : 'var(--gray-500)', borderBottom: profileTab === tab ? '2px solid var(--primary-600)' : '2px solid transparent', backgroundColor: 'transparent', cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>
            
            <div className="drawer-body" style={{ backgroundColor: 'var(--gray-50)' }}>
              {profileTab === 'Overview' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  <div className="card">
                    <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>Employment Details</h3>
                    <div className="detail-grid">
                      <div className="detail-item"><span className="detail-label">Employee ID</span><span className="detail-value">{showProfile.id}</span></div>
                      <div className="detail-item"><span className="detail-label">Department</span><span className="detail-value">{showProfile.dept}</span></div>
                      <div className="detail-item"><span className="detail-label">Designation</span><span className="detail-value">{showProfile.desig}</span></div>
                      <div className="detail-item"><span className="detail-label">Date of Joining</span><span className="detail-value">01 Feb 2026</span></div>
                      <div className="detail-item"><span className="detail-label">Employment Type</span><span className="detail-value">Full Time</span></div>
                    </div>
                  </div>
                  <div className="card">
                    <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>Work Settings</h3>
                    <div className="detail-grid">
                      <div className="detail-item"><span className="detail-label">Base Office</span><span className="detail-value">{showProfile.office}</span></div>
                      <div className="detail-item"><span className="detail-label">Work Mode</span><span className="detail-value">{showProfile.mode}</span></div>
                      <div className="detail-item"><span className="detail-label">Current Shift</span><span className="detail-value">{showProfile.shift}</span></div>
                    </div>
                  </div>
                  <div className="card">
                    <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>Contact Info</h3>
                    <div className="detail-grid">
                      <div className="detail-item"><span className="detail-label">Email</span><span className="detail-value">{showProfile.email}</span></div>
                      <div className="detail-item"><span className="detail-label">Mobile</span><span className="detail-value">+91 {showProfile.mobile}</span></div>
                    </div>
                  </div>
                </div>
              )}
              {profileTab === 'Attendance' && (
                <div className="card">
                  <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>September 2026 Snapshot</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div style={{ padding: '1rem', backgroundColor: 'var(--success-50)', borderRadius: 'var(--radius-md)' }}><div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Present Days</div><div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--success)' }}>18</div></div>
                    <div style={{ padding: '1rem', backgroundColor: 'var(--danger-50)', borderRadius: 'var(--radius-md)' }}><div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Late Logins</div><div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--danger)' }}>3</div></div>
                  </div>
                  <button onClick={() => { setShowProfile(null); navigate('/admin/attendance'); }} className="btn btn-outline" style={{ width: '100%', marginTop: '1.5rem' }}>View Full Attendance</button>
                </div>
              )}
              {profileTab === 'Payroll' && (
                <div className="card">
                  <div style={{ backgroundColor: 'var(--gray-100)', padding: '1.5rem', borderRadius: 'var(--radius-md)', textAlign: 'center', marginBottom: '1.5rem' }}>
                    <LockIcon size={24} style={{ margin: '0 auto 0.5rem auto', color: 'var(--text-secondary)' }} />
                    <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Detailed payroll breakdown requires Payroll Admin privileges.</p>
                  </div>
                  <button onClick={() => { setShowProfile(null); navigate('/admin/payroll'); }} className="btn btn-outline" style={{ width: '100%' }}>Go to Payroll Module</button>
                </div>
              )}
              {/* Other tabs are mocked conceptually */}
              {['Leave', 'WFH', 'Documents', 'Activity'].includes(profileTab) && (
                <div className="card" style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-secondary)' }}>
                  <p>Mock data for {profileTab} tab. Use the sidebar modules for detailed views.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Assign Modals */}
      {assignShiftModal && (
        <div className="drawer-overlay" style={{ alignItems: 'center' }}>
          <div className="card" style={{ margin: 'auto', width: '100%', maxWidth: '400px', animation: 'slideUp 0.3s' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem' }}>Assign Shift</h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>Employee: <strong>{assignShiftModal.firstName} {assignShiftModal.lastName}</strong></p>
            <form onSubmit={handleAssignShift} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label className="form-label">Effective Date</label>
                <input type="date" required className="form-control" defaultValue="2026-09-25" />
              </div>
              <div>
                <label className="form-label">Shift</label>
                <select className="form-control" value={formData.shift || assignShiftModal.shift} onChange={e => setFormData({...formData, shift: e.target.value})}>
                  <option>General Shift</option>
                  <option>Morning Shift</option>
                  <option>Evening Shift</option>
                  <option>Night Shift</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                <button type="button" onClick={() => setAssignShiftModal(null)} className="btn btn-outline" style={{ flex: 1 }}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>Assign Shift</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {assignOfficeModal && (
        <div className="drawer-overlay" style={{ alignItems: 'center' }}>
          <div className="card" style={{ margin: 'auto', width: '100%', maxWidth: '400px', animation: 'slideUp 0.3s' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem' }}>Assign Office</h3>
            <form onSubmit={handleAssignOffice} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label className="form-label">Office</label>
                <select className="form-control" value={formData.office || assignOfficeModal.office} onChange={e => setFormData({...formData, office: e.target.value})}>
                  <option>Chennai Main Office</option>
                  <option>Chennai Branch</option>
                  <option>Remote</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                <button type="button" onClick={() => setAssignOfficeModal(null)} className="btn btn-outline" style={{ flex: 1 }}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>Assign Office</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Deactivate / Reactivate Modals */}
      {deactivateModal && (
        <div className="drawer-overlay" style={{ alignItems: 'center' }}>
          <div className="card" style={{ margin: 'auto', width: '100%', maxWidth: '400px', animation: 'slideUp 0.3s', borderTop: '4px solid var(--danger-600)' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem' }}>Deactivate Employee?</h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
              Deactivating <strong>{deactivateModal.firstName} {deactivateModal.lastName} ({deactivateModal.id})</strong> will change their employment status to Inactive and revoke system access. Historical records will be preserved.
            </p>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button type="button" onClick={() => setDeactivateModal(null)} className="btn btn-outline" style={{ flex: 1 }}>Cancel</button>
              <button onClick={handleDeactivate} className="btn btn-primary" style={{ flex: 1, backgroundColor: 'var(--danger-600)', borderColor: 'var(--danger-600)' }}>Deactivate</button>
            </div>
          </div>
        </div>
      )}

      {reactivateModal && (
        <div className="drawer-overlay" style={{ alignItems: 'center' }}>
          <div className="card" style={{ margin: 'auto', width: '100%', maxWidth: '400px', animation: 'slideUp 0.3s' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem' }}>Reactivate Employee</h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>Do you want to reactivate {reactivateModal.firstName} {reactivateModal.lastName}?</p>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button type="button" onClick={() => setReactivateModal(null)} className="btn btn-outline" style={{ flex: 1 }}>Cancel</button>
              <button onClick={handleReactivate} className="btn btn-primary" style={{ flex: 1 }}>Reactivate</button>
            </div>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {importModal && (
        <div className="drawer-overlay" style={{ alignItems: 'center' }}>
          <div className="card" style={{ margin: 'auto', width: '100%', maxWidth: '500px', animation: 'slideUp 0.3s' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem', display: 'flex', justifyContent: 'space-between' }}>
              Import Employees
              <button onClick={() => setImportModal(false)} className="icon-button"><X size={18}/></button>
            </h3>
            
            {importState === 'idle' && (
              <>
                <div style={{ border: '2px dashed var(--gray-300)', borderRadius: 'var(--radius-lg)', padding: '3rem 1rem', textAlign: 'center', backgroundColor: 'var(--gray-50)', marginBottom: '1.5rem' }}>
                  <Upload size={32} style={{ margin: '0 auto 1rem auto', color: 'var(--text-secondary)' }} />
                  <div style={{ fontWeight: 500, marginBottom: '0.25rem' }}>Drag and drop CSV or Excel file here</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>or click to browse</div>
                  <button onClick={simulateImport} className="btn btn-outline" style={{ marginTop: '1.5rem' }}>Choose File</button>
                </div>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <button className="btn btn-outline" style={{ fontSize: '0.75rem', padding: '0.25rem 0.75rem' }}><FileText size={14} style={{ marginRight: '0.25rem' }}/> Download Sample Template</button>
                </div>
              </>
            )}

            {importState === 'uploading' && (
              <div style={{ padding: '3rem', textAlign: 'center' }}>
                <div className="pulse-ring" style={{ width: '40px', height: '40px', margin: '0 auto 1rem auto', border: '3px solid var(--primary-500)', borderRadius: '50%', borderTopColor: 'transparent', animation: 'spin 1s linear infinite' }} />
                <div style={{ fontWeight: 500 }}>Processing file...</div>
              </div>
            )}

            {importState === 'done' && (
              <div style={{ textAlign: 'center' }}>
                <CheckCircle2 size={48} color="var(--success)" style={{ margin: '0 auto 1rem auto' }} />
                <h4 style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Import Successful</h4>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', fontSize: '0.875rem', marginBottom: '1.5rem', backgroundColor: 'var(--gray-50)', padding: '1rem', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ display: 'flex', flexDirection: 'column' }}><span style={{ fontSize: '1.25rem', fontWeight: 600 }}>128</span><span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Found</span></div>
                  <div style={{ display: 'flex', flexDirection: 'column' }}><span style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--success-600)' }}>120</span><span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Valid</span></div>
                  <div style={{ display: 'flex', flexDirection: 'column' }}><span style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--danger-600)' }}>8</span><span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Invalid</span></div>
                </div>
                <button onClick={() => { setImportModal(false); setImportState('idle'); showToast('120 employees imported'); }} className="btn btn-primary" style={{ width: '100%' }}>Done</button>
              </div>
            )}

          </div>
        </div>
      )}

      <style>{`
        
        
        
        
        
        
        .summary-card-small:hover { transform: translateY(-2px); box-shadow: var(--shadow-sm); }
        
        
        
        
        
        .selected-row { background-color: var(--primary-50); }
        
        .dropdown-menu { background: white; border: 1px solid var(--border-color); border-radius: var(--radius-md); box-shadow: var(--shadow-lg); padding: 0.5rem 0; min-width: 180px; }
        .dropdown-item { width: 100%; text-align: left; padding: 0.5rem 1rem; font-size: 0.875rem; display: flex; align-items: center; gap: 0.5rem; background: none; border: none; cursor: pointer; color: var(--gray-700); }
        .dropdown-item:hover { background-color: var(--gray-50); color: var(--gray-900); }
        .dropdown-item.danger { color: var(--danger-600); }
        .dropdown-item.danger:hover { background-color: var(--danger-50); }
        .dropdown-divider { height: 1px; background-color: var(--gray-200); margin: 0.25rem 0; }
        
        .drawer-overlay { position: fixed; inset: 0; background-color: rgba(0,0,0,0.4); z-index: 100; display: flex; justify-content: flex-end; }
        .drawer { background-color: var(--bg-surface); width: 100%; height: 100%; display: flex; flex-direction: column; box-shadow: var(--shadow-xl); animation: slideInRight 0.3s forwards; }
        .wide-drawer { max-width: min(520px, 100vw); }
        .profile-drawer { max-width: 800px; }
        .drawer-header { padding: 1.5rem; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; alignItems: center; }
        .drawer-body { padding: 1.5rem; overflow-y: auto; flex: 1; }
        
        .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }
        .detail-item { display: flex; flex-direction: column; gap: 0.25rem; }
        .detail-label { font-size: 0.75rem; color: var(--gray-500); }
        .detail-value { font-size: 0.875rem; font-weight: 500; color: var(--gray-900); }
        
        @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes slideDown { from { transform: translate(-50%, -100%); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }
        @keyframes spin { 100% { transform: rotate(360deg); } }
        
        @media (max-width: 768px) {
          .drawer-overlay { align-items: flex-end; }
          .drawer, .wide-drawer, .profile-drawer { height: 95vh; border-top-left-radius: var(--radius-xl); border-top-right-radius: var(--radius-xl); animation: slideUp 0.3s forwards; }
          .page-header { flex-direction: column; align-items: stretch; }
          .page-header > div:last-child { justify-content: space-between; }
        }
        
        .skeleton { background: linear-gradient(90deg, var(--gray-200) 25%, var(--gray-100) 50%, var(--gray-200) 75%); background-size: 200% 100%; animation: skeleton-loading 1.5s infinite; }
        @keyframes skeleton-loading { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
      `}</style>
    </div>
  );
};

// Helper since lucide-react Lock isn't imported
const LockIcon = ({size, style}: any) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style}>
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
    <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
  </svg>
);

export default AdminEmployees;


