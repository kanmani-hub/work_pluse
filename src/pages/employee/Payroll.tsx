import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ChevronLeft, ChevronRight, Calendar as CalendarIcon, 
  IndianRupee, Lock, FileText, ArrowRight, X, Info
} from 'lucide-react';

const mockHistory = [
  { month: 'September 2026', gross: '50,000.00', deductions: '4,596.16', net: '45,403.84', status: 'PAID', date: '30 Sep 2026' },
  { month: 'August 2026', gross: '50,000.00', deductions: '250.00', net: '49,750.00', status: 'CLOSED', date: '31 Aug 2026' },
  { month: 'July 2026', gross: '50,000.00', deductions: '0.00', net: '50,000.00', status: 'CLOSED', date: '31 Jul 2026' }
];

const EmployeePayroll: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState('September 2026');
  const [selectedDetail, setSelectedDetail] = useState<any>(null);

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 700);
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', position: 'relative' }}>
      
      {/* Page Header */}
      <div className="page-header" style={{ marginBottom: 0, flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="page-title">My Payroll</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>View your monthly salary, deductions, attendance impact and payment status.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', backgroundColor: 'var(--bg-surface-elevated)', padding: '0.25rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
          <button onClick={handlePrevMonth} className="icon-button"><ChevronLeft size={20} /></button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0 0.5rem', fontWeight: 600 }}>
            <CalendarIcon size={18} className="nav-icon" />
            {currentMonth}
          </div>
          <button onClick={handleNextMonth} className="icon-button" disabled={currentMonth === 'September 2026'} style={{ opacity: currentMonth === 'September 2026' ? 0.3 : 1 }}><ChevronRight size={20} /></button>
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
                <IndianRupee size={16} />50,000
              </div>
            </div>
            <div className="tracking-kpi-card">
              <div className="sc-title">Total Deductions</div>
              <div className="sc-val" style={{ color: 'var(--danger)', display: 'flex', alignItems: 'center' }}>
                -<IndianRupee size={16} />4,596.16
              </div>
            </div>
            <div className="tracking-kpi-card" style={{ backgroundColor: 'var(--success-50)', borderColor: 'var(--success-200)' }}>
              <div className="sc-title">Net Salary</div>
              <div className="sc-val" style={{ color: 'var(--success)', display: 'flex', alignItems: 'center' }}>
                <IndianRupee size={16} />45,403.84
              </div>
            </div>
            <div className="tracking-kpi-card">
              <div className="sc-title">Payment Status</div>
              <div className="sc-val" style={{ color: 'var(--success)' }}>PAID</div>
            </div>
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '-1rem' }}>
            * These are prototype values and do not reflect real financial data.
          </div>
        </>
      )}

      {/* Locked State Banner */}
      {!loading && (
        <div style={{ display: 'flex', gap: '0.75rem', padding: '1rem', backgroundColor: 'var(--gray-100)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--gray-700)' }}>
          <Lock size={20} style={{ flexShrink: 0 }} />
          <div>
            <strong style={{ display: 'block', fontSize: '0.875rem' }}>Payroll Locked</strong>
            <span style={{ fontSize: '0.875rem' }}>This payroll has been finalized. Any correction requires authorized payroll action. You cannot edit these values.</span>
          </div>
        </div>
      )}

      <div className="two-col-grid">
        {/* Left Col */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Salary Breakdown */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="card-header" style={{ padding: '1.25rem 1.25rem 0 1.25rem', marginBottom: '1rem' }}>
              <h3 className="card-title">Salary Breakdown</h3>
            </div>
            
            {loading ? (
              <div className="skeleton" style={{ height: '300px', margin: '0 1.25rem 1.25rem 1.25rem' }} />
            ) : (
              <div style={{ padding: '0 1.25rem 1.25rem 1.25rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1.5rem' }}>
                  
                  {/* Earnings */}
                  <div>
                    <h4 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--gray-700)', marginBottom: '0.75rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>EARNINGS</h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.875rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Basic Salary</span><span>₹30,000.00</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>HRA</span><span>₹10,000.00</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Allowances</span><span>₹10,000.00</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, paddingTop: '0.5rem', borderTop: '1px dashed var(--border-color)', marginTop: '0.25rem' }}><span>Gross Salary</span><span>₹50,000.00</span></div>
                    </div>
                  </div>

                  {/* Deductions */}
                  <div>
                    <h4 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--danger)', marginBottom: '0.75rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>DEDUCTIONS</h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.875rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Loss of Pay (LOP)</span><span>₹1,923.08</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Late Deduction</span><span>₹500.00</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Early Logout</span><span>₹250.00</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Other Deduction</span><span>₹1,923.08</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, paddingTop: '0.5rem', borderTop: '1px dashed var(--border-color)', marginTop: '0.25rem', color: 'var(--danger)' }}><span>Total Deductions</span><span>₹4,596.16</span></div>
                    </div>
                  </div>
                  
                </div>
                
                <div style={{ marginTop: '1.5rem', padding: '1rem', backgroundColor: 'var(--gray-50)', borderRadius: 'var(--radius-md)', fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', gap: '0.5rem' }}>
                  <Info size={14} style={{ flexShrink: 0, marginTop: '1px' }} />
                  <span>Salary components and deduction rules are company-configured. Do not assume these specific allowances or deduction algorithms apply to all organizations.</span>
                </div>
              </div>
            )}
          </div>

          {/* Payment Info */}
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: '1rem' }}>Payment Information</h3>
            {loading ? (
               <div className="skeleton" style={{ height: '120px' }} />
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', fontSize: '0.875rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Payment Status</span>
                  <span className="badge badge-success" style={{ width: 'fit-content' }}>PAID</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Payment Date</span>
                  <span style={{ fontWeight: 500 }}>30 September 2026</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Amount Paid</span>
                  <span style={{ fontWeight: 600, color: 'var(--success)' }}>₹45,403.84</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Payment Method</span>
                  <span style={{ fontWeight: 500 }}>Bank Transfer</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Transaction Ref</span>
                  <span style={{ fontWeight: 500, fontFamily: 'monospace' }}>TXN-20260930-001</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Processed By</span>
                  <span style={{ fontWeight: 500 }}>HR Admin</span>
                </div>
              </div>
            )}
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
            
            {loading ? (
              <div className="skeleton" style={{ height: '280px' }} />
            ) : (
              <div className="payroll-timeline">
                {[
                  { label: 'Payroll Generated', active: true },
                  { label: 'Calculated', active: true },
                  { label: 'Under Review', active: true },
                  { label: 'Approved', active: true },
                  { label: 'Payment Pending', active: true },
                  { label: 'Paid', active: true, current: true },
                  { label: 'Closed', active: false }
                ].map((step, idx, arr) => (
                  <div key={idx} className={`pt-item ${step.active ? 'active' : ''} ${step.current ? 'current' : ''}`}>
                    <div className="pt-dot">{step.current && <div className="pulse-ring" />}</div>
                    <div className="pt-label">{step.label}</div>
                    {idx < arr.length - 1 && <div className="pt-line" />}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Attendance Summary */}
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: '1rem' }}>Attendance Summary</h3>
            {loading ? (
              <div className="skeleton" style={{ height: '160px' }} />
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', textAlign: 'center', marginBottom: '1rem' }}>
                  <div style={{ backgroundColor: 'var(--gray-50)', padding: '0.75rem', borderRadius: 'var(--radius-md)' }}>
                    <div style={{ fontSize: '1.25rem', fontWeight: 600 }}>22</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Working Days</div>
                  </div>
                  <div style={{ backgroundColor: 'var(--success-50)', padding: '0.75rem', borderRadius: 'var(--radius-md)' }}>
                    <div style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--success)' }}>18</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Present</div>
                  </div>
                  <div style={{ backgroundColor: 'var(--danger-50)', padding: '0.75rem', borderRadius: 'var(--radius-md)' }}>
                    <div style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--danger)' }}>1.5</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>LOP Days</div>
                  </div>
                </div>
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.875rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--gray-100)', paddingBottom: '0.25rem' }}><span style={{ color: 'var(--text-secondary)' }}>Leave Days</span><strong>2</strong></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--gray-100)', paddingBottom: '0.25rem' }}><span style={{ color: 'var(--text-secondary)' }}>Half Days</span><strong>1</strong></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--gray-100)', paddingBottom: '0.25rem' }}><span style={{ color: 'var(--text-secondary)' }}>Late Logins</span><strong>3</strong></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--gray-100)', paddingBottom: '0.25rem' }}><span style={{ color: 'var(--text-secondary)' }}>Early Logouts</span><strong>1</strong></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--gray-100)', paddingBottom: '0.25rem' }}><span style={{ color: 'var(--text-secondary)' }}>Permission</span><strong>2.5 Hrs</strong></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--gray-100)', paddingBottom: '0.25rem' }}><span style={{ color: 'var(--text-secondary)' }}>WFH Days</span><strong>3</strong></div>
                </div>

                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
                  <Info size={14} style={{ flexShrink: 0 }} />
                  <span>Attendance and configured payroll rules (like LOP mapping or late deductions) may affect salary calculations.</span>
                </div>
              </>
            )}
          </div>

        </div>
      </div>

      {/* Payroll History */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="card-header" style={{ padding: '1.5rem 1.5rem 0 1.5rem', marginBottom: '1rem' }}>
          <h3 className="card-title">Payroll History</h3>
        </div>
        
        {loading ? (
           <div className="skeleton" style={{ height: '200px', margin: '0 1.5rem 1.5rem 1.5rem' }} />
        ) : (
          <>
            <div className="mobile-cards">
              {mockHistory.map((row, idx) => (
                <div key={idx} className="mobile-hist-card" onClick={() => setSelectedDetail(row)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <strong style={{ fontSize: '0.875rem' }}>{row.month}</strong>
                    <span className={`badge ${row.status === 'PAID' ? 'badge-success' : 'badge-gray'}`}>{row.status}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', marginBottom: '0.25rem' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Net Salary:</span>
                    <strong style={{ color: 'var(--success)' }}>₹{row.net}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Paid On:</span>
                    <span>{row.date}</span>
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
                  {mockHistory.map((row, idx) => (
                    <tr key={idx} style={{ cursor: 'pointer' }} onClick={() => setSelectedDetail(row)}>
                      <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{row.month}</td>
                      <td style={{ textAlign: 'right' }}>₹{row.gross}</td>
                      <td style={{ textAlign: 'right', color: 'var(--danger-600)' }}>₹{row.deductions}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--success)' }}>₹{row.net}</td>
                      <td><span className={`badge ${row.status === 'PAID' ? 'badge-success' : 'badge-gray'}`}>{row.status}</span></td>
                      <td>{row.date}</td>
                      <td><ArrowRight size={16} color="var(--gray-400)" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Detail Drawer */}
      {selectedDetail && (
        <div className="drawer-overlay" onClick={() => setSelectedDetail(null)}>
          <div className="drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Payroll Details</h2>
              <button className="icon-button" onClick={() => setSelectedDetail(null)}><X size={20} /></button>
            </div>
            <div className="drawer-body">
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <div>
                  <div style={{ fontSize: '1.125rem', fontWeight: 600 }}>{selectedDetail.month}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>EMP001</div>
                </div>
                <span className={`badge ${selectedDetail.status === 'PAID' ? 'badge-success' : 'badge-gray'}`}>{selectedDetail.status}</span>
              </div>

              <div style={{ backgroundColor: 'var(--success-50)', border: '1px solid var(--success-200)', borderRadius: 'var(--radius-md)', padding: '1rem', marginBottom: '1.5rem', textAlign: 'center' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--success)', fontWeight: 600, marginBottom: '0.25rem' }}>NET SALARY</div>
                <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--success-800)' }}>₹{selectedDetail.net}</div>
              </div>

              <div className="detail-grid">
                <div className="detail-item">
                  <span className="detail-label">Gross Salary</span>
                  <span className="detail-value">₹{selectedDetail.gross}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Total Deductions</span>
                  <span className="detail-value" style={{ color: 'var(--danger)' }}>₹{selectedDetail.deductions}</span>
                </div>

                <div className="detail-item" style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--border-color)', paddingTop: '1rem', marginTop: '0.5rem' }}>
                  <span className="detail-label">Payment Information</span>
                </div>

                <div className="detail-item">
                  <span className="detail-label">Payment Date</span>
                  <span className="detail-value">{selectedDetail.date}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Payment Method</span>
                  <span className="detail-value">Bank Transfer</span>
                </div>
                <div className="detail-item" style={{ gridColumn: '1 / -1' }}>
                  <span className="detail-label">Transaction Reference</span>
                  <span className="detail-value" style={{ fontFamily: 'monospace' }}>TXN-{selectedDetail.date.replace(/ /g,'').toUpperCase()}-001</span>
                </div>
                
                <div className="detail-item" style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--border-color)', paddingTop: '1rem', marginTop: '0.5rem' }}>
                  <span className="detail-label">Attendance Highlights</span>
                </div>

                <div className="detail-item">
                  <span className="detail-label">Working Days</span>
                  <span className="detail-value">22</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">LOP Days</span>
                  <span className="detail-value">1.5</span>
                </div>
              </div>
              
              <button onClick={() => navigate('/employee/payslip')} className="btn btn-primary" style={{ width: '100%', marginTop: '2rem' }}>
                <FileText size={18} /> View Payslip
              </button>
            </div>
          </div>
        </div>
      )}

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
        .drawer-header { padding: 1.5rem; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; alignItems: center; }
        .drawer-body { padding: 1.5rem; overflow-y: auto; flex: 1; }
        .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
        .detail-item { display: flex; flex-direction: column; gap: 0.25rem; }
        .detail-label { font-size: 0.75rem; color: var(--gray-500); }
        .detail-value { font-size: 0.875rem; font-weight: 500; color: var(--gray-900); }
        
        /* Payroll Timeline */
        .payroll-timeline { display: flex; flexDirection: column; }
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


