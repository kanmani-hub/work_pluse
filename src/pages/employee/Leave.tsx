import React, { useState, useEffect } from 'react';
import { 
  Calendar, Plus, Info, X, AlertCircle, CheckCircle2, 
  ArrowRight, Upload, ShieldAlert
} from 'lucide-react';

const mockLeaveHistory = [
  { id: 'LV-2026-004', type: 'Casual Leave', from: '28 Sep 2026', to: '29 Sep 2026', rawFrom: '2026-09-28', rawTo: '2026-09-29', days: '2 Days', reason: 'Personal work', status: 'Approved', requestedOn: '20 Sep 2026', approvedBy: 'HR Admin' },
  { id: 'LV-2026-003', type: 'Sick Leave', from: '15 Sep 2026', to: '16 Sep 2026', rawFrom: '2026-09-15', rawTo: '2026-09-16', days: '2 Days', reason: 'Viral fever', status: 'Approved', requestedOn: '14 Sep 2026', approvedBy: 'Manager' },
  { id: 'LV-2026-002', type: 'Earned Leave', from: '05 Sep 2026', to: '05 Sep 2026', rawFrom: '2026-09-05', rawTo: '2026-09-05', days: '1 Day', reason: 'Attending family function', status: 'Pending', requestedOn: '01 Sep 2026', approvedBy: '-' },
  { id: 'LV-2026-001', type: 'Casual Leave', from: '20 Aug 2026', to: '21 Aug 2026', rawFrom: '2026-08-20', rawTo: '2026-08-21', days: '2 Days', reason: 'Trip out of town', status: 'Rejected', requestedOn: '15 Aug 2026', rejectReason: 'Team capacity is low during this period.' }
];

const EmployeeLeave: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState(mockLeaveHistory);
  const [selectedDetail, setSelectedDetail] = useState<any>(null);
  const [toastMessage, setToastMessage] = useState('');
  
  // Request Modal State
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [reqType, setReqType] = useState('Casual Leave');
  const [reqFrom, setReqFrom] = useState('');
  const [reqTo, setReqTo] = useState('');
  const [reqHalf, setReqHalf] = useState('');
  const [reqReason, setReqReason] = useState('');
  const [reqError, setReqError] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 600);
    return () => clearTimeout(timer);
  }, []);

  // Calculate Duration
  let durationText = '0 Days';
  let isHalfDayPossible = false;
  
  if (reqFrom && reqTo) {
    const start = new Date(reqFrom);
    const end = new Date(reqTo);
    if (end >= start) {
      const diffTime = Math.abs(end.getTime() - start.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
      
      if (diffDays === 1) {
        isHalfDayPossible = true;
        durationText = reqHalf ? '0.5 Days (Half Day)' : '1 Day';
      } else {
        durationText = `${diffDays} Days`;
      }
    }
  }

  const handleRequestSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setReqError('');
    if (!reqFrom || !reqTo) { setReqError('Please select From and To dates.'); return; }
    if (new Date(reqTo) < new Date(reqFrom)) { setReqError('To date cannot be before From date.'); return; }
    if (!reqReason) { setReqError('Please provide a reason.'); return; }
    
    // Mock Balance Validation
    if (reqType === 'Casual Leave' && parseInt(durationText) > 8) {
      setReqError('You have only 8 Casual Leave days remaining.'); return;
    }

    const newReq = {
      id: `LV-2026-00${history.length + 5}`,
      type: reqType,
      from: new Date(reqFrom).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
      to: new Date(reqTo).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
      rawFrom: reqFrom,
      rawTo: reqTo,
      days: durationText,
      reason: reqReason,
      requestedOn: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
      status: 'Pending',
      approvedBy: '-'
    };
    
    setHistory([newReq, ...history]);
    setShowRequestModal(false);
    showToast('Leave request submitted successfully');
    
    // Reset
    setReqFrom(''); setReqTo(''); setReqReason(''); setReqType('Casual Leave'); setReqHalf('');
  };

  const handleCancelRequest = (id: string) => {
    if (confirm('Are you sure you want to cancel this leave request?')) {
      setHistory(history.map(h => h.id === id ? { ...h, status: 'Cancelled' } : h));
      setSelectedDetail(null);
      showToast('Leave request cancelled');
    }
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3000);
  };

  const getStatusBadge = (status: string) => {
    switch(status.toUpperCase()) {
      case 'APPROVED': return 'badge-success';
      case 'PENDING': return 'badge-warning';
      case 'REJECTED': return 'badge-danger';
      case 'CANCELLED': return 'badge-gray';
      default: return 'badge-gray';
    }
  };

  const calendarDays = Array.from({length: 30}, (_, i) => i + 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', position: 'relative' }}>
      
      {toastMessage && (
        <div style={{ position: 'fixed', top: '24px', left: '50%', transform: 'translateX(-50%)', backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)', padding: '0.75rem 1.5rem', borderRadius: 'var(--radius-full)', zIndex: 1000, display: 'flex', alignItems: 'center', gap: '0.5rem', boxShadow: 'var(--shadow-lg)', animation: 'slideDown 0.3s forwards' }}>
          <CheckCircle2 size={18} color="var(--success)" />
          {toastMessage}
        </div>
      )}

      {/* Page Header */}
      <div className="page-header" style={{ marginBottom: 0, flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="page-title">My Leave</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>Apply for leave, track requests and view your leave balance.</p>
        </div>
        <button onClick={() => setShowRequestModal(true)} className="btn btn-primary">
          <Plus size={18} /> Apply Leave
        </button>
      </div>

      {loading ? (
        <div className="skeleton-container" style={{ display: 'flex', gap: '1rem', overflowX: 'auto', paddingBottom: '0.5rem' }}>
          {[...Array(4)].map((_, i) => <div key={i} className="skeleton" style={{ minWidth: '180px', height: '90px', borderRadius: 'var(--radius-md)' }} />)}
        </div>
      ) : (
        <>
          <div className="summary-cards-scroll">
            <div className="summary-card-small">
              <div className="sc-title">Casual Leave</div>
              <div className="sc-val" style={{ color: 'var(--primary-700)' }}>8 Days <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Available</span></div>
            </div>
            <div className="summary-card-small">
              <div className="sc-title">Sick Leave</div>
              <div className="sc-val" style={{ color: 'var(--warning)' }}>6 Days <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Available</span></div>
            </div>
            <div className="summary-card-small">
              <div className="sc-title">Earned Leave</div>
              <div className="sc-val" style={{ color: 'var(--success)' }}>10 Days <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Available</span></div>
            </div>
            <div className="summary-card-small">
              <div className="sc-title">Unpaid Leave</div>
              <div className="sc-val" style={{ color: 'var(--gray-700)' }}>Policy based</div>
            </div>
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '-1rem' }}>
            * Leave balances and leave rules are configured by the company.
          </div>
        </>
      )}

      <div className="two-col-grid">
        {/* Left Col */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* History */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="card-header" style={{ padding: '1.5rem 1.5rem 0 1.5rem', marginBottom: '1rem' }}>
              <h3 className="card-title">Leave History</h3>
            </div>
            
            {history.length === 0 ? (
              <div style={{ padding: '3rem 1rem', textAlign: 'center' }}>
                <Calendar size={32} color="var(--gray-400)" style={{ margin: '0 auto 1rem auto' }} />
                <h3 style={{ fontSize: '1.125rem', fontWeight: 600 }}>No leave requests</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1rem' }}>Your leave applications will appear here.</p>
                <button onClick={() => setShowRequestModal(true)} className="btn btn-outline">Apply Leave</button>
              </div>
            ) : (
              <>
                <div className="mobile-cards">
                  {history.map(row => (
                    <div key={row.id} className="mobile-hist-card" onClick={() => setSelectedDetail(row)}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                        <strong style={{ fontSize: '0.875rem' }}>{row.from} - {row.to}</strong>
                        <span className={`badge ${getStatusBadge(row.status)}`}>{row.status}</span>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>{row.type} • {row.days}</div>
                      <div style={{ fontSize: '0.875rem' }}>{row.reason}</div>
                    </div>
                  ))}
                </div>
                
                <div className="table-container desktop-table">
                  <table className="table" style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Type</th>
                        <th>Date</th>
                        <th>Days</th>
                        <th>Status</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((row) => (
                        <tr key={row.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedDetail(row)}>
                          <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{row.id}</td>
                          <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{row.type}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            {row.from === row.to ? row.from : `${row.from} to ${row.to}`}
                          </td>
                          <td>{row.days}</td>
                          <td><span className={`badge ${getStatusBadge(row.status)}`}>{row.status}</span></td>
                          <td><ArrowRight size={16} color="var(--gray-400)" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right Col */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Calendar View */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 className="card-title">Calendar View</h3>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <div className="cal-legend"><span style={{ backgroundColor: 'var(--success)' }}/> Appr</div>
                <div className="cal-legend"><span style={{ backgroundColor: 'var(--warning)' }}/> Pend</div>
              </div>
            </div>
            {loading ? (
              <div className="skeleton" style={{ height: '200px' }} />
            ) : (
              <div className="calendar-grid">
                {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(d => (
                  <div key={d} className="cal-head">{d}</div>
                ))}
                <div className="cal-day empty"></div>
                {calendarDays.map(day => {
                  const dayStr = `2026-09-${day.toString().padStart(2, '0')}`;
                  const req = history.find(h => {
                    const start = new Date(h.rawFrom).getTime();
                    const end = new Date(h.rawTo).getTime();
                    const current = new Date(dayStr).getTime();
                    return current >= start && current <= end;
                  });
                  return (
                    <div key={day} onClick={() => req && setSelectedDetail(req)} className={`cal-day ${!req ? 'future' : ''}`} style={{ cursor: req ? 'pointer' : 'default' }}>
                      <span className="cal-date">{day}</span>
                      {req && <div className="cal-dot" style={{ backgroundColor: req.status === 'Approved' ? 'var(--success)' : req.status === 'Pending' ? 'var(--warning)' : 'var(--danger)' }} />}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Rules info */}
          <div className="card" style={{ backgroundColor: 'var(--primary-50)', border: '1px solid var(--primary-100)' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Info size={18} color="var(--primary-600)" /> Leave Policy</div>
              <span className="badge badge-gray" style={{ fontSize: '0.75rem' }}>COMPANY-CONFIGURED</span>
            </h3>
            <ul style={{ fontSize: '0.875rem', color: 'var(--gray-700)', display: 'flex', flexDirection: 'column', gap: '0.5rem', listStyle: 'disc', paddingLeft: '1.25rem' }}>
              <li>Leave types and balances are allocated annually based on policy.</li>
              <li>Carry-forward rules depend on the specific leave type.</li>
              <li>Half-day leave is available for Casual and Sick leaves only.</li>
              <li>All leaves require Manager or HR Admin approval.</li>
              <li>Sick leaves exceeding 2 days require an attached medical certificate.</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Apply Leave Modal */}
      {showRequestModal && (
        <div className="drawer-overlay">
          <div className="card" style={{ margin: 'auto', width: '100%', maxWidth: '500px', maxHeight: '95vh', overflowY: 'auto', animation: 'slideUp 0.3s' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Apply Leave</h2>
              <button className="icon-button" onClick={() => setShowRequestModal(false)}><X size={20}/></button>
            </div>
            
            <form onSubmit={handleRequestSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {reqError && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem', backgroundColor: 'var(--danger-50)', color: 'var(--danger)', borderRadius: 'var(--radius-md)', fontSize: '0.875rem' }}>
                  <AlertCircle size={16} /> {reqError}
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Leave Type *</label>
                <select value={reqType} onChange={e => setReqType(e.target.value)} className="form-control">
                  <option>Casual Leave</option>
                  <option>Sick Leave</option>
                  <option>Earned Leave</option>
                  <option>Unpaid Leave</option>
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>From Date *</label>
                  <input type="date" value={reqFrom} onChange={e => setReqFrom(e.target.value)} className="form-control" />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>To Date *</label>
                  <input type="date" value={reqTo} onChange={e => setReqTo(e.target.value)} className="form-control" />
                </div>
              </div>

              {isHalfDayPossible && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', backgroundColor: 'var(--gray-50)', padding: '0.75rem', borderRadius: 'var(--radius-md)' }}>
                  <input type="checkbox" id="halfDay" checked={!!reqHalf} onChange={e => setReqHalf(e.target.checked ? 'First Half' : '')} />
                  <label htmlFor="halfDay" style={{ fontSize: '0.875rem' }}>Request Half Day</label>
                  
                  {!!reqHalf && (
                    <select value={reqHalf} onChange={e => setReqHalf(e.target.value)} className="form-control" style={{ width: 'auto', padding: '0.25rem' }}>
                      <option>First Half</option>
                      <option>Second Half</option>
                    </select>
                  )}
                </div>
              )}

              <div style={{ padding: '0.75rem', backgroundColor: 'var(--primary-50)', borderRadius: 'var(--radius-md)', fontSize: '0.875rem', fontWeight: 600, color: 'var(--primary-700)', display: 'flex', justifyContent: 'space-between' }}>
                <span>Calculated Duration:</span>
                <span>{durationText}</span>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Reason *</label>
                <textarea value={reqReason} onChange={e => setReqReason(e.target.value)} className="form-control" rows={3} placeholder="Provide a reason for the leave..."></textarea>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Attachment (Optional)</label>
                <div style={{ border: '1px dashed var(--border-color)', padding: '1rem', borderRadius: 'var(--radius-md)', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.875rem', cursor: 'pointer' }} onClick={() => alert('Mock: File input triggered')}>
                  <Upload size={20} style={{ margin: '0 auto 0.5rem auto' }} />
                  Attach supporting document<br/>
                  <span style={{ fontSize: '0.75rem' }}>JPG, PNG, PDF up to 5MB</span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                <button type="button" onClick={() => setShowRequestModal(false)} className="btn btn-outline" style={{ flex: 1 }}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>Submit Request</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detail Drawer */}
      {selectedDetail && (
        <div className="drawer-overlay" onClick={() => setSelectedDetail(null)}>
          <div className="drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Leave Details</h2>
              <button className="icon-button" onClick={() => setSelectedDetail(null)}><X size={20} /></button>
            </div>
            <div className="drawer-body">
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <div>
                  <div style={{ fontSize: '1.125rem', fontWeight: 600 }}>{selectedDetail.type}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{selectedDetail.id}</div>
                </div>
                <span className={`badge ${getStatusBadge(selectedDetail.status)}`}>{selectedDetail.status}</span>
              </div>

              {selectedDetail.status === 'Rejected' && (
                <div style={{ display: 'flex', gap: '0.5rem', backgroundColor: 'var(--danger-50)', color: 'var(--danger)', padding: '1rem', borderRadius: 'var(--radius-md)', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
                  <ShieldAlert size={18} style={{ flexShrink: 0 }} />
                  <div>
                    <strong style={{ display: 'block', marginBottom: '0.25rem' }}>Rejection Reason</strong>
                    {selectedDetail.rejectReason}
                  </div>
                </div>
              )}

              <div className="detail-grid">
                <div className="detail-item highlight">
                  <span className="detail-label">From</span>
                  <span className="detail-value">{selectedDetail.from}</span>
                </div>
                <div className="detail-item highlight">
                  <span className="detail-label">To</span>
                  <span className="detail-value">{selectedDetail.to}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Duration</span>
                  <span className="detail-value">{selectedDetail.days}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Requested On</span>
                  <span className="detail-value">{selectedDetail.requestedOn}</span>
                </div>
                
                <div className="detail-item" style={{ gridColumn: '1 / -1' }}>
                  <span className="detail-label">Reason</span>
                  <span className="detail-value">{selectedDetail.reason}</span>
                </div>

                <div className="detail-item" style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--border-color)', paddingTop: '1rem', marginTop: '0.5rem' }}>
                  <span className="detail-label">Approval Info</span>
                </div>

                <div className="detail-item">
                  <span className="detail-label">Approved By</span>
                  <span className="detail-value">{selectedDetail.approvedBy}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Approved On</span>
                  <span className="detail-value">{selectedDetail.status === 'Approved' ? selectedDetail.requestedOn : '-'}</span>
                </div>
              </div>
              
              {selectedDetail.status === 'Pending' && (
                <button onClick={() => handleCancelRequest(selectedDetail.id)} className="btn btn-outline" style={{ width: '100%', marginTop: '2rem', color: 'var(--danger-600)', borderColor: 'var(--danger-200)' }}>
                  Cancel Request
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`
        
        
        .summary-cards-scroll { display: flex; gap: 1rem; overflow-x: auto; padding-bottom: 0.5rem; scrollbar-width: thin; }
        
        
        
        .two-col-grid { display: grid; grid-template-columns: 1fr; gap: 1.5rem; }
        @media (min-width: 1024px) { .two-col-grid { grid-template-columns: 1fr 1fr; } }
        
        .cal-legend { display: flex; alignItems: center; gap: 0.25rem; font-size: 0.75rem; color: var(--gray-500); }
        .cal-legend span { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
        .calendar-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
        .cal-head { text-align: center; font-size: 0.75rem; font-weight: 600; color: var(--gray-500); padding-bottom: 0.5rem; }
        .cal-day { aspect-ratio: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; border-radius: var(--radius-md); transition: all 0.2s; position: relative; }
        .cal-day:not(.empty):not(.future):hover { background-color: var(--gray-100); }
        .cal-day.future { color: var(--gray-300); }
        .cal-date { font-size: 0.875rem; font-weight: 500; }
        .cal-dot { width: 6px; height: 6px; border-radius: 50%; margin-top: 4px; }
        
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
        .detail-item.highlight { background-color: var(--gray-50); padding: 0.75rem; border-radius: var(--radius-md); }
        .detail-label { font-size: 0.75rem; color: var(--gray-500); }
        .detail-value { font-size: 0.875rem; font-weight: 500; color: var(--gray-900); }
        
        @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @media (max-width: 768px) {
          .drawer-overlay { align-items: flex-end; }
          .drawer { height: 90vh; border-top-left-radius: var(--radius-xl); border-top-right-radius: var(--radius-xl); animation: slideUp 0.3s forwards; }
        }
        
        .skeleton { background: linear-gradient(90deg, var(--gray-200) 25%, var(--gray-100) 50%, var(--gray-200) 75%); background-size: 200% 100%; animation: skeleton-loading 1.5s infinite; }
        @keyframes skeleton-loading { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
        @keyframes slideDown { from { transform: translate(-50%, -100%); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }
      `}</style>
    </div>
  );
};

export default EmployeeLeave;


