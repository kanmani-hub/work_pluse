import React, { useState, useEffect } from 'react';
import { 
  ChevronLeft, ChevronRight, Calendar as CalendarIcon, Clock, Filter, 
  MapPin, AlertCircle, X, Info, Loader2, ArrowRight
} from 'lucide-react';

// --- MOCK DATA ---
const summaryStats = {
  workingDays: 22, present: 18, late: 2, halfDay: 1, leave: 1, wfh: 3, totalHours: '154h 32m'
};

const mockHistory = [
  { id: 1, date: '24 Sep 2026', rawDate: '2026-09-24', shift: 'Evening Shift', mode: 'OFFICE', in: '02:03 PM', out: '--:--', break: '32m', hours: '4h 12m', status: 'WORKING', overnight: false, lateMin: 0, earlyMin: 0 },
  { id: 2, date: '23 Sep 2026', rawDate: '2026-09-23', shift: 'Night Shift', mode: 'OFFICE', in: '10:04 PM', out: '07:02 AM', break: '1h 00m', hours: '8h 02m', status: 'Present', overnight: true, lateMin: 4, earlyMin: 0 },
  { id: 3, date: '22 Sep 2026', rawDate: '2026-09-22', shift: 'Morning Shift', mode: 'WFH', in: '09:00 AM', out: '06:05 PM', break: '1h 00m', hours: '8h 05m', status: 'WFH', overnight: false, lateMin: 0, earlyMin: 0 },
  { id: 4, date: '21 Sep 2026', rawDate: '2026-09-21', shift: 'Morning Shift', mode: 'OFFICE', in: '09:15 AM', out: '06:00 PM', break: '1h 00m', hours: '7h 45m', status: 'Late', overnight: false, lateMin: 15, earlyMin: 0 },
  { id: 5, date: '20 Sep 2026', rawDate: '2026-09-20', shift: 'Night Shift', mode: 'OFFICE', in: '10:02 PM', out: '07:00 AM', break: '0m', hours: '8h 58m', status: 'Auto Logout', overnight: true, lateMin: 2, earlyMin: 0, autoLogout: true },
  { id: 6, date: '19 Sep 2026', rawDate: '2026-09-19', shift: 'Week Off', mode: '-', in: '-', out: '-', break: '-', hours: '-', status: 'Week Off', overnight: false, lateMin: 0, earlyMin: 0 },
  { id: 7, date: '18 Sep 2026', rawDate: '2026-09-18', shift: 'Morning Shift', mode: 'OFFICE', in: '-', out: '-', break: '-', hours: '-', status: 'Leave', overnight: false, lateMin: 0, earlyMin: 0 },
];

const EmployeeAttendance: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState('September 2026');
  const [selectedDateDetail, setSelectedDateDetail] = useState<any>(null);
  
  // Filters
  const [filterMode, setFilterMode] = useState('All');
  const [filterStatus, setFilterStatus] = useState('All');
  
  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 800);
    return () => clearTimeout(timer);
  }, []);

  const handleClearFilters = () => {
    setFilterMode('All');
    setFilterStatus('All');
  };

  const filteredHistory = mockHistory.filter(item => {
    if (filterMode !== 'All' && item.mode !== filterMode) return false;
    if (filterStatus !== 'All' && item.status !== filterStatus) return false;
    return true;
  });

  const getStatusBadge = (status: string) => {
    switch(status.toUpperCase()) {
      case 'WORKING': return 'badge-warning';
      case 'PRESENT': return 'badge-success';
      case 'LATE': return 'badge-warning';
      case 'WFH': return 'badge-primary';
      case 'LEAVE': return 'badge-gray';
      case 'AUTO LOGOUT': return 'badge-danger';
      case 'WEEK OFF': return 'badge-gray';
      default: return 'badge-gray';
    }
  };

  const getStatusColorCode = (status: string) => {
    switch(status.toUpperCase()) {
      case 'PRESENT': return 'var(--success)';
      case 'LATE': return 'var(--warning)';
      case 'HALF DAY': return '#facc15';
      case 'LEAVE': return '#3b82f6';
      case 'WFH': return 'var(--primary-500)';
      case 'ABSENT': return 'var(--danger)';
      case 'AUTO LOGOUT': return 'var(--danger)';
      default: return 'var(--gray-300)';
    }
  };

  // Mock calendar days (just visually)
  const calendarDays = Array.from({length: 30}, (_, i) => i + 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', position: 'relative' }}>
      
      {/* Page Header */}
      <div className="page-header" style={{ marginBottom: 0, flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="page-title">My Attendance</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>Track your daily working hours, attendance status, shifts and breaks.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', backgroundColor: 'var(--bg-surface-elevated)', padding: '0.25rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
          <button className="icon-button"><ChevronLeft size={20} /></button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0 0.5rem', fontWeight: 600 }}>
            <CalendarIcon size={18} className="nav-icon" />
            {currentMonth}
          </div>
          <button className="icon-button"><ChevronRight size={20} /></button>
        </div>
      </div>

      {loading ? (
        <div className="skeleton-container" style={{ display: 'flex', gap: '1rem', overflowX: 'auto', paddingBottom: '0.5rem' }}>
          {[...Array(7)].map((_, i) => <div key={i} className="skeleton" style={{ minWidth: '120px', height: '80px', borderRadius: 'var(--radius-md)' }} />)}
        </div>
      ) : (
        <div className="summary-cards-scroll">
          <div className="summary-card-small">
            <div className="sc-title">Working Days</div>
            <div className="sc-val">{summaryStats.workingDays}</div>
          </div>
          <div className="summary-card-small">
            <div className="sc-title">Present</div>
            <div className="sc-val" style={{ color: 'var(--success)' }}>{summaryStats.present}</div>
          </div>
          <div className="summary-card-small">
            <div className="sc-title">Late</div>
            <div className="sc-val" style={{ color: 'var(--warning)' }}>{summaryStats.late}</div>
          </div>
          <div className="summary-card-small">
            <div className="sc-title">Half Day</div>
            <div className="sc-val" style={{ color: '#ca8a04' }}>{summaryStats.halfDay}</div>
          </div>
          <div className="summary-card-small">
            <div className="sc-title">Leave</div>
            <div className="sc-val" style={{ color: '#2563eb' }}>{summaryStats.leave}</div>
          </div>
          <div className="summary-card-small">
            <div className="sc-title">WFH</div>
            <div className="sc-val" style={{ color: 'var(--primary-700)' }}>{summaryStats.wfh}</div>
          </div>
          <div className="summary-card-small">
            <div className="sc-title">Total Hours</div>
            <div className="sc-val">{summaryStats.totalHours}</div>
          </div>
        </div>
      )}

      <div className="two-col-grid">
        {/* Left Col: Today & Timeline */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Today's Attendance Card */}
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>Today's Attendance</h3>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Date</div>
                <div style={{ fontWeight: 600 }}>24 September 2026</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span className="badge badge-warning" style={{ fontSize: '0.875rem', padding: '0.375rem 0.75rem' }}>
                  <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'currentColor', marginRight: '0.5rem', animation: 'pulse 2s infinite' }} />
                  WORKING
                </span>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', backgroundColor: 'var(--gray-50)', padding: '1rem', borderRadius: 'var(--radius-md)' }}>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Assigned Shift</div>
                <div style={{ fontWeight: 500 }}>Evening Shift</div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Scheduled</div>
                <div style={{ fontWeight: 500 }}>2:00 PM — 11:00 PM</div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Required Hours</div>
                <div style={{ fontWeight: 500 }}>8 Hours</div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Work Mode</div>
                <div style={{ fontWeight: 500 }}>OFFICE</div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1.5rem' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Clock In</div>
                <div style={{ fontWeight: 600, fontSize: '1.125rem' }}>2:03 PM</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Break</div>
                <div style={{ fontWeight: 600, fontSize: '1.125rem' }}>32m</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Clock Out</div>
                <div style={{ fontWeight: 600, fontSize: '1.125rem', color: 'var(--text-secondary)' }}>Not yet</div>
              </div>
            </div>
            
            <div style={{ marginTop: '1.5rem', textAlign: 'center', padding: '1rem', border: '1px dashed var(--border-color)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Effective Working Hours</div>
              <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--primary-600)', fontVariantNumeric: 'tabular-nums' }}>4h 12m 45s</div>
            </div>
          </div>

          {/* Attendance Timeline */}
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: '1rem' }}>Today's Timeline</h3>
            <div className="timeline">
              <div className="tl-item">
                <div className="tl-dot tl-neutral"></div>
                <div className="tl-content">
                  <div className="tl-time">02:00 PM</div>
                  <div className="tl-desc">Scheduled Shift Start</div>
                </div>
              </div>
              <div className="tl-item">
                <div className="tl-dot tl-success"></div>
                <div className="tl-content">
                  <div className="tl-time">02:03 PM</div>
                  <div className="tl-desc" style={{ fontWeight: 600 }}>Clocked In (Office)</div>
                </div>
              </div>
              <div className="tl-item">
                <div className="tl-dot tl-warning"></div>
                <div className="tl-content">
                  <div className="tl-time">05:15 PM</div>
                  <div className="tl-desc">Break Started</div>
                </div>
              </div>
              <div className="tl-item">
                <div className="tl-dot tl-success"></div>
                <div className="tl-content">
                  <div className="tl-time">05:47 PM</div>
                  <div className="tl-desc">Break Ended</div>
                </div>
              </div>
              <div className="tl-item tl-active">
                <div className="tl-dot tl-primary pulse-dot"></div>
                <div className="tl-content">
                  <div className="tl-time">Current Time</div>
                  <div className="tl-desc" style={{ color: 'var(--primary-700)', fontWeight: 600 }}>Working</div>
                </div>
              </div>
              <div className="tl-item">
                <div className="tl-dot tl-neutral tl-outline"></div>
                <div className="tl-content">
                  <div className="tl-time" style={{ color: 'var(--text-secondary)' }}>11:00 PM</div>
                  <div className="tl-desc" style={{ color: 'var(--text-secondary)' }}>Scheduled Shift End</div>
                </div>
              </div>
            </div>
          </div>
          
          {/* Shift Info */}
          <div className="card" style={{ backgroundColor: 'var(--primary-50)', border: '1px solid var(--primary-100)' }}>
             <h3 className="card-title" style={{ fontSize: '1rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Info size={18} color="var(--primary-600)" />
                Current Assigned Shift
             </h3>
             <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.875rem' }}>
               <div><span style={{ color: 'var(--text-secondary)' }}>Shift Name:</span> <strong>Evening Shift</strong></div>
               <div><span style={{ color: 'var(--text-secondary)' }}>Hours:</span> <strong>8h Required</strong></div>
               <div><span style={{ color: 'var(--text-secondary)' }}>Timing:</span> <strong>2:00 PM - 11:00 PM</strong></div>
               <div><span style={{ color: 'var(--text-secondary)' }}>Break:</span> <strong>1h Duration</strong></div>
               <div><span style={{ color: 'var(--text-secondary)' }}>Grace:</span> <strong>15 mins</strong></div>
               <div><span style={{ color: 'var(--text-secondary)' }}>Mode:</span> <strong>OFFICE</strong></div>
             </div>
          </div>

        </div>

        {/* Right Col: Calendar & Table */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Monthly Calendar */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 className="card-title">September 2026</h3>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <div className="cal-legend"><span style={{ backgroundColor: 'var(--success)' }}/> PR</div>
                <div className="cal-legend"><span style={{ backgroundColor: 'var(--warning)' }}/> LT</div>
                <div className="cal-legend"><span style={{ backgroundColor: 'var(--primary-500)' }}/> WFH</div>
              </div>
            </div>
            
            {loading ? (
              <div className="skeleton" style={{ height: '240px', borderRadius: 'var(--radius-md)' }} />
            ) : (
              <div className="calendar-grid">
                {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(d => (
                  <div key={d} className="cal-head">{d}</div>
                ))}
                {/* Empty cells for padding */}
                <div className="cal-day empty"></div>
                
                {calendarDays.map(day => {
                  // Mock random status for days
                  let status = 'PRESENT';
                  if (day === 24) status = 'WORKING';
                  else if (day === 21) status = 'LATE';
                  else if (day === 22) status = 'WFH';
                  else if (day === 19 || day === 20 || day === 12 || day === 13) status = 'WEEK OFF';
                  else if (day === 18) status = 'LEAVE';
                  else if (day > 24) status = 'FUTURE';

                  return (
                    <div 
                      key={day} 
                      className={`cal-day ${day === 24 ? 'active' : ''} ${status === 'FUTURE' ? 'future' : ''}`}
                      onClick={() => status !== 'FUTURE' && setSelectedDateDetail(mockHistory.find(h => h.rawDate === `2026-09-${day.toString().padStart(2, '0')}`) || mockHistory[0])}
                    >
                      <span className="cal-date">{day}</span>
                      {status !== 'FUTURE' && status !== 'WEEK OFF' && status !== 'WORKING' && (
                        <div className="cal-dot" style={{ backgroundColor: getStatusColorCode(status) }}></div>
                      )}
                      {status === 'WORKING' && (
                        <div className="cal-dot pulse-dot" style={{ backgroundColor: 'var(--warning)' }}></div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Filters */}
          <div className="card" style={{ padding: '1rem' }}>
            <div className="filter-row">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)' }}>
                <Filter size={18} /> Filters
              </div>
              <select className="btn btn-outline" value={filterMode} onChange={(e) => setFilterMode(e.target.value)}>
                <option value="All">All Modes</option>
                <option value="OFFICE">Office</option>
                <option value="WFH">WFH</option>
              </select>
              <select className="btn btn-outline" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                <option value="All">All Statuses</option>
                <option value="Present">Present</option>
                <option value="Late">Late</option>
                <option value="Leave">Leave</option>
                <option value="Auto Logout">Auto Logout</option>
              </select>
              {(filterMode !== 'All' || filterStatus !== 'All') && (
                <button onClick={handleClearFilters} className="btn" style={{ color: 'var(--primary-600)', fontSize: '0.875rem' }}>Clear Filters</button>
              )}
            </div>
          </div>

          {/* History Table */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {loading ? (
              <div className="skeleton" style={{ height: '300px' }} />
            ) : filteredHistory.length === 0 ? (
              <div style={{ padding: '3rem 1rem', textAlign: 'center' }}>
                <div style={{ display: 'inline-flex', padding: '1rem', backgroundColor: 'var(--gray-100)', borderRadius: '50%', marginBottom: '1rem' }}>
                  <SearchIcon size={32} color="var(--gray-400)" />
                </div>
                <h3 style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--text-primary)' }}>No attendance records found</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1rem' }}>Try changing the selected month or clearing your filters.</p>
                <button onClick={handleClearFilters} className="btn btn-outline">Clear Filters</button>
              </div>
            ) : (
              <>
                <div className="mobile-cards">
                  {filteredHistory.map(row => (
                    <div key={row.id} className="mobile-hist-card" onClick={() => setSelectedDateDetail(row)}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                        <strong style={{ fontSize: '0.875rem' }}>{row.date}</strong>
                        <span className={`badge ${getStatusBadge(row.status)}`}>{row.status}</span>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                        {row.shift} • {row.mode}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem' }}>
                        <div>In: <strong>{row.in}</strong></div>
                        <div>Out: <strong>{row.out}{row.overnight && <span style={{color:'var(--primary-600)', fontSize:'0.75rem', marginLeft:'2px'}}>+1d</span>}</strong></div>
                      </div>
                    </div>
                  ))}
                </div>
                
                <div className="table-container desktop-table">
                  <table className="table" style={{ width: '100%', minWidth: '700px' }}>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Shift</th>
                        <th>In</th>
                        <th>Out</th>
                        <th>Break</th>
                        <th>Hours</th>
                        <th>Status</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredHistory.map((row) => (
                        <tr key={row.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedDateDetail(row)}>
                          <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{row.date}</td>
                          <td>
                            <div>{row.shift}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{row.mode}</div>
                          </td>
                          <td>{row.in}</td>
                          <td>
                            {row.out}
                            {row.overnight && <span style={{ color: 'var(--primary-600)', fontSize: '0.75rem', fontWeight: 600, marginLeft: '0.25rem' }}>+1 DAY</span>}
                            {row.autoLogout && (
                              <span title="Automatically logged out because the configured shift end time was reached without a manual clock-out." style={{ display: 'inline-flex', marginLeft: '0.25rem', color: 'var(--danger)', cursor: 'help' }}>
                                <Info size={14} />
                              </span>
                            )}
                          </td>
                          <td>{row.break}</td>
                          <td style={{ fontWeight: 500 }}>{row.hours}</td>
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
      </div>

      {/* Date Detail Drawer / Bottom Sheet */}
      {selectedDateDetail && (
        <div className="drawer-overlay" onClick={() => setSelectedDateDetail(null)}>
          <div className="drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Attendance Details</h2>
              <button className="icon-button" onClick={() => setSelectedDateDetail(null)}><X size={20} /></button>
            </div>
            <div className="drawer-body">
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', paddingBottom: '1.5rem', borderBottom: '1px solid var(--border-color)' }}>
                <div className="avatar">AK</div>
                <div>
                  <div style={{ fontWeight: 600 }}>Arun Kumar</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>EMP001</div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <div style={{ fontSize: '1.125rem', fontWeight: 600 }}>{selectedDateDetail.date}</div>
                <span className={`badge ${getStatusBadge(selectedDateDetail.status)}`}>{selectedDateDetail.status}</span>
              </div>

              <div className="detail-grid">
                <div className="detail-item">
                  <span className="detail-label">Shift</span>
                  <span className="detail-value">{selectedDateDetail.shift}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Work Mode</span>
                  <span className="detail-value">{selectedDateDetail.mode}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Scheduled Start</span>
                  <span className="detail-value">09:00 AM</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Scheduled End</span>
                  <span className="detail-value">06:00 PM</span>
                </div>
                
                <div className="detail-item highlight">
                  <span className="detail-label">Clock In</span>
                  <span className="detail-value">{selectedDateDetail.in}</span>
                </div>
                <div className="detail-item highlight">
                  <span className="detail-label">Clock Out</span>
                  <span className="detail-value">
                    {selectedDateDetail.out}
                    {selectedDateDetail.overnight && <span style={{ color: 'var(--primary-600)', fontSize: '0.75rem', fontWeight: 600, marginLeft: '4px' }}>(+1 Day)</span>}
                  </span>
                </div>
                
                <div className="detail-item">
                  <span className="detail-label">Break Duration</span>
                  <span className="detail-value">{selectedDateDetail.break}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Effective Hours</span>
                  <span className="detail-value" style={{ fontWeight: 700, color: 'var(--primary-700)' }}>{selectedDateDetail.hours}</span>
                </div>
                
                <div className="detail-item">
                  <span className="detail-label">Late</span>
                  <span className="detail-value" style={{ color: selectedDateDetail.lateMin > 0 ? 'var(--danger-600)' : 'inherit' }}>
                    {selectedDateDetail.lateMin} minutes
                  </span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Early Logout</span>
                  <span className="detail-value" style={{ color: selectedDateDetail.earlyMin > 0 ? 'var(--warning-600)' : 'inherit' }}>
                    {selectedDateDetail.earlyMin} minutes
                  </span>
                </div>
              </div>

              {selectedDateDetail.mode !== '-' && (
                <div style={{ marginTop: '1.5rem', backgroundColor: 'var(--gray-50)', padding: '1rem', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <MapPin size={16} /> Location Verification
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Location:</span>
                    <span style={{ fontWeight: 500, color: selectedDateDetail.mode === 'OFFICE' ? 'var(--success)' : 'var(--gray-600)' }}>
                      {selectedDateDetail.mode === 'OFFICE' ? 'Verified' : 'Not Required'}
                    </span>
                  </div>
                </div>
              )}
              
              {selectedDateDetail.autoLogout && (
                <div style={{ marginTop: '1rem', display: 'flex', gap: '0.75rem', backgroundColor: 'var(--danger-50)', padding: '1rem', borderRadius: 'var(--radius-md)', color: 'var(--danger)', fontSize: '0.875rem' }}>
                  <AlertCircle size={20} style={{ flexShrink: 0 }} />
                  Automatically logged out because the configured shift end time was reached without a manual clock-out.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Scoped CSS for complex parts of Attendance page */}
      <style>{`
        .summary-cards-scroll {
          display: flex;
          gap: 1rem;
          overflow-x: auto;
          padding-bottom: 0.5rem;
          scrollbar-width: thin;
        }
        
        
        
        
        .two-col-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 1.5rem;
        }
        @media (min-width: 1024px) {
          .two-col-grid {
            grid-template-columns: 1fr 1fr;
          }
        }

        /* Timeline */
        .timeline {
          position: relative;
          padding-left: 1.5rem;
        }
        .timeline::before {
          content: '';
          position: absolute;
          left: 7px;
          top: 8px;
          bottom: 8px;
          width: 2px;
          background-color: var(--border-color);
        }
        .tl-item {
          position: relative;
          margin-bottom: 1.5rem;
        }
        .tl-item:last-child { margin-bottom: 0; }
        .tl-dot {
          position: absolute;
          left: -1.5rem;
          top: 4px;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background-color: white;
          border: 4px solid var(--gray-300);
          z-index: 2;
        }
        .tl-dot.tl-neutral { border-color: var(--gray-300); }
        .tl-dot.tl-success { border-color: var(--success); }
        .tl-dot.tl-warning { border-color: var(--warning); }
        .tl-dot.tl-primary { border-color: var(--primary-500); }
        .tl-dot.tl-outline { background-color: var(--bg-surface); border-width: 2px; }
        .pulse-dot { animation: pulseTimeline 2s infinite; }
        @keyframes pulseTimeline {
          0% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.4); }
          70% { box-shadow: 0 0 0 8px rgba(99, 102, 241, 0); }
          100% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0); }
        }
        .tl-content {
          padding-top: 2px;
        }
        .tl-time {
          font-size: 0.75rem;
          color: var(--gray-500);
          margin-bottom: 0.25rem;
        }
        .tl-desc {
          font-size: 0.875rem;
          color: var(--gray-900);
        }

        /* Calendar */
        .cal-legend { display: flex; alignItems: center; gap: 0.25rem; font-size: 0.75rem; color: var(--gray-500); }
        .cal-legend span { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
        
        .calendar-grid {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          gap: 4px;
        }
        .cal-head {
          text-align: center;
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--gray-500);
          padding-bottom: 0.5rem;
        }
        .cal-day {
          aspect-ratio: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          border-radius: var(--radius-md);
          cursor: pointer;
          transition: all 0.2s;
          position: relative;
        }
        .cal-day:not(.empty):not(.future):hover {
          background-color: var(--gray-100);
        }
        .cal-day.active {
          background-color: var(--primary-50);
          border: 1px solid var(--primary-200);
        }
        .cal-day.future {
          color: var(--gray-300);
          cursor: default;
        }
        .cal-date { font-size: 0.875rem; font-weight: 500; }
        .cal-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          margin-top: 4px;
        }

        /* Filters */
        .filter-row {
          display: flex;
          gap: 1rem;
          flex-wrap: wrap;
          align-items: center;
        }
        .filter-row select { min-width: 130px; }

        /* Responsive Table vs Cards */
        .desktop-table { display: block; }
        .mobile-cards { display: none; }
        @media (max-width: 768px) {
          .desktop-table { display: none; }
          .mobile-cards { display: flex; flex-direction: column; }
          .mobile-hist-card {
            padding: 1rem;
            border-bottom: 1px solid var(--border-color);
            cursor: pointer;
          }
          .mobile-hist-card:active { background-color: var(--gray-50); }
        }

        /* Drawer / Bottom Sheet */
        .drawer-overlay {
          position: fixed;
          inset: 0;
          background-color: rgba(0,0,0,0.4);
          z-index: 100;
          display: flex;
          justify-content: flex-end;
        }
        .drawer {
          background-color: var(--bg-surface);
          width: 100%;
          max-width: 400px;
          height: 100%;
          display: flex;
          flex-direction: column;
          box-shadow: var(--shadow-xl);
          animation: slideInRight 0.3s forwards;
        }
        .drawer-header {
          padding: 1.5rem;
          border-bottom: 1px solid var(--border-color);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .drawer-body {
          padding: 1.5rem;
          overflow-y: auto;
          flex: 1;
        }
        
        .detail-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1rem;
        }
        .detail-item {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }
        .detail-item.highlight {
          background-color: var(--gray-50);
          padding: 0.75rem;
          border-radius: var(--radius-md);
        }
        .detail-label { font-size: 0.75rem; color: var(--gray-500); }
        .detail-value { font-size: 0.875rem; font-weight: 500; color: var(--gray-900); }

        @media (max-width: 768px) {
          .drawer-overlay {
            align-items: flex-end;
          }
          .drawer {
            height: 85vh;
            border-top-left-radius: var(--radius-xl);
            border-top-right-radius: var(--radius-xl);
            animation: slideUp 0.3s forwards;
          }
        }
        
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        @keyframes slideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        
        .skeleton {
          background: linear-gradient(90deg, var(--gray-200) 25%, var(--gray-100) 50%, var(--gray-200) 75%);
          background-size: 200% 100%;
          animation: skeleton-loading 1.5s infinite;
        }
        @keyframes skeleton-loading {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
};

// Dummy component just to satisfy the SearchIcon call above without importing it since I forgot
const SearchIcon = ({size, color}: any) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>;

export default EmployeeAttendance;


