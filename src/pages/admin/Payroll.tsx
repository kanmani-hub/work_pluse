import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Banknote, Download, Settings, ChevronLeft, ChevronRight,
  Search, CheckCircle2, AlertTriangle, X,
  FileText, Activity, ShieldCheck,
  Lock, CheckCircle, ArrowRight, Send
} from 'lucide-react';
import { exportService } from '../../services/export/exportService';
import { payrollService } from '../../services/payroll/payrollService';
import { unresolvedReviewItems, parsePayrollSnapshot } from '../../services/payroll/payrollRules';
import { buildDailyMetrics } from '../../services/payroll/dailyMetricDetails';
import type { MetricKey } from '../../services/payroll/dailyMetricDetails';
import DailyMetricModal from '../../components/payroll/DailyMetricModal';
import RecordsModal from '../../components/common/RecordsModal';
import { clickableCardProps, EMPLOYEE_COLUMNS } from '../../services/common/cardDetails';
import { payrollMonthCards, clockedInCard, type PayrollMonthCard } from '../../services/payroll/payrollCardRules';
import { realtimeService } from '../../services/realtime/realtimeService';
import { payslipService } from '../../services/payroll/payslipService';
import { payrollSettingsService, type PayrollSettings } from '../../services/payroll/payrollSettingsService';
import { globalSettingsService } from '../../services/settings/globalSettingsService';
import { payrollDataService, type PayrollEmployeeData } from '../../services/payroll/payrollDataService';
import SalaryEditor from '../../components/SalaryEditor';
import PayslipDocument from '../../components/PayslipDocument';
import { supabase } from '../../lib/supabase';
import { useDepartments } from '../../hooks/useDepartments';
import { employeeService, type EmployeeWithRelations } from '../../services/employees/employeeService';

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const AdminPayroll: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  
  // View modes
  const [viewMode, setViewMode] = useState<'TODAY' | 'CUSTOM' | 'MONTH'>('MONTH');
  const [customDate, setCustomDate] = useState(() => {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  });
  
  // Daily reports
  const [dailyReports, setDailyReports] = useState<any[]>([]);

  // Month selector
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  
  // Filters
  const [search, setSearch] = useState('');
  const [filterDept, setFilterDept] = useState('All');
  const { departments: activeDepts, loading: deptLoading } = useDepartments();
  const [filterStatus, setFilterStatus] = useState('All');
  
  // Drawers & Modals
  const [detailDrawer, setDetailDrawer] = useState<any>(null);
  const [detailEmpData, setDetailEmpData] = useState<PayrollEmployeeData | null>(null);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [resolvingKey, setResolvingKey] = useState<string | null>(null);
  
  // Daily specific detail modal
  const [dailyDetailModal, setDailyDetailModal] = useState<any>(null);
  // Summary-card breakdown (Today / Custom date view); independent of the per-employee popup
  const [metricModal, setMetricModal] = useState<MetricKey | null>(null);
  const [monthCard, setMonthCard] = useState<PayrollMonthCard | 'clockedIn' | null>(null);

  const [generateModal, setGenerateModal] = useState(false);
  const [paymentModal, setPaymentModal] = useState<any>(null);
  const [showSalaryEditor, setShowSalaryEditor] = useState<string | null>(null);
  const [showPayslip, setShowPayslip] = useState<any>(null);
  const [settingsDrawer, setSettingsDrawer] = useState(false);
  const [bulkApproveModal, setBulkApproveModal] = useState(false);
  
  // Settings form state
  const [settingsForm, setSettingsForm] = useState<PayrollSettings>(payrollSettingsService.getSettings());
  // Load saved payroll settings once (declared after the state it sets)
  useEffect(() => {
    globalSettingsService.loadSettings().then(s => setSettingsForm(s.payroll));
  }, []);
  // Employees that Generate could not calculate (shown until dismissed; never silently skipped)
  const [generateIssues, setGenerateIssues] = useState<{ employee_id: string; error: string }[]>([]);
  
  // Forms
  const [paymentForm, setPaymentForm] = useState({ date: new Date().toISOString().split('T')[0], method: 'Bank Transfer', ref: '', remarks: '', amount: 0 });
  
  const [payrolls, setPayrolls] = useState<any[]>([]);
  const [employees, setEmployees] = useState<EmployeeWithRelations[]>([]);
  const [globalStatus, setGlobalStatus] = useState('DRAFT');

  // Filter payrolls for selected month
  const monthPayrolls = payrolls.filter(p => Number(p.payroll_year) === selectedYear && Number(p.payroll_month) === selectedMonth);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (viewMode === 'MONTH') {
        const [payrollRes, empRes, deptRes] = await Promise.all([
          payrollService.getPayrolls(),
          employeeService.getEmployees(),
          employeeService.getDepartments()
        ]);
        
        if (payrollRes.error) throw payrollRes.error;
        if (empRes.error) throw empRes.error;
        if (deptRes.error) throw deptRes.error;

        if (empRes.data) setEmployees(empRes.data);

        if (payrollRes.data) {
          setPayrolls(payrollRes.data);
          
          // Compute global status from month data
          const monthData = payrollRes.data.filter((p: any) => Number(p.payroll_year) === selectedYear && Number(p.payroll_month) === selectedMonth);
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
      } else {
        // Daily View (TODAY or CUSTOM)
        const targetDate = viewMode === 'TODAY' 
          ? new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) 
          : customDate;

        const { data, error } = await payrollService.getDailyDeductionReport(targetDate);
        if (error) throw error;
        setDailyReports(data || []);
      }
    } catch (err: any) {
      console.error("Error loading payroll data:", err);
      setError(err.message || 'Unable to load payroll data');
    } finally {
      setLoading(false);
    }
  }, [viewMode, selectedYear, selectedMonth, customDate]);

  useEffect(() => {
    fetchData();
    const channel = realtimeService.subscribeToAdminPayroll(() => fetchData());
    return () => { realtimeService.unsubscribe(channel); };
  }, [fetchData]);

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
    const matchSearch = name.toLowerCase().includes(search.toLowerCase()) || empCode.toLowerCase().includes(search.toLowerCase());
    const matchDept = filterDept === 'All' ? true : filterDept === 'Unassigned' ? emp.department_id === null : emp.department_id === filterDept;
    const matchStatus = filterStatus === 'All' || (payroll ? payroll.status === filterStatus : filterStatus === 'NOT_GENERATED');
    return matchSearch && matchDept && matchStatus;
  });

  const getKPIs = () => {
    return {
      total: employees.filter(e => e.status?.toUpperCase() === 'ACTIVE').length,
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
  // Month cards and their detail rows share one builder (same filters as getKPIs)
  const monthCards = payrollMonthCards(employees, monthPayrolls);
  const clockedIn = clockedInCard(dailyReports);
  // Card totals and their breakdowns come from the same rows and functions, so they always match
  const dailyMetrics = buildDailyMetrics(dailyReports);
  const dailyDateLabel = viewMode === 'TODAY' ? `Today (${new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })})` : `Date: ${customDate}`;

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
    
    const result: any = await payrollService.generatePayroll(selectedYear, selectedMonth);
    const failures: { employee_id: string; error: string }[] = result.failures || [];
    setGenerateIssues(failures);

    if (result.error) {
      showToast(result.error);
      return;
    }
    await fetchData();
    const locked = result.skippedLocked ? `, ${result.skippedLocked} locked (unchanged)` : '';
    const reviewCount = (result.reviews || []).length;
    const review = reviewCount ? ` ${reviewCount} employee(s) have days flagged for review — open their payroll details before approving.` : '';
    showToast(failures.length
      ? `${MONTH_NAMES[selectedMonth - 1]} ${selectedYear}: ${result.count} calculated, ${failures.length} NOT calculated${locked}. See the list above the table.${review}`
      : `${MONTH_NAMES[selectedMonth - 1]} ${selectedYear} payroll calculated for ${result.count} employee(s)${locked}.${review}`);
  };

  const handleExport = async () => {
    if (filteredData.length === 0) {
      showToast('No payroll data to export for current filters.');
      return;
    }
    const exportRows = filteredData.map(({ emp, payroll }) => ({
      name: `${emp.first_name || ''} ${emp.last_name || ''}`,
      code: emp.employee_code || '-',
      department: emp.department?.name || '-',
      status: payroll?.status || 'NOT_GENERATED',
      gross: payroll?.gross_salary || 0,
      deductions: payroll?.total_deductions || 0,
      net: payroll?.net_salary || 0
    }));

    exportService.excel(exportRows, [
      { header: 'Employee Name', key: 'name', width: 22 },
      { header: 'Employee Code', key: 'code', width: 14 },
      { header: 'Department', key: 'department', width: 16 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Gross Salary', key: 'gross', width: 14 },
      { header: 'Deductions', key: 'deductions', width: 14 },
      { header: 'Net Salary', key: 'net', width: 14 }
    ], `Payroll_${MONTH_NAMES[selectedMonth - 1]}_${selectedYear}`);
    showToast('Payroll export generated.');
  };

  const handleApprove = async (e: React.FormEvent) => {
    e.preventDefault();
    setBulkApproveModal(false);
    
    let count = 0;
    let blocked = 0;
    let failed = 0;
    for (const p of monthPayrolls) {
      if (p.status === 'UNDER_REVIEW') {
        const { error } = await payrollService.approvePayroll(p.id);
        if (!error) count++;
        else if (error.message.startsWith('Cannot approve:')) blocked++;
        else failed++;
      }
    }
    
    await fetchData();
    if (detailDrawer?.status === 'UNDER_REVIEW') setDetailDrawer(null);
    const extra = [blocked ? `${blocked} blocked (unresolved review flags)` : '', failed ? `${failed} failed` : ''].filter(Boolean).join(', ');
    showToast(`${count} payroll(s) approved${extra ? `; ${extra}` : ''}.`);
  };

  const handleProceedToPayments = async () => {
    let count = 0;
    for (const p of monthPayrolls) {
      if (p.status === 'APPROVED') {
        await payrollService.movePayrollToPaymentPending(p.id);
        count++;
      }
    }
    await fetchData();
    showToast(`${count} payroll(s) moved to Payment Pending.`);
  };

  // Detail drawer: individual actions
  const handleDetailSubmitReview = async () => {
    if (!detailDrawer) return;
    const { error } = await payrollService.submitPayrollForReview(detailDrawer.id);
    if (!error) {
      setDetailDrawer({ ...detailDrawer, status: 'UNDER_REVIEW' });
      await fetchData();
      showToast('Submitted for review.');
    } else { showToast(error.message); }
  };

  const handleDetailApprove = async () => {
    if (!detailDrawer) return;
    const { error } = await payrollService.approvePayroll(detailDrawer.id);
    if (!error) {
      setDetailDrawer({ ...detailDrawer, status: 'APPROVED' });
      await fetchData();
      showToast('Payroll approved.');
    } else { showToast(error.message); }
  };

  const handleResolveFlag = async (date: string, type: string, decision: 'APPLY' | 'WAIVE') => {
    if (!detailDrawer) return;
    const key = `${date}|${type}`;
    setResolvingKey(key);
    const { data, error } = await payrollService.resolveReviewFlag(detailDrawer.id, date, type, decision, reviewNotes[key] || '');
    setResolvingKey(null);
    if (error) { showToast(error.message); return; }
    // Recalculation creates a fresh payroll row: keep the drawer's employee details, take the new figures
    setDetailDrawer({ ...detailDrawer, ...data });
    setReviewNotes(n => { const c = { ...n }; delete c[key]; return c; });
    await fetchData();
    showToast(decision === 'APPLY' ? 'Flag resolved: deduction applied and payroll recalculated.' : 'Flag resolved: waived, no deduction. Payroll recalculated.');
  };

  const handleDetailProceedPayment = async () => {
    if (!detailDrawer) return;
    const { error } = await payrollService.movePayrollToPaymentPending(detailDrawer.id);
    if (!error) {
      setDetailDrawer({ ...detailDrawer, status: 'PAYMENT_PENDING' });
      await fetchData();
      showToast('Moved to Payment Pending.');
    } else { showToast(error.message); }
  };

  const handleDetailClose = async () => {
    if (!detailDrawer) return;
    const { error } = await payrollService.closePayroll(detailDrawer.id);
    if (!error) {
      setDetailDrawer({ ...detailDrawer, status: 'CLOSED' });
      await fetchData();
      showToast('Payroll closed.');
    } else { showToast(error.message); }
  };
  
  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (paymentModal) {
      const payroll = monthPayrolls.find(p => p.id === paymentModal);
      // Amount = the payroll's approved net salary (exact-payment policy); the service and the
      // database function both re-check it
      const { error } = await payrollService.markPayrollPaid(paymentModal, Number(payroll?.net_salary ?? paymentForm.amount), paymentForm.method, paymentForm.ref, paymentForm.remarks, paymentForm.date);
      await fetchData();
      setPaymentModal(null);
      if (error) {
        // Never claim success: e.g. already paid by another admin/tab, or the payment insert failed
        showToast(error.message);
        return;
      }
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
        // No stored payslip: show that none was issued instead of inventing a number
        payslip_number: detailDrawer.status === 'PAID' || detailDrawer.status === 'CLOSED' ? 'Not issued' : 'PENDING',
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


  // Helper: get data summary values for table display
  const getTableSummary = (p: any) => {
    const summary = parseDataSummary(p);
    const settings = globalSettingsService.getSettings().payroll;
    const workingDays = summary?.settings?.workingDaysUsed ?? payrollSettingsService.getWorkingDaysForMonth(p.payroll_year, p.payroll_month, settings, globalSettingsService.getSettings().app?.workingDays);
    const present = summary?.attendance?.presentDays ?? 0;
    const approvedLeave = summary?.leave?.approvedLeave ?? 0;
    const lopLeave = summary?.leave?.lopLeave ?? 0;
    return { workingDays, present, approvedLeave, lopLeave };
  };

  // Get detail summary (from drawer empData or stored notes)
  const getDetailSummary = () => {
    // Live figures that could not be loaded are unknown: fall back to the stored calculation snapshot
    if (detailEmpData && !detailEmpData.dataError) return detailEmpData;
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
          <button onClick={handleExport} className="btn btn-outline" style={{ fontSize: '0.875rem' }}><Download size={16}/> Export</button>
          <button onClick={() => setGenerateModal(true)} className="btn btn-primary" style={{ fontSize: '0.875rem' }}><Activity size={16}/> Generate</button>
        </div>
      </div>

      {/* View Selector */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', borderBottom: '1px solid var(--gray-200)', paddingBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <div style={{ fontSize: '1.125rem', fontWeight: 600 }}>Payroll View:</div>
          <div style={{ display: 'flex', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)', padding: '0.25rem', border: '1px solid var(--border-color)' }}>
            <button onClick={() => setViewMode('TODAY')} className={`btn ${viewMode === 'TODAY' ? 'btn-primary' : 'btn-ghost'}`} style={{ padding: '0.25rem 0.75rem', fontSize: '0.875rem' }}>Today</button>
            <button onClick={() => setViewMode('CUSTOM')} className={`btn ${viewMode === 'CUSTOM' ? 'btn-primary' : 'btn-ghost'}`} style={{ padding: '0.25rem 0.75rem', fontSize: '0.875rem' }}>Custom Date</button>
            <button onClick={() => setViewMode('MONTH')} className={`btn ${viewMode === 'MONTH' ? 'btn-primary' : 'btn-ghost'}`} style={{ padding: '0.25rem 0.75rem', fontSize: '0.875rem' }}>Month</button>
          </div>
        </div>

        {viewMode === 'MONTH' && (
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-surface-elevated)' }}>
              <button onClick={handlePrevMonth} className="icon-button" style={{ borderRight: '1px solid var(--border-color)', borderRadius: 'var(--radius-md) 0 0 var(--radius-md)', padding: '0.5rem' }}><ChevronLeft size={16}/></button>
              <div style={{ padding: '0.5rem 1rem', fontSize: '0.875rem', fontWeight: 600 }}>{monthLabel}</div>
              <button onClick={handleNextMonth} className="icon-button" style={{ borderLeft: '1px solid var(--border-color)', borderRadius: '0 var(--radius-md) var(--radius-md) 0', padding: '0.5rem' }}><ChevronRight size={16}/></button>
            </div>
            <button onClick={handleCurrentMonth} className="btn btn-outline" style={{ fontSize: '0.875rem', padding: '0.5rem 1rem' }}>Current Month</button>
          </div>
        )}

        {viewMode === 'CUSTOM' && (
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input 
              type="date" 
              value={customDate}
              onChange={e => setCustomDate(e.target.value)}
              className="form-control"
              style={{ fontSize: '0.875rem' }}
            />
          </div>
        )}
      </div>

      {generateIssues.length > 0 && (
        <div role="alert" style={{ padding: '1rem', border: '1px solid var(--danger)', backgroundColor: 'var(--danger-50)', borderRadius: 'var(--radius-md)', color: 'var(--danger-700)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 600, marginBottom: '0.5rem' }}>
            <span><AlertTriangle size={16} style={{ verticalAlign: 'middle', marginRight: '0.5rem' }} />{generateIssues.length} employee(s) were NOT calculated</span>
            <button className="icon-button" aria-label="Dismiss" onClick={() => setGenerateIssues([])}><X size={16} /></button>
          </div>
          <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.875rem' }}>
            {generateIssues.map(f => {
              const emp = employees.find(e => e.id === f.employee_id);
              return <li key={f.employee_id}>{emp ? `${emp.first_name} ${emp.last_name} (${emp.employee_code})` : f.employee_id}: {f.error}</li>;
            })}
          </ul>
        </div>
      )}

      {error ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--danger)', backgroundColor: 'var(--danger-50)', borderRadius: 'var(--radius-md)' }}>
          <AlertTriangle size={48} style={{ margin: '0 auto 1rem auto' }} />
          <h3 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Unable to load data</h3>
          <p style={{ marginTop: '0.5rem', color: 'var(--danger-700)' }}>{error}</p>
        </div>
      ) : loading ? (
        <div className="skeleton-container" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '1rem' }}>
          {[...Array(9)].map((_, i) => <div key={i} className="skeleton" style={{ height: '70px', borderRadius: 'var(--radius-md)' }} />)}
        </div>
      ) : viewMode === 'MONTH' ? (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', width: '100%', minWidth: 0 }}>
            <div className="kpi-grid">
              <div className="tracking-kpi-card" {...clickableCardProps('Total Employees', () => setMonthCard('total'))}><div className="sc-val">{kpis.total}</div><div className="sc-title">Total Employees</div></div>
              <div className="tracking-kpi-card" {...clickableCardProps('Payroll Generated', () => setMonthCard('generated'))}><div className="sc-val">{kpis.generated}</div><div className="sc-title">Payroll Generated</div></div>
              <div className="summary-card-small" {...clickableCardProps('Under Review', () => { setFilterStatus('UNDER_REVIEW'); setMonthCard('underReview'); })}><div className="sc-val" style={{ color: 'var(--warning)' }}>{kpis.underReview}</div><div className="sc-title">Under Review</div></div>
              <div className="summary-card-small" {...clickableCardProps('Approved', () => { setFilterStatus('APPROVED'); setMonthCard('approved'); })}><div className="sc-val" style={{ color: '#a855f7' }}>{kpis.approved}</div><div className="sc-title">Approved</div></div>
              <div className="summary-card-small" {...clickableCardProps('Payment Pending', () => { setFilterStatus('PAYMENT_PENDING'); setMonthCard('paymentPending'); })}><div className="sc-val" style={{ color: 'var(--primary-700)' }}>{kpis.paymentPending}</div><div className="sc-title">Payment Pending</div></div>
              <div className="summary-card-small" {...clickableCardProps('Paid', () => { setFilterStatus('PAID'); setMonthCard('paid'); })}><div className="sc-val" style={{ color: 'var(--success)' }}>{kpis.paid}</div><div className="sc-title">Paid</div></div>
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px', width: '100%', minWidth: 0 }}>
              <div className="tracking-kpi-card" {...clickableCardProps('Gross Payroll', () => setMonthCard('gross'))}>
                <div className="sc-title">Gross Payroll</div>
                <div style={{ fontSize: 'clamp(22px, 3vw, 40px)', lineHeight: 1.05, whiteSpace: 'normal', overflowWrap: 'anywhere', fontWeight: 700, color: 'var(--text-primary)' }}>₹{kpis.gross.toLocaleString('en-IN', {maximumFractionDigits:2})}</div>
              </div>
              <div className="tracking-kpi-card" {...clickableCardProps('Total Deductions', () => setMonthCard('deductions'))}>
                <div className="sc-title">Total Deductions</div>
                <div style={{ fontSize: 'clamp(22px, 3vw, 40px)', lineHeight: 1.05, whiteSpace: 'normal', overflowWrap: 'anywhere', fontWeight: 700, color: 'var(--danger)' }}>₹{kpis.deductions.toLocaleString('en-IN', {maximumFractionDigits:2})}</div>
              </div>
              <div className="tracking-kpi-card" {...clickableCardProps('Net Payroll', () => setMonthCard('net'))} style={{ cursor: 'pointer', backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--success)' }}>
                <div className="sc-title" style={{ color: 'var(--success)' }}>Net Payroll</div>
                <div style={{ fontSize: 'clamp(22px, 3vw, 40px)', lineHeight: 1.05, whiteSpace: 'normal', overflowWrap: 'anywhere', fontWeight: 800, color: 'var(--success)' }}>₹{kpis.net.toLocaleString('en-IN', {maximumFractionDigits:2})}</div>
              </div>
            </div>
          </div>

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
                  {deptLoading ? (
                    <option disabled>Loading...</option>
                  ) : (
                    <>
                      {activeDepts.map((d: any) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                      <option value="Unassigned">Unassigned</option>
                    </>
                  )}
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
                        const hasActiveSalary = emp.salary_structures && emp.salary_structures.some((s: any) => s.is_active);
                        return (
                          <tr key={emp.id}>
                            <td>
                              <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{emp.first_name} {emp.last_name}</div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{emp.employee_code} • {emp.department?.name || 'Unknown'}</div>
                            </td>
                            <td colSpan={7} style={{ textAlign: 'center', color: hasActiveSalary ? 'var(--text-secondary)' : 'var(--danger)' }}>
                              {hasActiveSalary ? 'Employee exists, but no payroll record exists for this period.' : 'Salary not configured'}
                            </td>
                            <td>{getStatusBadge('NOT_GENERATED')}</td>
                            <td style={{ textAlign: 'right' }}>
                              <button onClick={() => hasActiveSalary ? setGenerateModal(true) : setShowSalaryEditor(emp.id)} className="btn btn-outline" style={{ fontSize: '0.75rem', padding: '0.25rem 0.75rem' }}>
                                {hasActiveSalary ? 'Generate' : 'Configure'}
                              </button>
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
                          <td style={{ textAlign: 'right' }}>{Number.isFinite(ts.workingDays) ? ts.workingDays : '-'}</td>
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
          </div>
        </>
      ) : (
        /* TODAY / CUSTOM Date View */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', width: '100%', minWidth: 0 }}>
          
          <div className="kpi-grid">
            <div className="tracking-kpi-card" {...clickableCardProps('Employees Clocked In', () => setMonthCard('clockedIn'))}>
              <div className="sc-val">{clockedIn.count}</div>
              <div className="sc-title">Employees Clocked In</div>
            </div>
            {([
              { key: 'late', label: 'Late Deductions', color: 'var(--danger)' },
              { key: 'break', label: 'Break Overrun Deductions', color: 'var(--danger)' },
              { key: 'lop', label: 'LOP Impact', color: 'var(--danger)' },
              { key: 'overtime', label: 'Overtime Pay', color: 'var(--success)' },
              { key: 'total', label: 'Total Daily Deduction Impact', color: 'var(--danger)', bg: 'var(--danger-50)' },
            ] as { key: MetricKey; label: string; color: string; bg?: string }[]).map(c => (
              <div key={c.key} className="tracking-kpi-card" role="button" tabIndex={0}
                aria-label={`${c.label}: ₹${dailyMetrics[c.key].total.toLocaleString('en-IN')}. Show details`}
                onClick={() => setMetricModal(c.key)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setMetricModal(c.key); } }}
                style={{ cursor: 'pointer', ...(c.bg ? { backgroundColor: c.bg } : {}) }}>
                <div className="sc-val" style={{ color: c.color }}>
                  ₹{dailyMetrics[c.key].total.toLocaleString('en-IN')}
                </div>
                <div className="sc-title">{c.label}</div>
              </div>
            ))}
          </div>

          <div className="card" style={{ padding: 0 }}>
            {dailyReports.length === 0 ? (
              <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                <Activity size={48} style={{ margin: '0 auto 1rem auto', opacity: 0.3 }} />
                <h3 style={{ fontSize: '1.125rem', color: 'var(--text-primary)' }}>No attendance records found for this date.</h3>
              </div>
            ) : (
              <div className="table-container">
                <table className="table" style={{ width: '100%', minWidth: '1200px' }}>
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Shift</th>
                      <th>Status</th>
                      <th>Clock In</th>
                      <th>Clock Out</th>
                      <th style={{ textAlign: 'right' }}>Late Mins</th>
                      <th style={{ textAlign: 'right' }}>Late Ded.</th>
                      <th style={{ textAlign: 'right' }}>Break Overrun</th>
                      <th style={{ textAlign: 'right' }}>Break Ded.</th>
                      <th style={{ textAlign: 'right' }}>OT Mins</th>
                      <th style={{ textAlign: 'right' }}>OT Pay</th>
                      <th style={{ textAlign: 'right' }}>LOP Impact</th>
                      <th style={{ textAlign: 'right' }}>Other Ded.</th>
                      <th style={{ textAlign: 'right' }}>Total Impact</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dailyReports.map(r => (
                      <tr key={r.employee.id}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{r.employee.first_name} {r.employee.last_name}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{r.employee.employee_code} • {r.employee.departments?.name}</div>
                        </td>
                        <td>{r.shift}</td>
                        <td><span className={`badge badge-${r.status === 'COMPLETED' ? 'success' : r.status === 'WORKING' ? 'primary' : 'warning'}`}>{r.status}</span></td>
                        <td>{r.clockIn ? new Date(r.clockIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-'}</td>
                        <td>{r.clockOut ? new Date(r.clockOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-'}</td>
                        <td style={{ textAlign: 'right', color: r.lateMinutes > 0 ? 'var(--danger-700)' : 'inherit' }}>{r.lateMinutes || '-'}</td>
                        <td style={{ textAlign: 'right', color: r.lateDeduction > 0 ? 'var(--danger)' : 'inherit' }}>{r.lateDeduction > 0 ? `₹${r.lateDeduction.toLocaleString('en-IN')}` : '₹0'}</td>
                        <td style={{ textAlign: 'right', color: r.breakOverrunMinutes > 0 ? 'var(--warning-700)' : 'inherit' }}>{r.breakOverrunMinutes || '-'}</td>
                        <td style={{ textAlign: 'right', color: r.breakDeduction > 0 ? 'var(--danger)' : 'inherit' }}>{r.breakDeduction > 0 ? `₹${r.breakDeduction.toLocaleString('en-IN')}` : '₹0'}</td>
                        <td style={{ textAlign: 'right', color: r.overtimeMinutes > 0 ? 'var(--success-700)' : 'inherit' }}>{r.overtimeMinutes || '-'}</td>
                        <td style={{ textAlign: 'right', color: r.overtimePay > 0 ? 'var(--success)' : 'inherit' }}>{r.overtimePay > 0 ? `₹${r.overtimePay.toLocaleString('en-IN')}` : '₹0'}</td>
                        <td style={{ textAlign: 'right', color: r.lopImpact > 0 ? 'var(--danger)' : 'inherit' }}>{r.lopImpact > 0 ? `₹${r.lopImpact.toLocaleString('en-IN')}` : '₹0'}</td>
                        <td style={{ textAlign: 'right', color: r.otherDeductions > 0 ? 'var(--danger)' : 'inherit' }}>{r.otherDeductions > 0 ? `₹${r.otherDeductions.toLocaleString('en-IN')}` : '₹0'}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600, color: r.totalDailyImpact > 0 ? 'var(--danger)' : 'var(--text-secondary)' }}>
                          {r.totalDailyImpact > 0 ? `₹${r.totalDailyImpact.toLocaleString('en-IN')}` : '₹0'}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button onClick={() => setDailyDetailModal(r)} className="btn btn-outline" style={{ fontSize: '0.75rem', padding: '0.25rem 0.75rem' }}>Details</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Detail Drawer */}
      {detailDrawer && (() => {
        const ds = getDetailSummary();
        const storedSummary = parseDataSummary(detailDrawer);
        const att = ds?.attendance || { workingDays: 0, presentDays: 0, absentDays: 0, lateLogins: 0, totalLateMinutes: 0, earlyLogouts: 0, totalBreakOverrunMinutes: 0, totalOvertimeMinutes: 0, halfDays: 0, lopDays: 0 };
        const lv = ds?.leave || { approvedLeave: 0, lopLeave: 0, totalLeaveDays: 0 };
        const wfh = ds?.wfh || { wfhDays: 0 };
        const perm = ds?.permission || { permissionCount: 0, totalMinutes: 0 };
        const settings = globalSettingsService.getSettings().payroll;
        const workingDays = storedSummary?.settings?.workingDaysUsed ?? payrollSettingsService.getWorkingDaysForMonth(detailDrawer.payroll_year, detailDrawer.payroll_month, settings, globalSettingsService.getSettings().app?.workingDays);
        // Flags come from the STORED calculation (what approval checks), not the live preview
        const openFlags = unresolvedReviewItems(detailDrawer.remarks);
        const resolvedFlags: any[] = parsePayrollSnapshot(detailDrawer.remarks)?.reviewResolutions || [];
        const canResolve = ['CALCULATED', 'UNDER_REVIEW'].includes(detailDrawer.status);

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
              
              {detailEmpData?.dataError && (
                <div role="alert" style={{ padding: '0.75rem 1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--danger)', color: 'var(--danger)', fontSize: '0.8125rem' }}>
                  Live attendance data could not be loaded, so the figures below are from the stored calculation. {detailEmpData.dataError}
                </div>
              )}

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
                  <button type="button" onClick={handleDetailApprove} className="btn btn-primary" style={{ fontSize: '0.8rem' }} disabled={openFlags.length > 0} title={openFlags.length > 0 ? 'Resolve all attendance review flags first' : undefined}><CheckCircle size={14}/> Approve</button>
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
                    <div><div style={{ color: 'var(--danger)' }}>Working Days Basis</div><div style={{ fontWeight: 600 }}>{Number.isFinite(workingDays) ? `${workingDays} Days` : 'Not configured'}</div></div>
                    <div><div style={{ color: 'var(--danger)' }}>Daily Rate</div><div style={{ fontWeight: 600 }}>₹{workingDays > 0 ? Math.round(Number(detailDrawer.gross_salary) / workingDays).toLocaleString('en-IN') : '-'}</div></div>
                    <div><div style={{ color: 'var(--danger)' }}>Total LOP</div><div style={{ fontWeight: 700, color: 'var(--danger)' }}>₹{Number(detailDrawer.lop_deduction).toLocaleString('en-IN')}</div></div>
                  </div>
                </div>
              )}

              {/* Days an Admin must review before approval (nothing was deducted for the uncertain part) */}
              {openFlags.length > 0 && (
                <div role="status" style={{ padding: '0.75rem 1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--warning)', fontSize: '0.8125rem', display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                  <div style={{ fontWeight: 600, color: 'var(--warning)' }}>Admin review needed ({openFlags.length}) — approval is blocked until each flag is resolved</div>
                  {openFlags.map(r => {
                    const key = `${r.date}|${r.type || ''}`;
                    const busy = resolvingKey === key;
                    return (
                      <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                        <div><strong>{r.date}</strong> — {r.reason}</div>
                        {canResolve && r.type && (
                          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                            <input type="text" className="form-control" style={{ flex: 1, minWidth: '12rem', fontSize: '0.8125rem' }} placeholder="Note (required)" value={reviewNotes[key] || ''} onChange={e => setReviewNotes(n => ({ ...n, [key]: e.target.value }))}/>
                            <button type="button" className="btn btn-outline" style={{ fontSize: '0.75rem' }} disabled={busy || !(reviewNotes[key] || '').trim()} onClick={() => handleResolveFlag(r.date, r.type as string, 'APPLY')}>Apply deduction</button>
                            <button type="button" className="btn btn-outline" style={{ fontSize: '0.75rem' }} disabled={busy || !(reviewNotes[key] || '').trim()} onClick={() => handleResolveFlag(r.date, r.type as string, 'WAIVE')}>Waive</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {resolvedFlags.length > 0 && (
                <div style={{ padding: '0.75rem 1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', fontSize: '0.8125rem' }}>
                  <div style={{ fontWeight: 600, marginBottom: '0.375rem' }}>Resolved review flags ({resolvedFlags.length})</div>
                  {resolvedFlags.map((r: any) => (
                    <div key={`${r.date}|${r.type}`}><strong>{r.date}</strong> — {r.decision === 'APPLY' ? 'Deduction applied' : 'Waived'}: {r.note}</div>
                  ))}
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
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="info-label">Working Days</span><span className="info-val">{Number.isFinite(workingDays) ? workingDays : '-'}</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="info-label">Present</span><span className="info-val">{att.presentDays}</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="info-label">Late Logins</span><span className="info-val">{att.lateLogins} ({att.totalLateMinutes}m)</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="info-label">Break Overrun</span><span className="info-val">{att.totalBreakOverrunMinutes}m</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }} title="Recorded for information only — no early-logout deduction under the current policy"><span className="info-label">Early Logouts (info)</span><span className="info-val">{att.earlyLogouts}{(att as any).earlyLogoutMinutes ? ` (${(att as any).earlyLogoutMinutes}m)` : ''}</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="info-label">Approved Overtime</span>{(ds as any)?.approvedOvertimeError
                        ? <span className="info-val" style={{ color: 'var(--danger)' }} title={(ds as any).approvedOvertimeError}>Unavailable</span>
                        : <span className="info-val">{att.totalOvertimeMinutes}m</span>}</div>
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
                  await fetchData();
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
      {/* Month summary cards + Employees Clocked In (read-only details) */}
      {monthCard && (() => {
        const inr = (v: any) => `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
        const period = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;
        if (monthCard === 'clockedIn') {
          return <RecordsModal open title="Employees Clocked In" subtitle={dailyDateLabel} total={clockedIn.count} totalLabel="Employees"
            columns={[...EMPLOYEE_COLUMNS, { key: 'shift', label: 'Shift' }, { key: 'status', label: 'Status' }, { key: 'clockIn', label: 'Clock In' }, { key: 'clockOut', label: 'Clock Out' }, { key: 'elapsed', label: 'Elapsed (clock-in → clock-out)' }]}
            rows={clockedIn.rows} loading={loading} error={error || null} emptyMessage="No attendance records for this date."
            explanation={['One row per attendance record for the selected date (the same rows as the daily table).', 'Elapsed time is shown only when a clock-out exists; a missing clock-out is never turned into worked hours.']}
            onClose={() => setMonthCard(null)} />;
        }
        const amountCols = [...EMPLOYEE_COLUMNS, { key: 'status', label: 'Status' },
          { key: 'gross', label: 'Gross', align: 'right' as const, format: inr }, { key: 'overtime', label: 'Overtime', align: 'right' as const, format: inr },
          { key: 'lop', label: 'LOP (in deductions)', align: 'right' as const, format: inr }, { key: 'otherDeductions', label: 'Other deductions', align: 'right' as const, format: inr },
          { key: 'deductions', label: 'Total deductions', align: 'right' as const, format: inr }, { key: 'net', label: 'Net', align: 'right' as const, format: inr }];
        const statusText = (t: string, st: string) => ({ title: t, label: 'Payroll records', money: false, cols: amountCols, explain: `Payroll records for ${period} with status ${st}.`, empty: `No payroll records with status ${st} for ${period}.` });
        const meta: Record<PayrollMonthCard, { title: string; label: string; money: boolean; cols: any[]; explain: string; empty: string }> = {
          total: { title: 'Total Employees', label: 'Active employees', money: false, cols: [...EMPLOYEE_COLUMNS, { key: 'status', label: `Payroll status (${period})` }], explain: 'ACTIVE employees, with the status of their payroll for the selected month (NOT_GENERATED when none exists).', empty: 'No active employees.' },
          generated: { ...statusText('Payroll Generated', 'other than DRAFT'), explain: `Payroll records for ${period} in any status other than DRAFT.` },
          underReview: statusText('Payroll Under Review', 'UNDER_REVIEW'),
          approved: statusText('Payroll Approved', 'APPROVED'),
          paymentPending: statusText('Payroll Payment Pending', 'PAYMENT_PENDING'),
          paid: { ...statusText('Payroll Paid', 'PAID or CLOSED') },
          gross: { title: 'Gross Payroll', label: 'Gross payroll', money: true, cols: amountCols, explain: `Sum of the stored Gross column of every payroll record for ${period} (all statuses).`, empty: `No payroll records for ${period}.` },
          deductions: { title: 'Total Deductions', label: 'Total deductions', money: true, cols: amountCols, explain: `Sum of the stored Total deductions column for ${period}. LOP is shown separately but is already included in Total deductions (LOP + Other = Total), so nothing is counted twice.`, empty: `No payroll records for ${period}.` },
          net: { title: 'Net Payroll', label: 'Net payroll', money: true, cols: amountCols, explain: `Sum of the stored Net column for ${period} (Net = Gross + Overtime − Total deductions, as calculated when the payroll was generated).`, empty: `No payroll records for ${period}.` },
        };
        const m = meta[monthCard];
        const d = monthCards[monthCard];
        return <RecordsModal open title={m.title} subtitle={`Payroll month: ${period}`} total={m.money ? inr(d.amount) : d.count} totalLabel={m.money ? `${m.label} (${d.count} records)` : m.label}
          columns={m.cols} rows={d.rows} loading={loading} error={error || null} emptyMessage={m.empty}
          explanation={[m.explain, 'Read-only: opening this view does not generate, approve or pay payroll.']} onClose={() => setMonthCard(null)} />;
      })()}
      {/* Daily Detail Modal */}
      <DailyMetricModal
        metric={metricModal ? dailyMetrics[metricModal] : null}
        dateLabel={dailyDateLabel}
        loading={loading}
        error={error || null}
        onClose={() => setMetricModal(null)}
      />

      {dailyDetailModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ width: '90%', maxWidth: '600px' }}>
            <div className="modal-header">
              <h2 className="modal-title">Daily Deduction Breakdown</h2>
              <button onClick={() => setDailyDetailModal(null)} className="icon-button"><X size={20}/></button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div>
                <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>{dailyDetailModal.employee.first_name} {dailyDetailModal.employee.last_name}</h3>
                <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{dailyDetailModal.employee.employee_code} • {dailyDetailModal.employee.departments?.name}</div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="card" style={{ padding: '1rem', backgroundColor: 'var(--bg-surface)' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Clock In</div>
                  <div style={{ fontWeight: 600 }}>{dailyDetailModal.clockIn ? new Date(dailyDetailModal.clockIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-'}</div>
                </div>
                <div className="card" style={{ padding: '1rem', backgroundColor: 'var(--bg-surface)' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Clock Out</div>
                  <div style={{ fontWeight: 600 }}>{dailyDetailModal.clockOut ? new Date(dailyDetailModal.clockOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-'}</div>
                </div>
              </div>

              <div className="card" style={{ padding: '1rem' }}>
                <h4 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--danger-700)', marginBottom: '0.75rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>Deductions Applied</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.875rem' }}>
                  {dailyDetailModal.rawCalc.deductionItems.map((item: any, i: number) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>{item.name}</span>
                      <span style={{ fontWeight: 500, color: 'var(--danger)' }}>₹{item.amount.toLocaleString('en-IN')}</span>
                    </div>
                  ))}
                  {dailyDetailModal.rawCalc.deductionItems.length === 0 && (
                    <div style={{ color: 'var(--text-secondary)' }}>No deductions for this date.</div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed var(--border-color)', paddingTop: '0.5rem', marginTop: '0.25rem', fontWeight: 600 }}>
                    <span>Total Deduction Impact</span>
                    <span style={{ color: 'var(--danger)' }}>₹{dailyDetailModal.totalDailyImpact.toLocaleString('en-IN')}</span>
                  </div>
                </div>
              </div>
              
              {dailyDetailModal.overtimePay > 0 && (
                <div className="card" style={{ padding: '1rem', borderColor: 'var(--success-200)', backgroundColor: 'var(--success-50)' }}>
                  <h4 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--success-700)', marginBottom: '0.75rem' }}>Earnings</h4>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem' }}>
                    <span style={{ color: 'var(--success-700)' }}>Overtime Pay ({dailyDetailModal.overtimeMinutes}m)</span>
                    <span style={{ fontWeight: 600, color: 'var(--success)' }}>₹{dailyDetailModal.overtimePay.toLocaleString('en-IN')}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default AdminPayroll;
