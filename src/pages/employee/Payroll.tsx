import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ChevronLeft, ChevronRight, Calendar as CalendarIcon, 
  IndianRupee, Lock, FileText, ArrowRight, X, Info
} from 'lucide-react';

import { payrollService } from '../../services/payroll/payrollService';
import { realtimeService } from '../../services/realtime/realtimeService';
import { useAuth } from '../../context/AuthContext';

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const EmployeePayroll: React.FC = () => {
  const { employee } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [payrolls, setPayrolls] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentPayroll, setCurrentPayroll] = useState<any>(null);
  const [selectedDetail, setSelectedDetail] = useState<any>(null);

  const fetchPayrolls = async () => {
    setLoading(true);
    const { data } = await payrollService.getMyPayrolls();
    if (data && data.length > 0) {
      setPayrolls(data);
      setCurrentIndex(0);
      setCurrentPayroll(data[0]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchPayrolls();

    let channel: any;
    if (employee?.id) {
      channel = realtimeService.subscribeToMyPayroll(employee.id, () => {
        fetchPayrolls();
      });
    }

    return () => {
      if (channel) {
        realtimeService.unsubscribe(channel);
      }
    };
  }, [employee]);

  const handlePrevMonth = () => {
    if (currentIndex < payrolls.length - 1) {
      setLoading(true);
      const nextIndex = currentIndex + 1;
      setCurrentIndex(nextIndex);
      setCurrentPayroll(payrolls[nextIndex]);
      setLoading(false);
    }
  };

  const handleNextMonth = () => {
    if (currentIndex > 0) {
      setLoading(true);
      const nextIndex = currentIndex - 1;
      setCurrentIndex(nextIndex);
      setCurrentPayroll(payrolls[nextIndex]);
      setLoading(false);
    }
  };

  const getMonthName = (monthNum: number) => MONTH_NAMES[monthNum - 1] || '';

  const parseDataSummary = (payroll: any) => {
    try {
      if (payroll?.notes) return JSON.parse(payroll.notes);
    } catch {}
    return null;
  };

  const getAttendanceSummary = (payroll: any) => {
    const summary = parseDataSummary(payroll);
    return {
      workingDays: summary?.settings?.workingDaysUsed ?? summary?.attendance?.workingDays ?? 0,
      presentDays: summary?.attendance?.presentDays ?? 0,
      lateLogins: summary?.attendance?.lateLogins ?? 0,
      earlyLogouts: summary?.attendance?.earlyLogouts ?? 0,
      approvedLeave: summary?.leave?.approvedLeave ?? 0,
      lopLeave: summary?.leave?.lopLeave ?? 0,
      wfhDays: summary?.wfh?.wfhDays ?? 0,
      permissionMinutes: summary?.permission?.totalMinutes ?? 0,
      halfDays: summary?.attendance?.halfDays ?? 0,
    };
  };

  const currentSummary = getAttendanceSummary(currentPayroll);
  const currentMonthLabel = currentPayroll ? `${getMonthName(currentPayroll.payroll_month)} ${currentPayroll.payroll_year}` : 'No Data';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', position: 'relative' }}>
      
      {/* Page Header */}
      <div className="page-header" style={{ marginBottom: 0, flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="page-title">My Payroll</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>View your monthly salary, deductions, attendance impact and payment status.</p>
        </div>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', backgroundColor: 'var(--bg-surface-elevated)', padding: '0.25rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
            <button onClick={handlePrevMonth} className="icon-button" disabled={currentIndex === payrolls.length - 1} style={{ opacity: currentIndex === payrolls.length - 1 ? 0.3 : 1 }}><ChevronLeft size={20} /></button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0 0.5rem', fontWeight: 600 }}>
              <CalendarIcon size={18} className="nav-icon" />
              {currentMonthLabel}
            </div>
            <button onClick={handleNextMonth} className="icon-button" disabled={currentIndex === 0} style={{ opacity: currentIndex === 0 ? 0.3 : 1 }}><ChevronRight size={20} /></button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="skeleton-container" style={{ display: 'flex', gap: '1rem', overflowX: 'auto', paddingBottom: '0.5rem' }}>
          {[...Array(4)].map((_, i) => <div key={i} className="skeleton" style={{ minWidth: '180px', height: '90px', borderRadius: 'var(--radius-md)' }} />)}
        </div>
      ) : (
        <>
          <div className="tracking-kpi-grid">
            <div className="tracking-kpi-card">
              <div className="sc-title">Gross Salary</div>
              <div className="sc-val" style={{ display: 'flex', alignItems: 'center' }}>
                <IndianRupee size={16} />{currentPayroll ? Number(currentPayroll.gross_salary).toLocaleString('en-IN', {maximumFractionDigits:2}) : '0.00'}
              </div>
            </div>
            <div className="tracking-kpi-card">
              <div className="sc-title">Total Deductions</div>
              <div className="sc-val" style={{ color: 'var(--danger)', display: 'flex', alignItems: 'center' }}>
                -<IndianRupee size={16} />{currentPayroll ? Number(currentPayroll.total_deductions).toLocaleString('en-IN', {maximumFractionDigits:2}) : '0.00'}
              </div>
            </div>
            <div className="tracking-kpi-card" style={{ backgroundColor: 'var(--success-50)', borderColor: 'var(--success-200)' }}>
              <div className="sc-title">Net Salary</div>
              <div className="sc-val" style={{ color: 'var(--success)', display: 'flex', alignItems: 'center' }}>
                <IndianRupee size={16} />{currentPayroll ? Number(currentPayroll.net_salary).toLocaleString('en-IN', {maximumFractionDigits:2}) : '0.00'}
              </div>
            </div>
            <div className="tracking-kpi-card">
              <div className="sc-title">Payment Status</div>
              <div className="sc-val" style={{ color: currentPayroll?.status === 'PAID' || currentPayroll?.status === 'CLOSED' ? 'var(--success)' : 'var(--text-primary)' }}>{currentPayroll?.status || '-'}</div>
            </div>
          </div>
        </>
      )}

      {/* Locked State Banner */}
      {!loading && currentPayroll?.status === 'CLOSED' && (
        <div style={{ display: 'flex', gap: '0.75rem', padding: '1rem', backgroundColor: 'var(--gray-100)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--gray-700)' }}>
          <Lock size={20} style={{ flexShrink: 0 }} />
          <div>
            <strong style={{ display: 'block', fontSize: '0.875rem' }}>Payroll Closed</strong>
            <span style={{ fontSize: '0.875rem' }}>This payroll period has been closed and archived.</span>
          </div>
        </div>
      )}

      {!loading && currentPayroll ? (
      <div className="two-col-grid">
        {/* Left Col */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Salary Breakdown */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="card-header" style={{ padding: '1.25rem 1.25rem 0 1.25rem', marginBottom: '1rem' }}>
              <h3 className="card-title">Salary Breakdown</h3>
            </div>
            
            <div style={{ padding: '0 1.25rem 1.25rem 1.25rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1.5rem' }}>
                
                {/* Earnings */}
                <div>
                  <h4 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--gray-700)', marginBottom: '0.75rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>EARNINGS</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.875rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Basic Salary</span><span>₹{Number(currentPayroll.basic_salary).toLocaleString('en-IN', {maximumFractionDigits:2})}</span></div>
                    {Number(currentPayroll.total_allowances) > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Allowances</span><span>₹{Number(currentPayroll.total_allowances).toLocaleString('en-IN', {maximumFractionDigits:2})}</span></div>}
                    {Number(currentPayroll.overtime_amount) > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Overtime Pay</span><span>₹{Number(currentPayroll.overtime_amount).toLocaleString('en-IN', {maximumFractionDigits:2})}</span></div>}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, paddingTop: '0.5rem', borderTop: '1px dashed var(--border-color)', marginTop: '0.25rem' }}><span>Gross Salary</span><span>₹{Number(currentPayroll.gross_salary).toLocaleString('en-IN', {maximumFractionDigits:2})}</span></div>
                  </div>
                </div>

                {/* Deductions */}
                <div>
                  <h4 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--danger)', marginBottom: '0.75rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>DEDUCTIONS</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.875rem' }}>
                    {Number(currentPayroll.lop_deduction) > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Loss of Pay (LOP)</span><span>₹{Number(currentPayroll.lop_deduction).toLocaleString('en-IN', {maximumFractionDigits:2})}</span></div>}
                    {Number(currentPayroll.total_deductions) - Number(currentPayroll.lop_deduction) > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Other Deductions</span><span>₹{(Number(currentPayroll.total_deductions) - Number(currentPayroll.lop_deduction)).toLocaleString('en-IN', {maximumFractionDigits:2})}</span></div>}
                    {Number(currentPayroll.total_deductions) === 0 && <div style={{ fontStyle: 'italic', color: 'var(--text-secondary)' }}>No deductions</div>}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, paddingTop: '0.5rem', borderTop: '1px dashed var(--border-color)', marginTop: '0.25rem', color: Number(currentPayroll.total_deductions) > 0 ? 'var(--danger)' : 'inherit' }}><span>Total Deductions</span><span>₹{Number(currentPayroll.total_deductions).toLocaleString('en-IN', {maximumFractionDigits:2})}</span></div>
                  </div>
                </div>
                
              </div>
              
              <div style={{ marginTop: '1.5rem', padding: '1rem', backgroundColor: 'var(--gray-50)', borderRadius: 'var(--radius-md)', fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', gap: '0.5rem' }}>
                <Info size={14} style={{ flexShrink: 0, marginTop: '1px' }} />
                <span>Salary components and deduction rules are company-configured based on attendance, leaves, and permissions.</span>
              </div>
            </div>
          </div>

          {/* Payment Info */}
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: '1rem' }}>Payment Information</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', fontSize: '0.875rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Payment Status</span>
                <span className={`badge ${currentPayroll.status === 'PAID' || currentPayroll.status === 'CLOSED' ? 'badge-success' : 'badge-warning'}`} style={{ width: 'fit-content' }}>
                  {currentPayroll.status}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Payment Date</span>
                <span style={{ fontWeight: 500 }}>
                  {currentPayroll.payroll_payments?.[0]?.paid_at ? new Date(currentPayroll.payroll_payments[0].paid_at).toLocaleDateString('en-GB') : '-'}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Amount Paid</span>
                <span style={{ fontWeight: 600, color: currentPayroll.payroll_payments?.[0]?.amount ? 'var(--success)' : 'inherit' }}>
                  ₹{currentPayroll.payroll_payments?.[0]?.amount ? Number(currentPayroll.payroll_payments[0].amount).toLocaleString('en-IN', {maximumFractionDigits:2}) : '0.00'}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Payment Method</span>
                <span style={{ fontWeight: 500 }}>{currentPayroll.payroll_payments?.[0]?.payment_method || '-'}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Transaction Ref</span>
                <span style={{ fontWeight: 500, fontFamily: 'monospace' }}>{currentPayroll.payroll_payments?.[0]?.transaction_reference || '-'}</span>
              </div>
            </div>
          </div>

        </div>

        {/* Right Col */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Timeline Status */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h3 className="card-title">Processing Status</h3>
              <button onClick={() => navigate('/employee/payslip')} className="btn btn-outline" style={{ padding: '0.375rem 0.75rem', fontSize: '0.75rem' }}>
                <FileText size={14} style={{ marginRight: '0.25rem' }} /> View Payslip
              </button>
            </div>
            
            <div className="payroll-timeline">
              {[
                { label: 'Payroll Generated', key: 'DRAFT', active: true },
                { label: 'Calculated', key: 'CALCULATED', active: ['CALCULATED', 'UNDER_REVIEW', 'APPROVED', 'PAYMENT_PENDING', 'PAID', 'CLOSED'].includes(currentPayroll.status) },
                { label: 'Under Review', key: 'UNDER_REVIEW', active: ['UNDER_REVIEW', 'APPROVED', 'PAYMENT_PENDING', 'PAID', 'CLOSED'].includes(currentPayroll.status) },
                { label: 'Approved', key: 'APPROVED', active: ['APPROVED', 'PAYMENT_PENDING', 'PAID', 'CLOSED'].includes(currentPayroll.status) },
                { label: 'Payment Pending', key: 'PAYMENT_PENDING', active: ['PAYMENT_PENDING', 'PAID', 'CLOSED'].includes(currentPayroll.status) },
                { label: 'Paid', key: 'PAID', active: ['PAID', 'CLOSED'].includes(currentPayroll.status) },
                { label: 'Closed', key: 'CLOSED', active: ['CLOSED'].includes(currentPayroll.status) }
              ].map((step, idx, arr) => {
                const isCurrent = step.key === currentPayroll.status;
                return (
                  <div key={idx} className={`pt-item ${step.active ? 'active' : ''} ${isCurrent ? 'current' : ''}`}>
                    <div className="pt-dot">{isCurrent && <div className="pulse-ring" />}</div>
                    <div className="pt-label">{step.label}</div>
                    {idx < arr.length - 1 && <div className="pt-line" />}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Attendance Summary */}
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: '1rem' }}>Attendance Summary</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', textAlign: 'center', marginBottom: '1rem' }}>
              <div style={{ backgroundColor: 'var(--gray-50)', padding: '0.75rem', borderRadius: 'var(--radius-md)' }}>
                <div style={{ fontSize: '1.25rem', fontWeight: 600 }}>{currentSummary.workingDays}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Working Days</div>
              </div>
              <div style={{ backgroundColor: 'var(--success-50)', padding: '0.75rem', borderRadius: 'var(--radius-md)' }}>
                <div style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--success)' }}>{currentSummary.presentDays}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Present</div>
              </div>
              <div style={{ backgroundColor: 'var(--danger-50)', padding: '0.75rem', borderRadius: 'var(--radius-md)' }}>
                <div style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--danger)' }}>{currentSummary.lopLeave}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>LOP Days</div>
              </div>
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.875rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--gray-100)', paddingBottom: '0.25rem' }}><span style={{ color: 'var(--text-secondary)' }}>Approved Leave</span><strong>{currentSummary.approvedLeave}</strong></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--gray-100)', paddingBottom: '0.25rem' }}><span style={{ color: 'var(--text-secondary)' }}>Half Days</span><strong>{currentSummary.halfDays}</strong></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--gray-100)', paddingBottom: '0.25rem' }}><span style={{ color: 'var(--text-secondary)' }}>Late Logins</span><strong>{currentSummary.lateLogins}</strong></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--gray-100)', paddingBottom: '0.25rem' }}><span style={{ color: 'var(--text-secondary)' }}>Early Logouts</span><strong>{currentSummary.earlyLogouts}</strong></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--gray-100)', paddingBottom: '0.25rem' }}><span style={{ color: 'var(--text-secondary)' }}>Permission</span><strong>{currentSummary.permissionMinutes > 0 ? `${(currentSummary.permissionMinutes/60).toFixed(1)} Hrs` : '0'}</strong></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--gray-100)', paddingBottom: '0.25rem' }}><span style={{ color: 'var(--text-secondary)' }}>WFH Days</span><strong>{currentSummary.wfhDays}</strong></div>
            </div>

            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
              <Info size={14} style={{ flexShrink: 0 }} />
              <span>Attendance and configured payroll rules (like LOP mapping or late deductions) impact the final salary calculations.</span>
            </div>
          </div>

        </div>
      </div>
      ) : (
        !loading && (
          <div style={{ padding: '4rem', textAlign: 'center', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)' }}>
            <p style={{ color: 'var(--text-secondary)' }}>No payroll records found.</p>
          </div>
        )
      )}

      {/* Payroll History Table */}
      {!loading && payrolls.length > 0 && (
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="card-header" style={{ padding: '1.5rem 1.5rem 0 1.5rem', marginBottom: '1rem' }}>
          <h3 className="card-title">Payroll History</h3>
        </div>
        
        <div className="mobile-cards">
          {payrolls.map((row) => (
            <div key={row.id} className="mobile-hist-card" onClick={() => setSelectedDetail(row)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <strong style={{ fontSize: '0.875rem' }}>{getMonthName(row.payroll_month)} {row.payroll_year}</strong>
                <span className={`badge ${row.status === 'PAID' || row.status === 'CLOSED' ? 'badge-success' : 'badge-gray'}`}>{row.status}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', marginBottom: '0.25rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Net Salary:</span>
                <strong style={{ color: 'var(--success)' }}>₹{Number(row.net_salary).toLocaleString('en-IN', {maximumFractionDigits:2})}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Paid On:</span>
                <span>{row.payroll_payments?.[0]?.paid_at ? new Date(row.payroll_payments[0].paid_at).toLocaleDateString('en-GB') : '-'}</span>
              </div>
            </div>
          ))}
        </div>
        
        <div className="table-container desktop-table">
          <table className="table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Month</th>
                <th style={{ textAlign: 'right' }}>Gross Salary</th>
                <th style={{ textAlign: 'right' }}>Deductions</th>
                <th style={{ textAlign: 'right' }}>Net Salary</th>
                <th>Status</th>
                <th>Payment Date</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {payrolls.map((row) => (
                <tr key={row.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedDetail(row)}>
                  <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{getMonthName(row.payroll_month)} {row.payroll_year}</td>
                  <td style={{ textAlign: 'right' }}>₹{Number(row.gross_salary).toLocaleString('en-IN', {maximumFractionDigits:2})}</td>
                  <td style={{ textAlign: 'right', color: Number(row.total_deductions) > 0 ? 'var(--danger-600)' : 'inherit' }}>₹{Number(row.total_deductions).toLocaleString('en-IN', {maximumFractionDigits:2})}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--success)' }}>₹{Number(row.net_salary).toLocaleString('en-IN', {maximumFractionDigits:2})}</td>
                  <td><span className={`badge ${row.status === 'PAID' || row.status === 'CLOSED' ? 'badge-success' : 'badge-gray'}`}>{row.status}</span></td>
                  <td>{row.payroll_payments?.[0]?.paid_at ? new Date(row.payroll_payments[0].paid_at).toLocaleDateString('en-GB') : '-'}</td>
                  <td><ArrowRight size={16} color="var(--gray-400)" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* Detail Drawer for History row */}
      {selectedDetail && (() => {
        const rowSummary = getAttendanceSummary(selectedDetail);
        return (
        <div className="drawer-overlay" onClick={() => setSelectedDetail(null)}>
          <div className="drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Payroll Details</h2>
              <button className="icon-button" onClick={() => setSelectedDetail(null)}><X size={20} /></button>
            </div>
            <div className="drawer-body">
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <div>
                  <div style={{ fontSize: '1.125rem', fontWeight: 600 }}>{getMonthName(selectedDetail.payroll_month)} {selectedDetail.payroll_year}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Detail</div>
                </div>
                <span className={`badge ${selectedDetail.status === 'PAID' || selectedDetail.status === 'CLOSED' ? 'badge-success' : 'badge-gray'}`}>{selectedDetail.status}</span>
              </div>

              <div style={{ backgroundColor: 'var(--success-50)', border: '1px solid var(--success-200)', borderRadius: 'var(--radius-md)', padding: '1rem', marginBottom: '1.5rem', textAlign: 'center' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--success)', fontWeight: 600, marginBottom: '0.25rem' }}>NET SALARY</div>
                <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--success-800)' }}>₹{Number(selectedDetail.net_salary).toLocaleString('en-IN', {maximumFractionDigits:2})}</div>
              </div>

              <div className="detail-grid">
                <div className="detail-item">
                  <span className="detail-label">Gross Salary</span>
                  <span className="detail-value">₹{Number(selectedDetail.gross_salary).toLocaleString('en-IN', {maximumFractionDigits:2})}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Total Deductions</span>
                  <span className="detail-value" style={{ color: Number(selectedDetail.total_deductions) > 0 ? 'var(--danger)' : 'inherit' }}>₹{Number(selectedDetail.total_deductions).toLocaleString('en-IN', {maximumFractionDigits:2})}</span>
                </div>

                <div className="detail-item" style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--border-color)', paddingTop: '1rem', marginTop: '0.5rem' }}>
                  <span className="detail-label">Payment Information</span>
                </div>

                <div className="detail-item">
                  <span className="detail-label">Payment Date</span>
                  <span className="detail-value">{selectedDetail.payroll_payments?.[0]?.paid_at ? new Date(selectedDetail.payroll_payments[0].paid_at).toLocaleDateString('en-GB') : '-'}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Payment Method</span>
                  <span className="detail-value">{selectedDetail.payroll_payments?.[0]?.payment_method || '-'}</span>
                </div>
                <div className="detail-item" style={{ gridColumn: '1 / -1' }}>
                  <span className="detail-label">Transaction Reference</span>
                  <span className="detail-value" style={{ fontFamily: 'monospace' }}>{selectedDetail.payroll_payments?.[0]?.transaction_reference || '-'}</span>
                </div>
                
                <div className="detail-item" style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--border-color)', paddingTop: '1rem', marginTop: '0.5rem' }}>
                  <span className="detail-label">Attendance Highlights</span>
                </div>

                <div className="detail-item">
                  <span className="detail-label">Working Days</span>
                  <span className="detail-value">{rowSummary.workingDays}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">LOP Days</span>
                  <span className="detail-value" style={{ color: rowSummary.lopLeave > 0 ? 'var(--danger)' : 'inherit' }}>{rowSummary.lopLeave}</span>
                </div>
              </div>
              
              <button onClick={() => navigate('/employee/payslip')} className="btn btn-primary" style={{ width: '100%', marginTop: '2rem' }}>
                <FileText size={18} /> View Payslips
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      <style>{`
        .two-col-grid { display: grid; grid-template-columns: 1fr; gap: 1.5rem; }
        @media (min-width: 1024px) { .two-col-grid { grid-template-columns: 1fr 1fr; } }
        
        .desktop-table { display: block; }
        .mobile-cards { display: none; }
        @media (max-width: 768px) {
          .desktop-table { display: none; }
          .mobile-cards { display: flex; flex-direction: column; }
          .mobile-hist-card { padding: 1rem; border-bottom: 1px solid var(--border-color); cursor: pointer; }
          .mobile-hist-card:active { background-color: var(--gray-50); }
        }

        .drawer-overlay { position: fixed; inset: 0; background-color: rgba(0,0,0,0.4); z-index: 100; display: flex; justify-content: flex-end; }
        .drawer { background-color: var(--bg-surface); width: 100%; max-width: 400px; height: 100%; display: flex; flex-direction: column; box-shadow: var(--shadow-xl); animation: slideInRight 0.3s forwards; }
        .drawer-header { padding: 1.5rem; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; }
        .drawer-body { padding: 1.5rem; overflow-y: auto; flex: 1; }
        .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
        .detail-item { display: flex; flex-direction: column; gap: 0.25rem; }
        .detail-label { font-size: 0.75rem; color: var(--gray-500); }
        .detail-value { font-size: 0.875rem; font-weight: 500; color: var(--gray-900); }
        
        /* Payroll Timeline */
        .payroll-timeline { display: flex; flex-direction: column; }
        .pt-item { display: flex; align-items: flex-start; position: relative; padding-bottom: 1.5rem; }
        .pt-item:last-child { padding-bottom: 0; }
        .pt-dot { width: 16px; height: 16px; border-radius: 50%; background-color: var(--gray-200); border: 3px solid white; z-index: 2; margin-top: 2px; position: relative; }
        .pt-item.active .pt-dot { background-color: var(--success); }
        .pt-item.current .pt-dot { background-color: var(--primary-500); }
        .pt-line { position: absolute; left: 7px; top: 18px; bottom: 0; width: 2px; background-color: var(--gray-200); z-index: 1; }
        .pt-item.active .pt-line { background-color: var(--success); }
        .pt-item:last-child .pt-line { display: none; }
        .pt-label { margin-left: 1rem; font-size: 0.875rem; color: var(--gray-500); }
        .pt-item.active .pt-label { color: var(--gray-900); font-weight: 500; }
        .pt-item.current .pt-label { color: var(--primary-700); font-weight: 600; }
        
        .pulse-ring { position: absolute; top: -4px; left: -4px; right: -4px; bottom: -4px; border-radius: 50%; border: 2px solid var(--primary-500); animation: pulse 2s infinite; }
        @keyframes pulse {
          0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(168, 85, 247, 0.7); }
          70% { transform: scale(1); box-shadow: 0 0 0 10px rgba(168, 85, 247, 0); }
          100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(168, 85, 247, 0); }
        }
        
        @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @media (max-width: 768px) {
          .drawer-overlay { align-items: flex-end; }
          .drawer { height: 90vh; border-top-left-radius: var(--radius-xl); border-top-right-radius: var(--radius-xl); animation: slideUp 0.3s forwards; }
        }
        
        .skeleton { background: linear-gradient(90deg, var(--gray-200) 25%, var(--gray-100) 50%, var(--gray-200) 75%); background-size: 200% 100%; animation: skeleton-loading 1.5s infinite; }
        @keyframes skeleton-loading { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
      `}</style>
    </div>
  );
};

export default EmployeePayroll;
