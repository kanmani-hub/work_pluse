import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Banknote, Download, Settings, ChevronLeft, ChevronRight,
  Search, Filter, CheckCircle2, AlertTriangle, Eye, X, 
  FileText, Activity, ShieldCheck, History, Edit, 
  Unlock, Lock, CheckCircle, ArrowRight, Send
} from 'lucide-react';
import { payrollService } from '../../services/payroll/payrollService';
import { realtimeService } from '../../services/realtime/realtimeService';
import { payslipService } from '../../services/payroll/payslipService';
import { payrollSettingsService, type PayrollSettings } from '../../services/payroll/payrollSettingsService';
import { globalSettingsService } from '../../services/settings/globalSettingsService';
import { payrollDataService, type PayrollEmployeeData } from '../../services/payroll/payrollDataService';
import SalaryEditor from '../../components/SalaryEditor';
import PayslipDocument from '../../components/PayslipDocument';
import { supabase } from '../../lib/supabase';
import { employeeService, type EmployeeWithRelations } from '../../services/employees/employeeService';

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const AdminPayroll: React.FC = () => {
  React.useEffect(() => {
    globalSettingsService.loadSettings().then(s => setSettingsForm(s.payroll));
  }, []);
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  
  // Month selector
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  
  // Filters
  const [search, setSearch] = useState('');
  const [filterDept, setFilterDept] = useState('All');
  const [filterStatus, setFilterStatus] = useState('All');
  
  // Drawers & Modals
  const [detailDrawer, setDetailDrawer] = useState<any>(null);
  const [detailEmpData, setDetailEmpData] = useState<PayrollEmployeeData | null>(null);
  const [generateModal, setGenerateModal] = useState(false);
  const [paymentModal, setPaymentModal] = useState<any>(null);
  const [showSalaryEditor, setShowSalaryEditor] = useState<string | null>(null);
  const [showPayslip, setShowPayslip] = useState<any>(null);
  const [settingsDrawer, setSettingsDrawer] = useState(false);
  const [bulkApproveModal, setBulkApproveModal] = useState(false);
  
  // Settings form state
  const [settingsForm, setSettingsForm] = useState<PayrollSettings>(payrollSettingsService.getSettings());
  
  // Forms
  const [paymentForm, setPaymentForm] = useState({ date: new Date().toISOString().split('T')[0], method: 'Bank Transfer', ref: '', remarks: '', amount: 0 });
  
  const [payrolls, setPayrolls] = useState<any[]>([]);
  const [employees, setEmployees] = useState<EmployeeWithRelations[]>([]);
  const [allDepartments, setAllDepartments] = useState<any[]>([]);
  const [globalStatus, setGlobalStatus] = useState('DRAFT');
  const [departments, setDepartments] = useState<string[]>([]);

  // Filter payrolls for selected month
  const monthPayrolls = payrolls.filter(p => p.payroll_year === selectedYear && p.payroll_month === selectedMonth);

  const fetchPayrolls = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [payrollRes, empRes, deptRes] = await Promise.all([
        payrollService.getPayrolls(),
        employeeService.getEmployees(),
        employeeService.getDepartments()
      ]);
      
      if (payrollRes.error) throw payrollRes.error;
      if (empRes.error) throw empRes.error;
      if (deptRes.error) throw deptRes.error;

      if (empRes.data) setEmployees(empRes.data);
      if (deptRes.data) {
        setAllDepartments(deptRes.data);
        setDepartments(deptRes.data.map((d: any) => d.name).sort());
      }

      if (payrollRes.data) {
        setPayrolls(payrollRes.data);
        
        // Compute global status from month data
        const monthData = payrollRes.data.filter((p: any) => p.payroll_year === selectedYear && p.payroll_month === selectedMonth);
        if (monthData.length > 0) {
          if (monthData.every((p: any) => p.status === 'CLOSED')) setGlobalStatus('CLOSED');
          else if (monthData.every((p: any) => p.status === 'PAID')) setGlobalStatus('PAID');
          else if (monthData.some((p: any) => p.status === 'PAYMENT_PENDING')) setGlobalStatus('PAYMENT_PENDING');
          else if (monthData.some((p: any) => p.status === 'APPROVED')) setGlobalStatus('APPROVED');
          else if (monthData.some((p: any) => p.status === 'UNDER_REVIEW')) setGlobalStatus('UNDER_REVIEW');
          else if (monthData.some((p: any) => p.status === 'CALCULATED')) setGlobalStatus('CALCULATED');
          else setGlobalStatus('DRAFT');
        } else {
          setGlobalStatus('DRAFT');
        }
      }
    } catch (err: any) {
      console.error("Error loading payroll data:", err);
      setError(err.message || 'Unable to load payroll data');
    } finally {
      setLoading(false);
    }
  }, [selectedYear, selectedMonth]);

  useEffect(() => {
    fetchPayrolls();
    const channel = realtimeService.subscribeToAdminPayroll(() => fetchPayrolls());
    return () => { realtimeService.unsubscribe(channel); };
  }, [fetchPayrolls]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  // Parse data summary from payroll.notes
  const parseDataSummary = (payroll: any) => {
    try {
      if (payroll?.notes) return JSON.parse(payroll.notes);
    } catch {}
    return null;
  };

  const filteredData = employees.map(emp => {
    const payroll = monthPayrolls.find(p => p.employee_id === emp.id) || null;
    return { emp, payroll };
  }).filter(({ emp, payroll }) => {
    const name = `${emp.first_name || ''} ${emp.last_name || ''}`;
    const empCode = emp.employee_code || '';
    const dept = emp.department?.name || 'Unknown';
    const matchSearch = name.toLowerCase().includes(search.toLowerCase()) || empCode.toLowerCase().includes(search.toLowerCase());
    const matchDept = filterDept === 'All' || dept === filterDept;
    const matchStatus = filterStatus === 'All' || (payroll ? payroll.status === filterStatus : filterStatus === 'NOT_GENERATED');
    return matchSearch && matchDept && matchStatus;
  });

  const getKPIs = () => {
    return {
      total: monthPayrolls.length,
      generated: monthPayrolls.filter(p => p.status !== 'DRAFT').length,
      underReview: monthPayrolls.filter(p => p.status === 'UNDER_REVIEW').length,
      approved: monthPayrolls.filter(p => p.status === 'APPROVED').length,
      paymentPending: monthPayrolls.filter(p => p.status === 'PAYMENT_PENDING').length,
      paid: monthPayrolls.filter(p => p.status === 'PAID' || p.status === 'CLOSED').length,
      gross: monthPayrolls.reduce((sum, p) => sum + Number(p.gross_salary), 0),
      deductions: monthPayrolls.reduce((sum, p) => sum + Number(p.total_deductions), 0),
      net: monthPayrolls.reduce((sum, p) => sum + Number(p.net_salary), 0)
    };
  };
  const kpis = getKPIs();

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'NOT_GENERATED': return <span className="badge badge-gray" style={{ opacity: 0.7 }}>Not Generated</span>;
      case 'DRAFT': return <span className="badge badge-gray">Draft</span>;
      case 'CALCULATED': return <span className="badge badge-primary">Calculated</span>;
      case 'UNDER_REVIEW': return <span className="badge badge-warning">Under Review</span>;
      case 'APPROVED': return <span className="badge badge-primary" style={{ backgroundColor: 'rgba(168,85,247,0.15)', color: '#a855f7', borderColor: 'rgba(168,85,247,0.3)' }}>Approved</span>;
      case 'PAYMENT_PENDING': return <span className="badge badge-primary">Payment Pending</span>;
      case 'PAID': return <span className="badge badge-success">Paid</span>;
      case 'CLOSED': return <span className="badge badge-gray">Closed</span>;
      default: return <span className="badge badge-gray">{status}</span>;
    }
  };

  // Month navigation
  const handlePrevMonth = () => {
    if (selectedMonth === 1) { setSelectedMonth(12); setSelectedYear(y => y - 1); }
    else setSelectedMonth(m => m - 1);
  };
  const handleNextMonth = () => {
    if (selectedMonth === 12) { setSelectedMonth(1); setSelectedYear(y => y + 1); }
    else setSelectedMonth(m => m + 1);
  };
  const handleCurrentMonth = () => {
    setSelectedYear(now.getFullYear());
    setSelectedMonth(now.getMonth() + 1);
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setGenerateModal(false);
    showToast(`Calculating payroll for ${MONTH_NAMES[selectedMonth - 1]} ${selectedYear}...`);
    
    const result = await payrollService.generatePayroll(selectedYear, selectedMonth);
    
    if (result.success) {
      await fetchPayrolls();
      showToast(`${MONTH_NAMES[selectedMonth - 1]} ${selectedYear} payroll calculated for ${result.count} employee(s).`);
    } else {
      showToast(result.error || 'Failed to generate payroll');
    }
  };

  const handleApprove = async (e: React.FormEvent) => {
    e.preventDefault();
    setBulkApproveModal(false);
    
    let count = 0;
    for (const p of monthPayrolls) {
      if (p.status === 'UNDER_REVIEW') {
        await payrollService.approvePayroll(p.id);
        count++;
      }
    }
    
    await fetchPayrolls();
    if (detailDrawer?.status === 'UNDER_REVIEW') setDetailDrawer({ ...detailDrawer, status: 'APPROVED' });
    showToast(`${count} payroll(s) approved.`);
  };

  const handleProceedToPayments = async () => {
    let count = 0;
    for (const p of monthPayrolls) {
      if (p.status === 'APPROVED') {
        await payrollService.movePayrollToPaymentPending(p.id);
        count++;
      }
    }
    await fetchPayrolls();
    showToast(`${count} payroll(s) moved to Payment Pending.`);
  };

  // Detail drawer: individual actions
  const handleDetailSubmitReview = async () => {
    if (!detailDrawer) return;
    const { error } = await payrollService.submitPayrollForReview(detailDrawer.id);
    if (!error) {
      setDetailDrawer({ ...detailDrawer, status: 'UNDER_REVIEW' });
      await fetchPayrolls();
      showToast('Submitted for review.');
    } else { showToast(error.message); }
  };

  const handleDetailApprove = async () => {
    if (!detailDrawer) return;
    const { error } = await payrollService.approvePayroll(detailDrawer.id);
    if (!error) {
      setDetailDrawer({ ...detailDrawer, status: 'APPROVED' });
      await fetchPayrolls();
      showToast('Payroll approved.');
    } else { showToast(error.message); }
  };

  const handleDetailProceedPayment = async () => {
    if (!detailDrawer) return;
    const { error } = await payrollService.movePayrollToPaymentPending(detailDrawer.id);
    if (!error) {
      setDetailDrawer({ ...detailDrawer, status: 'PAYMENT_PENDING' });
      await fetchPayrolls();
      showToast('Moved to Payment Pending.');
    } else { showToast(error.message); }
  };

  const handleDetailClose = async () => {
    if (!detailDrawer) return;
    const { error } = await payrollService.closePayroll(detailDrawer.id);
    if (!error) {
      setDetailDrawer({ ...detailDrawer, status: 'CLOSED' });
      await fetchPayrolls();
      showToast('Payroll closed.');
    } else { showToast(error.message); }
  };
  
  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (paymentModal) {
      const payroll = monthPayrolls.find(p => p.id === paymentModal);
      await payrollService.markPayrollPaid(paymentModal, paymentForm.amount || payroll?.net_salary || 0, paymentForm.method, paymentForm.ref, paymentForm.remarks);
      await fetchPayrolls();
      setPaymentModal(null);
      if (detailDrawer?.id === paymentModal) setDetailDrawer({ ...detailDrawer, status: 'PAID' });
      showToast('Payment recorded successfully.');
    }
  };

  const handleViewPayslip = async (payrollId: string) => {
    setLoading(true);
    let { data } = await payslipService.getAdminPayslipByPayrollId(payrollId);
    
    if (!data && detailDrawer) {
      const { data: fullPayroll } = await supabase
        .from('payroll')
        .select('*, employees!payroll_employee_id_fkey(first_name, last_name, employee_code, departments(name)), payroll_items(*)')
        .eq('id', payrollId)
        .single();
        
      data = {
        payslip_period: `${MONTH_NAMES[detailDrawer.payroll_month - 1]} ${detailDrawer.payroll_year}`,
        payslip_number: detailDrawer.status === 'PAID' || detailDrawer.status === 'CLOSED' ? `PS-${Date.now()}` : 'PENDING',
        payroll: fullPayroll || detailDrawer
      };
    }

    if (data) {
      setShowPayslip(data);
    } else {
      showToast('Payslip not available.');
    }
    setLoading(false);
  };

  // When opening detail drawer, fetch employee data
  const openDetailDrawer = async (p: any) => {
    setDetailDrawer(p);
    setDetailEmpData(null);
    const data = await payrollDataService.getEmployeePayrollData(p.employee_id, p.payroll_year, p.payroll_month);
    setDetailEmpData(data);
  };

  // Payroll settings save
  const handleSaveSettings = () => {
    globalSettingsService.saveSettings({ app: globalSettingsService.getSettings().app, payroll: settingsForm });
    setSettingsDrawer(false);
    showToast('Payroll settings saved.');
  };

  // Helper: get data summary values for table display
  const getTableSummary = (p: any) => {
    const summary = parseDataSummary(p);
    const settings = globalSettingsService.getSettings().payroll;
    const workingDays = summary?.settings?.workingDaysUsed ?? payrollSettingsService.getWorkingDaysForMonth(p.payroll_year, p.payroll_month, settings);
    const present = summary?.attendance?.presentDays ?? 0;
    const approvedLeave = summary?.leave?.approvedLeave ?? 0;
    const lopLeave = summary?.leave?.lopLeave ?? 0;
    return { workingDays, present, approvedLeave, lopLeave };
  };

  // Get detail summary (from drawer empData or stored notes)
  const getDetailSummary = () => {
    if (detailEmpData) return detailEmpData;
    const summary = parseDataSummary(detailDrawer);
    if (summary) {
      return {
        attendance: summary.attendance || { workingDays: 0, presentDays: 0, absentDays: 0, lateLogins: 0, earlyLogouts: 0, halfDays: 0, lopDays: 0 },
        leave: summary.leave || { approvedLeave: 0, lopLeave: 0, totalLeaveDays: 0 },
        wfh: summary.wfh || { wfhDays: 0 },
        permission: summary.permission || { permissionCount: 0, totalMinutes: 0 },
      } as PayrollEmployeeData;
    }
    return null;
  };

  const monthLabel = `${MONTH_NAMES[selectedMonth - 1]} ${selectedYear}`;

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
          <button onClick={() => { setSettingsForm(globalSettingsService.getSettings().payroll); setSettingsDrawer(true); }} className="btn btn-outline" style={{ fontSize: '0.875rem' }}><Settings size={16}/> Payroll Settings</button>
          <button onClick={() => showToast('Payroll export prepared.')} className="btn btn-outline" style={{ fontSize: '0.875rem' }}><Download size={16}/> Export</button>
          <button onClick={() => setGenerateModal(true)} className="btn btn-primary" style={{ fontSize: '0.875rem' }}><Activity size={16}/> Generate</button>
        </div>
      </div>

      {/* Month Selector */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', borderBottom: '1px solid var(--gray-200)', paddingBottom: '1rem' }}>
        <div style={{ fontSize: '1.125rem', fontWeight: 600 }}>Payroll Period: <span style={{ color: 'var(--primary-700)' }}>{monthLabel}</span></div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-surface-elevated)' }}>
            <button onClick={handlePrevMonth} className="icon-button" style={{ borderRight: '1px solid var(--border-color)', borderRadius: 'var(--radius-md) 0 0 var(--radius-md)', padding: '0.5rem' }}><ChevronLeft size={16}/></button>
            <div style={{ padding: '0.5rem 1rem', fontSize: '0.875rem', fontWeight: 600 }}>{monthLabel}</div>
            <button onClick={handleNextMonth} className="icon-button" style={{ borderLeft: '1px solid var(--border-color)', borderRadius: '0 var(--radius-md) var(--radius-md) 0', padding: '0.5rem' }}><ChevronRight size={16}/></button>
          </div>
          <button onClick={handleCurrentMonth} className="btn btn-outline" style={{ fontSize: '0.875rem', padding: '0.5rem 1rem' }}>Current Month</button>
        </div>
      </div>

      {error ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--danger)', backgroundColor: 'var(--danger-50)', borderRadius: 'var(--radius-md)' }}>
          <AlertTriangle size={48} style={{ margin: '0 auto 1rem auto' }} />
          <h3 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Unable to load payroll data</h3>
          <p style={{ marginTop: '0.5rem', color: 'var(--danger-700)' }}>{error}</p>
        </div>
      ) : loading ? (
        <div className="skeleton-container" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '1rem' }}>
          {[...Array(9)].map((_, i) => <div key={i} className="skeleton" style={{ height: '70px', borderRadius: 'var(--radius-md)' }} />)}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', width: '100%', minWidth: 0 }}>
          <div className="kpi-grid">
            <div className="tracking-kpi-card"><div className="sc-val">{kpis.total}</div><div className="sc-title">Total Employees</div></div>
            <div className="tracking-kpi-card"><div className="sc-val">{kpis.generated}</div><div className="sc-title">Payroll Generated</div></div>
            <div className="summary-card-small" style={{cursor:'pointer'}} onClick={() => setFilterStatus('UNDER_REVIEW')}><div className="sc-val" style={{ color: 'var(--warning)' }}>{kpis.underReview}</div><div className="sc-title">Under Review</div></div>
            <div className="summary-card-small" style={{cursor:'pointer'}} onClick={() => setFilterStatus('APPROVED')}><div className="sc-val" style={{ color: '#a855f7' }}>{kpis.approved}</div><div className="sc-title">Approved</div></div>
            <div className="summary-card-small" style={{cursor:'pointer'}} onClick={() => setFilterStatus('PAYMENT_PENDING')}><div className="sc-val" style={{ color: 'var(--primary-700)' }}>{kpis.paymentPending}</div><div className="sc-title">Payment Pending</div></div>
            <div className="summary-card-small" style={{cursor:'pointer'}} onClick={() => setFilterStatus('PAID')}><div className="sc-val" style={{ color: 'var(--success)' }}>{kpis.paid}</div><div className="sc-title">Paid</div></div>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px', width: '100%', minWidth: 0 }}>
            <div className="tracking-kpi-card">
              <div className="sc-title">Gross Payroll</div>
              <div style={{ fontSize: 'clamp(22px, 3vw, 40px)', lineHeight: 1.05, whiteSpace: 'normal', overflowWrap: 'anywhere', fontWeight: 700, color: 'var(--text-primary)' }}>₹{kpis.gross.toLocaleString('en-IN', {maximumFractionDigits:2})}</div>
            </div>
            <div className="tracking-kpi-card">
              <div className="sc-title">Total Deductions</div>
              <div style={{ fontSize: 'clamp(22px, 3vw, 40px)', lineHeight: 1.05, whiteSpace: 'normal', overflowWrap: 'anywhere', fontWeight: 700, color: 'var(--danger)' }}>₹{kpis.deductions.toLocaleString('en-IN', {maximumFractionDigits:2})}</div>
            </div>
            <div className="tracking-kpi-card" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--success)' }}>
              <div className="sc-title" style={{ color: 'var(--success)' }}>Net Payroll</div>
              <div style={{ fontSize: 'clamp(22px, 3vw, 40px)', lineHeight: 1.05, whiteSpace: 'normal', overflowWrap: 'anywhere', fontWeight: 800, color: 'var(--success)' }}>₹{kpis.net.toLocaleString('en-IN', {maximumFractionDigits:2})}</div>
            </div>
          </div>
        </div>
      )}

      {/* Progress Banner */}
      <div className="card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem', backgroundColor: 'var(--bg-surface-elevated)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>{monthLabel} Payroll</h3>
            <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>Status: {getStatusBadge(globalStatus)}</div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {globalStatus === 'UNDER_REVIEW' && <button onClick={() => setBulkApproveModal(true)} className="btn btn-primary" style={{ fontSize: '0.875rem' }}>Approve Payroll</button>}
            {globalStatus === 'APPROVED' && <button onClick={handleProceedToPayments} className="btn btn-outline" style={{ fontSize: '0.875rem', color: 'var(--primary-700)', borderColor: 'var(--primary-400)' }}><ArrowRight size={16}/> Proceed to Payments</button>}
          </div>
        </div>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem', position: 'relative' }}>
          <div style={{ position: 'absolute', top: '12px', left: '20px', right: '20px', height: '2px', backgroundColor: 'var(--gray-200)', zIndex: 0 }}></div>
          {['Draft', 'Calculated', 'Under Review', 'Approved', 'Payment Pending', 'Paid', 'Closed'].map((step, i) => {
            const steps = ['DRAFT', 'CALCULATED', 'UNDER_REVIEW', 'APPROVED', 'PAYMENT_PENDING', 'PAID', 'CLOSED'];
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
            <option value="All">All Departments</option>
            {departments.map(d => <option key={d}>{d}</option>)}
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="form-control" style={{ width: 'auto', fontSize: '0.875rem' }}>
            <option value="All">All Statuses</option>
            <option value="NOT_GENERATED">Not Generated</option>
            <option value="CALCULATED">Calculated</option>
            <option value="UNDER_REVIEW">Under Review</option>
            <option value="APPROVED">Approved</option>
            <option value="PAYMENT_PENDING">Payment Pending</option>
            <option value="PAID">Paid</option>
            <option value="CLOSED">Closed</option>
          </select>
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
            <p style={{ fontSize: '0.875rem', marginTop: '0.5rem' }}>Generate payroll to create records for this month.</p>
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
                {filteredData.map(({ emp, payroll }) => {
                  if (!payroll) {
                    return (
                      <tr key={emp.id}>
                        <td>
                          <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{emp.first_name} {emp.last_name}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{emp.employee_code} • {emp.department?.name || 'Unknown'}</div>
                        </td>
                        <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
                          Employee exists, but no payroll record exists for this period.
                        </td>
                        <td>{getStatusBadge('NOT_GENERATED')}</td>
                        <td style={{ textAlign: 'right' }}>
                          <button onClick={() => setGenerateModal(true)} className="btn btn-outline" style={{ fontSize: '0.75rem', padding: '0.25rem 0.75rem' }}>Generate</button>
                        </td>
                      </tr>
                    );
                  }
                  
                  const ts = getTableSummary(payroll);
                  return (
                    <tr key={payroll.id}>
                      <td>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{emp.first_name} {emp.last_name}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{emp.employee_code} • {emp.department?.name || 'Unknown'}</div>
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 500 }}>₹{Number(payroll.gross_salary).toLocaleString('en-IN')}</td>
                      <td style={{ textAlign: 'right' }}>{ts.workingDays}</td>
                      <td style={{ textAlign: 'right' }}>{ts.present}</td>
                      <td style={{ textAlign: 'right' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>{ts.approvedLeave}</span> / <span style={{ color: ts.lopLeave > 0 ? 'var(--danger-600)' : 'var(--gray-600)', fontWeight: ts.lopLeave > 0 ? 600 : 400 }}>{ts.lopLeave}</span>
                      </td>
                      <td style={{ textAlign: 'right', color: Number(payroll.total_deductions) > 0 ? 'var(--danger)' : 'inherit' }}>
                        ₹{Number(payroll.total_deductions).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                      </td>
                      <td style={{ textAlign: 'right', color: Number(payroll.overtime_amount) > 0 ? 'var(--success)' : 'inherit' }}>
                        ₹{Number(payroll.overtime_amount).toLocaleString('en-IN')}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--text-primary)', fontSize: '1rem' }}>
                        ₹{Number(payroll.net_salary).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                      </td>
                      <td>{getStatusBadge(payroll.status)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <button onClick={() => openDetailDrawer(payroll)} className="btn btn-outline" style={{ fontSize: '0.75rem', padding: '0.25rem 0.75rem' }}>View</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        
        {!loading && filteredData.length > 0 && (
          <div className="mobile-only" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {filteredData.map(({ emp, payroll }) => (
              <div key={emp.id} className="card" style={{ padding: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <div><div style={{ fontWeight: 600, fontSize: '1rem' }}>{emp.first_name} {emp.last_name}</div><div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{emp.employee_code} • {emp.department?.name || 'Unknown'}</div></div>
                  <div>{getStatusBadge(payroll ? payroll.status : 'NOT_GENERATED')}</div>
                </div>
                {payroll ? (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.875rem', marginTop: '1rem' }}>
                      <div><span style={{ color: 'var(--text-secondary)' }}>Gross:</span> ₹{Number(payroll.gross_salary).toLocaleString('en-IN')}</div>
                      <div><span style={{ color: 'var(--danger-600)' }}>Ded:</span> ₹{Number(payroll.total_deductions).toLocaleString('en-IN', {maximumFractionDigits:2})}</div>
                      <div style={{ gridColumn: '1 / -1', fontSize: '1rem', fontWeight: 700, marginTop: '0.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.5rem' }}>
                        Net: ₹{Number(payroll.net_salary).toLocaleString('en-IN', {maximumFractionDigits:2})}
                      </div>
                    </div>
                    <button onClick={() => openDetailDrawer(payroll)} className="btn btn-outline" style={{ width: '100%', marginTop: '1rem', fontSize: '0.875rem' }}>View Payroll</button>
                  </>
                ) : (
                  <>
                    <div style={{ textAlign: 'center', color: 'var(--text-secondary)', margin: '1rem 0' }}>
                      Employee exists, but no payroll record exists for this period.
                    </div>
                    <button onClick={() => setGenerateModal(true)} className="btn btn-outline" style={{ width: '100%', marginTop: '1rem', fontSize: '0.875rem' }}>Generate Payroll</button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Detail Drawer */}
      {detailDrawer && (() => {
        const ds = getDetailSummary();
        const storedSummary = parseDataSummary(detailDrawer);
        const att = ds?.attendance || { workingDays: 0, presentDays: 0, absentDays: 0, lateLogins: 0, totalLateMinutes: 0, earlyLogouts: 0, totalBreakOverrunMinutes: 0, totalOvertimeMinutes: 0, halfDays: 0, lopDays: 0 };
        const lv = ds?.leave || { approvedLeave: 0, lopLeave: 0, totalLeaveDays: 0 };
        const wfh = ds?.wfh || { wfhDays: 0 };
        const perm = ds?.permission || { permissionCount: 0, totalMinutes: 0 };
        const settings = globalSettingsService.getSettings().payroll;
        const workingDays = storedSummary?.settings?.workingDaysUsed ?? payrollSettingsService.getWorkingDaysForMonth(detailDrawer.payroll_year, detailDrawer.payroll_month, settings);

        return (
        <div className="drawer-overlay" onClick={() => { setDetailDrawer(null); setDetailEmpData(null); }}>
          <div className="drawer wide-drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header" style={{ alignItems: 'flex-start' }}>
              <div style={{ width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h2 style={{ fontSize: '1.5rem', fontWeight: 600 }}>{detailDrawer.employees?.first_name} {detailDrawer.employees?.last_name}</h2>
                  <button className="icon-button" onClick={() => { setDetailDrawer(null); setDetailEmpData(null); }}><X size={20} /></button>
                </div>
                <div style={{ display: 'flex', gap: '1rem', fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                  <span>{detailDrawer.employees?.employee_code}</span> • <span>{detailDrawer.employees?.departments?.name}</span>
                </div>
                <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', alignItems: 'center' }}>
                  {getStatusBadge(detailDrawer.status)}
                  <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--gray-700)' }}>{MONTH_NAMES[detailDrawer.payroll_month - 1]} {detailDrawer.payroll_year} Payroll</span>
                </div>
              </div>
            </div>
            
            <div className="drawer-body" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
              
              {/* Action Bar */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', flexWrap: 'wrap' }}>
                {!['CLOSED'].includes(detailDrawer.status) && (
                  <button type="button" onClick={() => setShowSalaryEditor(detailDrawer.employee_id)} className="btn btn-outline" style={{ fontSize: '0.8rem' }}><Settings size={14}/> Edit Salary</button>
                )}
                <button type="button" onClick={() => handleViewPayslip(detailDrawer.id)} className="btn btn-outline" style={{ fontSize: '0.8rem' }}><FileText size={14}/> View Payslip</button>
                
                {detailDrawer.status === 'CALCULATED' && (
                  <button type="button" onClick={handleDetailSubmitReview} className="btn btn-outline" style={{ fontSize: '0.8rem', color: 'var(--warning)', borderColor: 'var(--warning)' }}><Send size={14}/> Submit for Review</button>
                )}
                {detailDrawer.status === 'UNDER_REVIEW' && (
                  <button type="button" onClick={handleDetailApprove} className="btn btn-primary" style={{ fontSize: '0.8rem' }}><CheckCircle size={14}/> Approve</button>
                )}
                {detailDrawer.status === 'APPROVED' && (
                  <button type="button" onClick={handleDetailProceedPayment} className="btn btn-outline" style={{ fontSize: '0.8rem', color: 'var(--primary-700)', borderColor: 'var(--primary-400)' }}><ArrowRight size={14}/> Proceed to Payment</button>
                )}
                {detailDrawer.status === 'PAYMENT_PENDING' && (
                  <button type="button" onClick={() => { setPaymentForm({...paymentForm, amount: detailDrawer.net_salary}); setPaymentModal(detailDrawer.id); }} className="btn btn-primary" style={{ fontSize: '0.8rem' }}><Banknote size={14}/> Mark as Paid</button>
                )}
                {detailDrawer.status === 'PAID' && (
                  <button type="button" onClick={handleDetailClose} className="btn btn-outline" style={{ fontSize: '0.8rem', color: 'var(--danger)', borderColor: 'var(--danger)' }}><Lock size={14}/> Close Payroll</button>
                )}
              </div>

              {/* Net Salary Calculation */}
              <div style={{ backgroundColor: 'var(--bg-surface-elevated)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', padding: '1.5rem', boxShadow: 'var(--shadow-sm)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Gross Earnings</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 600 }}>₹{Number(detailDrawer.gross_salary).toLocaleString('en-IN')}</div>
                  </div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '1.5rem', fontWeight: 300 }}>-</div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{ fontSize: '0.875rem', color: 'var(--danger-600)' }}>Total Deductions</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--danger)' }}>₹{Number(detailDrawer.total_deductions).toLocaleString('en-IN', {maximumFractionDigits:2})}</div>
                  </div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '1.5rem', fontWeight: 300 }}>+</div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{ fontSize: '0.875rem', color: 'var(--success-600)' }}>Approved Overtime</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--success)' }}>₹{Number(detailDrawer.overtime_amount).toLocaleString('en-IN')}</div>
                  </div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '1.5rem', fontWeight: 300 }}>=</div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', backgroundColor: 'var(--success-50)', padding: '0.5rem 1rem', borderRadius: 'var(--radius-md)' }}>
                    <div style={{ fontSize: '0.875rem', color: 'var(--success)', fontWeight: 600 }}>Net Salary</div>
                    <div style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--success)' }}>₹{Number(detailDrawer.net_salary).toLocaleString('en-IN', {maximumFractionDigits:2})}</div>
                  </div>
                </div>
              </div>

              {/* LOP Visualizer */}
              {Number(detailDrawer.lop_deduction) > 0 && (
                <div style={{ backgroundColor: 'var(--danger-50)', padding: '1.25rem', borderRadius: 'var(--radius-md)', border: '1px dashed var(--danger)' }}>
                  <h4 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--danger)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <AlertTriangle size={16}/> Loss of Pay (LOP) Deduction
                  </h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '1rem', fontSize: '0.875rem' }}>
                    <div><div style={{ color: 'var(--danger)' }}>Monthly Gross</div><div style={{ fontWeight: 600 }}>₹{Number(detailDrawer.gross_salary).toLocaleString('en-IN')}</div></div>
                    <div><div style={{ color: 'var(--danger)' }}>Working Days Basis</div><div style={{ fontWeight: 600 }}>{workingDays} Days</div></div>
                    <div><div style={{ color: 'var(--danger)' }}>Daily Rate</div><div style={{ fontWeight: 600 }}>₹{workingDays > 0 ? Math.round(Number(detailDrawer.gross_salary) / workingDays).toLocaleString('en-IN') : '-'}</div></div>
                    <div><div style={{ color: 'var(--danger)' }}>Total LOP</div><div style={{ fontWeight: 700, color: 'var(--danger)' }}>₹{Number(detailDrawer.lop_deduction).toLocaleString('en-IN')}</div></div>
                  </div>
                </div>
              )}

              {/* Data Source Summaries */}
              <div>
                <h3 className="section-title">Data Source Summaries</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  
                  {/* Attendance */}
                  <div className="card" style={{ boxShadow: 'none', border: '1px solid var(--border-color)' }}>
                    <h4 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--gray-700)' }}>Attendance Summary</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.875rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="info-label">Working Days</span><span className="info-val">{workingDays}</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="info-label">Present</span><span className="info-val">{att.presentDays}</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="info-label">Late Logins</span><span className="info-val">{att.lateLogins} ({att.totalLateMinutes}m)</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="info-label">Break Overrun</span><span className="info-val">{att.totalBreakOverrunMinutes}m</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="info-label">Overtime</span><span className="info-val">{att.totalOvertimeMinutes}m</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="info-label">Absent Days</span><span className="info-val" style={{ color: att.absentDays > 0 ? 'var(--danger)' : undefined }}>{att.absentDays}</span></div>
                    </div>
                  </div>

                  {/* Leave & Permission */}
                  <div className="card" style={{ boxShadow: 'none', border: '1px solid var(--border-color)' }}>
                    <h4 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--gray-700)' }}>Leave, WFH & Permission</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.875rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="info-label">Approved Leave</span><span className="info-val">{lv.approvedLeave}</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="info-label">LOP Leave</span><span className="info-val" style={{ color: lv.lopLeave > 0 ? 'var(--danger)' : undefined }}>{lv.lopLeave}</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="info-label">WFH Days</span><span className="info-val">{wfh.wfhDays}</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="info-label">Permissions</span><span className="info-val">{perm.permissionCount}</span></div>
                    </div>
                  </div>

                </div>
              </div>

              {/* Deduction Breakdown */}
              {storedSummary?.deductionBreakdown && storedSummary.deductionBreakdown.length > 0 && (
                <div>
                  <h3 className="section-title">Deduction Breakdown</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.875rem' }}>
                    {storedSummary.deductionBreakdown.map((d: any, i: number) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid var(--border-color)' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>{d.name}</span>
                        <span style={{ fontWeight: 600, color: 'var(--danger)' }}>₹{Number(d.amount).toLocaleString('en-IN', {maximumFractionDigits:2})}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Payment Details */}
              {(detailDrawer.status === 'PAID' || detailDrawer.status === 'CLOSED') && detailDrawer.payroll_payments?.[0] && (
                <div style={{ backgroundColor: 'var(--success-50)', padding: '1.25rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--success)' }}>
                  <h4 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--success)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <CheckCircle2 size={16}/> Payment Recorded
                  </h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: '1rem', fontSize: '0.875rem' }}>
                    <div><div style={{ color: 'var(--success)' }}>Payment Date</div><div style={{ fontWeight: 600 }}>{new Date(detailDrawer.payroll_payments[0].paid_at).toLocaleDateString('en-GB')}</div></div>
                    <div><div style={{ color: 'var(--success)' }}>Amount</div><div style={{ fontWeight: 600 }}>₹{Number(detailDrawer.payroll_payments[0].amount).toLocaleString('en-IN', {maximumFractionDigits:2})}</div></div>
                    <div><div style={{ color: 'var(--success)' }}>Method</div><div style={{ fontWeight: 600 }}>{detailDrawer.payroll_payments[0].payment_method}</div></div>
                    <div><div style={{ color: 'var(--success)' }}>Reference</div><div style={{ fontWeight: 600 }}>{detailDrawer.payroll_payments[0].transaction_reference || '-'}</div></div>
                  </div>
                </div>
              )}

              {/* Audit History */}
              <div>
                <h3 className="section-title">Payroll Change History</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', paddingLeft: '1rem', borderLeft: '2px solid var(--gray-200)' }}>
                  <div style={{ position: 'relative' }}>
                    <div style={{ position: 'absolute', left: '-1.35rem', top: '2px', width: '12px', height: '12px', borderRadius: '50%', backgroundColor: 'var(--gray-400)', border: '2px solid var(--bg-surface)' }}></div>
                    <div style={{ fontSize: '0.875rem', fontWeight: 500 }}>Payroll Calculated</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{detailDrawer.calculated_at ? new Date(detailDrawer.calculated_at).toLocaleString('en-GB') : MONTH_NAMES[detailDrawer.payroll_month - 1] + ' ' + detailDrawer.payroll_year}</div>
                  </div>
                  {['UNDER_REVIEW','APPROVED','PAYMENT_PENDING','PAID','CLOSED'].includes(detailDrawer.status) && (
                    <div style={{ position: 'relative' }}>
                      <div style={{ position: 'absolute', left: '-1.35rem', top: '2px', width: '12px', height: '12px', borderRadius: '50%', backgroundColor: 'var(--warning)', border: '2px solid var(--bg-surface)' }}></div>
                      <div style={{ fontSize: '0.875rem', fontWeight: 500 }}>Submitted for Review</div>
                    </div>
                  )}
                  {['APPROVED','PAYMENT_PENDING','PAID','CLOSED'].includes(detailDrawer.status) && (
                    <div style={{ position: 'relative' }}>
                      <div style={{ position: 'absolute', left: '-1.35rem', top: '2px', width: '12px', height: '12px', borderRadius: '50%', backgroundColor: 'var(--primary-500)', border: '2px solid var(--bg-surface)' }}></div>
                      <div style={{ fontSize: '0.875rem', fontWeight: 500 }}>Payroll Approved</div>
                      {detailDrawer.approved_at && <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{new Date(detailDrawer.approved_at).toLocaleString('en-GB')}</div>}
                    </div>
                  )}
                  {['PAYMENT_PENDING','PAID','CLOSED'].includes(detailDrawer.status) && (
                    <div style={{ position: 'relative' }}>
                      <div style={{ position: 'absolute', left: '-1.35rem', top: '2px', width: '12px', height: '12px', borderRadius: '50%', backgroundColor: 'var(--primary-400)', border: '2px solid var(--bg-surface)' }}></div>
                      <div style={{ fontSize: '0.875rem', fontWeight: 500 }}>Moved to Payment Pending</div>
                    </div>
                  )}
                  {['PAID','CLOSED'].includes(detailDrawer.status) && detailDrawer.payroll_payments?.[0] && (
                    <div style={{ position: 'relative' }}>
                      <div style={{ position: 'absolute', left: '-1.35rem', top: '2px', width: '12px', height: '12px', borderRadius: '50%', backgroundColor: 'var(--success)', border: '2px solid var(--bg-surface)' }}></div>
                      <div style={{ fontSize: '0.875rem', fontWeight: 500 }}>Payment Recorded</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{new Date(detailDrawer.payroll_payments[0].paid_at).toLocaleString('en-GB')}</div>
                    </div>
                  )}
                  {detailDrawer.status === 'CLOSED' && (
                    <div style={{ position: 'relative' }}>
                      <div style={{ position: 'absolute', left: '-1.35rem', top: '2px', width: '12px', height: '12px', borderRadius: '50%', backgroundColor: 'var(--gray-500)', border: '2px solid var(--bg-surface)' }}></div>
                      <div style={{ fontSize: '0.875rem', fontWeight: 500 }}>Payroll Closed</div>
                    </div>
                  )}
                </div>
              </div>

            </div>
          </div>
        </div>
        );
      })()}

      {/* Generate Payroll Modal */}
      {generateModal && (
        <div className="drawer-overlay" style={{ alignItems: 'center', zIndex: 120 }}>
          <div className="card" style={{ margin: 'auto', width: '100%', maxWidth: '500px', animation: 'slideUp 0.3s' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem' }}>Generate {monthLabel} Payroll?</h3>
            
            <div style={{ backgroundColor: 'var(--gray-50)', padding: '1rem', borderRadius: 'var(--radius-md)', marginBottom: '1.5rem' }}>
              <h4 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem' }}>Payroll Configuration</h4>
              <ul style={{ margin: 0, paddingLeft: '1.5rem', fontSize: '0.875rem', color: 'var(--gray-700)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <li>Working Days Basis: {settingsForm.workingDaysBasis === 'configured' ? `Configured (${settingsForm.configuredWorkingDays})` : settingsForm.workingDaysBasis === 'calendar' ? 'Calendar Days' : 'Actual Working Days'}</li>
                <li>Rounding: {settingsForm.salaryRounding === 'round' ? 'Nearest Integer' : 'Exact Decimals'}</li>
                <li style={{ color: settingsForm.enableLopDeductions ? 'var(--success)' : 'var(--text-secondary)' }}>LOP Deductions: {settingsForm.enableLopDeductions ? 'Enabled' : 'Disabled'}</li>
              </ul>
            </div>

            <div style={{ padding: '0.75rem', backgroundColor: 'var(--warning-50)', color: 'var(--warning)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
              <AlertTriangle size={16} style={{ marginTop: '0.125rem', flexShrink: 0 }} /> 
              <div>Generating payroll will snapshot current attendance and leave records for calculations.</div>
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
              <span>Under Review: {kpis.underReview}</span>
              <span>Net Payroll: ₹{kpis.net.toLocaleString('en-IN')}</span>
            </div>
            <form onSubmit={handleApprove} style={{ display: 'flex', gap: '1rem' }}>
              <button type="button" onClick={() => setBulkApproveModal(false)} className="btn btn-outline" style={{ flex: 1 }}>Cancel</button>
              <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>Approve & Proceed</button>
            </form>
          </div>
        </div>
      )}

      {/* Salary Editor Modal */}
      {showSalaryEditor && (
        <div className="modal-overlay" style={{ zIndex: 120 }}>
          <div className="modal-content" style={{ maxWidth: '800px', width: '90%' }}>
            <div className="modal-header">
              <h2>Edit Salary Structure</h2>
              <button className="icon-button" onClick={() => setShowSalaryEditor(null)}><X size={20}/></button>
            </div>
            <div style={{ padding: '1.5rem' }}>
              <SalaryEditor 
                employeeId={showSalaryEditor} 
                payrollYear={detailDrawer?.payroll_year}
                payrollMonth={detailDrawer?.payroll_month}
                onSuccess={async () => {
                  await fetchPayrolls();
                  if (detailDrawer) {
                    const { data } = await supabase
                      .from('payroll')
                      .select('*, employees!payroll_employee_id_fkey(first_name, last_name, employee_code, departments(name)), payroll_payments(paid_at, payment_method, transaction_reference, amount)')
                      .eq('employee_id', detailDrawer.employee_id)
                      .eq('payroll_year', detailDrawer.payroll_year)
                      .eq('payroll_month', detailDrawer.payroll_month)
                      .single();
                    if (data) setDetailDrawer(data);
                  }
                  setShowSalaryEditor(null);
                  showToast('Salary structure updated and payroll recalculated.');
                }}
                onCancel={() => setShowSalaryEditor(null)}
              />
            </div>
          </div>
        </div>
      )}

      {/* Payslip Modal */}
      {showPayslip && (
        <div className="modal-overlay" style={{ zIndex: 120 }}>
          <div className="modal-content" style={{ maxWidth: '900px', width: '90%', maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="modal-header">
              <h2>Payslip</h2>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="btn btn-outline" onClick={() => window.print()} style={{ fontSize: '0.875rem', padding: '0.25rem 0.75rem' }}>Print</button>
                <button className="icon-button" onClick={() => setShowPayslip(null)}><X size={20}/></button>
              </div>
            </div>
            <div style={{ padding: '1.5rem', backgroundColor: 'var(--gray-50)' }}>
              <PayslipDocument currentPayslip={showPayslip} />
            </div>
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
                  ₹{Number(monthPayrolls.find(p => p.id === paymentModal)?.net_salary || 0).toLocaleString('en-IN', {maximumFractionDigits:2})}
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

              <div style={{ padding: '0.75rem', backgroundColor: 'var(--primary-50)', color: 'var(--primary-400)', borderRadius: 'var(--radius-md)', fontSize: '0.75rem', display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
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
              <div>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)' }}>Payroll Policy Configuration</h2>
                <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Manage company payroll rules</div>
              </div>
              <button className="btn btn-icon" onClick={() => setSettingsDrawer(false)}><X size={20} /></button>
            </div>
            <div className="drawer-body" style={{ display: 'flex', flexDirection: 'column', gap: '2rem', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '4rem 2rem' }}>
              <Settings size={64} style={{ color: 'var(--gray-400)' }} />
              <div>
                <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.5rem' }}>Centralized Payroll Settings</h3>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
                  Payroll policies (Working days, LOP, Late Login Deductions, Half-Day, Permission, WFH, Overtime) are now managed globally in the Admin Settings page to maintain a single source of truth.
                </p>
                <button className="btn btn-primary" onClick={() => navigate('/admin/settings?section=Payroll')}>
                  Go to Admin Settings <ArrowRight size={16} />
                </button>
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
        .drawer-header { padding: 1.5rem; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: flex-start; }
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
