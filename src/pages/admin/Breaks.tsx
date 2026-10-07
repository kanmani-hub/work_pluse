import React, { useState, useEffect } from 'react';
import { useGlobalSettings } from '../../services/settings/globalSettingsService';
import { breakService } from '../../services/attendance/breakService';
import { realtimeService } from '../../services/realtime/realtimeService';
import { Coffee, Search, Clock, FileText } from 'lucide-react';

const AdminBreaks: React.FC = () => {
  const { settings } = useGlobalSettings();
  const appSettings = settings.app;
  const payrollSettings = settings.payroll;
  
  const [breaks, setBreaks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [filterDate, setFilterDate] = useState(() => {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  });
  
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);

  const fetchBreaks = async () => {
    setLoading(true);
    const { data, error } = await breakService.getBreakReport(filterDate);
    if (data) {
      setBreaks(data); // data is now an array of attendance records
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchBreaks();
    const subscription = realtimeService.subscribeToAdminBreaks(() => {
      fetchBreaks();
    });
    return () => {
      realtimeService.unsubscribe(subscription);
    };
  }, [filterDate]);

  // Aggregate breaks per employee per attendance day
  const employeeBreakSummary = React.useMemo(() => {
    return breaks.map(att => {
      const allowedMins = att.shift_template?.break_duration_minutes ?? appSettings.breakDurationMins ?? 75;
      
      let totalMins = 0;
      let activeCount = 0;
      
      const sessions = (att.attendance_breaks || []).map((b: any) => {
        let duration = 0;
        if (b.duration_minutes !== null) {
          duration = b.duration_minutes;
        } else if (b.started_at && !b.ended_at) {
          // If active, compute current elapsed based on Asia/Kolkata timezone
          duration = Math.floor((new Date().getTime() - new Date(b.started_at).getTime()) / 60000);
          activeCount += 1;
        }
        totalMins += duration;
        return { ...b, computed_duration: duration };
      });
      
      const excessMins = Math.max(0, totalMins - allowedMins);
      const isDeductionApplicable = excessMins > 0 && payrollSettings?.enableBreakOverrunDeduction;
      
      let status = 'Within Limit';
      if (activeCount > 0) status = 'Currently On Break';
      else if (excessMins > 0) status = 'Excess Break';
      
      return {
        employee_id: att.employee_id,
        attendance_id: att.id,
        employee: att.employees,
        attendance: att,
        allowedMins,
        totalMins,
        activeCount,
        sessions,
        excessMins,
        status,
        isDeductionApplicable
      };
    });
  }, [breaks, appSettings, payrollSettings]);

  // Apply Filters
  const filteredSummary = employeeBreakSummary.filter(s => {
    if (filterStatus === 'EXCESS' && s.excessMins === 0) return false;
    if (filterStatus === 'WITHIN' && s.excessMins > 0) return false;
    return true;
  });

  const selectedDetails = employeeBreakSummary.find(s => s.employee_id === selectedEmployee);

  const formatTime = (isoString: string) => {
    return new Date(isoString).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="page-container">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="page-title">Break Management</h1>
          <p className="page-subtitle">Monitor employee break sessions and excess durations.</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '200px' }}>
            <label className="form-label">Date</label>
            <input 
              type="date" 
              className="form-control" 
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
            />
          </div>
          <div style={{ flex: 1, minWidth: '200px' }}>
            <label className="form-label">Status Filter</label>
            <select className="form-select" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="ALL">All Break Statuses</option>
              <option value="WITHIN">Within Limit</option>
              <option value="EXCESS">Excess Break</option>
            </select>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selectedEmployee ? '2fr 1fr' : '1fr', gap: '1.5rem' }}>
        
        {/* Main Table */}
        <div className="card">
          <div className="table-responsive">
            <table className="table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Shift</th>
                  <th>Allowed</th>
                  <th>Total Break</th>
                  <th>Excess</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: '3rem' }}>
                      <div className="spinner" style={{ margin: '0 auto' }}></div>
                    </td>
                  </tr>
                ) : filteredSummary.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                      No break records found for this date.
                    </td>
                  </tr>
                ) : (
                  filteredSummary.map(s => (
                    <tr key={`${s.employee_id}_${s.attendance_id}`}>
                      <td>
                        <div style={{ fontWeight: 500 }}>{s.employee?.first_name} {s.employee?.last_name}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{s.employee?.employee_code} • {s.employee?.departments?.name}</div>
                      </td>
                      <td>
                        <span className="badge badge-primary">{s.attendance?.shift_template?.name || 'Standard'}</span>
                      </td>
                      <td>{s.allowedMins} min</td>
                      <td>
                        <span style={{ fontWeight: 600, color: s.excessMins > 0 ? 'var(--danger)' : 'inherit' }}>
                          {s.totalMins} min
                        </span>
                      </td>
                      <td>
                        <span style={{ fontWeight: 600, color: s.excessMins > 0 ? 'var(--danger)' : 'var(--text-secondary)' }}>
                          {s.excessMins} min
                        </span>
                      </td>
                      <td>
                        {s.status === 'Currently On Break' ? (
                          <span className="badge badge-warning">{s.status}</span>
                        ) : s.excessMins > 0 ? (
                          <span className="badge badge-danger">Excess</span>
                        ) : (
                          <span className="badge badge-success">Within Limit</span>
                        )}
                      </td>
                      <td>
                        <button 
                          className="btn btn-outline" 
                          style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem' }}
                          onClick={() => setSelectedEmployee(s.employee_id)}
                        >
                          View Details
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Details Pane */}
        {selectedDetails && (
          <div className="card" style={{ alignSelf: 'start', position: 'sticky', top: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <FileText size={18} />
                Break Details
              </h3>
              <button className="icon-button" onClick={() => setSelectedEmployee(null)}>×</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
              <div style={{ paddingBottom: '0.75rem', borderBottom: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Employee</div>
                <div style={{ fontWeight: 600, fontSize: '1.125rem' }}>{selectedDetails.employee?.first_name} {selectedDetails.employee?.last_name}</div>
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Allowed Break</div>
                  <div style={{ fontWeight: 600 }}>{selectedDetails.allowedMins} min</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Total Used</div>
                  <div style={{ fontWeight: 600, color: selectedDetails.excessMins > 0 ? 'var(--danger)' : 'inherit' }}>{selectedDetails.totalMins} min</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Excess</div>
                  <div style={{ fontWeight: 600, color: selectedDetails.excessMins > 0 ? 'var(--danger)' : 'inherit' }}>{selectedDetails.excessMins} min</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Deduction</div>
                  <div style={{ fontWeight: 600, color: selectedDetails.isDeductionApplicable ? 'var(--danger)' : 'var(--text-secondary)' }}>
                    {selectedDetails.isDeductionApplicable ? 'Applicable' : '₹0'}
                  </div>
                </div>
              </div>
            </div>

            <h4 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '1rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Sessions</h4>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {selectedDetails.sessions.map((session: any, i: number) => (
                <div key={session.id} style={{ padding: '0.75rem', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
                    <span style={{ fontWeight: 600 }}>Session {i + 1}</span>
                    {session.ended_at ? (
                      <span className="badge badge-success" style={{ fontSize: '0.7rem' }}>Completed</span>
                    ) : (
                      <span className="badge badge-warning" style={{ fontSize: '0.7rem' }}>Active</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem' }}>
                    <div>
                      {formatTime(session.started_at)} → {session.ended_at ? formatTime(session.ended_at) : 'Now'}
                    </div>
                    <div style={{ fontWeight: 600 }}>
                      {session.computed_duration} min
                    </div>
                  </div>
                </div>
              ))}
            </div>

          </div>
        )}

      </div>
    </div>
  );
};

export default AdminBreaks;
