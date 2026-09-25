import React, { useState, useEffect } from 'react';
import { 
  ChevronLeft, ChevronRight, Calendar as CalendarIcon, 
  Download, Printer, CheckCircle2, Lock, ArrowLeft
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const EmployeePayslip: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState('September 2026');
  const [toastMessage, setToastMessage] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 500);
    return () => clearTimeout(timer);
  }, [currentMonth]);

  const handlePrevMonth = () => {
    setLoading(true);
    setCurrentMonth('August 2026');
  };

  const handleNextMonth = () => {
    if (currentMonth !== 'September 2026') {
      setLoading(true);
      setCurrentMonth('September 2026');
    }
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3000);
  };

  const handleDownload = () => {
    showToast('Payslip download started.');
  };

  const handlePrint = () => {
    window.print();
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
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Monthly salary statement</p>
        </div>
        
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', backgroundColor: 'var(--bg-surface-elevated)', padding: '0.25rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
            <button onClick={handlePrevMonth} className="icon-button"><ChevronLeft size={20} /></button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0 0.5rem', fontWeight: 600 }}>
              <CalendarIcon size={18} className="nav-icon" />
              {currentMonth}
            </div>
            <button onClick={handleNextMonth} className="icon-button" disabled={currentMonth === 'September 2026'} style={{ opacity: currentMonth === 'September 2026' ? 0.3 : 1 }}><ChevronRight size={20} /></button>
          </div>
          
          <button onClick={handlePrint} className="btn btn-outline" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Printer size={18} /> Print
          </button>
          <button onClick={handleDownload} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Download size={18} /> Download
          </button>
        </div>
      </div>

      {loading ? (
        <div className="skeleton" style={{ width: '100%', maxWidth: '800px', height: '800px', margin: '0 auto', borderRadius: 'var(--radius-lg)' }} />
      ) : (
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          
          {/* Document Container */}
          <div className="payslip-document">
            
            {/* Header */}
            <div style={{ textAlign: 'center', borderBottom: '2px solid var(--border-color)', paddingBottom: '1.5rem', marginBottom: '2rem' }}>
              <h2 className="payslip-title">WorkPulse HR</h2>
              <div className="payslip-subtitle">Salary Slip</div>
              <div className="payslip-month">{currentMonth}</div>
            </div>

            {/* Employee Info Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '2rem', fontSize: '0.875rem' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border-color)' }}><span className="payslip-label">Name:</span> <strong className="payslip-value">Arun Kumar</strong></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid var(--border-color)' }}><span className="payslip-label">Employee ID:</span> <strong className="payslip-value">EMP001</strong></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '0.5rem' }}><span className="payslip-label">Joining Date:</span> <strong className="payslip-value">01 February 2026</strong></div>
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border-color)' }}><span className="payslip-label">Department:</span> <strong className="payslip-value">Development</strong></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid var(--border-color)' }}><span className="payslip-label">Designation:</span> <strong className="payslip-value">Software Developer</strong></div>
              </div>
            </div>

            {/* Salary Tables */}
            <div className="salary-tables-grid">
              
              {/* Earnings Table */}
              <div>
                <table className="doc-table">
                  <thead>
                    <tr>
                      <th className="section-header">Earnings</th>
                      <th className="section-header" style={{ textAlign: 'right' }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td className="payslip-line-item">Basic Salary</td><td className="payslip-amount" style={{ textAlign: 'right' }}>₹30,000.00</td></tr>
                    <tr><td className="payslip-line-item">House Rent Allowance (HRA)</td><td className="payslip-amount" style={{ textAlign: 'right' }}>₹10,000.00</td></tr>
                    <tr><td className="payslip-line-item">Special Allowances</td><td className="payslip-amount" style={{ textAlign: 'right' }}>₹10,000.00</td></tr>
                    <tr><td>&nbsp;</td><td></td></tr>
                  </tbody>
                  <tfoot>
                    <tr>
                      <th className="payslip-total">Gross Salary</th>
                      <th className="payslip-total" style={{ textAlign: 'right' }}>₹50,000.00</th>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Deductions Table */}
              <div>
                <table className="doc-table">
                  <thead>
                    <tr>
                      <th className="section-header">Deductions</th>
                      <th className="section-header" style={{ textAlign: 'right' }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td className="payslip-line-item">Loss of Pay (LOP)</td><td className="payslip-amount" style={{ textAlign: 'right' }}>₹1,923.08</td></tr>
                    <tr><td className="payslip-line-item">Late Deduction</td><td className="payslip-amount" style={{ textAlign: 'right' }}>₹500.00</td></tr>
                    <tr><td className="payslip-line-item">Early Logout</td><td className="payslip-amount" style={{ textAlign: 'right' }}>₹250.00</td></tr>
                    <tr><td className="payslip-line-item">Other Adjustments</td><td className="payslip-amount" style={{ textAlign: 'right' }}>₹1,923.08</td></tr>
                  </tbody>
                  <tfoot>
                    <tr>
                      <th className="payslip-total">Total Deductions</th>
                      <th className="payslip-total" style={{ textAlign: 'right' }}>₹4,596.16</th>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Net Salary Summary Box */}
            <div style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '1.5rem', margin: '2rem 0', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="payslip-label">Gross Salary:</span>
                <span className="payslip-value">₹50,000.00</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--danger)', fontWeight: 500 }}>Total Deductions:</span>
                <span style={{ fontWeight: 600, color: 'var(--danger)' }}>-₹4,596.16</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '2px dashed var(--border-color)', paddingTop: '1rem', marginTop: '0.5rem' }}>
                <span style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>Net Salary:</span>
                <span style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--success)' }}>₹45,403.84</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)', padding: '1rem', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}><span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Payment Status</span><strong style={{ color: 'var(--success)' }}>PAID</strong></div>
                <div style={{ display: 'flex', flexDirection: 'column' }}><span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Payment Date</span><strong className="payslip-value">30 September 2026</strong></div>
              </div>
            </div>

            {/* Bottom Info Grids */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', fontSize: '0.875rem' }}>
              
              {/* Attendance Summary */}
              <div>
                <h4 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.75rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem', color: 'var(--text-primary)' }}>Attendance Summary</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'x.5rem y.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.25rem 0' }}><span className="payslip-label">Working Days:</span> <strong className="payslip-value">22</strong></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.25rem 0' }}><span className="payslip-label">Present:</span> <strong className="payslip-value">18</strong></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.25rem 0' }}><span className="payslip-label">Leave Days:</span> <strong className="payslip-value">2</strong></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.25rem 0' }}><span className="payslip-label">Half Days:</span> <strong className="payslip-value">1</strong></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.25rem 0' }}><span style={{ color: 'var(--danger)', fontWeight: 500 }}>LOP Days:</span> <strong className="payslip-value">1.5</strong></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.25rem 0' }}><span style={{ color: 'var(--warning)', fontWeight: 500 }}>Late / Early:</span> <strong className="payslip-value">3 / 1</strong></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.25rem 0' }}><span style={{ color: 'var(--info)', fontWeight: 500 }}>WFH Days:</span> <strong className="payslip-value">3</strong></div>
                </div>
              </div>

              {/* Payment Details */}
              <div>
                <h4 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.75rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem', color: 'var(--text-primary)' }}>Payment Details</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="payslip-label">Method:</span> <strong className="payslip-value">Bank Transfer</strong></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="payslip-label">Date:</span> <strong className="payslip-value">30 Sep 2026</strong></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="payslip-label">Reference:</span> <strong className="payslip-value" style={{ fontFamily: 'monospace' }}>TXN-20260930-001</strong></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="payslip-label">Processed By:</span> <strong className="payslip-value">WorkPulse HR Admin</strong></div>
                </div>
              </div>
            </div>

            {/* Locked Warning */}
            <div style={{ marginTop: '3rem', padding: '1rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', display: 'flex', gap: '0.75rem', color: 'var(--text-secondary)', backgroundColor: 'var(--bg-elevated)', alignItems: 'center' }}>
              <Lock size={18} style={{ flexShrink: 0 }} />
              <div style={{ fontSize: '0.875rem' }}>
                <strong style={{ display: 'block', color: 'var(--text-primary)' }}>Payroll Locked</strong>
                This payslip represents a finalized payroll run. Any corrections require authorized HR action.
              </div>
            </div>
            
            <div style={{ textAlign: 'center', marginTop: '2rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              This is a system-generated document and does not require a physical signature.
            </div>
          </div>
        </div>
      )}

      <style>{`
        .payslip-document {
          background-color: var(--bg-surface);
          border-radius: var(--radius-lg);
          padding: 3rem;
          width: 100%;
          max-width: 800px;
          box-shadow: var(--shadow-md);
          border: 1px solid var(--border-color);
        }
        
        .payslip-title { font-size: 1.5rem; font-weight: 700; margin: 0; color: var(--text-primary); }
        .payslip-subtitle { font-size: 1.125rem; font-weight: 600; color: var(--text-primary); margin-top: 0.5rem; }
        .payslip-month { font-size: 1rem; color: var(--text-secondary); margin-top: 0.25rem; font-weight: 500; }
        
        .payslip-label { color: var(--text-secondary); font-weight: 500; }
        .payslip-value { color: var(--text-primary); font-weight: 600; }
        .payslip-line-item { color: var(--text-secondary); }
        .payslip-amount { color: var(--text-primary); font-weight: 600; }
        .payslip-total { background-color: var(--bg-elevated); color: var(--text-primary); font-weight: 700; padding: 0.75rem; border-top: 2px solid var(--border-color); }
        .section-header { background-color: #080B10; color: #FFFFFF; font-weight: 600; padding: 0.75rem; text-align: left; }

        .salary-tables-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; }
        
        .doc-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
        .doc-table th, .doc-table td { padding: 0.75rem; }
        .doc-table tbody tr { border-bottom: 1px solid var(--border-color); }
        
        @media print {
          body {
            background-color: #FFFFFF !important;
            color: #111827 !important;
          }
          .payslip-document { 
            box-shadow: none !important; 
            border: none !important; 
            padding: 0 !important;
            background-color: #FFFFFF !important;
          }
          .payslip-title, .payslip-subtitle, .payslip-value, .payslip-amount { color: #111827 !important; }
          .payslip-month, .payslip-label, .payslip-line-item { color: #4B5563 !important; }
          .payslip-total { background-color: #F3F4F6 !important; color: #111827 !important; border-top: 2px solid #D1D5DB !important; }
          .section-header { background-color: #111827 !important; color: #FFFFFF !important; }
          .doc-table tbody tr { border-bottom: 1px solid #E5E7EB !important; }
          .page-header, .icon-button, .btn { display: none !important; }
          
          body * {
            visibility: hidden;
          }
          .payslip-document, .payslip-document * {
            visibility: visible;
          }
          .payslip-document {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }
        }
        
        @media (max-width: 768px) {
          .payslip-document { padding: 1.5rem; }
          .salary-tables-grid { grid-template-columns: 1fr; gap: 1rem; }
        }
        
        @keyframes slideDown { from { transform: translate(-50%, -100%); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }
        .skeleton { background: linear-gradient(90deg, var(--bg-surface) 25%, var(--bg-elevated) 50%, var(--bg-surface) 75%); background-size: 200% 100%; animation: skeleton-loading 1.5s infinite; }
        @keyframes skeleton-loading { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
      `}</style>
    </div>
  );
};

export default EmployeePayslip;



