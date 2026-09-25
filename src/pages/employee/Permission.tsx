import React, { useState, useEffect } from 'react';
import { 
  Plus, Info, X, AlertCircle, CheckCircle2, 
  ArrowRight, Clock, Calendar as CalendarIcon, ShieldAlert
} from 'lucide-react';

const mockPermissionHistory = [
  { id: 'PER-2026-004', date: '26 Sep 2026', rawDate: '2026-09-26', type: 'Late Arrival', start: '09:00 AM', end: '10:30 AM', duration: '1h 30m', reason: 'Heavy traffic due to rain', status: 'Approved', requestedOn: '25 Sep 2026', approvedBy: 'Manager' },
  { id: 'PER-2026-003', date: '22 Sep 2026', rawDate: '2026-09-22', type: 'Personal Work', start: '03:00 PM', end: '04:30 PM', duration: '1h 30m', reason: 'Bank work', status: 'Pending', requestedOn: '21 Sep 2026', approvedBy: '-' },
  { id: 'PER-2026-002', date: '15 Sep 2026', rawDate: '2026-09-15', type: 'Early Departure', start: '04:30 PM', end: '06:00 PM', duration: '1h 30m', reason: 'Doctor appointment', status: 'Approved', requestedOn: '13 Sep 2026', approvedBy: 'HR Admin' },
  { id: 'PER-2026-001', date: '05 Sep 2026', rawDate: '2026-09-05', type: 'Short Permission', start: '11:00 AM', end: '01:00 PM', duration: '2h 00m', reason: 'Personal work', status: 'Rejected', requestedOn: '04 Sep 2026', rejectReason: 'Permission duration exceeds the configured limit for a single day.' }
];

const EmployeePermission: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState(mockPermissionHistory);
  const [selectedDetail, setSelectedDetail] = useState<any>(null);
  const [toastMessage, setToastMessage] = useState('');
  
  // Request Modal State
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [reqDate, setReqDate] = useState('');
  const [reqType, setReqType] = useState('Short Permission');
  const [reqStart, setReqStart] = useState('');
  const [reqEnd, setReqEnd] = useState('');
  const [reqReason, setReqReason] = useState('');
  const [reqError, setReqError] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 600);
    return () => clearTimeout(timer);
  }, []);

  // Calculate Duration
  let durationText = '0h 0m';
  if (reqStart && reqEnd) {
    const [startH, startM] = reqStart.split(':').map(Number);
    const [endH, endM] = reqEnd.split(':').map(Number);
    let diffMins = (endH * 60 + endM) - (startH * 60 + startM);
    
    if (diffMins > 0) {
      const h = Math.floor(diffMins / 60);
      const m = diffMins % 60;
      durationText = `${h}h ${m}m`;
    } else if (diffMins < 0) {
      durationText = 'Invalid Time';
    }
  }

  const formatAMPM = (timeStr: string) => {
    if (!timeStr) return '';
    const [h, m] = timeStr.split(':');
    let hours = parseInt(h);
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; 
    return `${hours.toString().padStart(2, '0')}:${m} ${ampm}`;
  };

  const handleRequestSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setReqError('');
    if (!reqDate) { setReqError('Please select a date.'); return; }
    if (!reqStart || !reqEnd) { setReqError('Please select start and end times.'); return; }
    if (durationText === 'Invalid Time' || durationText === '0h 0m') { setReqError('End time must be after start time.'); return; }
    if (!reqReason) { setReqError('Please provide a reason.'); return; }
    
    // Mock limit validation
    const durationMins = parseInt(durationText.split('h')[0]) * 60 + parseInt(durationText.split('h ')[1].split('m')[0]);
    if (durationMins > 120) {
      setReqError('Permission duration exceeds the configured limit (max 2 hours).'); return;
    }

    const newReq = {
      id: `PER-2026-00${history.length + 5}`,
      date: new Date(reqDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
      rawDate: reqDate,
      type: reqType,
      start: formatAMPM(reqStart),
      end: formatAMPM(reqEnd),
      duration: durationText,
      reason: reqReason,
      requestedOn: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
      status: 'Pending',
      approvedBy: '-'
    };
    
    setHistory([newReq, ...history]);
    setShowRequestModal(false);
    showToast('Permission request submitted successfully');
    
    // Reset
    setReqDate(''); setReqStart(''); setReqEnd(''); setReqReason(''); setReqType('Short Permission');
  };

  const handleCancelRequest = (id: string) => {
    if (confirm('Are you sure you want to cancel this permission request?')) {
      setHistory(history.map(h => h.id === id ? { ...h, status: 'Cancelled' } : h));
      setSelectedDetail(null);
      showToast('Permission request cancelled');
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
          <h1 className="page-title">Permission</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>Request and track short-duration permission during your working hours.</p>
        </div>
        <button onClick={() => setShowRequestModal(true)} className="btn btn-primary">
          <Plus size={18} /> Request Permission
        </button>
      </div>

      {loading ? (
        <div className="skeleton-container" style={{ display: 'flex', gap: '1rem', overflowX: 'auto', paddingBottom: '0.5rem' }}>
          {[...Array(4)].map((_, i) => <div key={i} className="skeleton" style={{ minWidth: '180px', height: '90px', borderRadius: 'var(--radius-md)' }} />)}
        </div>
      ) : (
        <>
          <div className="tracking-kpi-grid">
            <div className="tracking-kpi-card">
              <div className="sc-title">Available Permission</div>
              <div className="sc-val" style={{ color: 'var(--primary-700)' }}>2h 30m</div>
            </div>
            <div className="tracking-kpi-card">
              <div className="sc-title">Used This Month</div>
              <div className="sc-val">1h 30m</div>
            </div>
            <div className="tracking-kpi-card">
              <div className="sc-title">Pending</div>
              <div className="sc-val" style={{ color: 'var(--warning)' }}>1</div>
            </div>
            <div className="tracking-kpi-card">
              <div className="sc-title">Approved</div>
              <div className="sc-val" style={{ color: 'var(--success)' }}>3</div>
            </div>
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '-1rem' }}>
            * Permission limits and durations are company-configured.
          </div>
        </>
      )}

      <div className="two-col-grid">
        {/* Left Col */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* History */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="card-header" style={{ padding: '1.5rem 1.5rem 0 1.5rem', marginBottom: '1rem' }}>
              <h3 className="card-title">Permission History</h3>
            </div>
            
            {history.length === 0 ? (
              <div style={{ padding: '3rem 1rem', textAlign: 'center' }}>
                <Clock size={32} color="var(--gray-400)" style={{ margin: '0 auto 1rem auto' }} />
                <h3 style={{ fontSize: '1.125rem', fontWeight: 600 }}>No permission requests</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1rem' }}>Your permission applications will appear here.</p>
                <button onClick={() => setShowRequestModal(true)} className="btn btn-outline">Request Permission</button>
              </div>
            ) : (
              <>
                <div className="mobile-cards">
                  {history.map(row => (
                    <div key={row.id} className="mobile-hist-card" onClick={() => setSelectedDetail(row)}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                        <strong style={{ fontSize: '0.875rem' }}>{row.date}</strong>
                        <span className={`badge ${getStatusBadge(row.status)}`}>{row.status}</span>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>{row.type} • {row.duration}</div>
                      <div style={{ fontSize: '0.875rem' }}>{row.start} - {row.end}</div>
                    </div>
                  ))}
                </div>
                
                <div className="table-container desktop-table">
                  <table className="table" style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Type</th>
                        <th>Time</th>
                        <th>Duration</th>
                        <th>Status</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((row) => (
                        <tr key={row.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedDetail(row)}>
                          <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{row.date}</td>
                          <td>{row.type}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>{row.start} - {row.end}</td>
                          <td>{row.duration}</td>
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
          
          {/* List View / Timeline alternative for Permission */}
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: '1rem' }}>September 2026 Overview</h3>
            {loading ? (
               <div className="skeleton" style={{ height: '150px' }} />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {history.slice(0,3).map(h => (
                  <div key={h.id} onClick={() => setSelectedDetail(h)} style={{ display: 'flex', gap: '1rem', padding: '0.75rem', backgroundColor: 'var(--gray-50)', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>
                    <div style={{ width: '40px', height: '40px', backgroundColor: 'var(--primary-100)', color: 'var(--primary-700)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <CalendarIcon size={18} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                        <strong style={{ fontSize: '0.875rem' }}>{h.date}</strong>
                        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: h.status === 'Approved' ? 'var(--success-600)' : 'var(--warning-600)' }}>{h.status}</span>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{h.start} to {h.end} ({h.duration})</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Rules info */}
          <div className="card" style={{ backgroundColor: 'var(--primary-50)', border: '1px solid var(--primary-100)' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <Info size={18} color="var(--primary-600)" />
              How Permission Affects Attendance
            </h3>
            <ul style={{ fontSize: '0.875rem', color: 'var(--gray-700)', display: 'flex', flexDirection: 'column', gap: '0.5rem', listStyle: 'disc', paddingLeft: '1.25rem' }}>
              <li>Permission is separate from full-day or half-day leave.</li>
              <li>It must occur within your designated working shift.</li>
              <li>Approved permission time is considered authorized away-time according to company rules.</li>
              <li>Late arrival and early departure markings on attendance can be offset by approved permissions.</li>
              <li>Any payroll impact depends entirely on configured company rules.</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Request Modal */}
      {showRequestModal && (
        <div className="drawer-overlay">
          <div className="card" style={{ margin: 'auto', width: '100%', maxWidth: '500px', maxHeight: '95vh', overflowY: 'auto', animation: 'slideUp 0.3s' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Request Permission</h2>
              <button className="icon-button" onClick={() => setShowRequestModal(false)}><X size={20}/></button>
            </div>
            
            <form onSubmit={handleRequestSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {reqError && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem', backgroundColor: 'var(--danger-50)', color: 'var(--danger)', borderRadius: 'var(--radius-md)', fontSize: '0.875rem' }}>
                  <AlertCircle size={16} /> {reqError}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Date *</label>
                  <input type="date" value={reqDate} onChange={e => setReqDate(e.target.value)} className="form-control" />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Permission Type *</label>
                  <select value={reqType} onChange={e => setReqType(e.target.value)} className="form-control">
                    <option>Short Permission</option>
                    <option>Late Arrival</option>
                    <option>Early Departure</option>
                    <option>Personal Work</option>
                    <option>Other</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Start Time *</label>
                  <input type="time" value={reqStart} onChange={e => setReqStart(e.target.value)} className="form-control" />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>End Time *</label>
                  <input type="time" value={reqEnd} onChange={e => setReqEnd(e.target.value)} className="form-control" />
                </div>
              </div>

              <div style={{ padding: '0.75rem', backgroundColor: durationText === 'Invalid Time' ? 'var(--danger-50)' : 'var(--primary-50)', borderRadius: 'var(--radius-md)', fontSize: '0.875rem', fontWeight: 600, color: durationText === 'Invalid Time' ? 'var(--danger)' : 'var(--primary-700)', display: 'flex', justifyContent: 'space-between' }}>
                <span>Calculated Duration:</span>
                <span>{durationText}</span>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Reason *</label>
                <textarea value={reqReason} onChange={e => setReqReason(e.target.value)} className="form-control" rows={3} placeholder="Provide a reason for the permission..."></textarea>
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
              <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Permission Details</h2>
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
                  <span className="detail-label">Date</span>
                  <span className="detail-value">{selectedDetail.date}</span>
                </div>
                <div className="detail-item highlight">
                  <span className="detail-label">Duration</span>
                  <span className="detail-value">{selectedDetail.duration}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Start Time</span>
                  <span className="detail-value">{selectedDetail.start}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">End Time</span>
                  <span className="detail-value">{selectedDetail.end}</span>
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

export default EmployeePermission;


