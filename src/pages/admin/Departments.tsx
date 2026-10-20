import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Building2, Search, Plus, Filter, MoreVertical, X, CheckCircle2, 
  AlertTriangle, Users, Eye, Edit, Trash2, ShieldAlert
} from 'lucide-react';

import { departmentService } from '../../services/department/departmentService';
import RecordsModal from '../../components/common/RecordsModal';
import { clickableCardProps, EMPLOYEE_COLUMNS } from '../../services/common/cardDetails';
import { departmentCards, type DepartmentCard } from '../../services/common/orgCardRules';
import { toDepartmentEmployeeRows } from '../../services/department/departmentDetailRules';
import DepartmentDetailPanel, { type DepartmentEmployeesState } from '../../components/departments/DepartmentDetailPanel';
import PanelErrorBoundary from '../../components/common/PanelErrorBoundary';

const AdminDepartments: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  
  const [departments, setDepartments] = useState<any[]>([]);
  const [unassignedCount, setUnassignedCount] = useState(0);
  const [unassignedEmployees, setUnassignedEmployees] = useState<any[]>([]);
  const [cardError, setCardError] = useState<string | null>(null);
  const [openCard, setOpenCard] = useState<DepartmentCard | null>(null);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('All');
  
  const [activeMenu, setActiveMenu] = useState<string | null>(null);

  // Drawers & Modals
  const [showForm, setShowForm] = useState<string | boolean>(false); // false | true (add) | id (edit)
  const [showDetail, setShowDetail] = useState<any>(null);
  // Employees of the department open in View Details (loaded on open; stale responses ignored)
  const [detailEmployees, setDetailEmployees] = useState<DepartmentEmployeesState>({ status: 'loading' });
  const detailRequest = useRef(0);
  const [deactivateModal, setDeactivateModal] = useState<any>(null);

  // Form State
  const [formData, setFormData] = useState<any>({});
  const [formError, setFormError] = useState('');

  const fetchDepartments = async () => {
    setLoading(true);
    const res: any = await departmentService.getDepartments();
    const { data, unassigned, error } = res;
    setUnassignedEmployees(res.unassignedEmployees || []);
    setCardError(error?.message || res.unassignedError?.message || null);
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

  const cards = departmentCards(departments, unassignedEmployees);
  void unassignedCount;
  const filteredDepts = departments.filter(d => {
    const matchesSearch = d.name?.toLowerCase().includes(search.toLowerCase());
    const statusLabel = d.is_active ? 'Active' : 'Inactive';
    const matchesStatus = filterStatus === 'All' || statusLabel === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const loadDetailEmployees = async (departmentId: string) => {
    const req = ++detailRequest.current;
    setDetailEmployees({ status: 'loading' });
    try {
      const { data, error } = await departmentService.getDepartmentEmployees(departmentId);
      if (req !== detailRequest.current) return;
      if (error || !data) setDetailEmployees({ status: 'error', message: error?.message || 'No data returned.' });
      else setDetailEmployees({ status: 'ready', rows: toDepartmentEmployeeRows(data) });
    } catch (e: any) {
      if (req === detailRequest.current) setDetailEmployees({ status: 'error', message: e?.message || 'Network error.' });
    }
  };

  const closeDetail = useCallback(() => {
    detailRequest.current++;
    setShowDetail(null);
  }, []);

  const handleActionClick = (action: string, dept: any) => {
    setActiveMenu(null);
    switch(action) {
      case 'view': setShowDetail(dept); loadDetailEmployees(dept.id); break;
      case 'edit': {
        let parsedDesc = { desc: '', code: '', manager: '' };
        if (dept.description) {
          try {
            const parsed = JSON.parse(dept.description);
            parsedDesc = {
              desc: parsed.desc || '',
              code: parsed.code || '',
              manager: parsed.manager || ''
            };
          } catch (e) {
            parsedDesc.desc = dept.description;
          }
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
          <div className="tracking-kpi-card" {...clickableCardProps('Total Departments', () => setOpenCard('total'))}>
            <div className="sc-header"><div className="sc-icon"><Building2 size={18} /></div></div>
            <div className="sc-val">{cards.total.count}</div>
            <div className="sc-title">Total Departments</div>
          </div>
          <div className="tracking-kpi-card" {...clickableCardProps('Active Departments', () => setOpenCard('active'))}>
            <div className="sc-header"><div className="sc-icon" style={{ backgroundColor: 'var(--success-100)', color: 'var(--success)' }}><CheckCircle2 size={18} /></div></div>
            <div className="sc-val" style={{ color: 'var(--success)' }}>{cards.active.count}</div>
            <div className="sc-title">Active Departments</div>
          </div>
          <div className="tracking-kpi-card" {...clickableCardProps('Total Employees', () => setOpenCard('employees'))}>
            <div className="sc-header"><div className="sc-icon" style={{ backgroundColor: 'var(--primary-100)', color: 'var(--primary-700)' }}><Users size={18} /></div></div>
            <div className="sc-val" style={{ color: 'var(--primary-700)' }}>{cards.employees.count}</div>
            <div className="sc-title">Total Employees</div>
          </div>
          <div className="tracking-kpi-card" {...clickableCardProps('Unassigned Employees', () => setOpenCard('unassigned'))}>
            <div className="sc-header"><div className="sc-icon" style={{ backgroundColor: 'var(--warning-100)', color: 'var(--warning)' }}><AlertTriangle size={18} /></div></div>
            <div className="sc-val" style={{ color: 'var(--warning)' }}>{cards.unassigned.count}</div>
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
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search department name or code..." className="form-control" style={{ paddingLeft: '2.25rem' }} aria-label="Search department name or code" />
          </div>
          
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="form-control" style={{ width: 'auto' }} aria-label="Status">
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
                  let parsedDesc = { desc: '-', code: '-', manager: '-' };
                  if (dept.description) {
                    try {
                      const parsed = JSON.parse(dept.description);
                      parsedDesc = {
                        desc: parsed.desc || '-',
                        code: parsed.code || '-',
                        manager: parsed.manager || '-'
                      };
                    } catch (e) {
                      parsedDesc.desc = dept.description;
                    }
                  }
                  
                  return (
                  <tr key={dept.id}>
                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{dept.name}</div>
                      {parsedDesc.desc !== '-' && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{parsedDesc.desc}</div>
                      )}
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
                      <button onClick={() => setActiveMenu(activeMenu === dept.id ? null : dept.id)} className="icon-button" aria-label="More actions"><MoreVertical size={18}/></button>
                      
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
              <button className="icon-button" onClick={() => setShowForm(false)} aria-label="Close"><X size={20} /></button>
            </div>
            
            <form onSubmit={handleSaveForm} className="drawer-body" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              
              {formError && (
                <div style={{ padding: '0.75rem', backgroundColor: 'var(--danger-50)', color: 'var(--danger)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}>
                  <AlertTriangle size={16} /> {formError}
                </div>
              )}

              <div>
                <label className="form-label">Department Name *</label>
                <input required className="form-control" value={formData.name || ''} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="e.g. Development" aria-label="Department Name" />
              </div>
              
              <div>
                <label className="form-label">Department Code *</label>
                <input required className="form-control" style={{ textTransform: 'uppercase' }} value={formData.code || ''} onChange={e => setFormData({...formData, code: e.target.value})} placeholder="e.g. DEV" aria-label="Department Code" />
              </div>

              <div>
                <label className="form-label">Department Manager</label>
                <input className="form-control" value={formData.manager || ''} onChange={e => setFormData({...formData, manager: e.target.value})} placeholder="e.g. Rahul Kumar" aria-label="Department Manager" />
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>Optional. Maps to employee reporting structure.</div>
              </div>

              <div>
                <label className="form-label">Description</label>
                <textarea className="form-control" rows={3} value={formData.desc || ''} onChange={e => setFormData({...formData, desc: e.target.value})} placeholder="Briefly describe department functions..." aria-label="Description" />
              </div>

              <div>
                <label className="form-label">Status</label>
                <select className="form-control" value={formData.status || 'Active'} onChange={e => setFormData({...formData, status: e.target.value})} aria-label="Status">
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

      {/* Department Detail Drawer: a render error stays inside the panel instead of blanking the app */}
      {showDetail && (
        <PanelErrorBoundary
          resetKey={showDetail.id}
          fallback={() => (
            <div className="drawer-overlay" onClick={closeDetail}>
              <div className="drawer wide-drawer" role="alertdialog" aria-modal="true" aria-labelledby="department-detail-error" onClick={e => e.stopPropagation()}>
                <div className="drawer-header">
                  <h2 id="department-detail-error" style={{ fontSize: '1.25rem', fontWeight: 600 }}>Department details could not be displayed</h2>
                  <button className="icon-button" onClick={closeDetail} aria-label="Close"><X size={20} /></button>
                </div>
                <div className="drawer-body">
                  <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Something in this department's data could not be shown. The rest of the page still works; close this panel and try again.</p>
                </div>
              </div>
            </div>
          )}
        >
          <DepartmentDetailPanel
            department={showDetail}
            employees={detailEmployees}
            onClose={closeDetail}
            onRetry={() => loadDetailEmployees(showDetail.id)}
            onOpenEmployees={() => navigate('/admin/employees')}
          />
        </PanelErrorBoundary>
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
      {openCard && (() => {
        const deptCols = [{ key: 'department', label: 'Department' }, { key: 'status', label: 'Status' }, { key: 'employees', label: 'Employees', align: 'right' as const }];
        const empCols = [...EMPLOYEE_COLUMNS, { key: 'status', label: 'Status' }];
        const meta: Record<DepartmentCard, { title: string; label: string; cols: any[]; empty: string; explain: string }> = {
          total: { title: 'Total Departments', label: 'Departments', cols: deptCols, empty: 'No departments exist yet.', explain: 'Every department record, active or inactive.' },
          active: { title: 'Active Departments', label: 'Departments', cols: deptCols, empty: 'No active departments.', explain: 'Departments marked active.' },
          employees: { title: 'Employees by Department', label: 'Employees', cols: empCols, empty: 'No employees are assigned to a department.', explain: 'Every employee linked to a department (all statuses), grouped by department — the sum of the Employees column in the table.' },
          unassigned: { title: 'Unassigned Employees', label: 'Employees', cols: empCols, empty: 'Every active employee has a department.', explain: 'ACTIVE employees with no department set.' },
        };
        const m = meta[openCard];
        return <RecordsModal open title={m.title} total={cards[openCard].count} totalLabel={m.label} columns={m.cols} rows={cards[openCard].rows}
          loading={loading} error={openCard === 'unassigned' || openCard === 'employees' ? cardError : null} emptyMessage={m.empty} explanation={[m.explain]} onClose={() => setOpenCard(null)} />;
      })()}
    </div>
  );
};

export default AdminDepartments;


