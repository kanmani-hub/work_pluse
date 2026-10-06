import { useDepartments } from '../../hooks/useDepartments';
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Plus, Search, Filter, Download, Upload, MoreVertical, X, CheckCircle2, 
  AlertTriangle, Users, UserCheck, UserX, Home, Settings, MapPin, Briefcase, 
  FileText, CalendarClock, Activity, Eye, Edit, CalendarOff, Clock, Wallet, Trash2, EyeOff
} from 'lucide-react';

import { employeeService } from '../../services/employees/employeeService';
import type { EmployeeWithRelations } from '../../services/employees/employeeService';
import { salaryService } from '../../services/payroll/salaryService';
import { payrollService } from '../../services/payroll/payrollService';
import SalaryEditor from '../../components/SalaryEditor';
import { exportService } from '../../services/export/exportService';

const AdminEmployees: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  
  const [employees, setEmployees] = useState<EmployeeWithRelations[]>([]);
  const { departments, loading: deptLoading } = useDepartments();
  const [offices, setOffices] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [shifts, setShifts] = useState<any[]>([]);
  
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
  const [deleteModal, setDeleteModal] = useState<any>(null);

  // Form State
  const [formData, setFormData] = useState<any>({});
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const loadData = async () => {
    setLoading(true);
    const [empRes, offRes, roleRes, shiftRes] = await Promise.all([
      employeeService.getEmployees(),
      // employeeService.getDepartments(),
      employeeService.getOffices(),
      employeeService.getRoles(),
      employeeService.getShifts()
    ]);
    
    if (empRes.error) {
      alert("Failed to load employees: " + empRes.error.message);
    } else if (empRes.data) {
      setEmployees(empRes.data);
    }
    // if (deptRes.data) setDepartments(deptRes.data);
    if (offRes.data) setOffices(offRes.data);
    if (roleRes.data) setRoles(roleRes.data);
    if (shiftRes.data) setShifts(shiftRes.data);
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  // Filter Logic
  const filteredEmployees = employees.filter(emp => {
    const searchString = `${emp.first_name} ${emp.last_name} ${emp.employee_code} ${emp.email}`.toLowerCase();
    const matchesSearch = searchString.includes(search.toLowerCase());
    const matchesDept = filterDept === 'All' ? true : filterDept === 'Unassigned' ? emp.department_id === null : emp.department_id === filterDept;
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
      case 'profile': 
        setShowProfile(emp); 
        break;
      case 'edit': 
        setFormData(emp); 
        setShowEditForm(emp.id); 
        salaryService.getEmployeeSalaryStructure(emp.id).then(res => {
          if (res.data) {
            const salaryData: any = res.data;
            setFormData((prev: any) => ({...prev, gross_salary: salaryData.basic_salary}));
          }
        });
        break;
      case 'deactivate': setDeactivateModal(emp); break;
      case 'reactivate': setReactivateModal(emp); break;
      case 'shift': setAssignShiftModal(emp); break;
      case 'office': setAssignOfficeModal(emp); break;
      case 'attend': navigate('/admin/attendance'); break;
      case 'leave': navigate('/admin/leave'); break;
      case 'wfh': navigate('/admin/wfh'); break;
      case 'payroll': navigate('/admin/payroll'); break;
      case 'delete': setDeleteModal(emp); break;
    }
  };



  const handleSaveForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.first_name || !formData.joining_date) {
      return alert('Required fields are missing.');
    }
    
    if (!showEditForm) {
      if (!formData.password || formData.password.length < 8) {
        return alert('Password must be at least 8 characters long.');
      }
      if (formData.password !== formData.confirm_password) {
        return alert('Passwords do not match.');
      }
    }
    
    setLoading(true);
    if (showEditForm) {
      const { gross_salary, ...empData } = formData;
      const { error } = await employeeService.updateEmployee(showEditForm, empData);
      if (error) {
        alert(error.message);
      } else {
        if (gross_salary !== undefined) {
          await salaryService.updateSalaryStructure(showEditForm, { basic_salary: Number(gross_salary) });
        }
        showToast('Employee updated successfully');
        setShowEditForm(null);
        loadData();
      }
    } else {
      const { gross_salary, ...empData } = formData;
      const { data, error } = await employeeService.createEmployee(empData);
      if (error) {
        alert(error.message);
      } else {
        if (data?.id && gross_salary !== undefined) {
          await salaryService.updateSalaryStructure(data.id, { basic_salary: Number(gross_salary) });
        }
        showToast('Employee added successfully');
        setShowAddForm(false);
        loadData();
      }
    }
    setLoading(false);
  };

  const handleDelete = async () => {
    setLoading(true);
    const { error } = await employeeService.deleteEmployee(deleteModal.id);
    if (error) {
      alert(error.message);
    } else {
      showToast('Employee deleted successfully');
      setDeleteModal(null);
      loadData();
    }
    setLoading(false);
  };

  const handleDeactivate = async () => {
    setLoading(true);
    const { error } = await employeeService.deactivateEmployee(deactivateModal.id);
    if (!error) {
      setDeactivateModal(null);
      showToast('Employee deactivated successfully');
      loadData();
    } else {
      alert(error.message);
      setLoading(false);
    }
  };

  const handleReactivate = async () => {
    setLoading(true);
    const { error } = await employeeService.updateEmployee(reactivateModal.id, { status: 'ACTIVE' });
    if (!error) {
      setReactivateModal(null);
      showToast('Employee reactivated successfully');
      loadData();
    } else {
      alert(error.message);
      setLoading(false);
    }
  };

  const handleAssignShift = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await employeeService.assignShift(assignShiftModal.id, formData.shift_id, formData.effective_date);
    if (!error) {
      setAssignShiftModal(null);
      showToast('Shift assigned successfully');
      loadData();
    } else {
      alert(error.message || 'Failed to assign shift');
      setLoading(false);
    }
  };

  const handleAssignOffice = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await employeeService.updateEmployee(assignOfficeModal.id, { office_id: formData.office_id });
    if (!error) {
      setAssignOfficeModal(null);
      showToast('Office assignment updated successfully');
      loadData();
    } else {
      alert(error.message);
      setLoading(false);
    }
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
          <button onClick={() => exportService.excel(filteredEmployees.map(e => ({
            employee_code: e.employee_code,
            name: `${e.first_name} ${e.last_name}`,
            email: e.email,
            department: (e.department as any)?.name || '-',
            office: (e.office as any)?.name || '-',
            role: (e.role as any)?.name || '-',
            status: e.status,
            phone: e.phone || '-',
            join_date: e.joining_date || '-',
          })), [
            { header: 'Code', key: 'employee_code', width: 10 },
            { header: 'Name', key: 'name', width: 22 },
            { header: 'Email', key: 'email', width: 28 },
            { header: 'Department', key: 'department', width: 18 },
            { header: 'Office', key: 'office', width: 16 },
            { header: 'Role', key: 'role', width: 16 },
            { header: 'Status', key: 'status', width: 12 },
            { header: 'Phone', key: 'phone', width: 14 },
            { header: 'Join Date', key: 'join_date', width: 14 },
          ], `employees_export_${new Date().toISOString().split('T')[0]}`)} className="btn btn-outline" style={{ fontSize: '0.875rem' }}><Download size={16}/> Export Excel</button>
          <button onClick={() => exportService.pdf(filteredEmployees.map(e => ({
            employee_code: e.employee_code,
            name: `${e.first_name} ${e.last_name}`,
            department: (e.department as any)?.name || '-',
            role: (e.role as any)?.name || '-',
            status: e.status,
          })), [
            { header: 'Code', key: 'employee_code' },
            { header: 'Name', key: 'name' },
            { header: 'Department', key: 'department' },
            { header: 'Role', key: 'role' },
            { header: 'Status', key: 'status' },
          ], 'Employee Directory', `employees_export_${new Date().toISOString().split('T')[0]}`, `Total: ${filteredEmployees.length} employees`)} className="btn btn-outline" style={{ fontSize: '0.875rem' }}><FileText size={16}/> Export PDF</button>
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
            <div className="sc-val">{employees.length}</div>
            <div className="sc-title">Total Employees</div>
          </div>
          <div className="tracking-kpi-card" onClick={() => setFilterStatus('ACTIVE')} style={{ cursor: 'pointer', borderColor: filterStatus==='ACTIVE' ? 'var(--success-300)' : '' }}>
            <div className="sc-header"><div className="sc-icon" style={{ backgroundColor: 'var(--success-100)', color: 'var(--success)' }}><UserCheck size={18} /></div></div>
            <div className="sc-val" style={{ color: 'var(--success)' }}>{employees.filter(e => e.status === 'ACTIVE').length}</div>
            <div className="sc-title">Active</div>
          </div>
          <div className="tracking-kpi-card" onClick={() => setFilterStatus('INACTIVE')} style={{ cursor: 'pointer', borderColor: filterStatus==='INACTIVE' ? 'var(--gray-300)' : '' }}>
            <div className="sc-header"><div className="sc-icon" style={{ backgroundColor: 'var(--gray-200)', color: 'var(--gray-700)' }}><UserX size={18} /></div></div>
            <div className="sc-val" style={{ color: 'var(--gray-700)' }}>{employees.filter(e => e.status === 'INACTIVE').length}</div>
            <div className="sc-title">Inactive</div>
          </div>
          <div className="tracking-kpi-card" onClick={() => setFilterStatus('On Leave')} style={{ cursor: 'pointer', borderColor: filterStatus==='On Leave' ? 'var(--warning-300)' : '' }}>
            <div className="sc-header"><div className="sc-icon" style={{ backgroundColor: 'var(--warning-100)', color: 'var(--warning)' }}><CalendarOff size={18} /></div></div>
            <div className="sc-val" style={{ color: 'var(--warning)' }}>0</div>
            <div className="sc-title">On Leave</div>
          </div>
          <div className="tracking-kpi-card">
            <div className="sc-header"><div className="sc-icon" style={{ backgroundColor: 'var(--primary-100)', color: 'var(--primary-700)' }}><Home size={18} /></div></div>
            <div className="sc-val" style={{ color: 'var(--primary-700)' }}>0</div>
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
            
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="form-control" style={{ width: 'auto' }}>
              <option value="All">All Statuses</option>
              <option value='ACTIVE'>Active</option>
              <option value='INACTIVE'>Inactive</option>
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
                        <div className="avatar" style={{ backgroundColor: emp.status === 'INACTIVE' ? 'var(--gray-300)' : 'var(--primary-100)', color: emp.status === 'INACTIVE' ? 'var(--gray-700)' : 'var(--primary-700)' }}>
                          {emp.first_name?.[0] || ''}{emp.last_name?.[0] || ''}
                        </div>
                        <div>
                          <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{emp.first_name} {emp.last_name}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 500 }}>{emp.employee_code} • {emp.department?.name || 'Unassigned'}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ fontSize: '0.875rem' }}>{emp.employee_code}</td>
                    <td style={{ fontSize: '0.875rem' }}>{emp.department?.name || 'Unassigned'}</td>
                    <td style={{ fontSize: '0.875rem' }}>{emp.office?.name || 'Unassigned'}</td>
                    <td style={{ fontSize: '0.875rem' }}>
                      {(() => {
                        let currentShift = null;
                        if (emp.shift_assignments && emp.shift_assignments.length > 0) {
                          const sortedAssignments = [...emp.shift_assignments].sort((a: any, b: any) => new Date(b.effective_date).getTime() - new Date(a.effective_date).getTime());
                          const mostRecent = sortedAssignments.find((sa: any) => new Date(sa.effective_date) <= new Date()) || sortedAssignments[0];
                          if (mostRecent && mostRecent.shift_templates) {
                            currentShift = mostRecent.shift_templates;
                          }
                        }
                        return (
                          <>
                            <div style={{ fontWeight: 500 }}>{currentShift ? currentShift.name : 'No Shift'}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                              {currentShift ? `${currentShift.start_time?.slice(0,5)} - ${currentShift.end_time?.slice(0,5)}` : '-'}
                            </div>
                          </>
                        );
                      })()}
                    </td>
                    <td>
                      <span className={`badge ${emp.status === 'ACTIVE' ? 'badge-success' : emp.status === 'INACTIVE' ? 'badge-gray' : 'badge-warning'}`}>
                        {emp.status}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', position: 'relative' }}>
                      <button onClick={() => setActiveMenu(activeMenu === emp.id ? null : emp.id)} className="icon-button"><MoreVertical size={18}/></button>
                      
                      {activeMenu === emp.id && (
                        <div className="dropdown-menu" style={{ position: 'absolute', right: '30px', top: '12px', zIndex: 10 }}>
                          <button onClick={() => handleActionClick('profile', emp)} className="dropdown-item"><Eye size={14}/> View Profile</button>
                          <button onClick={() => handleActionClick('edit', emp)} className="dropdown-item"><Edit size={14}/> Edit Employee</button>
                          {emp.status !== 'INACTIVE' && (
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
                          <div className="dropdown-divider"></div>
                          <button onClick={() => handleActionClick('delete', emp)} className="dropdown-item danger"><Trash2 size={14}/> Delete</button>
                          {emp.status === 'INACTIVE' && (
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
                    <input required className="form-control" value={formData.first_name || ''} onChange={e => setFormData({...formData, first_name: e.target.value})} placeholder="e.g. Arun" />
                  </div>
                  <div>
                    <label className="form-label">Last Name</label>
                    <input className="form-control" value={formData.last_name || ''} onChange={e => setFormData({...formData, last_name: e.target.value})} placeholder="e.g. Kumar" />
                  </div>
                  <div>
                    <label className="form-label">Email *</label>
                    <input required type="email" className="form-control" value={formData.email || ''} onChange={e => setFormData({...formData, email: e.target.value})} placeholder="arun@example.com" />
                  </div>
                  <div>
                    <label className="form-label">Mobile Number</label>
                    <input className="form-control" value={formData.phone || ''} onChange={e => setFormData({...formData, phone: e.target.value})} placeholder="9876543210" />
                  </div>
                </div>
              </section>

              <section>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, borderBottom: '1px solid var(--gray-200)', paddingBottom: '0.5rem', marginBottom: '1rem' }}>Employment Information</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <label className="form-label">Employee Code</label>
                    <input className="form-control" value={formData.employee_code || ''} onChange={e => setFormData({...formData, employee_code: e.target.value})} disabled={true} placeholder={showEditForm ? "" : "Auto-generated"} />
                  </div>
                  <div>
                    <label className="form-label">Date of Joining *</label>
                    <input required type="date" className="form-control" value={formData.joining_date || ''} onChange={e => setFormData({...formData, joining_date: e.target.value})} />
                  </div>
                  <div>
                    <label className="form-label">Department</label>
                    <select className="form-control" value={formData.department_id || ''} onChange={e => setFormData({...formData, department_id: e.target.value})}>
                      <option value="">Select Dept</option>
                      {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Designation</label>
                    <input className="form-control" value={formData.designation || ''} onChange={e => setFormData({...formData, designation: e.target.value})} placeholder="e.g. Software Developer" />
                  </div>
                  <div>
                    <label className="form-label">Employment Type</label>
                    <select className="form-control" value={formData.employment_type || ''} onChange={e => setFormData({...formData, employment_type: e.target.value})}>
                      <option>Full Time</option>
                      <option>Part Time</option>
                      <option>Contract</option>
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Employment Status</label>
                    <select className="form-control" value={formData.status || 'Active'} onChange={e => setFormData({...formData, status: e.target.value})}>
                      <option value='ACTIVE'>Active</option>
                      <option value='INACTIVE'>Inactive</option>
                    </select>
                  </div>
                </div>
              </section>

              <section>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, borderBottom: '1px solid var(--gray-200)', paddingBottom: '0.5rem', marginBottom: '1rem' }}>Work Information</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <label className="form-label">Office</label>
                    <select className="form-control" value={formData.office_id || ''} onChange={e => setFormData({...formData, office_id: e.target.value})}>
                      <option value="">Select Office</option>
                      {offices.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </div>
                </div>
              </section>

              <section>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, borderBottom: '1px solid var(--gray-200)', paddingBottom: '0.5rem', marginBottom: '1rem' }}>Salary Information</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <label className="form-label">Gross Salary *</label>
                    <input required type="number" min="0" className="form-control" value={formData.gross_salary || ''} onChange={e => setFormData({...formData, gross_salary: e.target.value})} placeholder="e.g. 50000" />
                  </div>
                </div>
              </section>

              <section>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, borderBottom: '1px solid var(--gray-200)', paddingBottom: '0.5rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  Account Role
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <label className="form-label">System Role</label>
                    <select className="form-control" value={formData.role_id || ''} onChange={e => setFormData({...formData, role_id: e.target.value})}>
                      <option value="">Select Role</option>
                      {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </div>
                </div>
              </section>

              {!showEditForm && (
                <section>
                  <h3 style={{ fontSize: '1rem', fontWeight: 600, borderBottom: '1px solid var(--gray-200)', paddingBottom: '0.5rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    Authentication
                  </h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div>
                      <label className="form-label">Temporary Password *</label>
                      <div style={{ position: 'relative' }}>
                        <input required type={showPassword ? "text" : "password"} minLength={8} className="form-control" value={formData.password || ''} onChange={e => setFormData({...formData, password: e.target.value})} placeholder="At least 8 characters" style={{ paddingRight: '2.5rem' }} />
                        <button type="button" onClick={() => setShowPassword(!showPassword)} style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-500)', padding: 0, display: 'flex' }} aria-label={showPassword ? "Hide password" : "Show password"} title={showPassword ? "Hide password" : "Show password"}>
                          {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="form-label">Confirm Password *</label>
                      <div style={{ position: 'relative' }}>
                        <input required type={showConfirmPassword ? "text" : "password"} minLength={8} className="form-control" value={formData.confirm_password || ''} onChange={e => setFormData({...formData, confirm_password: e.target.value})} placeholder="Confirm password" style={{ paddingRight: '2.5rem' }} />
                        <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-500)', padding: 0, display: 'flex' }} aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"} title={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}>
                          {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                      </div>
                    </div>
                  </div>
                </section>
              )}

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
                <div className="avatar" style={{ width: '80px', height: '80px', fontSize: '2rem', backgroundColor: showProfile.status === 'INACTIVE' ? 'var(--gray-200)' : 'var(--primary-100)', color: showProfile.status === 'INACTIVE' ? 'var(--gray-500)' : 'var(--primary-700)' }}>
                  {showProfile.first_name?.[0]}{showProfile.last_name?.[0]}
                </div>
                <div>
                  <h2 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: '0.25rem' }}>{showProfile.first_name} {showProfile.last_name}</h2>
                  <div style={{ display: 'flex', gap: '1rem', color: 'var(--text-secondary)', fontSize: '0.875rem', flexWrap: 'wrap' }}>
                    <span>{showProfile.employee_code}</span>
                    <span>•</span>
                    <span>{showProfile.department?.name || 'Unassigned'}</span>
                    <span>•</span>
                    <span>{showProfile.designation || 'No Designation'}</span>
                    <span className={`badge ${showProfile.status === 'ACTIVE' ? 'badge-success' : showProfile.status === 'INACTIVE' ? 'badge-gray' : 'badge-warning'}`}>{showProfile.status}</span>
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
                      <div className="detail-item"><span className="detail-label">Employee ID</span><span className="detail-value">{showProfile.employee_code}</span></div>
                      <div className="detail-item"><span className="detail-label">Department</span><span className="detail-value">{showProfile.department?.name || 'Unassigned'}</span></div>
                      <div className="detail-item"><span className="detail-label">Designation</span><span className="detail-value">{showProfile.designation || '-'}</span></div>
                      <div className="detail-item"><span className="detail-label">Date of Joining</span><span className="detail-value">{showProfile.joining_date}</span></div>
                      <div className="detail-item"><span className="detail-label">Employment Type</span><span className="detail-value">{showProfile.employment_type || '-'}</span></div>
                    </div>
                  </div>
                  <div className="card">
                    <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>Work Settings</h3>
                    <div className="detail-grid">
                      <div className="detail-item"><span className="detail-label">Base Office</span><span className="detail-value">{showProfile.office?.name || 'Unassigned'}</span></div>
                      <div className="detail-item"><span className="detail-label">Work Mode</span><span className="detail-value">{/*showProfile.mode*/ 'Office'}</span></div>
                      <div className="detail-item"><span className="detail-label">Current Shift</span><span className="detail-value">{/*showProfile.shift*/ 'General'}</span></div>
                    </div>
                  </div>
                  <div className="card">
                    <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>Contact Info</h3>
                    <div className="detail-grid">
                      <div className="detail-item"><span className="detail-label">Email</span><span className="detail-value">{showProfile.email}</span></div>
                      <div className="detail-item"><span className="detail-label">Mobile</span><span className="detail-value">{showProfile.phone ? `+91 ${showProfile.phone}` : '-'}</span></div>
                    </div>
                  </div>
                </div>
              )}
              {profileTab === 'Attendance' && (
                <div className="card">
                  <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>Recent Attendance</h3>
                  <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--text-secondary)' }}>
                    Detailed attendance records are available in the Attendance module.
                  </div>
                  <button onClick={() => { setShowProfile(null); navigate('/admin/attendance'); }} className="btn btn-outline" style={{ width: '100%', marginTop: '1.5rem' }}>View Full Attendance</button>
                </div>
              )}
              {profileTab === 'Payroll' && (
                <div className="card">
                  <SalaryEditor employeeId={showProfile.id} />
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

      {/* Delete Modal */}
      {deleteModal && (
        <div className="modal-overlay" onClick={() => setDeleteModal(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Delete Employee?</h2>
              <button className="icon-button" onClick={() => setDeleteModal(null)}><X size={20} /></button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', padding: '1rem', backgroundColor: 'var(--danger-50)', borderRadius: 'var(--radius-md)', color: 'var(--danger)' }}>
                <AlertTriangle size={24} />
                <p style={{ fontSize: '0.875rem', fontWeight: 500 }}>Are you sure you want to delete this employee? This action cannot be undone.</p>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
                <p><strong>Employee:</strong> {deleteModal.first_name} {deleteModal.last_name}</p>
                <p><strong>Employee Code:</strong> {deleteModal.employee_code}</p>
                <p><strong>Email:</strong> {deleteModal.email}</p>
              </div>
            </div>
            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
              <button className="btn-secondary" onClick={() => setDeleteModal(null)}>Cancel</button>
              <button className="btn-danger" onClick={handleDelete}>Delete Employee</button>
            </div>
          </div>
        </div>
      )}

      {/* Assign Modals */}
      {assignShiftModal && (
        <div className="drawer-overlay" style={{ alignItems: 'center' }}>
          <div className="card" style={{ margin: 'auto', width: '100%', maxWidth: '400px', animation: 'slideUp 0.3s' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem' }}>Assign Shift</h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>Employee: <strong>{assignShiftModal.first_name} {assignShiftModal.last_name}</strong></p>
            <form onSubmit={handleAssignShift} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label className="form-label">Effective Date</label>
                <input type="date" required className="form-control" value={formData.effective_date || new Date().toISOString().split('T')[0]} onChange={e => setFormData({...formData, effective_date: e.target.value})} />
              </div>
              <div>
                <label className="form-label">Shift</label>
                <select className="form-control" required value={formData.shift_id || ''} onChange={e => setFormData({...formData, shift_id: e.target.value})}>
                  <option value="">Select a shift...</option>
                  {shifts.map(s => (
                    <option key={s.id} value={s.id}>{s.name} ({s.start_time} - {s.end_time})</option>
                  ))}
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
                <select className="form-control" value={formData.office_id || assignOfficeModal.office_id || ''} onChange={e => setFormData({...formData, office_id: e.target.value})}>
                  <option value="">Select an office...</option>
                  {offices.map(o => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
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
              Deactivating <strong>{deactivateModal.first_name} {deactivateModal.last_name} ({deactivateModal.employee_code})</strong> will change their employment status to Inactive and revoke system access. Historical records will be preserved.
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
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>Do you want to reactivate {reactivateModal.first_name} {reactivateModal.last_name}?</p>
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
                  <div style={{ display: 'flex', flexDirection: 'column' }}><span style={{ fontSize: '1.25rem', fontWeight: 600 }}>0</span><span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Found</span></div>
                  <div style={{ display: 'flex', flexDirection: 'column' }}><span style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--success-600)' }}>0</span><span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Valid</span></div>
                  <div style={{ display: 'flex', flexDirection: 'column' }}><span style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--danger-600)' }}>0</span><span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Invalid</span></div>
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


