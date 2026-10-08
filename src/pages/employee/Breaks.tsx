import React, { useState, useEffect } from 'react';
import { useGlobalSettings } from '../../services/settings/globalSettingsService';
import { breakService } from '../../services/attendance/breakService';
import { attendanceService } from '../../services/attendance/attendanceService';
import { realtimeService } from '../../services/realtime/realtimeService';
import { Coffee, Clock, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { companyDateStr } from '../../utils/companyDate';

const EmployeeBreaks: React.FC = () => {
  const { settings } = useGlobalSettings();
  const { user } = useAuth();
  const appSettings = settings.app;
  const payrollSettings = settings.payroll;
  
  const [breaks, setBreaks] = useState<any[]>([]);
  const [attendance, setAttendance] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(new Date());

  const getLocalDateStr = () => companyDateStr();

  const fetchBreaks = async () => {
    setLoading(true);
    const dateStr = getLocalDateStr();
    
    // Fetch today's attendance to get the shift information
    const { data: att } = await attendanceService.getCurrentAttendance();
    setAttendance(att);

    const { data, error } = await breakService.getMyBreaks((att as any)?.attendance_date ?? dateStr);
    if (data) {
      setBreaks(data);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchBreaks();

    const employeeId = user?.id; // Assuming auth user id resolves to employee id in realtimeService internally if we map it, wait, subscribeToMyBreaks takes employeeId. Let's fetch employeeId.
    let subscription: any;
    
    attendanceService.getCurrentEmployeeId().then(empId => {
      if (empId) {
        subscription = realtimeService.subscribeToMyBreaks(empId, () => {
          fetchBreaks();
        });
      }
    });

    return () => {
      if (subscription) realtimeService.unsubscribe(subscription);
    };
  }, [user]);

  // Real-time timer for active break
  useEffect(() => {
    const timer = setInterval(() => setCurrentDate(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (isoString: string) => {
    return new Date(isoString).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  const allowedBreakMins = attendance?.shift_template?.break_duration_minutes ?? appSettings.breakDurationMins ?? 75;
  
  let totalBreakMins = 0;
  let activeBreakElapseMins = 0;
  let isActive = false;

  breaks.forEach(b => {
    if (b.duration_minutes) {
      totalBreakMins += b.duration_minutes;
    } else if (b.started_at && !b.ended_at) {
      isActive = true;
      const startIso = new Date(b.started_at).getTime();
      const currentMs = currentDate.getTime();
      activeBreakElapseMins = Math.floor((currentMs - startIso) / 60000);
      totalBreakMins += activeBreakElapseMins;
    }
  });

  const excessMins = Math.max(0, totalBreakMins - allowedBreakMins);
  
  // Salary deduction info
  // Assuming month = 25 days, 8 hours a day, so hourly is just an example for UI or we just state it is applicable.
  // The client requested: "Salary deduction status if applicable"
  
  const isDeductionApplicable = excessMins > 0 && payrollSettings?.enableBreakOverrunDeduction;

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">My Breaks</h1>
          <p className="page-subtitle">Track your break durations and limits for {getLocalDateStr()}</p>
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
           <div className="spinner"></div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
          
          {/* Summary Card */}
          <div className="card">
            <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem' }}>
              <Coffee size={20} className="nav-icon" />
              Today's Break Summary
            </h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border-color)' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Shift Name</span>
                <span style={{ fontWeight: 500 }}>{attendance?.shift_template?.name || 'Standard Shift'}</span>
              </div>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border-color)' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Allowed Break</span>
                <span style={{ fontWeight: 500 }}>{allowedBreakMins} min</span>
              </div>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border-color)' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Used Break</span>
                <span style={{ fontWeight: 600, color: excessMins > 0 ? 'var(--danger)' : 'var(--text-primary)' }}>
                  {totalBreakMins} min
                </span>
              </div>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border-color)' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Remaining</span>
                <span style={{ fontWeight: 500 }}>{Math.max(0, allowedBreakMins - totalBreakMins)} min</span>
              </div>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border-color)' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Excess</span>
                <span style={{ fontWeight: 600, color: excessMins > 0 ? 'var(--danger)' : 'var(--success)' }}>
                  {excessMins} min
                </span>
              </div>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border-color)' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Status</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  {isActive ? (
                    <span className="badge badge-warning">Currently On Break</span>
                  ) : excessMins > 0 ? (
                    <span className="badge badge-danger">Excess Break</span>
                  ) : (
                    <span className="badge badge-success">Within Limit</span>
                  )}
                </span>
              </div>
              
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Salary Deduction</span>
                <span style={{ fontWeight: 500, color: isDeductionApplicable ? 'var(--danger)' : 'var(--success)' }}>
                  {isDeductionApplicable ? 'Applicable' : 'Not Applicable'}
                </span>
              </div>
            </div>
            
            {isActive && (
              <div style={{ marginTop: '1.5rem', padding: '1rem', backgroundColor: 'var(--warning-50)', borderRadius: 'var(--radius-md)', border: '1px solid var(--warning-200)', textAlign: 'center' }}>
                <div style={{ color: 'var(--warning-800)', fontWeight: 600, marginBottom: '0.5rem' }}>Active Break Elapsed</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--warning-900)' }}>
                  {activeBreakElapseMins} min
                </div>
              </div>
            )}
            
            {isDeductionApplicable && (
              <div style={{ marginTop: '1.5rem', padding: '1rem', backgroundColor: 'var(--danger-50)', borderRadius: 'var(--radius-md)', border: '1px solid var(--danger-200)', display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                <AlertTriangle size={18} color="var(--danger-600)" style={{ marginTop: '0.125rem' }} />
                <div style={{ fontSize: '0.875rem', color: 'var(--danger-800)' }}>
                  <strong>Salary Deduction:</strong> You have exceeded the allowed break duration by {excessMins} minutes. This excess time is subject to a salary deduction in payroll.
                </div>
              </div>
            )}
          </div>
          
          {/* Break Records List */}
          <div className="card">
            <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem' }}>
              <Clock size={20} className="nav-icon" />
              Individual Break Records
            </h3>
            
            {breaks.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--text-secondary)' }}>
                <Coffee size={48} style={{ opacity: 0.2, margin: '0 auto 1rem auto' }} />
                No break records for today.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {breaks.map((b, index) => (
                  <div key={b.id} style={{ padding: '1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                      <span style={{ fontWeight: 600 }}>Break {index + 1}</span>
                      {!b.ended_at ? (
                        <span className="badge badge-warning">Active</span>
                      ) : (
                        <span className="badge badge-success">Completed</span>
                      )}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', fontSize: '0.875rem' }}>
                      <div>
                        <div style={{ color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Start</div>
                        <div style={{ fontWeight: 500 }}>{formatTime(b.started_at)}</div>
                      </div>
                      <div>
                        <div style={{ color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>End</div>
                        <div style={{ fontWeight: 500 }}>{b.ended_at ? formatTime(b.ended_at) : '--:--'}</div>
                      </div>
                      <div>
                        <div style={{ color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Duration</div>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                          {b.duration_minutes !== null ? `${b.duration_minutes} min` : `${Math.floor((currentDate.getTime() - new Date(b.started_at).getTime()) / 60000)} min`}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          
        </div>
      )}
    </div>
  );
};

export default EmployeeBreaks;
