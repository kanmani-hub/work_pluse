import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ChevronLeft, ChevronRight, Calendar as CalendarIcon, 
  IndianRupee, Lock, FileText, ArrowRight, X, Info, Download, Clock, User, CheckCircle2, AlertTriangle, Plus, PlusCircle, FileCheck
} from 'lucide-react';

import { payrollService } from '../../services/payroll/payrollService';
import { payrollAuditService } from '../../services/payroll/payrollAuditService';
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
  const [auditLogs, setAuditLogs] = useState<any[]>([]);

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

  useEffect(() => {
    if (currentPayroll?.id) {
      payrollAuditService.getTimeline(currentPayroll.id).then(logs => {
        setAuditLogs(logs || []);
      });
    } else {
      setAuditLogs([]);
    }
  }, [currentPayroll]);

  const handlePrevMonth = () => {
    if (currentIndex < payrolls.length - 1) {
      const nextIndex = currentIndex + 1;
      setCurrentIndex(nextIndex);
      setCurrentPayroll(payrolls[nextIndex]);
    }
  };

  const handleNextMonth = () => {
    if (currentIndex > 0) {
      const nextIndex = currentIndex - 1;
      setCurrentIndex(nextIndex);
      setCurrentPayroll(payrolls[nextIndex]);
    }
  };

  const getMonthName = (monthNum: number) => MONTH_NAMES[monthNum - 1] || '';

  const parseDataSummary = (payroll: any) => {
    try {
      if (payroll?.notes) return JSON.parse(payroll.notes);
    } catch {}
    return null;
  };

  const getEventIcon = (action: string) => {
    if (action === 'PAYROLL_APPROVED') return <CheckCircle2 size={16} color="var(--success)" />;
    if (action === 'PAYROLL_PAID') return <IndianRupee size={16} color="var(--success)" />;
    if (action.includes('ADJUSTMENT') || action.includes('ADDED')) return <Plus size={16} color="var(--primary-600)" />;
    if (action === 'PAYROLL_GENERATED') return <FileCheck size={16} color="var(--gray-600)" />;
    if (action === 'PAYROLL_CALCULATED') return <Info size={16} color="var(--gray-600)" />;
    if (action.includes('REJECTED')) return <X size={16} color="var(--danger)" />;
    if (action.includes('LOCKED')) return <Lock size={16} color="var(--gray-600)" />;
    return <Clock size={16} color="var(--gray-500)" />;
  };

  const currentSummary = parseDataSummary(currentPayroll) || {};
  const deductionItems = currentSummary?.deductionBreakdown || [];
  const currentMonthLabel = currentPayroll ? `${getMonthName(currentPayroll.payroll_month)} ${currentPayroll.payroll_year}` : 'No Data';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', position: 'relative' }}>
      
      {/* Page Header */}
      <div className="page-header" style={{ marginBottom: 0, flexWrap: 'wrap', gap: '1rem', justifyContent: 'space-between' }}>
        <div>
          <h1 className="page-title">Payroll Details</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>View your complete payroll breakdown and chronological audit timeline.</p>
        </div>
        
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          {currentPayroll && (
            <>
              <button onClick={() => navigate('/employee/payslip')} className="btn btn-outline">
                <FileText size={16} style={{ marginRight: '0.5rem' }} /> Preview Payslip
              </button>
              <button className="btn btn-primary">
                <Download size={16} style={{ marginRight: '0.5rem' }} /> Download
              </button>
            </>
          )}
        </div>
      </div>

      {loading ? (
        <div className="skeleton-container" style={{ display: 'flex', gap: '1rem', overflowX: 'auto', paddingBottom: '0.5rem' }}>
          {[...Array(4)].map((_, i) => <div key={i} className="skeleton" style={{ minWidth: '180px', height: '90px', borderRadius: 'var(--radius-md)' }} />)}
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', backgroundColor: 'var(--bg-surface-elevated)', padding: '0.5rem 1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', width: 'fit-content', marginBottom: '0.5rem' }}>
            <button onClick={handlePrevMonth} className="icon-button" disabled={currentIndex === payrolls.length - 1} style={{ opacity: currentIndex === payrolls.length - 1 ? 0.3 : 1 }}><ChevronLeft size={20} /></button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0 1rem', fontWeight: 600, fontSize: '1.125rem' }}>
              <CalendarIcon size={18} className="nav-icon" />
              {currentMonthLabel}
            </div>
            <button onClick={handleNextMonth} className="icon-button" disabled={currentIndex === 0} style={{ opacity: currentIndex === 0 ? 0.3 : 1 }}><ChevronRight size={20} /></button>
          </div>
        </>
      )}

      {!loading && currentPayroll ? (
      <div className="two-col-grid">
        {/* Left Col */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* EARNINGS */}
          <div className="card" style={{ padding: '1.25rem' }}>
            <h3 className="card-title" style={{ marginBottom: '1rem', color: 'var(--gray-800)', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>EARNINGS</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.875rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--gray-600)' }}>Base Salary</span>
                <span style={{ fontWeight: 500 }}>₹{Number(currentPayroll.basic_salary).toLocaleString('en-IN', {maximumFractionDigits:2})}</span>
              </div>
              
              {Number(currentPayroll.overtime_amount) > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--gray-600)' }}>Overtime</span>
                  <span style={{ fontWeight: 500 }}>₹{Number(currentPayroll.overtime_amount).toLocaleString('en-IN', {maximumFractionDigits:2})}</span>
                </div>
              )}
              
              {Number(currentPayroll.total_allowances) > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--gray-600)' }}>Adjustments / Additions</span>
                  <span style={{ fontWeight: 500 }}>₹{Number(currentPayroll.total_allowances).toLocaleString('en-IN', {maximumFractionDigits:2})}</span>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem', paddingTop: '0.75rem', borderTop: '1px dashed var(--border-color)', fontSize: '1rem', fontWeight: 700 }}>
                <span>TOTAL EARNINGS</span>
                <span>₹{(Number(currentPayroll.gross_salary) + Number(currentPayroll.overtime_amount)).toLocaleString('en-IN', {maximumFractionDigits:2})}</span>
              </div>
            </div>
          </div>

          {/* DEDUCTIONS */}
          <div className="card" style={{ padding: '1.25rem' }}>
            <h3 className="card-title" style={{ marginBottom: '1rem', color: 'var(--danger)', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>DEDUCTIONS</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: '0.875rem' }}>
              {deductionItems.map((item: any, i: number) => {
                let name = item.name;
                let desc = '';
                if (name.includes('(')) {
                  desc = name.split('(')[1].replace(')', '');
                  name = name.split('(')[0].trim();
                }

                return (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ color: 'var(--gray-700)', fontWeight: 500 }}>{name}</span>
                      {desc && <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Reason: {desc}</span>}
                    </div>
                    <span style={{ fontWeight: 500, color: 'var(--danger-700)' }}>-₹{Number(item.amount).toLocaleString('en-IN', {maximumFractionDigits:2})}</span>
                  </div>
                );
              })}
              
              {deductionItems.length === 0 && <div style={{ color: 'var(--text-secondary)' }}>No deductions for this period.</div>}

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.25rem', paddingTop: '0.75rem', borderTop: '1px dashed var(--border-color)', fontSize: '1rem', fontWeight: 700 }}>
                <span>TOTAL DEDUCTIONS</span>
                <span style={{ color: 'var(--danger)' }}>₹{Number(currentPayroll.total_deductions).toLocaleString('en-IN', {maximumFractionDigits:2})}</span>
              </div>
            </div>
          </div>

          {/* NET PAY */}
          <div className="card" style={{ padding: '1.25rem', backgroundColor: 'var(--primary-50)', borderColor: 'var(--primary-200)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: '0.875rem', color: 'var(--primary-700)', fontWeight: 600 }}>NET PAY</div>
                <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--primary-800)', marginTop: '0.25rem' }}>₹{Number(currentPayroll.net_salary).toLocaleString('en-IN', {maximumFractionDigits:2})}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span className={`badge ${currentPayroll.status === 'PAID' || currentPayroll.status === 'CLOSED' ? 'badge-success' : 'badge-warning'}`} style={{ fontSize: '0.75rem', marginBottom: '0.5rem', display: 'inline-block' }}>
                  {currentPayroll.status}
                </span>
                {currentPayroll.payroll_payments?.[0] && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--gray-600)' }}>
                    Paid via {currentPayroll.payroll_payments[0].payment_method}
                  </div>
                )}
              </div>
            </div>
          </div>
          
        </div>

        {/* Right Col */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* ACTIVITY LOGS */}
          <div className="card" style={{ padding: '1.25rem', flex: 1 }}>
            <h3 className="card-title" style={{ marginBottom: '1.5rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border-color)' }}>ACTIVITY LOGS</h3>
            
            {auditLogs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
                No activity logs available for this payroll.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                {auditLogs.map((log: any, idx: number) => {
                  const date = new Date(log.created_at);
                  const isSystem = log.source === 'SYSTEM' || log.source === 'SCHEDULER';
                  const actorName = log.actor ? `${log.actor.first_name} ${log.actor.last_name}` : (isSystem ? 'SCHEDULER' : 'SYSTEM');
                  const descLines = log.description ? log.description.split('\n') : [];
                  const titleStr = log.metadata?.title || (log.action.includes('ADJUSTMENT') ? 'Adjustment Added' : log.action.replace(/_/g, ' '));
                  
                  return (
                    <div key={log.id} style={{ display: 'flex', gap: '1rem', position: 'relative' }}>
                      {idx !== auditLogs.length - 1 && <div style={{ position: 'absolute', left: '11px', top: '24px', bottom: '-24px', width: '2px', backgroundColor: 'var(--gray-200)' }} />}
                      
                      <div style={{ width: '24px', height: '24px', borderRadius: '50%', backgroundColor: 'var(--bg-surface)', border: '2px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, zIndex: 1, marginTop: '2px' }}>
                        {getEventIcon(log.action)}
                      </div>
                      
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            {log.action === 'PAYROLL_APPROVED' || log.action === 'PAYROLL_PAID' ? <span style={{ color: 'var(--success)', fontWeight: 600 }}>✓</span> : 
                             log.action.includes('ADJUSTMENT') ? <span style={{ color: 'var(--primary-600)', fontWeight: 600 }}>+</span> : 
                             <span style={{ color: 'var(--gray-500)', fontWeight: 600 }}>✦</span>}
                            <span style={{ fontWeight: 600, color: 'var(--gray-800)' }}>{titleStr}</span>
                          </div>
                        </div>

                        {(log.old_values?.status || log.new_values?.status) && (
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            {log.old_values?.status ? `${log.old_values.status} → ${log.new_values?.status || 'Unknown'}` : `Status: ${log.new_values?.status}`}
                          </div>
                        )}
                        
                        {descLines.length > 0 && (
                          <div style={{ marginTop: '0.5rem', padding: '0.75rem', backgroundColor: 'var(--gray-50)', borderRadius: 'var(--radius-sm)', fontSize: '0.875rem', color: 'var(--gray-700)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                            {descLines.map((line: string, i: number) => (
                              <div key={i}>{line}</div>
                            ))}
                          </div>
                        )}

                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
                          <span style={{ fontWeight: 500 }}>By {actorName}</span>
                          <span>{date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}, {date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
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

      {/* Previous Payrolls List */}
      {!loading && payrolls.length > 1 && (
        <div style={{ marginTop: '2rem' }}>
          <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '1rem' }}>Payroll History</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))', gap: '1rem' }}>
            {payrolls.map((row, i) => {
              if (i === currentIndex) return null; // Skip current
              return (
                <div key={row.id} className="card" style={{ padding: '1rem', cursor: 'pointer', transition: 'all 0.2s', border: '1px solid var(--border-color)' }} onClick={() => {
                  setCurrentIndex(i);
                  setCurrentPayroll(row);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <strong style={{ fontSize: '1rem' }}>{getMonthName(row.payroll_month)} {row.payroll_year}</strong>
                    <span className={`badge ${row.status === 'PAID' || row.status === 'CLOSED' ? 'badge-success' : 'badge-gray'}`} style={{ fontSize: '0.65rem' }}>{row.status}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Net Pay:</span>
                    <strong style={{ color: 'var(--gray-800)' }}>₹{Number(row.net_salary).toLocaleString('en-IN', {maximumFractionDigits:2})}</strong>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
};

export default EmployeePayroll;
