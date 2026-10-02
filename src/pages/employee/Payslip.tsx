import React, { useState, useEffect } from 'react';
import { 
  ChevronLeft, ChevronRight, Calendar as CalendarIcon, 
  Download, Printer, CheckCircle2, Lock, ArrowLeft,
  Activity, X
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { payrollService } from '../../services/payroll/payrollService';
import PayslipDocument from '../../components/PayslipDocument';

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const EmployeePayslip: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [allPayrolls, setAllPayrolls] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentPayroll, setCurrentPayroll] = useState<any>(null);
  const [toastMessage, setToastMessage] = useState('');
  const [showPreview, setShowPreview] = useState(false);

  const fetchPayrolls = async () => {
    setLoading(true);
    const { data } = await payrollService.getMyPayrolls();
    if (data && data.length > 0) {
      const fetchedPayrolls = data as any[];
      setAllPayrolls(fetchedPayrolls);
      setCurrentIndex(0);
      const detail = await payrollService.getMyPayrollById(fetchedPayrolls[0].id);
      setCurrentPayroll(detail.data);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchPayrolls();
  }, []);

  const handlePrevMonth = async () => {
    if (currentIndex < allPayrolls.length - 1) {
      setLoading(true);
      const nextIndex = currentIndex + 1;
      setCurrentIndex(nextIndex);
      const detail = await payrollService.getMyPayrollById(allPayrolls[nextIndex].id);
      setCurrentPayroll(detail.data);
      setLoading(false);
    }
  };

  const handleNextMonth = async () => {
    if (currentIndex > 0) {
      setLoading(true);
      const nextIndex = currentIndex - 1;
      setCurrentIndex(nextIndex);
      const detail = await payrollService.getMyPayrollById(allPayrolls[nextIndex].id);
      setCurrentPayroll(detail.data);
      setLoading(false);
    }
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3000);
  };

  const getMonthName = (monthNum: number) => MONTH_NAMES[monthNum - 1] || '';

  // Parse stored data summary from payroll.notes
  const getDataSummary = () => {
    try {
      if (currentPayroll?.notes) return JSON.parse(currentPayroll.notes);
    } catch {}
    return null;
  };

  // Get deduction items from payroll_items or stored summary
  const getDeductionItems = () => {
    const items: { name: string; amount: number }[] = [];
    
    // First try payroll_items from the database
    if (currentPayroll?.payroll_items) {
      const deductions = currentPayroll.payroll_items.filter((i: any) => i.item_type === 'DEDUCTION');
      for (const d of deductions) {
        if (Number(d.amount) > 0) {
          items.push({ name: d.item_name, amount: Number(d.amount) });
        }
      }
    }

    // Fallback to stored summary
    if (items.length === 0) {
      const summary = getDataSummary();
      if (summary?.deductionBreakdown) {
        for (const d of summary.deductionBreakdown) {
          if (Number(d.amount) > 0) {
            items.push({ name: d.name, amount: Number(d.amount) });
          }
        }
      }
    }

    return items;
  };

  // Get attendance/leave/permission summary
  const getAttendanceSummary = () => {
    const summary = getDataSummary();
    return {
      workingDays: summary?.settings?.workingDaysUsed ?? summary?.attendance?.workingDays ?? 0,
      presentDays: summary?.attendance?.presentDays ?? 0,
      lateLogins: summary?.attendance?.lateLogins ?? 0,
      earlyLogouts: summary?.attendance?.earlyLogouts ?? 0,
      approvedLeave: summary?.leave?.approvedLeave ?? 0,
      lopLeave: summary?.leave?.lopLeave ?? 0,
      wfhDays: summary?.wfh?.wfhDays ?? 0,
      permissionCount: summary?.permission?.permissionCount ?? 0,
    };
  };

  // Get payslip number
  const getPayslipNumber = () => {
    if (currentPayroll?.status === 'PAID' || currentPayroll?.status === 'CLOSED') {
      return `PS-${currentPayroll.payroll_year}${String(currentPayroll.payroll_month).padStart(2, '0')}-${currentPayroll.id?.substring(0, 6)?.toUpperCase() || '000'}`;
    }
    return 'PENDING';
  };

  // Get payment info
  const getPaymentInfo = () => {
    const payment = currentPayroll?.payroll_payments?.[0];
    if (payment) {
      return {
        status: 'PAID',
        date: new Date(payment.paid_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
        method: payment.payment_method,
      };
    }
    return {
      status: currentPayroll?.status || 'UNKNOWN',
      date: '-',
      method: '-',
    };
  };

  // Download payslip as printable HTML
  const handleDownload = () => {
    if (!currentPayroll) return;
    
    const emp = currentPayroll.employees;
    const monthYear = `${getMonthName(currentPayroll.payroll_month)} ${currentPayroll.payroll_year}`;
    const paymentInfo = getPaymentInfo();
    const deductions = getDeductionItems();
    const totalDeductions = Number(currentPayroll.total_deductions);
    
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Payslip - ${emp?.first_name} ${emp?.last_name} - ${monthYear}</title>
  <style>
    body { font-family: 'Segoe UI', Arial, sans-serif; padding: 40px; color: #222; max-width: 800px; margin: 0 auto; }
    h1 { font-size: 24px; margin-bottom: 4px; }
    h2 { font-size: 18px; color: #555; margin-bottom: 20px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #eee; font-size: 14px; }
    th { background: #f5f5f5; font-weight: 600; }
    .right { text-align: right; }
    .total-row { font-weight: 700; border-top: 2px solid #333; }
    .section-title { font-size: 16px; font-weight: 700; margin: 20px 0 10px; padding-bottom: 6px; border-bottom: 2px solid #7c5cff; }
    .net-pay { font-size: 28px; font-weight: 800; color: #0a7; text-align: center; padding: 20px; background: #f0fdf4; border-radius: 8px; margin: 20px 0; }
    .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 20px; font-size: 14px; }
    .meta-grid div { display: flex; justify-content: space-between; }
    .meta-label { color: #666; }
    @media print { body { padding: 20px; } }
  </style>
</head>
<body>
  <h1>WorkPulse HR</h1>
  <h2>Salary Slip — ${monthYear}</h2>
  
  <div class="meta-grid">
    <div><span class="meta-label">Employee Name</span><span>${emp?.first_name || ''} ${emp?.last_name || ''}</span></div>
    <div><span class="meta-label">Employee ID</span><span>${emp?.employee_code || '-'}</span></div>
    <div><span class="meta-label">Department</span><span>${emp?.departments?.name || '-'}</span></div>
    <div><span class="meta-label">Payslip No</span><span>${getPayslipNumber()}</span></div>
    <div><span class="meta-label">Payment Status</span><span>${paymentInfo.status}</span></div>
    <div><span class="meta-label">Payment Date</span><span>${paymentInfo.date}</span></div>
  </div>

  <div class="section-title">Earnings</div>
  <table>
    <tr><td>Base Salary</td><td class="right">₹${Number(currentPayroll.basic_salary).toLocaleString('en-IN', {maximumFractionDigits:2})}</td></tr>
    ${Number(currentPayroll.total_allowances) > 0 ? `<tr><td>Allowances</td><td class="right">₹${Number(currentPayroll.total_allowances).toLocaleString('en-IN', {maximumFractionDigits:2})}</td></tr>` : ''}
    <tr><td>Overtime Pay</td><td class="right">₹${Number(currentPayroll.overtime_amount).toLocaleString('en-IN', {maximumFractionDigits:2})}</td></tr>
    <tr class="total-row"><td>Gross Earnings</td><td class="right">₹${Number(currentPayroll.gross_salary).toLocaleString('en-IN', {maximumFractionDigits:2})}</td></tr>
  </table>

  <div class="section-title">Deductions</div>
  <table>
    ${deductions.length > 0 ? deductions.map(d => `<tr><td>${d.name}</td><td class="right">₹${d.amount.toLocaleString('en-IN', {maximumFractionDigits:2})}</td></tr>`).join('') : '<tr><td colspan="2" style="color:#999; font-style:italic;">No deductions applied</td></tr>'}
    <tr class="total-row"><td>Total Deductions</td><td class="right">₹${totalDeductions.toLocaleString('en-IN', {maximumFractionDigits:2})}</td></tr>
  </table>

  <div class="net-pay">Net Pay: ₹${Number(currentPayroll.net_salary).toLocaleString('en-IN', {maximumFractionDigits:2})}</div>
  
  <p style="font-size:12px; color:#999; text-align:center; margin-top:30px;">This is a computer-generated payslip and does not require a signature.</p>
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Payslip_${emp?.employee_code || 'EMP'}_${currentPayroll.payroll_year}_${String(currentPayroll.payroll_month).padStart(2, '0')}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Payslip downloaded successfully.');
  };

  const handlePreview = () => {
    setShowPreview(true);
  };
  
  // Construct payslip object for preview
  const payslipObj = currentPayroll ? {
    payslip_period: `${getMonthName(currentPayroll.payroll_month)} ${currentPayroll.payroll_year}`,
    payslip_number: getPayslipNumber(),
    payroll: currentPayroll
  } : null;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'CALCULATED': return <span className="badge badge-primary">Calculated</span>;
      case 'UNDER_REVIEW': return <span className="badge badge-warning">Under Review</span>;
      case 'APPROVED': return <span className="badge badge-primary" style={{ backgroundColor: 'rgba(168,85,247,0.15)', color: '#a855f7' }}>Approved</span>;
      case 'PAYMENT_PENDING': return <span className="badge badge-primary">Payment Pending</span>;
      case 'PAID': return <span className="badge badge-success">Paid</span>;
      case 'CLOSED': return <span className="badge badge-gray">Closed</span>;
      default: return <span className="badge badge-gray">{status}</span>;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', position: 'relative' }}>
      
      {toastMessage && (
        <div style={{ position: 'fixed', top: '24px', left: '50%', transform: 'translateX(-50%)', backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)', padding: '0.75rem 1.5rem', borderRadius: 'var(--radius-full)', zIndex: 1000, display: 'flex', alignItems: 'center', gap: '0.5rem', boxShadow: 'var(--shadow-lg)', animation: 'slideDown 0.3s forwards' }}>
          <CheckCircle2 size={18} color="var(--success)" />
          {toastMessage}
        </div>
      )}

      {/* Page Header */}
      <div className="page-header" style={{ marginBottom: 0, flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <button onClick={() => navigate('/employee/payroll')} className="icon-button" style={{ padding: '0.25rem', marginLeft: '-0.25rem' }}><ArrowLeft size={20} /></button>
            <h1 className="page-title">Payslip</h1>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>View your monthly payslip details and history.</p>
        </div>
        
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', backgroundColor: 'var(--bg-surface-elevated)', padding: '0.25rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
            <button onClick={handlePrevMonth} className="icon-button" disabled={currentIndex === allPayrolls.length - 1} style={{ opacity: currentIndex === allPayrolls.length - 1 ? 0.3 : 1 }}><ChevronLeft size={20} /></button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0 0.5rem', fontWeight: 600 }}>
              <CalendarIcon size={18} className="nav-icon" />
              {currentPayroll ? `${getMonthName(currentPayroll.payroll_month)} ${currentPayroll.payroll_year}` : 'No Data'}
            </div>
            <button onClick={handleNextMonth} className="icon-button" disabled={currentIndex === 0} style={{ opacity: currentIndex === 0 ? 0.3 : 1 }}><ChevronRight size={20} /></button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="skeleton-container" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: '1.5rem' }}>
          <div className="skeleton" style={{ height: '200px', borderRadius: 'var(--radius-lg)' }} />
          <div className="skeleton" style={{ height: '300px', borderRadius: 'var(--radius-lg)' }} />
        </div>
      ) : !currentPayroll ? (
        <div style={{ padding: '4rem', textAlign: 'center', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)' }}>
          <p style={{ color: 'var(--text-secondary)' }}>No payslip data found.</p>
        </div>
      ) : (() => {
        const deductionItems = getDeductionItems();
        const att = getAttendanceSummary();
        const paymentInfo = getPaymentInfo();

        return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Top Section: PAY SUMMARY */}
          <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.25rem' }}>PAY SUMMARY</h2>
              <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--primary-700)' }}>
                {getMonthName(currentPayroll.payroll_month)} {currentPayroll.payroll_year}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Status</div>
              {getStatusBadge(currentPayroll.status)}
            </div>
          </div>

          <div className="two-col-grid">
            {/* Left Column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              
              {/* EARNINGS */}
              <div className="card">
                <h3 className="card-title" style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem', marginBottom: '1rem' }}>EARNINGS</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.875rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Base Salary</span>
                    <span style={{ fontWeight: 500 }}>₹{Number(currentPayroll.basic_salary).toLocaleString('en-IN', {maximumFractionDigits:2})}</span>
                  </div>
                  {Number(currentPayroll.total_allowances) > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Allowances</span>
                      <span style={{ fontWeight: 500 }}>₹{Number(currentPayroll.total_allowances).toLocaleString('en-IN', {maximumFractionDigits:2})}</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Overtime Pay</span>
                    <span style={{ fontWeight: 500 }}>₹{Number(currentPayroll.overtime_amount).toLocaleString('en-IN', {maximumFractionDigits:2})}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem', paddingTop: '0.75rem', borderTop: '1px dashed var(--border-color)', fontWeight: 600, fontSize: '1rem' }}>
                    <span>Gross Earnings</span>
                    <span>₹{Number(currentPayroll.gross_salary).toLocaleString('en-IN', {maximumFractionDigits:2})}</span>
                  </div>
                </div>
              </div>

              {/* DEDUCTIONS — Only show applicable ones */}
              <div className="card">
                <h3 className="card-title" style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem', marginBottom: '1rem', color: 'var(--danger)' }}>DEDUCTIONS</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.875rem' }}>
                  {deductionItems.length > 0 ? (
                    deductionItems.map((d, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>{d.name}</span>
                        <span style={{ fontWeight: 500, color: 'var(--danger)' }}>₹{d.amount.toLocaleString('en-IN', {maximumFractionDigits:2})}</span>
                      </div>
                    ))
                  ) : (
                    <div style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                      No deductions applied
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-color)', fontWeight: 600 }}>
                    <span>Total Deductions</span>
                    <span style={{ color: Number(currentPayroll.total_deductions) > 0 ? 'var(--danger)' : undefined }}>₹{Number(currentPayroll.total_deductions).toLocaleString('en-IN', {maximumFractionDigits:2})}</span>
                  </div>
                </div>
              </div>
              
              {/* FINAL NET PAY */}
              <div style={{ backgroundColor: 'var(--bg-surface-elevated)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', padding: '1.5rem', boxShadow: 'var(--shadow-sm)' }}>
                <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '0.5rem' }}>FINAL NET PAY</h3>
                <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>Amount payable after all deductions and adjustments</p>
                <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--success)' }}>
                  ₹{Number(currentPayroll.net_salary).toLocaleString('en-IN', {maximumFractionDigits:2})}
                </div>
              </div>

            </div>

            {/* Right Column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              
              {/* ATTENDANCE SUMMARY */}
              <div className="card">
                <h3 className="card-title" style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem', marginBottom: '1rem' }}>ATTENDANCE SUMMARY</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.875rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-secondary)' }}>Working Days</span><span style={{ fontWeight: 600 }}>{att.workingDays}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-secondary)' }}>Present</span><span style={{ fontWeight: 600 }}>{att.presentDays}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-secondary)' }}>Late Login</span><span style={{ fontWeight: 600 }}>{att.lateLogins}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-secondary)' }}>Early Logout</span><span style={{ fontWeight: 600 }}>{att.earlyLogouts}</span></div>
                </div>
              </div>

              {/* LEAVE / PERMISSION SUMMARY */}
              <div className="card">
                <h3 className="card-title" style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem', marginBottom: '1rem' }}>LEAVE / PERMISSION SUMMARY</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.875rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-secondary)' }}>Approved Leave</span><span style={{ fontWeight: 600 }}>{att.approvedLeave}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-secondary)' }}>LOP Leave</span><span style={{ fontWeight: 600, color: att.lopLeave > 0 ? 'var(--danger)' : undefined }}>{att.lopLeave}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-secondary)' }}>WFH Days</span><span style={{ fontWeight: 600 }}>{att.wfhDays}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-secondary)' }}>Permissions</span><span style={{ fontWeight: 600 }}>{att.permissionCount}</span></div>
                </div>
              </div>

              {/* PAYMENT STATUS */}
              <div className="card">
                <h3 className="card-title" style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem', marginBottom: '1rem' }}>PAYMENT STATUS</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.875rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Payslip No</span>
                    <span style={{ fontWeight: 600 }}>{getPayslipNumber()}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Payment Status</span>
                    <span style={{ fontWeight: 600 }}>{getStatusBadge(paymentInfo.status)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Payment Date</span>
                    <span style={{ fontWeight: 600 }}>{paymentInfo.date}</span>
                  </div>
                  {paymentInfo.method !== '-' && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Payment Method</span>
                      <span style={{ fontWeight: 600 }}>{paymentInfo.method}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* ACTIVITY / PAYROLL HISTORY */}
              <div className="card">
                <h3 className="card-title" style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem', marginBottom: '1rem' }}>ACTIVITY / PAYROLL HISTORY</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', paddingLeft: '1rem', borderLeft: '2px solid var(--gray-200)' }}>
                  <div style={{ position: 'relative' }}>
                    <div style={{ position: 'absolute', left: '-1.35rem', top: '2px', width: '12px', height: '12px', borderRadius: '50%', backgroundColor: 'var(--gray-400)', border: '2px solid var(--bg-surface)' }}></div>
                    <div style={{ fontSize: '0.875rem', fontWeight: 600 }}>Payroll Calculated</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{currentPayroll.calculated_at ? new Date(currentPayroll.calculated_at).toLocaleDateString('en-GB') : `${getMonthName(currentPayroll.payroll_month)} ${currentPayroll.payroll_year}`}</div>
                  </div>
                  
                  {['APPROVED', 'PAYMENT_PENDING', 'PAID', 'CLOSED'].includes(currentPayroll.status) && (
                    <div style={{ position: 'relative' }}>
                      <div style={{ position: 'absolute', left: '-1.35rem', top: '2px', width: '12px', height: '12px', borderRadius: '50%', backgroundColor: 'var(--primary-500)', border: '2px solid var(--bg-surface)' }}></div>
                      <div style={{ fontSize: '0.875rem', fontWeight: 600 }}>Payroll Approved</div>
                      {currentPayroll.approved_at && <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{new Date(currentPayroll.approved_at).toLocaleDateString('en-GB')}</div>}
                    </div>
                  )}

                  {['PAID', 'CLOSED'].includes(currentPayroll.status) && (
                    <div style={{ position: 'relative' }}>
                      <div style={{ position: 'absolute', left: '-1.35rem', top: '2px', width: '12px', height: '12px', borderRadius: '50%', backgroundColor: 'var(--success)', border: '2px solid var(--bg-surface)' }}></div>
                      <div style={{ fontSize: '0.875rem', fontWeight: 600 }}>Payment Processed</div>
                      {currentPayroll.payroll_payments?.[0] && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                          {new Date(currentPayroll.payroll_payments[0].paid_at).toLocaleDateString('en-GB')} via {currentPayroll.payroll_payments[0].payment_method}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

            </div>
          </div>
          
          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-start', marginTop: '1rem' }}>
            <button type="button" onClick={handlePreview} className="btn btn-outline" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Printer size={18} /> Preview
            </button>
            <button type="button" onClick={handleDownload} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Download size={18} /> Download Payslip
            </button>
          </div>
        </div>
        );
      })()}

      {/* Preview Modal */}
      {showPreview && payslipObj && (
        <div className="modal-overlay" style={{ zIndex: 120 }}>
          <div className="modal-content" style={{ maxWidth: '900px', width: '90%', maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="modal-header">
              <h2>Payslip Preview</h2>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="button" className="btn btn-outline" onClick={() => window.print()} style={{ fontSize: '0.875rem', padding: '0.25rem 0.75rem' }}>Print</button>
                <button type="button" className="icon-button" onClick={() => setShowPreview(false)}><X size={20}/></button>
              </div>
            </div>
            <div style={{ padding: '2rem' }} className="print-area">
              <PayslipDocument currentPayslip={payslipObj} />
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default EmployeePayslip;
