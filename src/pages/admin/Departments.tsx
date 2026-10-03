import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Building2, Search, Plus, Filter, MoreVertical, X, CheckCircle2, 
  AlertTriangle, Users, Eye, Edit, Trash2, ShieldAlert
} from 'lucide-react';

import { departmentService } from '../../services/department/departmentService';

const AdminDepartments: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  
  const [departments, setDepartments] = useState<any[]>([]);
  const [unassignedCount, setUnassignedCount] = useState(0);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('All');
  
  const [activeMenu, setActiveMenu] = useState<string | null>(null);

  // Drawers & Modals
  const [showForm, setShowForm] = useState<string | boolean>(false); // false | true (add) | id (edit)
  const [showDetail, setShowDetail] = useState<any>(null);
  const [deactivateModal, setDeactivateModal] = useState<any>(null);

  // Form State
  const [formData, setFormData] = useState<any>({});
  const [formError, setFormError] = useState('');

  const fetchDepartments = async () => {
    setLoading(true);
    const { data, unassigned, error } = await departmentService.getDepartments();
    if (data) {
      setDepartments(data);
    }
    if (unassigned !== undefined) {
      setUnassignedCount(unassigned);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchDepartments();
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const filteredDepts = departments.filter(d => {
    const matchesSearch = d.name?.toLowerCase().includes(search.toLowerCase());
    const statusLabel = d.is_active ? 'Active' : 'Inactive';
    const matchesStatus = filterStatus === 'All' || statusLabel === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const handleActionClick = (action: string, dept: any) => {
    setActiveMenu(null);
    switch(action) {
      case 'view': setShowDetail(dept); break;
      case 'edit': {
        let parsedDesc = { desc: dept.description || '', code: '', manager: '' };
        try {
          const parsed = JSON.parse(dept.description || '{}');
          if (parsed.desc !== undefined) parsedDesc = parsed;
        } catch (e) {
          // ignore
        }
        setFormData({ 
          name: dept.name, 
          code: parsedDesc.code, 
          manager: parsedDesc.manager, 
          desc: parsedDesc.desc,
          status: dept.is_active ? 'Active' : 'Inactive'
        }); 
        setShowForm(dept.id); 
        break;
      }
      case 'deactivate': setDeactivateModal(dept); break;
    }
  };

  const handleSaveForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!formData.name) return setFormError('Department Name is required.');
    
    setLoading(true);
    if (!showForm || typeof showForm === 'boolean') {
      if (departments.some(d => d.name.toUpperCase() === formData.name.toUpperCase())) {
        setLoading(false);
        return setFormError('Department name already exists.');
      }
      const payload = { code: formData.code, manager: formData.manager, desc: formData.desc };
      const { error } = await departmentService.createDepartment({
        name: formData.name,
        description: JSON.stringify(payload),
        is_active: formData.status === 'Inactive' ? false : true
      });
      if (error) {
        setFormError(error.message);
        setLoading(false);
        return;
      }
      showToast('Department created successfully');
    } else {
      const payload = { code: formData.code, manager: formData.manager, desc: formData.desc };
      const { error } = await departmentService.updateDepartment(showForm as string, {
        name: formData.name,
        description: JSON.stringify(payload),
        is_active: formData.status === 'Inactive' ? false : true
      });
      if (error) {
        setFormError(error.message);
        setLoading(false);
        return;
      }
      showToast('Department updated successfully');
    }
    setShowForm(false);
    fetchDepartments();
  };

  const handleDeactivate = async () => {
    if (!deactivateModal) return;
    setLoading(true);
    await departmentService.deactivateDepartment(deactivateModal.id);
    setDeactivateModal(null);
    showToast('Department deactivated successfully');
    fetchDepartments();
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
          <h1 className="page-title">Departments</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>Manage company departments and their organizational structure.</p>
        </div>
        <button onClick={() => { setFormData({}); setFormError(''); setShowForm(true); }} className="btn btn-primary" style={{ fontSize: '0.875rem' }}><Plus size={16}/> Add Department</button>
      </div>

      {loading ? (
        <div className="skeleton-container" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
          {[...Array(4)].map((_, i) => <div key={i} className="skeleton" style={{ height: '90px', borderRadius: 'var(--radius-md)' }} />)}
        </div>
      ) : (
        <div className="kpi-grid">
          <div className="tracking-kpi-card">
            <div className="sc-header"><div className="sc-icon"><Building2 size={18} /></div></div>
            <div className="sc-val">{departments.length}</div>
            <div className="sc-title">Total Departments</div>
          </div>
          <div className="tracking-kpi-card">
            <div className="sc-header"><div className="sc-icon" style={{ backgroundColor: 'var(--success-100)', color: 'var(--success)' }}><CheckCircle2 size={18} /></div></div>
            <div className="sc-val" style={{ color: 'var(--success)' }}>{departments.filter(d => d.is_active).length}</div>
            <div className="sc-title">Active Departments</div>
          </div>
          <div className="tracking-kpi-card" onClick={() => navigate('/admin/employees')} style={{ cursor: 'pointer' }}>
            <div className="sc-header"><div className="sc-icon" style={{ backgroundColor: 'var(--primary-100)', color: 'var(--primary-700)' }}><Users size={18} /></div></div>
            <div className="sc-val" style={{ color: 'var(--primary-700)' }}>{departments.reduce((sum, d) => sum + (d.employeeCount || 0), 0)}</div>
            <div className="sc-title">Total Employees</div>
          </div>
          <div className="tracking-kpi-card">
            <div className="sc-header"><div className="sc-icon" style={{ backgroundColor: 'var(--warning-100)', color: 'var(--warning)' }}><AlertTriangle size={18} /></div></div>
            <div className="sc-val" style={{ color: 'var(--warning)' }}>{unassignedCount}</div>
            <div className="sc-title">Unassigned Employees</div>
          </div>
        </div>
      )}

      {/* Main Table Card */}
      <div className="card" style={{ padding: 0 }}>
        {/* Toolbar */}
        <div style={{ padding: '1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          
          <div style={{ position: 'relative', width: '250px', flex: '1 1 auto', maxWidth: '300px' }}>
            <Search size={18} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search department name or code..." className="form-control" style={{ paddingLeft: '2.25rem' }} />
          </div>
          
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="form-control" style={{ width: 'auto' }}>
            <option value="All">All Statuses</option>
            <option>Active</option>
            <option>Inactive</option>
          </select>
          
          {(search || filterStatus !== 'All') && (
            <button onClick={() => { setSearch(''); setFilterStatus('All'); }} className="btn btn-outline" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>Clear Filters</button>
          )}
        </div>

        {loading ? (
          <div className="skeleton" style={{ height: '300px', margin: '1rem' }} />
        ) : filteredDepts.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
            <Building2 size={48} style={{ margin: '0 auto 1rem auto', opacity: 0.3 }} />
            <h3 style={{ fontSize: '1.125rem', color: 'var(--text-primary)' }}>No departments found</h3>
            <p style={{ marginTop: '0.5rem' }}>Try changing your search or filters.</p>
            <button onClick={() => { setSearch(''); setFilterStatus('All'); }} className="btn btn-outline" style={{ marginTop: '1rem' }}>Clear Filters</button>
          </div>
        ) : (
          <div className="table-container">
            <table className="table" style={{ width: '100%', minWidth: '800px' }}>
              <thead>
                <tr>
                  <th>Department</th>
                  <th>Code</th>
                  <th>Manager</th>
                  <th style={{ textAlign: 'right' }}>Employees</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredDepts.map(dept => {
                  let parsedDesc = { desc: dept.description || '', code: '-', manager: '-' };
                  try {
                    const parsed = JSON.parse(dept.description || '{}');
                    if (parsed.desc !== undefined) parsedDesc = parsed;
                  } catch (e) {
                    // Not JSON, ignore
                  }
                  return (
                  <tr key={dept.id}>
                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{dept.name}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{parsedDesc.desc}</div>
                    </td>
                    <td style={{ fontWeight: 600, fontFamily: 'monospace' }}>{parsedDesc.code}</td>
                    <td>{parsedDesc.manager}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{dept.employeeCount || 0}</td>
                    <td>
                      <span className={`badge ${dept.is_active ? 'badge-success' : 'badge-gray'}`}>
                        {dept.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.875rem' }}>{new Date(dept.created_at).toLocaleDateString()}</td>
                    <td style={{ textAlign: 'right', position: 'relative' }}>
                      <button onClick={() => setActiveMenu(activeMenu === dept.id ? null : dept.id)} className="icon-button"><MoreVertical size={18}/></button>
                      
                      {activeMenu === dept.id && (
                        <div className="dropdown-menu" style={{ position: 'absolute', right: '30px', top: '12px', zIndex: 10 }}>
                          <button onClick={() => handleActionClick('view', dept)} className="dropdown-item"><Eye size={14}/> View Details</button>
                          <button onClick={() => handleActionClick('edit', dept)} className="dropdown-item"><Edit size={14}/> Edit Department</button>
                          <div className="dropdown-divider"></div>
                          {dept.is_active && (
                            <button onClick={() => handleActionClick('deactivate', dept)} className="dropdown-item danger"><Trash2 size={14}/> Deactivate</button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                )})}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Form Drawer */}
      {showForm && (
        <div className="drawer-overlay" onClick={() => setShowForm(false)}>
          <div className="drawer wide-drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>{typeof showForm === 'string' ? 'Edit Department' : 'Add Department'}</h2>
              <button className="icon-button" onClick={() => setShowForm(false)}><X size={20} /></button>
            </div>
            
            <form onSubmit={handleSaveForm} className="drawer-body" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              
              {formError && (
                <div style={{ padding: '0.75rem', backgroundColor: 'var(--danger-50)', color: 'var(--danger)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}>
                  <AlertTriangle size={16} /> {formError}
                </div>
              )}

              <div>
                <label className="form-label">Department Name *</label>
                <input required className="form-control" value={formData.name || ''} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="e.g. Development" />
              </div>
              
              <div>
                <label className="form-label">Department Code *</label>
                <input required className="form-control" style={{ textTransform: 'uppercase' }} value={formData.code || ''} onChange={e => setFormData({...formData, code: e.target.value})} placeholder="e.g. DEV" />
              </div>

              <div>
                <label className="form-label">Department Manager</label>
                <input className="form-control" value={formData.manager || ''} onChange={e => setFormData({...formData, manager: e.target.value})} placeholder="e.g. Rahul Kumar" />
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>Optional. Maps to employee reporting structure.</div>
              </div>

              <div>
                <label className="form-label">Description</label>
                <textarea className="form-control" rows={3} value={formData.desc || ''} onChange={e => setFormData({...formData, desc: e.target.value})} placeholder="Briefly describe department functions..." />
              </div>

              <div>
                <label className="form-label">Status</label>
                <select className="form-control" value={formData.status || 'Active'} onChange={e => setFormData({...formData, status: e.target.value})}>
                  <option>Active</option>
                  <option>Inactive</option>
                </select>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1rem', borderTop: '1px solid var(--gray-200)', paddingTop: '1.5rem' }}>
                <button type="button" onClick={() => setShowForm(false)} className="btn btn-outline">Cancel</button>
                <button type="submit" className="btn btn-primary">{typeof showForm === 'string' ? 'Update Department' : 'Create Department'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Department Detail Drawer */}
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
                  <div style={{ display: 'flex', gap: '1rem', fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                    <span>Manager: <strong>{showDetail.manager}</strong></span>
                    <span>Created: <strong>{showDetail.created}</strong></span>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <span className={`badge ${showDetail.status === 'Active' ? 'badge-success' : 'badge-gray'}`}>{showDetail.status}</span>
                  <button className="icon-button" onClick={() => setShowDetail(null)}><X size={20} /></button>
                </div>
              </div>
            </div>
            
            <div className="drawer-body" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
              
              <div className="card" style={{ padding: '1rem' }}>
                <h3 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--gray-700)', marginBottom: '0.5rem' }}>Description</h3>
                <p style={{ fontSize: '0.875rem', color: 'var(--text-primary)' }}>{showDetail.desc || 'No description provided.'}</p>
              </div>

              <div>
                <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  Employees in Department
                  <span className="badge badge-primary">{showDetail.employees} Total</span>
                </h3>
                
                {showDetail.employees > 0 ? (
                  <div className="table-container" style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)' }}>
                    <table className="table" style={{ width: '100%' }}>
                      <thead>
                        <tr>
                          <th>Employee</th>
                          <th>Designation</th>
                          <th>Office</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {showDetail.employees === 0 ? (
                          <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>No employees found in this department</td></tr>
                        ) : (
                          [].map((emp: any) => (
                            <tr key={emp.id} style={{ cursor: 'pointer' }} onClick={() => navigate('/admin/employees')}>
                              <td>
                                <div style={{ fontWeight: 500 }}>{emp.name}</div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{emp.id}</div>
                              </td>
                              <td style={{ fontSize: '0.875rem' }}>{emp.desig}</td>
                              <td style={{ fontSize: '0.875rem' }}>{emp.office}</td>
                              <td><span className={`badge ${emp.status === 'Active' ? 'badge-success' : 'badge-warning'}`}>{emp.status}</span></td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)', border: '1px dashed var(--gray-300)', borderRadius: 'var(--radius-md)' }}>
                    No employees currently assigned to this department.
                  </div>
                )}
                
                <div style={{ marginTop: '1rem', textAlign: 'center' }}>
                  <button onClick={() => navigate('/admin/employees')} className="btn btn-outline" style={{ fontSize: '0.875rem' }}>Manage in Employee Directory</button>
                </div>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* Deactivate Modal */}
      {deactivateModal && (
        <div className="drawer-overlay" style={{ alignItems: 'center' }}>
          <div className="card" style={{ margin: 'auto', width: '100%', maxWidth: '400px', animation: 'slideUp 0.3s', borderTop: '4px solid var(--danger-600)' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <ShieldAlert size={20} color="var(--danger-600)" /> Deactivate Department?
            </h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
              Deactivating <strong>{deactivateModal.name}</strong> will change its status to Inactive. <br/><br/>
              <strong>Warning:</strong> Deactivating a department will not delete historical employee or attendance records tied to it.
            </p>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button type="button" onClick={() => setDeactivateModal(null)} className="btn btn-outline" style={{ flex: 1 }}>Cancel</button>
              <button onClick={handleDeactivate} className="btn btn-primary" style={{ flex: 1, backgroundColor: 'var(--danger-600)', borderColor: 'var(--danger-600)' }}>Deactivate</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        
        
        
        
        
        
        .summary-card-small:hover { transform: translateY(-2px); box-shadow: var(--shadow-sm); }
        
        
        
        
        
        .dropdown-menu { background: white; border: 1px solid var(--border-color); border-radius: var(--radius-md); box-shadow: var(--shadow-lg); padding: 0.5rem 0; min-width: 160px; }
        .dropdown-item { width: 100%; text-align: left; padding: 0.5rem 1rem; font-size: 0.875rem; display: flex; align-items: center; gap: 0.5rem; background: none; border: none; cursor: pointer; color: var(--gray-700); }
        .dropdown-item:hover { background-color: var(--gray-50); color: var(--gray-900); }
        .dropdown-item.danger { color: var(--danger-600); }
        .dropdown-item.danger:hover { background-color: var(--danger-50); }
        .dropdown-divider { height: 1px; background-color: var(--gray-200); margin: 0.25rem 0; }
        
        .drawer-overlay { position: fixed; inset: 0; background-color: rgba(0,0,0,0.4); z-index: 100; display: flex; justify-content: flex-end; }
        .drawer { background-color: var(--bg-surface); width: 100%; height: 100%; display: flex; flex-direction: column; box-shadow: var(--shadow-xl); animation: slideInRight 0.3s forwards; }
        .wide-drawer { max-width: min(520px, 100vw); }
        .drawer-header { padding: 1.5rem; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; alignItems: center; }
        .drawer-body { padding: 1.5rem; overflow-y: auto; flex: 1; }
        
        @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes slideDown { from { transform: translate(-50%, -100%); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }
        
        @media (max-width: 768px) {
          .drawer-overlay { align-items: flex-end; }
          .drawer, .wide-drawer { height: 90vh; border-top-left-radius: var(--radius-xl); border-top-right-radius: var(--radius-xl); animation: slideUp 0.3s forwards; }
        }
        
        .skeleton { background: linear-gradient(90deg, var(--gray-200) 25%, var(--gray-100) 50%, var(--gray-200) 75%); background-size: 200% 100%; animation: skeleton-loading 1.5s infinite; }
        @keyframes skeleton-loading { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
      `}</style>
    </div>
  );
};

export default AdminDepartments;


