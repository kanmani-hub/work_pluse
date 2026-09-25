import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Clock, Calendar, MapPin, Coffee, LogOut, CheckCircle2, 
  AlertTriangle, FileText, Home, ShieldAlert, ShieldCheck,
  RefreshCw, X, Camera, Map, User, Shield
} from 'lucide-react';

type AttendanceState = 'not_clocked_in' | 'working' | 'on_break' | 'clocked_out';

const EmployeeDashboard: React.FC = () => {
  const navigate = useNavigate();
  
  // Real-time date
  const [currentDate, setCurrentDate] = useState(new Date());
  
  // Attendance State
  const [attendanceState, setAttendanceState] = useState<AttendanceState>('not_clocked_in');
  
  // Modals
  const [showBreakModal, setShowBreakModal] = useState(false);
  const [showSecurityModal, setShowSecurityModal] = useState(false);
  
  // Timers (Mock)
  const [workTime, setWorkTime] = useState(0); // in seconds
  const [breakTime, setBreakTime] = useState(0); // in seconds

  // Security Simulator States
  const [simLocation, setSimLocation] = useState<'inside'|'outside'|'error'>('inside');
  const [simFace, setSimFace] = useState<'success'|'failed'|'not_registered'|'multiple'>('success');
  const [simWFH, setSimWFH] = useState(false);

  // Verification Flow States
  const [clockAction, setClockAction] = useState<'in'|'out'>('in');
  const [secStep, setSecStep] = useState<'init'|'location_check'|'location_failed'|'face_ready'|'face_detecting'|'face_failed'|'override'|'success'>('init');
  const [faceAttempts, setFaceAttempts] = useState(0);
  const [adminOverrideRequested, setAdminOverrideRequested] = useState(false);
  
  useEffect(() => {
    const timer = setInterval(() => setCurrentDate(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (attendanceState === 'working') {
      interval = setInterval(() => setWorkTime(t => t + 1), 1000);
    } else if (attendanceState === 'on_break') {
      interval = setInterval(() => setBreakTime(t => t + 1), 1000);
    }
    return () => clearInterval(interval);
  }, [attendanceState]);

  const formatTime = (totalSeconds: number) => {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleClockAction = (action: 'in' | 'out') => {
    setClockAction(action);
    setFaceAttempts(0);
    setAdminOverrideRequested(false);
    setShowSecurityModal(true);
    setSecStep('init');
    
    // Auto-start location check
    setTimeout(() => {
      setSecStep('location_check');
      setTimeout(() => {
        if (simWFH) {
          setSecStep('face_ready');
        } else if (simLocation === 'inside') {
          setSecStep('face_ready');
        } else {
          setSecStep('location_failed');
        }
      }, 1500);
    }, 500);
  };

  const retryLocation = () => {
    setSecStep('location_check');
    setTimeout(() => {
      if (simLocation === 'inside') setSecStep('face_ready');
      else setSecStep('location_failed');
    }, 1500);
  };

  const startFaceVerification = () => {
    setSecStep('face_detecting');
    setTimeout(() => {
      if (simFace === 'success') {
        setSecStep('success');
      } else {
        setFaceAttempts(prev => prev + 1);
        setSecStep('face_failed');
      }
    }, 2000);
  };

  const finalizeClockAction = () => {
    setShowSecurityModal(false);
    if (clockAction === 'in') {
      setAttendanceState('working');
    } else {
      setAttendanceState('clocked_out');
    }
  };

  const requestAdminOverride = () => {
    setAdminOverrideRequested(true);
    // Mocking an async request
    setTimeout(() => {
      alert("Override request sent to Admin.");
    }, 500);
  };

  const confirmBreak = () => {
    setShowBreakModal(false);
    setAttendanceState('on_break');
  };

  // --------------------------------------------------------
  // Reusable Security Status Component
  // --------------------------------------------------------
  const SecurityStatusSteps = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', backgroundColor: 'var(--gray-50)', padding: '1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--gray-200)', marginBottom: '1.5rem' }}>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '0.875rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          1. Shift
        </span>
        <span className="badge badge-success" style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}><CheckCircle2 size={12}/> Assigned</span>
      </div>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '0.875rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.5rem', color: secStep === 'init' ? 'var(--gray-400)' : 'inherit' }}>
          2. Location
        </span>
        {secStep === 'init' ? <span className="badge badge-gray">Pending</span> : 
         secStep === 'location_check' ? <span className="badge badge-warning" style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}><RefreshCw size={12} className="spin"/> Checking</span> :
         secStep === 'location_failed' ? <span className="badge badge-danger">Failed</span> :
         <span className="badge badge-success" style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}><CheckCircle2 size={12}/> Verified {simWFH && '(Bypassed)'}</span>
        }
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '0.875rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.5rem', color: ['init', 'location_check', 'location_failed'].includes(secStep) ? 'var(--gray-400)' : 'inherit' }}>
          3. Face Identity
        </span>
        {['init', 'location_check', 'location_failed'].includes(secStep) ? <span className="badge badge-gray">Pending</span> :
         secStep === 'face_ready' ? <span className="badge badge-primary" style={{ backgroundColor: 'var(--primary-100)', color: 'var(--primary-700)' }}>Ready</span> : 
         secStep === 'face_detecting' ? <span className="badge badge-warning" style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}><RefreshCw size={12} className="spin"/> Verifying</span> :
         secStep === 'face_failed' || secStep === 'override' ? <span className="badge badge-danger">Failed</span> :
         <span className="badge badge-success" style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}><CheckCircle2 size={12}/> Verified</span>
        }
      </div>

      <div style={{ borderTop: '1px solid var(--gray-200)', margin: '0.25rem 0' }} />
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>Action Status</span>
        {secStep === 'success' ? <span className="badge badge-success" style={{ fontSize: '0.875rem', padding: '0.25rem 0.5rem' }}>ALLOWED</span> :
         ['location_failed', 'face_failed', 'override'].includes(secStep) ? <span className="badge badge-danger" style={{ fontSize: '0.875rem', padding: '0.25rem 0.5rem' }}>BLOCKED</span> :
         <span className="badge badge-warning" style={{ fontSize: '0.875rem', padding: '0.25rem 0.5rem' }}>VERIFYING</span>
        }
      </div>

    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      
      {/* Header Greeting */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="page-title" style={{ marginBottom: '0.25rem' }}>Good Afternoon, Arun!</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            {currentDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
      </div>

      {/* Simulator Panel (For Prototype Reviewing) */}
      <div className="card" style={{ backgroundColor: 'var(--primary-900)', color: 'var(--bg-primary)', border: 'none', padding: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.5rem' }}>
          <ShieldAlert size={18} color="var(--warning-400)" />
          <h3 style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600, color: 'var(--warning-400)' }}>PROTOTYPE SECURITY SIMULATOR</h3>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem' }}>
          <div>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase' }}>Mock Location State</div>
            <select className="form-control" value={simLocation} onChange={e => setSimLocation(e.target.value as any)}>
              <option value="inside" style={{ color: 'var(--text-primary)' }}>Inside Office Geofence</option>
              <option value="outside" style={{ color: 'var(--text-primary)' }}>Outside Office Geofence</option>
              <option value="error" style={{ color: 'var(--text-primary)' }}>Location Unavailable / Error</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase' }}>Mock Face Verification State</div>
            <select className="form-control" value={simFace} onChange={e => setSimFace(e.target.value as any)}>
              <option value="success" style={{ color: 'var(--text-primary)' }}>Match Successful</option>
              <option value="failed" style={{ color: 'var(--text-primary)' }}>Match Failed</option>
              <option value="not_registered" style={{ color: 'var(--text-primary)' }}>Not Registered</option>
              <option value="multiple" style={{ color: 'var(--text-primary)' }}>Multiple Faces Detected</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase' }}>Work Mode Settings</div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-primary)', cursor: 'pointer' }}>
              <input type="checkbox" checked={simWFH} onChange={e => setSimWFH(e.target.checked)} />
              Simulate Approved WFH
            </label>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>(Bypasses office geofence)</div>
          </div>
        </div>
      </div>

      {/* Main Grid: Shift & Clock Card vs Quick Actions */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
        
        {/* Left Column: Shift & Attendance */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Today's Shift Card */}
          <div className="card">
            <div className="card-header" style={{ marginBottom: '1rem' }}>
              <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Calendar size={18} className="nav-icon" />
                Today's Shift
              </h3>
              <span className="badge badge-primary">Evening Shift</span>
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Shift Timing</div>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>2:00 PM — 11:00 PM</div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Required Hours</div>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>8 hours</div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Assigned Office</div>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Chennai Office</div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Work Mode</div>
                <div style={{ fontWeight: 600, color: simWFH ? 'var(--primary-600)' : 'var(--gray-900)' }}>{simWFH ? 'WFH (Approved)' : 'OFFICE'}</div>
              </div>
            </div>

            <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)', display: 'flex', gap: '1rem', fontSize: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: 'var(--success)' }}><CheckCircle2 size={14}/> Location Configured</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: simFace === 'not_registered' ? 'var(--danger-600)' : 'var(--success)' }}>
                {simFace === 'not_registered' ? <ShieldAlert size={14}/> : <ShieldCheck size={14}/>} 
                Face {simFace === 'not_registered' ? 'Not Registered' : 'Registered'}
              </div>
            </div>
          </div>

          {/* Attendance / Clock Card */}
          <div className="card" style={{ borderTop: '4px solid var(--primary-600)' }}>
            <div style={{ textAlign: 'center', padding: '1rem 0' }}>
              <div style={{ fontSize: '2.5rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.5rem', fontVariantNumeric: 'tabular-nums' }}>
                {currentDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </div>
              
              {/* Not Clocked In */}
              {attendanceState === 'not_clocked_in' && (
                <>
                  <div style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontWeight: 500 }}>Status: Not Clocked In</div>
                  <button onClick={() => handleClockAction('in')} className="btn btn-primary" style={{ width: '100%', padding: '1rem', fontSize: '1.125rem', borderRadius: 'var(--radius-full)' }}>
                    <ShieldCheck size={20} />
                    Secure Clock In
                  </button>
                </>
              )}

              {/* Working */}
              {attendanceState === 'working' && (
                <>
                  <div style={{ color: 'var(--success)', marginBottom: '0.5rem', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--success)', animation: 'pulse 2s infinite' }} />
                    WORKING
                  </div>
                  <div style={{ color: 'var(--text-primary)', fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem', fontVariantNumeric: 'tabular-nums' }}>
                    {formatTime(workTime)}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <button onClick={() => setShowBreakModal(true)} className="btn btn-outline" style={{ padding: '0.75rem', borderRadius: 'var(--radius-full)' }}>
                      <Coffee size={18} />
                      Start Break
                    </button>
                    <button onClick={() => handleClockAction('out')} className="btn" style={{ padding: '0.75rem', borderRadius: 'var(--radius-full)', backgroundColor: 'var(--danger)', color: 'var(--bg-primary)' }}>
                      <ShieldCheck size={18} />
                      Secure Clock Out
                    </button>
                  </div>
                </>
              )}

              {/* On Break */}
              {attendanceState === 'on_break' && (
                <>
                  <div style={{ color: 'var(--warning)', marginBottom: '0.5rem', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                    <Coffee size={16} />
                    ON BREAK
                  </div>
                  <div style={{ color: 'var(--text-primary)', fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem', fontVariantNumeric: 'tabular-nums' }}>
                    {formatTime(breakTime)}
                  </div>
                  <button onClick={() => setAttendanceState('working')} className="btn btn-primary" style={{ width: '100%', padding: '1rem', fontSize: '1.125rem', borderRadius: 'var(--radius-full)' }}>
                    Resume Work
                  </button>
                </>
              )}

              {/* Clocked Out */}
              {attendanceState === 'clocked_out' && (
                <>
                  <div style={{ color: 'var(--text-secondary)', marginBottom: '0.5rem', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                    <CheckCircle2 size={16} />
                    CLOCKED OUT
                  </div>
                  <div style={{ color: 'var(--text-primary)', fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem', fontVariantNumeric: 'tabular-nums' }}>
                    Total: {formatTime(workTime)}
                  </div>
                  <div className="badge badge-success" style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}>Shift Completed</div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Summaries & Quick Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Quick Actions */}
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: '1rem', fontSize: '1rem' }}>Quick Actions</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.75rem' }}>
              <button onClick={() => navigate('/employee/leave')} className="btn btn-outline" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '1rem' }}>
                <Calendar size={24} className="nav-icon" />
                Apply Leave
              </button>
              <button onClick={() => navigate('/employee/wfh')} className="btn btn-outline" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '1rem' }}>
                <Home size={24} className="nav-icon" />
                Request WFH
              </button>
              <button onClick={() => navigate('/employee/permission')} className="btn btn-outline" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '1rem' }}>
                <Clock size={24} className="nav-icon" />
                Permission
              </button>
              <button onClick={() => navigate('/employee/payslip')} className="btn btn-outline" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '1rem' }}>
                <FileText size={24} className="nav-icon" />
                View Payslip
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Security Flow Modals */}
      
      {/* Break Modal (Simple non-secure) */}
      {showBreakModal && (
        <div className="drawer-overlay" style={{ alignItems: 'center' }}>
          <div className="card" style={{ width: '100%', maxWidth: '360px', textAlign: 'center', animation: 'slideUp 0.3s' }}>
            <div style={{ width: '48px', height: '48px', backgroundColor: 'var(--warning-50)', color: 'var(--warning)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem auto' }}>
              <Coffee size={24} />
            </div>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>Start Break?</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>Your working timer will be paused.</p>
            
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button onClick={() => setShowBreakModal(false)} className="btn btn-outline" style={{ flex: 1 }}>Cancel</button>
              <button onClick={confirmBreak} className="btn" style={{ flex: 1, backgroundColor: 'var(--warning)', color: 'var(--bg-primary)' }}>Start Break</button>
            </div>
          </div>
        </div>
      )}

      {/* Secure Clock In/Out Modal */}
      {showSecurityModal && (
        <div className="drawer-overlay" style={{ alignItems: 'center' }}>
          <div className="card" style={{ width: '100%', maxWidth: '500px', animation: 'slideUp 0.3s', padding: 0, overflow: 'hidden' }}>
            
            <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <ShieldCheck size={20} color="var(--primary-600)"/>
                Secure {clockAction === 'in' ? 'Clock In' : 'Clock Out'}
              </h2>
              <button className="icon-button" onClick={() => setShowSecurityModal(false)}><X size={20}/></button>
            </div>

            <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              
              <SecurityStatusSteps />

              {/* Dynamic Content Area based on Step */}
              
              {/* Location Processing */}
              {(secStep === 'init' || secStep === 'location_check') && (
                <div style={{ textAlign: 'center', padding: '2rem 0' }}>
                  <Map size={48} color="var(--primary-300)" style={{ margin: '0 auto 1rem auto', animation: 'pulse 2s infinite' }} />
                  <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.5rem' }}>Checking Location...</h3>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Verifying you are within the {simWFH ? 'authorized work' : 'assigned office'} area.</p>
                </div>
              )}

              {/* Location Failed */}
              {secStep === 'location_failed' && (
                <div style={{ textAlign: 'center', padding: '1rem 0' }}>
                  <div style={{ width: '64px', height: '64px', backgroundColor: 'var(--danger-50)', color: 'var(--danger)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem auto' }}>
                    <MapPin size={32} />
                  </div>
                  <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--danger)' }}>
                    {simLocation === 'outside' ? 'Outside Assigned Office' : 'Location Unavailable'}
                  </h3>
                  {simLocation === 'outside' ? (
                    <>
                      <p style={{ color: 'var(--gray-700)', fontSize: '0.875rem', marginBottom: '1rem' }}>You are currently outside the allowed office location.</p>
                      <div style={{ backgroundColor: 'var(--gray-50)', padding: '0.75rem', borderRadius: 'var(--radius-md)', display: 'inline-block', marginBottom: '1rem', textAlign: 'left', border: '1px solid var(--gray-200)' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Current Distance: <strong style={{ color: 'var(--danger-600)' }}>482m</strong></div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Allowed Radius: <strong>200m</strong></div>
                      </div>
                      <p style={{ color: 'var(--danger-600)', fontSize: '0.875rem', fontWeight: 600 }}>Move inside the assigned office location to continue.</p>
                    </>
                  ) : (
                    <p style={{ color: 'var(--gray-700)', fontSize: '0.875rem', marginBottom: '1rem' }}>We could not verify your location. Please check your browser/device permissions.</p>
                  )}
                  
                  <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
                    <button onClick={() => setShowSecurityModal(false)} className="btn btn-outline" style={{ flex: 1 }}>Cancel</button>
                    <button onClick={retryLocation} className="btn btn-primary" style={{ flex: 1 }}>Retry Location</button>
                  </div>
                </div>
              )}

              {/* Face Ready */}
              {secStep === 'face_ready' && (
                <div style={{ textAlign: 'center', padding: '1rem 0' }}>
                  <div style={{ width: '64px', height: '64px', backgroundColor: 'var(--primary-50)', color: 'var(--primary-600)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem auto' }}>
                    <User size={32} />
                  </div>
                  <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>Verify Your Identity</h3>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>Look at the camera to verify your identity before clocking {clockAction}.</p>
                  
                  <div style={{ position: 'relative', width: '200px', height: '260px', backgroundColor: 'var(--text-primary)', borderRadius: '50% 50% 40% 40%', margin: '0 auto 1.5rem auto', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                     <div style={{ color: 'var(--bg-primary)', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                       <Camera size={16}/> Camera Ready
                     </div>
                  </div>

                  <div style={{ display: 'flex', gap: '1rem' }}>
                    <button onClick={() => setShowSecurityModal(false)} className="btn btn-outline" style={{ flex: 1 }}>Cancel</button>
                    <button onClick={startFaceVerification} className="btn btn-primary" style={{ flex: 1 }}>Verify Face</button>
                  </div>
                </div>
              )}

              {/* Face Detecting */}
              {secStep === 'face_detecting' && (
                <div style={{ textAlign: 'center', padding: '1rem 0' }}>
                  <div style={{ position: 'relative', width: '200px', height: '260px', backgroundColor: 'var(--text-primary)', borderRadius: '50% 50% 40% 40%', margin: '0 auto 1.5rem auto', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                     <div style={{ position: 'absolute', inset: 0, border: '4px solid var(--warning)', borderRadius: '50% 50% 40% 40%', animation: 'pulse 1s infinite' }} />
                     <div style={{ color: 'var(--warning-400)', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem', zIndex: 10 }}>
                       <RefreshCw size={16} className="spin"/> Comparing profile...
                     </div>
                  </div>
                </div>
              )}

              {/* Face Failed */}
              {secStep === 'face_failed' && (
                <div style={{ textAlign: 'center', padding: '1rem 0' }}>
                  <div style={{ width: '64px', height: '64px', backgroundColor: 'var(--danger-50)', color: 'var(--danger)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem auto' }}>
                    <ShieldAlert size={32} />
                  </div>
                  <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--danger)' }}>
                    {simFace === 'not_registered' ? 'Face Profile Not Registered' : 
                     simFace === 'multiple' ? 'Multiple Faces Detected' : 
                     'Face Verification Failed'}
                  </h3>
                  
                  <p style={{ color: 'var(--gray-700)', fontSize: '0.875rem', marginBottom: '1rem' }}>
                    {simFace === 'not_registered' ? 'You must register a face profile with HR before using secure clock in.' : 
                     simFace === 'multiple' ? 'Ensure only you are visible in the camera frame.' : 
                     'We could not match your face to the registered profile. Please ensure good lighting and try again.'}
                  </p>
                  
                  {simFace !== 'not_registered' && (
                    <div style={{ fontSize: '0.875rem', color: 'var(--danger-600)', fontWeight: 600, marginBottom: '1.5rem' }}>
                      Attempt {faceAttempts} of 3
                    </div>
                  )}

                  {faceAttempts >= 3 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      <div style={{ backgroundColor: 'var(--danger-50)', color: 'var(--danger-800)', padding: '0.75rem', borderRadius: 'var(--radius-md)', fontSize: '0.875rem', border: '1px solid var(--danger-200)' }}>
                        Verification Temporarily Blocked. Exceeded maximum attempts.
                      </div>
                      <button onClick={() => setSecStep('override')} className="btn btn-outline" style={{ borderColor: 'var(--gray-400)' }}>Request Admin Override</button>
                      <button onClick={() => setShowSecurityModal(false)} className="btn btn-outline">Close</button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: '1rem' }}>
                      <button onClick={() => setShowSecurityModal(false)} className="btn btn-outline" style={{ flex: 1 }}>Cancel</button>
                      <button onClick={() => setSecStep('face_ready')} className="btn btn-primary" style={{ flex: 1 }}>Try Again</button>
                    </div>
                  )}
                </div>
              )}

              {/* Admin Override Request */}
              {secStep === 'override' && (
                <div style={{ textAlign: 'center', padding: '1rem 0' }}>
                  <ShieldAlert size={48} color="var(--warning)" style={{ margin: '0 auto 1rem auto' }} />
                  <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>Request Admin Override</h3>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>An administrator can manually approve your clock {clockAction} request.</p>
                  
                  <div style={{ textAlign: 'left', marginBottom: '1.5rem' }}>
                    <label className="form-label" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: 500 }}>Reason for override (Required)</label>
                    <textarea className="form-control" rows={3} placeholder="E.g., Camera broken, poor lighting in current room..." style={{ width: '100%', resize: 'none', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', outline: 'none' }}></textarea>
                  </div>

                  <div style={{ display: 'flex', gap: '1rem' }}>
                    <button onClick={() => setShowSecurityModal(false)} className="btn btn-outline" style={{ flex: 1 }}>Cancel</button>
                    <button onClick={requestAdminOverride} disabled={adminOverrideRequested} className="btn btn-primary" style={{ flex: 1, backgroundColor: 'var(--warning)', color: 'var(--bg-primary)', border: 'none' }}>
                      {adminOverrideRequested ? 'Request Sent' : 'Submit Request'}
                    </button>
                  </div>
                </div>
              )}

              {/* Success */}
              {secStep === 'success' && (
                <div style={{ textAlign: 'center', padding: '1rem 0' }}>
                  <div style={{ width: '80px', height: '80px', backgroundColor: 'var(--success-50)', color: 'var(--success)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem auto' }}>
                    <CheckCircle2 size={40} />
                  </div>
                  <h3 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
                    Clock {clockAction === 'in' ? 'In' : 'Out'} Successful
                  </h3>
                  <div style={{ backgroundColor: 'var(--gray-50)', padding: '1rem', borderRadius: 'var(--radius-md)', margin: '1rem auto 2rem auto', textAlign: 'left', border: '1px solid var(--gray-200)', maxWidth: '300px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                      <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Time:</span>
                      <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>{currentDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                      <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Office:</span>
                      <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>{simWFH ? 'WFH' : 'Chennai Office'}</span>
                    </div>
                    {clockAction === 'out' && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--gray-200)', paddingTop: '0.5rem', marginTop: '0.5rem' }}>
                        <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Total Hours:</span>
                        <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--primary-700)' }}>{formatTime(workTime)}</span>
                      </div>
                    )}
                  </div>
                  
                  <button onClick={finalizeClockAction} className="btn btn-primary" style={{ width: '100%', maxWidth: '300px' }}>Done</button>
                </div>
              )}

            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.7); }
          70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(34, 197, 94, 0); }
          100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
        }
        .drawer-overlay { position: fixed; inset: 0; background-color: rgba(0,0,0,0.5); z-index: 100; display: flex; justify-content: center; padding: 1rem; }
        @keyframes slideUp { from { transform: translateY(50px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};

export default EmployeeDashboard;




