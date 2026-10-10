import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useGlobalSettings } from '../../services/settings/globalSettingsService';
import { 
  Calendar, Plus, Info, X, AlertCircle, CheckCircle2, 
  ArrowRight, Upload, ShieldAlert
} from 'lucide-react';

import { leaveService } from '../../services/leave/leaveService';
import RecordsModal from '../../components/common/RecordsModal';
import { clickableCardProps } from '../../services/common/cardDetails';
import { myLeaveBalanceDetail } from '../../services/common/myRequestCards';

const EmployeeLeave: React.FC = () => {
  const { settings } = useGlobalSettings();
  const appSettings = settings.app;
  const payrollSettings = settings.payroll;

  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<any[]>([]);
  const [balances, setBalances] = useState<any[]>([]);
  const [openBalance, setOpenBalance] = useState<any>(null);
  const [leaveTypes, setLeaveTypes] = useState<any[]>([]);
  const [selectedDetail, setSelectedDetail] = useState<any>(null);
  const [toastMessage, setToastMessage] = useState('');
  
  // Request Modal State
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [reqTypeId, setReqTypeId] = useState('');
  const [reqFrom, setReqFrom] = useState('');
  const [reqTo, setReqTo] = useState('');
  const [reqHalf, setReqHalf] = useState('');
  const [reqReason, setReqReason] = useState('');
  const [reqError, setReqError] = useState('');



  const [attendance, setAttendance] = useState<any[]>([]);
  
  const fetchData = async () => {

    setLoading(true);
    const [typesRes, balRes, histRes] = await Promise.all([
      leaveService.getLeaveTypes(),
      leaveService.getMyLeaveBalances(),
      leaveService.getMyLeaveRequests()
    ]);

    let fetchedHistory: any[] = [];
    if (histRes.data) {
      fetchedHistory = histRes.data.map((h: any) => ({
        id: h.id,
        type: h.leave_types?.name,
        typeCode: h.leave_types?.code,
        from: new Date(h.start_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
        to: new Date(h.end_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
        rawFrom: h.start_date,
        rawTo: h.end_date,
        daysText: `${h.total_days} Day(s)`,
        totalDays: h.total_days,
        reason: h.reason,
        status: h.status.charAt(0).toUpperCase() + h.status.slice(1).toLowerCase(),
        requestedOn: new Date(h.requested_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
        approvedBy: h.reviewed_by ? 'Reviewer' : '-',
        rejectReason: h.reviewer_remarks
      }));
      setHistory(fetchedHistory);
    }
    
    if (typesRes.data) {
      setLeaveTypes(typesRes.data);
      if (typesRes.data.length > 0) setReqTypeId((typesRes.data as any[])[0].id);
    }
    
    // Fetch attendance for calendar (SANDWICH LOP)
    const { supabase } = await import('../../lib/supabase');
    const { data: attData } = await supabase.from('attendance').select('*').eq('status', 'SANDWICH LOP');
    if (attData) {
        setAttendance(attData);
    }
    
    // Process balances and inject Casual Leave rules
    let currentBalances: any[] = balRes.data || [];
    
    // Find CL type
    const clType: any = typesRes.data?.find((t: any) => t.code === 'CL' || t.name?.toLowerCase().includes('casual'));
    
    if (clType && appSettings?.casualLeaveEnabled) {
       // Calculate approved CL usage for the current month
       let clUsedThisMonth = 0;
       const now = new Date();
       fetchedHistory.forEach(h => {
          if (h.typeCode === 'CL' || h.type?.toLowerCase().includes('casual')) {
             if (h.status.toUpperCase() === 'APPROVED') {
                 const d = new Date(h.rawFrom);
                 if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) {
                     clUsedThisMonth += h.totalDays;
                 }
             }
          }
       });
       
       const maxCl = appSettings?.casualLeaveDaysPerMonth || 2;
       const remainingCl = Math.max(0, maxCl - clUsedThisMonth);
       
       // Ensure CL exists in balances
       const existingClIdx = currentBalances.findIndex((b: any) => b.leave_type_id === clType.id);
       if (existingClIdx >= 0) {
           currentBalances[existingClIdx].remaining_days = remainingCl;
           currentBalances[existingClIdx].used_days = clUsedThisMonth;
           currentBalances[existingClIdx].total_allowance = maxCl;
       } else {
           currentBalances.push({
               id: 'virtual-cl',
               leave_type_id: clType.id,
               leave_types: { name: clType.name, code: clType.code },
               remaining_days: remainingCl,
               used_days: clUsedThisMonth,
               total_allowance: maxCl
           });
       }
    }
    
    setBalances(currentBalances);
    setLoading(false);
  };


  useEffect(() => {
    fetchData();
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

  const handleRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setReqError('');
    if (!reqFrom || !reqTo) { setReqError('Please select From and To dates.'); return; }
    if (new Date(reqTo) < new Date(reqFrom)) { setReqError('To date cannot be before From date.'); return; }
    if (!reqReason) { setReqError('Please provide a reason.'); return; }
    

    // Add Casual Leave limit validation
    const clType: any = leaveTypes.find(t => t.id === reqTypeId);
    if (clType && (clType.code === 'CL' || clType.name.toLowerCase().includes('casual'))) {
        const bal = balances.find(b => b.leave_type_id === reqTypeId);
        if (bal) {
            const requestedDays = leaveService.calculateTotalDays(reqFrom, reqTo, !!reqHalf);
            if (bal.remaining_days < requestedDays && !appSettings?.allowNegativeBalance) {
                setReqError(`You only have ${bal.remaining_days} Casual Leave(s) remaining for this month.`);
                return;
            }
        }
    }

    const { error } = await leaveService.createLeaveRequest({
      leave_type_id: reqTypeId,
      start_date: reqFrom,
      end_date: reqTo,
      is_half_day: !!reqHalf,
      half_day_type: reqHalf as any,
      reason: reqReason
    });

    if (error) {
      setReqError(error.message);
      return;
    }

    setShowRequestModal(false);
    showToast('Leave request submitted successfully');
    
    // Reset
    setReqFrom(''); setReqTo(''); setReqReason(''); setReqHalf('');
    fetchData();
  };

  const handleCancelRequest = async (id: string) => {
    if (confirm('Are you sure you want to cancel this leave request?')) {
      const { error } = await leaveService.cancelLeaveRequest(id);
      if (error) {
        alert(error.message);
        return;
      }
      setSelectedDetail(null);
      showToast('Leave request cancelled');
      fetchData();
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
          <div className="tracking-kpi-grid">
            {balances.length > 0 ? balances.map(b => (
              <div key={b.id} className="tracking-kpi-card" {...clickableCardProps(`${b.leave_types?.name || 'Leave'} balance`, () => setOpenBalance(b))}>
                <div className="sc-title">{b.leave_types?.name}</div>
                <div className="sc-val" style={{ color: 'var(--primary-700)' }}>{b.remaining_days} Days <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Available</span></div>
              </div>
            )) : (
              <div className="tracking-kpi-card">
                <div className="sc-title">No Leave Balances Found</div>
                <div className="sc-val" style={{ color: 'var(--gray-500)' }}>-</div>
              </div>
            )}
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
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>{row.type} • {row.daysText}</div>
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
                          <td>{row.daysText}</td>
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
                {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
                  <div key={d} className="cal-head">{d}</div>
                ))}
                {(() => {
                  const now = new Date();
                  const year = now.getFullYear();
                  const month = now.getMonth();
                  const firstDay = new Date(year, month, 1).getDay();
                  const daysInMonth = new Date(year, month + 1, 0).getDate();
                  const blanks = Array.from({length: firstDay}, (_, i) => i);
                  const days = Array.from({length: daysInMonth}, (_, i) => i + 1);
                  
                  return (
                    <>
                      {blanks.map(b => <div key={`blank-${b}`} className="cal-day empty"></div>)}
                      {days.map(day => {
                        const dayStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                        const current = new Date(dayStr).getTime();
                        
                        const req = history.find(h => {
                          const start = new Date(h.rawFrom).getTime();
                          const end = new Date(h.rawTo).getTime();
                          return current >= start && current <= end && h.status !== 'Cancelled' && h.status !== 'Rejected';
                        });
                        
                        const isSandwich = attendance.find(a => a.attendance_date === dayStr);
                        
                        let dotColor = null;
                        let tooltip = '';
                        if (isSandwich) {
                            dotColor = 'var(--danger)';
                            tooltip = 'SANDWICH LOP';
                        } else if (req) {
                            dotColor = req.status === 'Approved' ? 'var(--success)' : 'var(--warning)';
                            tooltip = `${req.type} (${req.status})`;
                        }
                        
                        return (
                          <div key={day} title={tooltip} onClick={() => req && setSelectedDetail(req)} className={`cal-day ${!req && !isSandwich ? 'future' : ''}`} style={{ cursor: req ? 'pointer' : 'default', position: 'relative' }}>
                            <span className="cal-date">{day}</span>
                            {dotColor && <div className="cal-dot" style={{ backgroundColor: dotColor, width: '6px', height: '6px', borderRadius: '50%', position: 'absolute', bottom: '4px', left: '50%', transform: 'translateX(-50%)' }} />}
                          </div>
                        );
                      })}
                    </>
                  );
                })()}
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
                <select value={reqTypeId} onChange={e => setReqTypeId(e.target.value)} className="form-control">
                  {leaveTypes.map(lt => (
                    <option key={lt.id} value={lt.id}>{lt.name}</option>
                  ))}
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
                  <span className="detail-value">{selectedDetail.daysText}</span>
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
      {openBalance && (() => {
        const d = myLeaveBalanceDetail(openBalance, history);
        const f = (v: number | null) => (v === null || Number.isNaN(v) ? 'not set' : `${v} day(s)`);
        return <RecordsModal open title={`${d.name} Balance`} total={d.remaining === null ? '—' : `${d.remaining} Days`} totalLabel="Available"
          columns={[{ key: 'from', label: 'From' }, { key: 'to', label: 'To' }, { key: 'days', label: 'Days', align: 'right' }, { key: 'status', label: 'Status' }, { key: 'reason', label: 'Reason' }, { key: 'requestedOn', label: 'Requested On' }, { key: 'remarks', label: 'Remarks' }]}
          rows={d.rows} loading={loading} emptyMessage={`You have no ${d.name} requests.`}
          explanation={[`Allowance: ${f(d.allowance)} · Used: ${f(d.used)} · Available: ${f(d.remaining)}${d.monthly ? ' (per month, from the company’s casual-leave setting)' : ''}.`, 'Balances are maintained by the company; the requests below are your own requests of this leave type (all statuses).']}
          onClose={() => setOpenBalance(null)} />;
      })()}
    </div>
  );
};

export default EmployeeLeave;


