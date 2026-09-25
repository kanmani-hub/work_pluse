import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Banknote, Download, Settings, ChevronLeft, ChevronRight,
  Search, Filter, CheckCircle2, AlertTriangle, Eye, X, 
  FileText, Activity, ShieldCheck, History, Edit, 
  Unlock, Lock, CheckCircle
} from 'lucide-react';

const mockKPIs = {
  total: 48, generated: 48, underReview: 8, approved: 35, paymentPending: 5, paid: 30,
  gross: '₹24,00,000', deductions: '₹1,25,000', net: '₹22,75,000'
};

const mockPayroll = [
  {
    id: 'pr1', empId: 'EMP001', name: 'Arun Kumar', dept: 'Engineering', 
    gross: 50000, workingDays: 26, present: 23, leave: 2, lop: 1, 
    deductions: 2423, overtime: 850, net: 48427, status: 'UNDER REVIEW',
    paymentDetails: null
  },
  {
    id: 'pr2', empId: 'EMP002', name: 'Priya Sharma', dept: 'HR', 
    gross: 45000, workingDays: 26, present: 26, leave: 0, lop: 0, 
    deductions: 0, overtime: 0, net: 45000, status: 'PAYMENT PENDING',
    paymentDetails: null
  },
  {
    id: 'pr3', empId: 'EMP003', name: 'Kumar Raj', dept: 'Support', 
    gross: 35000, workingDays: 26, present: 25, leave: 0, lop: 1, 
    deductions: 1346.15, overtime: 1200, net: 34853.85, status: 'PAID',
    paymentDetails: { date: '30 Sep 2026', method: 'Bank Transfer', ref: 'TXN987654321', by: 'Admin' }
  },
  {
    id: 'pr4', empId: 'EMP004', name: 'Anitha S', dept: 'Finance', 
    gross: 60000, workingDays: 26, present: 24, leave: 2, lop: 0, 
    deductions: 0, overtime: 0, net: 60000, status: 'APPROVED',
    paymentDetails: null
  }
];

const AdminPayroll: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  
  // Filters
  const [search, setSearch] = useState('');
  const [filterDept, setFilterDept] = useState('All');
  const [filterStatus, setFilterStatus] = useState('All');
  
  // Drawers & Modals
  const [detailDrawer, setDetailDrawer] = useState<any>(null);
  const [generateModal, setGenerateModal] = useState(false);
  const [paymentModal, setPaymentModal] = useState<any>(null); // holds emp id
  const [settingsDrawer, setSettingsDrawer] = useState(false);
  const [bulkApproveModal, setBulkApproveModal] = useState(false);
  
  // Forms
  const [paymentForm, setPaymentForm] = useState({ date: '2026-09-30', method: 'Bank Transfer', ref: '', remarks: '' });
  
  const [payrolls, setPayrolls] = useState(mockPayroll);
  const [globalStatus, setGlobalStatus] = useState('UNDER REVIEW');

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 700);
    return () => clearTimeout(timer);
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const filteredData = payrolls.filter(p => {
    const matchSearch = p.name.toLowerCase().includes(search.toLowerCase()) || p.empId.toLowerCase().includes(search.toLowerCase());
    const matchDept = filterDept === 'All' || p.dept === filterDept;
    const matchStatus = filterStatus === 'All' || p.status === filterStatus;
    return matchSearch && matchDept && matchStatus;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'DRAFT': return <span className="badge badge-gray">DRAFT</span>;
      case 'CALCULATED': return <span className="badge badge-primary">CALCULATED</span>;
      case 'UNDER REVIEW': return <span className="badge badge-warning">UNDER REVIEW</span>;
      case 'APPROVED': return <span className="badge" style={{ backgroundColor: 'var(--purple-100)', color: 'var(--purple-800)' }}>APPROVED</span>;
      case 'PAYMENT PENDING': return <span className="badge" style={{ backgroundColor: 'var(--primary-100)', color: 'var(--primary-800)' }}>PAYMENT PENDING</span>;
      case 'PAID': return <span className="badge badge-success">PAID</span>;
      case 'CLOSED': return <span className="badge badge-gray">CLOSED</span>;
      default: return <span className="badge badge-gray">{status}</span>;
    }
  };

  const handleGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    setGenerateModal(false);
    setGlobalStatus('CALCULATED');
    showToast('September 2026 payroll calculated successfully.');
  };

  const handleApprove = (e: React.FormEvent) => {
    e.preventDefault();
    setBulkApproveModal(false);
    setGlobalStatus('APPROVED');
    setPayrolls(prev => prev.map(p => p.status === 'UNDER REVIEW' ? { ...p, status: 'APPROVED' } : p));
    if (detailDrawer?.status === 'UNDER REVIEW') setDetailDrawer({ ...detailDrawer, status: 'APPROVED' });
    showToast('Payroll approved successfully.');
  };
  
  const handleRecordPayment = (e: React.FormEvent) => {
    e.preventDefault();
    setPayrolls(prev => prev.map(p => p.id === paymentModal ? { 
      ...p, 
      status: 'PAID',
      paymentDetails: { date: paymentForm.date, method: paymentForm.method, ref: paymentForm.ref, by: 'Admin User' }
    } : p));
    if (detailDrawer?.id === paymentModal) {
      setDetailDrawer({
        ...detailDrawer, 
        status: 'PAID',
        paymentDetails: { date: paymentForm.date, method: paymentForm.method, ref: paymentForm.ref, by: 'Admin User' }
      });
    }
    setPaymentModal(null);
    showToast('Payment recorded successfully.');
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
      <div className="page-header" style={{ marginBottom: 0, flexWrap: 'wrap', gap: '1rem', minWidth: 0, width: '100%' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 className="page-title">Payroll Management</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem', overflowWrap: 'anywhere', whiteSpace: 'normal' }}>Manage monthly salary calculations, deductions, approvals, payments, and payslips.</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={() => setSettingsDrawer(true)} className="btn btn-outline" style={{ fontSize: '0.875rem' }}><Settings size={16}/> Payroll Settings</button>
          <button onClick={() => showToast('Payroll export prepared successfully.')} className="btn btn-outline" style={{ fontSize: '0.875rem' }}><Download size={16}/> Export</button>
          <button onClick={() => setGenerateModal(true)} className="btn btn-primary" style={{ fontSize: '0.875rem' }}><Activity size={16}/> Generate</button>
        </div>
      </div>

      {/* Month Selector */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', borderBottom: '1px solid var(--gray-200)', paddingBottom: '1rem' }}>
        <div style={{ fontSize: '1.125rem', fontWeight: 600 }}>Payroll Period: <span style={{ color: 'var(--primary-700)' }}>September 2026</span></div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-surface-elevated)' }}>
            <button className="icon-button" style={{ borderRight: '1px solid var(--border-color)', borderRadius: 'var(--radius-md) 0 0 var(--radius-md)', padding: '0.5rem' }}><ChevronLeft size={16}/></button>
            <div style={{ padding: '0.5rem 1rem', fontSize: '0.875rem', fontWeight: 600 }}>September 2026</div>
            <button className="icon-button" style={{ borderLeft: '1px solid var(--border-color)', borderRadius: '0 var(--radius-md) var(--radius-md) 0', padding: '0.5rem' }}><ChevronRight size={16}/></button>
          </div>
          <button className="btn btn-outline" style={{ fontSize: '0.875rem', padding: '0.5rem 1rem' }}>Current Month</button>
        </div>
      </div>

      {loading ? (
        <div className="skeleton-container" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '1rem' }}>
          {[...Array(9)].map((_, i) => <div key={i} className="skeleton" style={{ height: '70px', borderRadius: 'var(--radius-md)' }} />)}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', width: '100%', minWidth: 0 }}>
          <div className="kpi-grid">
            <div className="summary-card-small"><div className="sc-val">{mockKPIs.total}</div><div className="sc-title">Total Employees</div></div>
            <div className="summary-card-small"><div className="sc-val">{mockKPIs.generated}</div><div className="sc-title">Payroll Generated</div></div>
            <div className="summary-card-small cursor-pointer" onClick={() => setFilterStatus('UNDER REVIEW')}><div className="sc-val" style={{ color: 'var(--warning)' }}>{mockKPIs.underReview}</div><div className="sc-title">Under Review</div></div>
            <div className="summary-card-small cursor-pointer" onClick={() => setFilterStatus('APPROVED')}><div className="sc-val" style={{ color: 'var(--purple-700)' }}>{mockKPIs.approved}</div><div className="sc-title">Approved</div></div>
            <div className="summary-card-small cursor-pointer" onClick={() => setFilterStatus('PAYMENT PENDING')}><div className="sc-val" style={{ color: 'var(--primary-700)' }}>{mockKPIs.paymentPending}</div><div className="sc-title">Payment Pending</div></div>
            <div className="summary-card-small cursor-pointer" onClick={() => setFilterStatus('PAID')}><div className="sc-val" style={{ color: 'var(--success)' }}>{mockKPIs.paid}</div><div className="sc-title">Paid</div></div>
          </div>
          
          <div className="payroll-financial-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px', width: '100%', minWidth: 0 }}>
            <div className="summary-card-small">
              <div className="sc-title">Gross Payroll</div>
              <div className="financial-value" style={{ fontSize: 'clamp(22px, 3vw, 40px)', lineHeight: 1.05, whiteSpace: 'normal', overflowWrap: 'anywhere', fontWeight: 700, color: 'var(--text-primary)' }}>{mockKPIs.gross}</div>
            </div>
            <div className="summary-card-small">
              <div className="sc-title">Total Deductions</div>
              <div className="financial-value" style={{ fontSize: 'clamp(22px, 3vw, 40px)', lineHeight: 1.05, whiteSpace: 'normal', overflowWrap: 'anywhere', fontWeight: 700, color: 'var(--danger)' }}>{mockKPIs.deductions}</div>
            </div>
            <div className="summary-card-small" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--success)' }}>
              <div className="sc-title" style={{ color: 'var(--success)' }}>Net Payroll</div>
              <div className="financial-value" style={{ fontSize: 'clamp(22px, 3vw, 40px)', lineHeight: 1.05, whiteSpace: 'normal', overflowWrap: 'anywhere', fontWeight: 800, color: 'var(--success)' }}>{mockKPIs.net}</div>
            </div>
          </div>
        </div>
      )}

      {/* Progress Banner */}
      <div className="card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem', backgroundColor: 'var(--bg-surface-elevated)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>September 2026 Payroll</h3>
            <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>Status: {getStatusBadge(globalStatus)}</div>
          </div>
          {globalStatus === 'UNDER REVIEW' && <button onClick={() => setBulkApproveModal(true)} className="btn btn-primary" style={{ fontSize: '0.875rem' }}>Approve Payroll</button>}
          {globalStatus === 'APPROVED' && <button className="btn btn-outline" style={{ fontSize: '0.875rem', color: 'var(--primary-700)', borderColor: 'var(--primary-300)' }}>Proceed to Payments</button>}
        </div>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem', position: 'relative' }}>
          <div style={{ position: 'absolute', top: '12px', left: '20px', right: '20px', height: '2px', backgroundColor: 'var(--gray-200)', zIndex: 0 }}></div>
          {['Draft', 'Calculated', 'Under Review', 'Approved', 'Payment Pending', 'Paid', 'Closed'].map((step, i) => {
            const steps = ['DRAFT', 'CALCULATED', 'UNDER REVIEW', 'APPROVED', 'PAYMENT PENDING', 'PAID', 'CLOSED'];
            const currentIndex = steps.indexOf(globalStatus);
            const isCompleted = i <= currentIndex;
            const isCurrent = i === currentIndex;
            
            return (
              <div key={step} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', zIndex: 1, backgroundColor: 'var(--bg-surface-elevated)', padding: '0 0.5rem' }}>
                <div style={{ 
                  width: '24px', height: '24px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  backgroundColor: isCurrent ? 'var(--primary-600)' : isCompleted ? 'var(--success)' : 'var(--gray-200)',
                  color: 'var(--bg-primary)', fontSize: '0.75rem', fontWeight: 600, border: isCurrent ? '4px solid var(--primary-100)' : 'none'
                }}>
                  {isCompleted && !isCurrent ? <CheckCircle size={14}/> : isCurrent ? '●' : '○'}
                </div>
                <div style={{ fontSize: '0.75rem', fontWeight: isCurrent ? 700 : 500, color: isCurrent ? 'var(--primary-700)' : isCompleted ? 'var(--gray-800)' : 'var(--gray-400)' }}>{step}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Table */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', width: '220px' }}>
            <Search size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search employee..." className="form-control" style={{ paddingLeft: '2.25rem', fontSize: '0.875rem' }} />
          </div>
          <select value={filterDept} onChange={e => setFilterDept(e.target.value)} className="form-control" style={{ width: 'auto', fontSize: '0.875rem' }}>
            <option value="All">All Departments</option><option>Engineering</option><option>HR</option><option>Finance</option>
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="form-control" style={{ width: 'auto', fontSize: '0.875rem' }}>
            <option value="All">All Statuses</option><option>UNDER REVIEW</option><option>APPROVED</option><option>PAYMENT PENDING</option><option>PAID</option>
          </select>
          <button className="btn btn-outline" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}><Filter size={14} style={{ marginRight: '0.25rem' }}/> More</button>
          {(search || filterDept !== 'All' || filterStatus !== 'All') && (
            <button onClick={() => { setSearch(''); setFilterDept('All'); setFilterStatus('All'); }} className="btn btn-outline" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>Clear</button>
          )}
        </div>

        {loading ? (
          <div className="skeleton" style={{ height: '400px', margin: '1rem' }} />
        ) : filteredData.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
            <Banknote size={48} style={{ margin: '0 auto 1rem auto', opacity: 0.3 }} />
            <h3 style={{ fontSize: '1.125rem', color: 'var(--text-primary)' }}>No payroll records found</h3>
          </div>
        ) : (
          <div className="table-container desktop-only">
            <table className="table" style={{ width: '100%', minWidth: '1000px' }}>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th style={{ textAlign: 'right' }}>Gross Salary</th>
                  <th style={{ textAlign: 'right' }}>Work Days</th>
                  <th style={{ textAlign: 'right' }}>Present</th>
                  <th style={{ textAlign: 'right' }}>Leave / LOP</th>
                  <th style={{ textAlign: 'right' }}>Deductions</th>
                  <th style={{ textAlign: 'right' }}>Overtime</th>
                  <th style={{ textAlign: 'right' }}>Net Salary</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredData.map(p => (
                  <tr key={p.id}>
                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{p.name}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{p.empId} • {p.dept}</div>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 500 }}>₹{p.gross.toLocaleString('en-IN')}</td>
                    <td style={{ textAlign: 'right' }}>{p.workingDays}</td>
                    <td style={{ textAlign: 'right' }}>{p.present}</td>
                    <td style={{ textAlign: 'right' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>{p.leave}</span> / <span style={{ color: p.lop > 0 ? 'var(--danger-600)' : 'var(--gray-600)', fontWeight: p.lop > 0 ? 600 : 400 }}>{p.lop}</span>
                    </td>
                    <td style={{ textAlign: 'right', color: p.deductions > 0 ? 'var(--danger)' : 'inherit' }}>
                      ₹{p.deductions.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </td>
                    <td style={{ textAlign: 'right', color: p.overtime > 0 ? 'var(--success)' : 'inherit' }}>
                      ₹{p.overtime.toLocaleString('en-IN')}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--text-primary)', fontSize: '1rem' }}>
                      ₹{p.net.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </td>
                    <td>{getStatusBadge(p.status)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                        <button onClick={() => setDetailDrawer(p)} className="btn btn-outline" style={{ fontSize: '0.75rem', padding: '0.25rem 0.75rem' }}>View</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        
        {!loading && filteredData.length > 0 && (
          <div className="mobile-only" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {filteredData.map(p => (
              <div key={p.id} className="card" style={{ padding: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <div><div style={{ fontWeight: 600, fontSize: '1rem' }}>{p.name}</div><div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{p.empId}</div></div>
                  <div>{getStatusBadge(p.status)}</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.875rem', marginTop: '1rem' }}>
                  <div><span style={{ color: 'var(--text-secondary)' }}>Gross:</span> ₹{p.gross.toLocaleString('en-IN')}</div>
                  <div><span style={{ color: 'var(--danger-600)' }}>Ded:</span> ₹{p.deductions.toLocaleString('en-IN', {maximumFractionDigits:2})}</div>
                  <div style={{ gridColumn: '1 / -1', fontSize: '1rem', fontWeight: 700, marginTop: '0.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.5rem' }}>
                    Net: ₹{p.net.toLocaleString('en-IN', {maximumFractionDigits:2})}
                  </div>
                </div>
                <button onClick={() => setDetailDrawer(p)} className="btn btn-outline" style={{ width: '100%', marginTop: '1rem', fontSize: '0.875rem' }}>View Payroll</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Detail Drawer */}
      {detailDrawer && (
        <div className="drawer-overlay" onClick={() => setDetailDrawer(null)}>
          <div className="drawer wide-drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header" style={{ alignItems: 'flex-start' }}>
              <div style={{ width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h2 style={{ fontSize: '1.5rem', fontWeight: 600 }}>{detailDrawer.name}</h2>
                  <button className="icon-button" onClick={() => setDetailDrawer(null)}><X size={20} /></button>
                </div>
                <div style={{ display: 'flex', gap: '1rem', fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                  <span>{detailDrawer.empId}</span> • <span>{detailDrawer.dept}</span>
                </div>
                <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', alignItems: 'center' }}>
                  {getStatusBadge(detailDrawer.status)}
                  <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--gray-700)' }}>September 2026 Payroll</span>
                </div>
              </div>
            </div>
            
            <div className="drawer-body" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
              
              {/* Action Bar */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
                <button onClick={() => navigate('/employee/payslip')} className="btn btn-outline" style={{ fontSize: '0.875rem' }}><FileText size={16}/> View Payslip</button>
                {detailDrawer.status === 'UNDER REVIEW' && <button className="btn btn-outline" style={{ fontSize: '0.875rem', color: 'var(--warning)', borderColor: 'var(--warning-300)' }}><Edit size={16}/> Send Back</button>}
                {(detailDrawer.status === 'PAYMENT PENDING' || detailDrawer.status === 'APPROVED') && <button onClick={() => setPaymentModal(detailDrawer.id)} className="btn btn-primary" style={{ fontSize: '0.875rem' }}><Banknote size={16}/> Mark as Paid</button>}
                {detailDrawer.status === 'PAID' && <button className="btn btn-outline" style={{ fontSize: '0.875rem', color: 'var(--danger)', borderColor: 'var(--danger-300)' }}><Lock size={16}/> Lock Payroll</button>}
              </div>

              {/* Net Salary Calculation Highlight */}
              <div style={{ backgroundColor: 'var(--bg-surface-elevated)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', padding: '1.5rem', boxShadow: 'var(--shadow-sm)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Gross Earnings</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 600 }}>₹{detailDrawer.gross.toLocaleString('en-IN')}</div>
                  </div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '1.5rem', fontWeight: 300 }}>-</div>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{ fontSize: '0.875rem', color: 'var(--danger-600)' }}>Total Deductions</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--danger)' }}>₹{detailDrawer.deductions.toLocaleString('en-IN', {maximumFractionDigits:2})}</div>
                  </div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '1.5rem', fontWeight: 300 }}>+</div>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{ fontSize: '0.875rem', color: 'var(--success-600)' }}>Approved Overtime</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--success)' }}>₹{detailDrawer.overtime.toLocaleString('en-IN')}</div>
                  </div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '1.5rem', fontWeight: 300 }}>=</div>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', backgroundColor: 'var(--success-50)', padding: '0.5rem 1rem', borderRadius: 'var(--radius-md)' }}>
                    <div style={{ fontSize: '0.875rem', color: 'var(--success-800)', fontWeight: 600 }}>Net Salary</div>
                    <div style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--success-900)' }}>₹{detailDrawer.net.toLocaleString('en-IN', {maximumFractionDigits:2})}</div>
                  </div>

                </div>
              </div>

              {/* Salary Breakdown */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                {/* Earnings */}
                <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '1.25rem' }}>
                  <h3 className="section-title">Earnings Breakdown</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.875rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Basic Salary</span><span>₹30,000.00</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>HRA</span><span>₹10,000.00</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Allowances</span><span>₹5,000.00</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Other Earnings</span><span>₹5,000.00</span></div>
                    <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '0.5rem 0' }}></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, fontSize: '1rem' }}><span>Gross Earnings</span><span>₹{detailDrawer.gross.toLocaleString('en-IN', {minimumFractionDigits:2})}</span></div>
                  </div>
                </div>

                {/* Deductions */}
                <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '1.25rem' }}>
                  <h3 className="section-title" style={{ color: 'var(--danger)' }}>Deductions Breakdown</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.875rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: detailDrawer.lop > 0 ? 'var(--danger)' : 'inherit' }}><span>Loss of Pay ({detailDrawer.lop} days)</span><span>₹{(detailDrawer.lop * 1923.08).toLocaleString('en-IN', {maximumFractionDigits:2, minimumFractionDigits:2})}</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Half Day</span><span>₹0.00</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Late Login</span><span>₹500.00</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Statutory / Tax</span><span>₹0.00</span></div>
                    <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '0.5rem 0' }}></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, fontSize: '1rem', color: 'var(--danger)' }}><span>Total Deductions</span><span>₹{detailDrawer.deductions.toLocaleString('en-IN', {minimumFractionDigits:2, maximumFractionDigits:2})}</span></div>
                  </div>
                </div>
              </div>

              {/* LOP Visualizer */}
              {detailDrawer.lop > 0 && (
                <div style={{ backgroundColor: 'var(--danger-50)', padding: '1.25rem', borderRadius: 'var(--radius-md)', border: '1px dashed var(--danger-300)' }}>
                  <h4 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--danger-800)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <AlertTriangle size={16}/> Loss of Pay (LOP) Calculation
                  </h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', fontSize: '0.875rem' }}>
                    <div><div style={{ color: 'var(--danger)' }}>Monthly Salary</div><div style={{ fontWeight: 600 }}>₹{detailDrawer.gross.toLocaleString('en-IN')}</div></div>
                    <div><div style={{ color: 'var(--danger)' }}>Payable Days Policy</div><div style={{ fontWeight: 600 }}>26 Working Days</div></div>
                    <div><div style={{ color: 'var(--danger)' }}>Daily Rate</div><div style={{ fontWeight: 600 }}>₹1,923.08</div></div>
                    <div><div style={{ color: 'var(--danger)' }}>Total LOP (1 Day)</div><div style={{ fontWeight: 700, color: 'var(--danger-800)' }}>₹1,923.08</div></div>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--danger-600)', marginTop: '0.75rem' }}>* Payable days and LOP treatment are determined by Admin payroll configuration.</div>
                </div>
              )}

              {/* Modules Integration Summaries */}
              <div>
                <h3 className="section-title">Data Source Summaries</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  
                  {/* Attendance */}
                  <div className="card" style={{ boxShadow: 'none', border: '1px solid var(--border-color)' }}>
                    <h4 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--gray-700)' }}>Attendance Summary</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.875rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="info-label">Working Days</span><span className="info-val">{detailDrawer.workingDays}</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="info-label">Present</span><span className="info-val">{detailDrawer.present}</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="info-label">Late Login</span><span className="info-val">3</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="info-label">Early Logout</span><span className="info-val">2</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gridColumn: '1 / -1' }}><span className="info-label">Payroll Policy</span><span className="info-val" style={{ color: 'var(--danger-600)' }}>Deductions Enabled for Late</span></div>
                    </div>
                  </div>

                  {/* Leave & Permission */}
                  <div className="card" style={{ boxShadow: 'none', border: '1px solid var(--border-color)' }}>
                    <h4 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--gray-700)' }}>Leave, WFH & Permission</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.875rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="info-label">Approved Leave</span><span className="info-val">{detailDrawer.leave}</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="info-label">WFH Days</span><span className="info-val">4</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="info-label">Permissions</span><span className="info-val">3h 30m</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gridColumn: '1 / -1' }}><span className="info-label">Payroll Policy</span><span className="info-val">No deductions (Within limits)</span></div>
                    </div>
                  </div>

                </div>
              </div>

              {/* Payment Details if Paid */}
              {detailDrawer.status === 'PAID' && detailDrawer.paymentDetails && (
                <div style={{ backgroundColor: 'var(--success-50)', padding: '1.25rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--success-200)' }}>
                  <h4 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--success-800)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <CheckCircle2 size={16}/> Payment Recorded Successfully
                  </h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', fontSize: '0.875rem' }}>
                    <div><div style={{ color: 'var(--success)' }}>Payment Date</div><div style={{ fontWeight: 600 }}>{detailDrawer.paymentDetails.date}</div></div>
                    <div><div style={{ color: 'var(--success)' }}>Amount</div><div style={{ fontWeight: 600 }}>₹{detailDrawer.net.toLocaleString('en-IN', {maximumFractionDigits:2})}</div></div>
                    <div><div style={{ color: 'var(--success)' }}>Method</div><div style={{ fontWeight: 600 }}>{detailDrawer.paymentDetails.method}</div></div>
                    <div><div style={{ color: 'var(--success)' }}>Reference ID</div><div style={{ fontWeight: 600 }}>{detailDrawer.paymentDetails.ref}</div></div>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--success)', marginTop: '0.75rem' }}>Recorded by {detailDrawer.paymentDetails.by}. Employees cannot modify or record their own payments.</div>
                </div>
              )}

              {/* Audit History */}
              <div>
                <h3 className="section-title">Payroll Change History</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', paddingLeft: '1rem', borderLeft: '2px solid var(--gray-200)' }}>
                  <div style={{ position: 'relative' }}>
                    <div style={{ position: 'absolute', left: '-1.35rem', top: '2px', width: '12px', height: '12px', borderRadius: '50%', backgroundColor: 'var(--gray-400)', border: '2px solid white' }}></div>
                    <div style={{ fontSize: '0.875rem', fontWeight: 500 }}>Payroll Generated</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>24 Sep 2026 by System</div>
                  </div>
                  {detailDrawer.status !== 'UNDER REVIEW' && detailDrawer.status !== 'DRAFT' && detailDrawer.status !== 'CALCULATED' && (
                    <div style={{ position: 'relative' }}>
                      <div style={{ position: 'absolute', left: '-1.35rem', top: '2px', width: '12px', height: '12px', borderRadius: '50%', backgroundColor: 'var(--primary-500)', border: '2px solid white' }}></div>
                      <div style={{ fontSize: '0.875rem', fontWeight: 500 }}>Payroll Reviewed & Approved</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>25 Sep 2026 by HR Admin</div>
                    </div>
                  )}
                  {detailDrawer.status === 'PAID' && (
                    <div style={{ position: 'relative' }}>
                      <div style={{ position: 'absolute', left: '-1.35rem', top: '2px', width: '12px', height: '12px', borderRadius: '50%', backgroundColor: 'var(--success)', border: '2px solid white' }}></div>
                      <div style={{ fontSize: '0.875rem', fontWeight: 500 }}>Payment Recorded</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{detailDrawer.paymentDetails?.date} by {detailDrawer.paymentDetails?.by}</div>
                    </div>
                  )}
                </div>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* Generate Payroll Modal */}
      {generateModal && (
        <div className="drawer-overlay" style={{ alignItems: 'center', zIndex: 120 }}>
          <div className="card" style={{ margin: 'auto', width: '100%', maxWidth: '500px', animation: 'slideUp 0.3s' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem' }}>Generate September 2026 Payroll?</h3>
            
            <div style={{ backgroundColor: 'var(--gray-50)', padding: '1rem', borderRadius: 'var(--radius-md)', marginBottom: '1.5rem' }}>
              <h4 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem' }}>Payroll Validation Checks</h4>
              <ul style={{ margin: 0, paddingLeft: '1.5rem', fontSize: '0.875rem', color: 'var(--gray-700)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <li style={{ color: 'var(--success)' }}>48 Employees configured</li>
                <li style={{ color: 'var(--success)' }}>Attendance processing complete</li>
                <li style={{ color: 'var(--warning)' }}>3 employees have unresolved attendance exceptions</li>
              </ul>
            </div>

            <div style={{ padding: '0.75rem', backgroundColor: 'var(--warning-50)', color: 'var(--warning-800)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
              <AlertTriangle size={16} style={{ marginTop: '0.125rem' }} /> 
              <div>Warning: Generating payroll will snapshot current attendance and leave records for calculations. You can recalculate later if needed.</div>
            </div>

            <form onSubmit={handleGenerate} style={{ display: 'flex', gap: '1rem' }}>
              <button type="button" onClick={() => setGenerateModal(false)} className="btn btn-outline" style={{ flex: 1 }}>Cancel</button>
              <button type="submit" className="btn btn-primary" style={{ flex: 1 }}><Activity size={16}/> Generate Payroll</button>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Approve Modal */}
      {bulkApproveModal && (
        <div className="drawer-overlay" style={{ alignItems: 'center', zIndex: 120 }}>
          <div className="card" style={{ margin: 'auto', width: '100%', maxWidth: '450px', animation: 'slideUp 0.3s' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>Approve Payroll?</h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>Approving payroll confirms the current salary calculations and deductions for this period.</p>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', marginBottom: '1.5rem', fontWeight: 600 }}>
              <span>Total Employees: 48</span>
              <span>Net Payroll: ₹22.75L</span>
            </div>
            <form onSubmit={handleApprove} style={{ display: 'flex', gap: '1rem' }}>
              <button type="button" onClick={() => setBulkApproveModal(false)} className="btn btn-outline" style={{ flex: 1 }}>Cancel</button>
              <button type="submit" className="btn btn-primary" style={{ flex: 1, backgroundColor: 'var(--purple-600)', borderColor: 'var(--purple-600)' }}>Approve & Proceed</button>
            </form>
          </div>
        </div>
      )}

      {/* Record Payment Modal */}
      {paymentModal && (
        <div className="drawer-overlay" style={{ alignItems: 'center', zIndex: 120 }}>
          <div className="card" style={{ margin: 'auto', width: '100%', maxWidth: '450px', animation: 'slideUp 0.3s' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Banknote size={20} color="var(--primary-600)"/> Record Salary Payment
            </h3>
            <form onSubmit={handleRecordPayment} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ backgroundColor: 'var(--gray-50)', padding: '0.75rem', borderRadius: '4px', textAlign: 'center', marginBottom: '0.5rem' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Amount to Pay</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  ₹{payrolls.find(p => p.id === paymentModal)?.net.toLocaleString('en-IN', {maximumFractionDigits:2})}
                </div>
              </div>

              <div><label className="form-label">Payment Date *</label><input required type="date" className="form-control" value={paymentForm.date} onChange={e => setPaymentForm({...paymentForm, date: e.target.value})} /></div>
              <div>
                <label className="form-label">Payment Method *</label>
                <select className="form-control" value={paymentForm.method} onChange={e => setPaymentForm({...paymentForm, method: e.target.value})}>
                  <option>Bank Transfer</option><option>UPI</option><option>Cheque</option><option>Cash</option>
                </select>
              </div>
              <div><label className="form-label">Transaction Reference Number *</label><input required type="text" className="form-control" placeholder="e.g. TXN12345678" value={paymentForm.ref} onChange={e => setPaymentForm({...paymentForm, ref: e.target.value})} /></div>
              <div><label className="form-label">Remarks (Optional)</label><input type="text" className="form-control" value={paymentForm.remarks} onChange={e => setPaymentForm({...paymentForm, remarks: e.target.value})} /></div>

              <div style={{ padding: '0.75rem', backgroundColor: 'var(--primary-50)', color: 'var(--primary-800)', borderRadius: 'var(--radius-md)', fontSize: '0.75rem', display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                <ShieldCheck size={16} /> I confirm that this salary payment has been successfully completed.
              </div>

              <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                <button type="button" onClick={() => setPaymentModal(null)} className="btn btn-outline" style={{ flex: 1 }}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>Mark as Paid</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Settings Drawer */}
      {settingsDrawer && (
        <div className="drawer-overlay" onClick={() => setSettingsDrawer(false)}>
          <div className="drawer wide-drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Payroll Policy Configuration</h2>
              <button className="icon-button" onClick={() => setSettingsDrawer(false)}><X size={20} /></button>
            </div>
            <div className="drawer-body">
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '2rem' }}>Define how attendance, leave, and permissions impact final salary calculations. Do not hard-code rules.</p>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                
                <div>
                  <h3 className="section-title">General Settings</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem' }}>
                    <div><label className="form-label">Working Days Basis</label><select className="form-control"><option>Configured Working Days (e.g. 26)</option><option>Calendar Days (e.g. 30/31)</option><option>Actual Working Days</option></select></div>
                    <div><label className="form-label">Salary Rounding</label><select className="form-control"><option>Round to nearest integer</option><option>Exact decimals</option></select></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0' }}><span style={{ fontSize: '0.875rem', fontWeight: 500 }}>Require Multi-Level Approval</span><input type="checkbox" defaultChecked /></div>
                  </div>
                </div>

                <div>
                  <h3 className="section-title">Deduction Rules</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--gray-50)', padding: '0.75rem', borderRadius: '4px' }}>
                      <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>Enable LOP (Loss of Pay) Deductions</span><input type="checkbox" defaultChecked />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--gray-50)', padding: '0.75rem', borderRadius: '4px' }}>
                      <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>Enable Half-Day Deductions</span><input type="checkbox" defaultChecked />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--gray-50)', padding: '0.75rem', borderRadius: '4px' }}>
                      <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>Deduct for Late Login (Configurable limit)</span><input type="checkbox" defaultChecked />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--gray-50)', padding: '0.75rem', borderRadius: '4px' }}>
                      <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>Deduct for Permissions Exceeding Limit</span><input type="checkbox" />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--gray-50)', padding: '0.75rem', borderRadius: '4px' }}>
                      <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>Deduct for WFH (e.g. reduced allowances)</span><input type="checkbox" />
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="section-title">Overtime Rules</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ fontSize: '0.875rem', fontWeight: 500 }}>Enable Overtime Pay</span><input type="checkbox" defaultChecked /></div>
                    <div><label className="form-label">Overtime Rate Type</label><select className="form-control"><option>Multiplier (e.g. 1.5x Hourly)</option><option>Fixed Rate</option></select></div>
                  </div>
                </div>

              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        
        
        
        
        
        
        
        
        
        
        
        
        .info-label { color: var(--gray-500); }
        .info-val { font-weight: 600; color: var(--gray-900); }
        
        .drawer-overlay { position: fixed; inset: 0; background-color: rgba(0,0,0,0.4); z-index: 100; display: flex; justify-content: flex-end; }
        .drawer { background-color: var(--bg-surface); width: 100%; height: 100%; display: flex; flex-direction: column; box-shadow: var(--shadow-xl); animation: slideInRight 0.3s forwards; }
        .wide-drawer { max-width: min(520px, 100vw); }
        .drawer-header { padding: 1.5rem; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; alignItems: flex-start; }
        .drawer-body { padding: 1.5rem; overflow-y: auto; flex: 1; }
        
        .desktop-only { display: block; }
        .mobile-only { display: none; }
        
        @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes slideDown { from { transform: translate(-50%, -100%); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }
        
        @media (max-width: 900px) { 
          .desktop-only { display: none; }
          .mobile-only { display: block; }
           
        }
        @media (max-width: 600px) {
          
          .drawer-overlay { align-items: flex-end; }
          .drawer, .wide-drawer { height: 95vh; border-top-left-radius: var(--radius-xl); border-top-right-radius: var(--radius-xl); animation: slideUp 0.3s forwards; }
        }
        .skeleton { background: linear-gradient(90deg, var(--gray-200) 25%, var(--gray-100) 50%, var(--gray-200) 75%); background-size: 200% 100%; animation: skeleton-loading 1.5s infinite; }
        @keyframes skeleton-loading { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
      `}</style>
    </div>
  );
};

export default AdminPayroll;



