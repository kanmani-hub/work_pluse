import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useGlobalSettings } from '../../services/settings/globalSettingsService';
import { useNavigate } from 'react-router-dom';
import { 
  Clock, Calendar, MapPin, Coffee, LogOut, CheckCircle2, 
  AlertTriangle, FileText, Home, ShieldAlert, ShieldCheck,
  RefreshCw, X, Camera, Map, User, Shield
} from 'lucide-react';
import { attendanceService } from '../../services/attendance/attendanceService';
import { breakService } from '../../services/attendance/breakService';
import { faceService } from '../../services/face/faceService';
import { locationService } from '../../services/location/locationService';
import { supabase } from '../../lib/supabase';
import { qaTimeService } from '../../services/qa/qaTimeService';
import { computeWorkTimer, findActiveBreak, resolveAllowedBreakMinutes } from '../../services/attendance/breakRules';

type AttendanceState = 'not_clocked_in' | 'working' | 'on_break' | 'clocked_out';

const EmployeeDashboard: React.FC = () => {
  const { settings } = useGlobalSettings();
  const appSettings = settings.app;
  const payrollSettings = settings.payroll;

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
  const [todayBreaks, setTodayBreaks] = useState<any[]>([]);

  // Verification Flow States
  const [clockAction, setClockAction] = useState<'in'|'out'>('in');
  const [secStep, setSecStep] = useState<'init'|'location_check'|'location_failed'|'face_ready'|'face_detecting'|'face_failed'|'override'|'success'>('init');
  const [faceAttempts, setFaceAttempts] = useState(0);
  const [adminOverrideRequested, setAdminOverrideRequested] = useState(false);
  const [verificationEventId, setVerificationEventId] = useState<string | undefined>(undefined);
  const [locVerificationEventId, setLocVerificationEventId] = useState<string | undefined>(undefined);

  // Camera Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  useEffect(() => {
    return () => stopCamera();
  }, []);
  
  const [attendanceRecord, setAttendanceRecord] = useState<any>(null);
  const [currentShift, setCurrentShift] = useState<any>(null);
  const [loadingAttendance, setLoadingAttendance] = useState(true);

  useEffect(() => {
    const timer = setInterval(() => setCurrentDate(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    fetchTodayAttendance();

    attendanceService.getCurrentEmployeeId().then(empId => {
      if (!empId) return;
      
      // QA-only helper (VITE_QA_FAST_MODE): it can back-date breaks, so it must not exist in normal builds
      if (qaTimeService.isEnabled) {
        (window as any)._testAutoBreak = async (action: 'START' | 'END', pastMins: number = 0) => {
            const time = new Date(Date.now() - pastMins * 60000).toISOString();
            await breakService.handleAutoBreakTransition(empId, action, time);
            console.log(`Test Auto Break ${action} triggered at ${time}`);
        };
      }
      
      const channel = supabase.channel('dashboard_attendance')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'attendance', filter: `employee_id=eq.${empId}` },
          () => {
            fetchTodayAttendance();
          }
        )
        .subscribe();
      
      return () => {
        supabase.removeChannel(channel);
      };
    });
  }, []);

  const getLocalDateStr = () => {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  };

  const fetchTodayAttendance = async () => {
    setLoadingAttendance(true);
    const dateStr = getLocalDateStr();
    
    const { data: shiftData } = await attendanceService.getCurrentShift(dateStr);
    setCurrentShift(shiftData);

    const { data, error } = await attendanceService.getTodayAttendance(dateStr);
    if (data) {
      setAttendanceRecord(data);
      const { data: breaks } = await breakService.getAttendanceBreaks(data.id);
      setTodayBreaks(breaks || []);
      const hasActiveBreak = (breaks || []).some((b: any) => !b.ended_at);
      if (data.clock_in_at && !data.clock_out_at) {
        if (data.status === 'ON_BREAK' || hasActiveBreak) {
          setAttendanceState('on_break');
        } else {
          setAttendanceState('working');
        }
      } else {
        setAttendanceState('clocked_out');
      }
      
      if (data.clock_in_at) {
        const timer = computeWorkTimer(data, breaks || [], qaTimeService.now());
        setBreakTime(timer.activeBreakSeconds);
        setWorkTime(timer.workSeconds);
      }
    } else {
      setAttendanceState('not_clocked_in');
    }
    setLoadingAttendance(false);
  };

  useEffect(() => {
    // Recompute from stored timestamps: work pauses during an active break, break counts from started_at.
    if (!attendanceRecord?.clock_in_at || attendanceRecord?.clock_out_at) return;
    const tick = () => {
      const timer = computeWorkTimer(attendanceRecord, todayBreaks, qaTimeService.now());
      setWorkTime(timer.workSeconds);
      setBreakTime(timer.activeBreakSeconds);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [attendanceRecord, todayBreaks]);

  const formatTime = (totalSeconds: number) => {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const startCamera = async () => {
    try {
      setSecStep('face_ready');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err: any) {
      alert("Camera permission is required for face verification.");
      setSecStep('face_failed');
    }
  };

  const startLocationCheck = async () => {
    setSecStep('location_check');
    
    try {
      const { eventId, error } = await locationService.verifyCurrentLocation(clockAction === 'in' ? 'CLOCK_IN' : 'CLOCK_OUT');
      
      if (error) {
        if (error.message.includes('outside')) {
           alert("You are outside the assigned office location.");
        } else {
           alert(error.message || "Unable to verify your current location.");
        }
        setSecStep('location_failed');
      } else {
        setLocVerificationEventId(eventId || undefined);
        if (appSettings?.requireFaceVerification) {
          startCamera();
        } else {
          setSecStep('success');
        }
      }
    } catch (e: any) {
      alert("Unable to verify your current location.");
      setSecStep('location_failed');
    }
  };

  const handleClockAction = (action: 'in' | 'out') => {
    if (action === 'in' && !currentShift) {
      alert("Your shift assignment is not available for the current time.");
      return;
    }
    if (action === 'out' && attendanceState === 'on_break') {
      alert("Please end your active break before clocking out.");
      return;
    }
    setClockAction(action);
    setFaceAttempts(0);
    setAdminOverrideRequested(false);
    setShowSecurityModal(true);
    setSecStep('init');
    
    // Auto-start depending on settings
    setTimeout(() => {
      if (appSettings?.requireGeolocation) {
        startLocationCheck();
      } else if (appSettings?.requireFaceVerification) {
        startCamera();
      } else {
        setSecStep('success');
      }
    }, 500);
  };

  const retryLocation = () => {
    startLocationCheck();
  };

  const startFaceVerification = async () => {
    if (!videoRef.current) return;
    setSecStep('face_detecting');
    
    // Capture image
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth || 640;
    canvas.height = videoRef.current.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(videoRef.current, 0, 0);
    }
    const imageBase64 = canvas.toDataURL('image/jpeg', 0.9);
    
    stopCamera();
    
    const { eventId, error } = await faceService.verifyFaceForAttendance(clockAction === 'in' ? 'CLOCK_IN' : 'CLOCK_OUT', imageBase64);
    
    if (error) {
      alert(error.message || "Face verification failed. Please try again.");
      setFaceAttempts(prev => prev + 1);
      setSecStep('face_failed');
    } else {
      setVerificationEventId(eventId || undefined);
      setSecStep('success');
    }
  };

  const finalizeClockAction = async () => {
    closeSecurityModal();
    if (clockAction === 'in') {
      const { data, error } = await attendanceService.clockIn({
        localDateStr: getLocalDateStr(),
        locationVerificationId: locVerificationEventId,
        faceVerificationEventId: verificationEventId
      });
      if (error) {
        alert(`Attendance could not be created. Please try again.\n${error.message}`);
      } else {
        locationService.startLiveTracking();
        await fetchTodayAttendance();
      }
    } else {
      if (attendanceRecord) {
        const { error } = await attendanceService.clockOut(attendanceRecord.id);
        if (error) {
           alert(error.message);
        } else {
           locationService.stopLiveTracking();
           await fetchTodayAttendance();
        }
      }
    }
  };

  const requestAdminOverride = () => {
    setAdminOverrideRequested(true);
    // Mocking an async request
    setTimeout(() => {
      alert("Override request sent to Admin.");
    }, 500);
  };

  const confirmBreak = async () => {
    if (attendanceRecord) {
      if (attendanceState === 'working') {
        const { error } = await breakService.startBreak(attendanceRecord.id, 'REGULAR');
        if (error) alert(error.message);
        else await fetchTodayAttendance();
      } else if (attendanceState === 'on_break') {
        const { error } = await breakService.endBreak(attendanceRecord.id);
        if (error) alert(error.message);
        else await fetchTodayAttendance();
      }
    }
    setShowBreakModal(false);
  };

  const closeSecurityModal = () => {
    stopCamera();
    setShowSecurityModal(false);
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
         <span className="badge badge-success" style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}><CheckCircle2 size={12}/> Verified</span>
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
          <h1 className="page-title" style={{ marginBottom: '0.25rem' }}>Good Afternoon, Employee!</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            {currentDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
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
              <span className="badge badge-primary">{currentShift?.name || 'Standard Shift'}</span>
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Shift Timing</div>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{currentShift ? `${currentShift.start_time} — ${currentShift.end_time}` : '09:00:00 — 18:00:00'}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Required Hours</div>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{currentShift?.required_hours || 8} hours</div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Assigned Office</div>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Primary Office</div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Work Mode</div>
                <div style={{ fontWeight: 600, color: 'var(--gray-900)' }}>OFFICE</div>
              </div>
            </div>

            <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)', display: 'flex', gap: '1rem', fontSize: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: 'var(--success)' }}><CheckCircle2 size={14}/> Location Configured</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: 'var(--success)' }}>
                <ShieldCheck size={14}/> Face Identity Enabled
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
                  <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginBottom: '1rem' }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Status</div>
                      <div style={{ fontWeight: 600, color: attendanceRecord?.late_minutes > 0 ? 'var(--warning-600)' : 'var(--success-600)' }}>
                        {attendanceRecord?.late_minutes > 0 ? 'LATE' : 'ON TIME'}
                      </div>
                    </div>
                    {attendanceRecord?.late_minutes > 0 && (
                      <div style={{ textAlign: 'center', borderLeft: '1px solid var(--border-color)', paddingLeft: '1rem' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Late By</div>
                        <div style={{ fontWeight: 600, color: 'var(--danger-600)' }}>{attendanceRecord.late_minutes} {attendanceRecord.late_minutes === 1 ? 'minute' : 'minutes'}</div>
                      </div>
                    )}
                    {attendanceRecord?.late_minutes === 0 && (
                      <div style={{ textAlign: 'center', borderLeft: '1px solid var(--border-color)', paddingLeft: '1rem' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Late By</div>
                        <div style={{ fontWeight: 600, color: 'var(--success-600)' }}>0 minutes</div>
                      </div>
                    )}
                    <div style={{ textAlign: 'center', borderLeft: '1px solid var(--border-color)', paddingLeft: '1rem' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Clock In</div>
                      <div style={{ fontWeight: 600 }}>{new Date(attendanceRecord?.clock_in_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</div>
                    </div>
                  </div>
                  
                  <div style={{ color: 'var(--success)', marginBottom: '0.5rem', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--success)', animation: 'pulse 2s infinite' }} />
                    WORKING
                  </div>
                  <div style={{ color: 'var(--text-primary)', fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem', fontVariantNumeric: 'tabular-nums' }}>
                    {formatTime(workTime)}
                  </div>
                  {appSettings?.breakEnabled && attendanceRecord?.break_minutes > 0 && (
                    <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                      Total Break Time: {formatTime(attendanceRecord.break_minutes * 60)}
                    </div>
                  )}
                  <div style={{ display: 'grid', gridTemplateColumns: (appSettings?.breakEnabled && attendanceRecord?.status === 'WFH') ? '1fr 1fr' : '1fr', gap: '1rem', marginTop: '1rem' }}>
                    {appSettings?.breakEnabled && attendanceRecord?.status === 'WFH' && (
                      <button onClick={() => setShowBreakModal(true)} className="btn btn-outline" style={{ padding: '0.75rem', borderRadius: 'var(--radius-full)' }}>
                        <Coffee size={18} />
                        Start Break
                      </button>
                    )}
                    <button onClick={() => handleClockAction('out')} className="btn" style={{ padding: '0.75rem', borderRadius: 'var(--radius-full)', backgroundColor: 'var(--danger)', color: 'var(--bg-primary)' }}>
                      <ShieldCheck size={18} />
                      Secure Clock Out
                    </button>
                  </div>
                </>
              )}

              {/* On Break */}
              {attendanceState === 'on_break' && appSettings?.breakEnabled && (
                <>
                  <div style={{ color: 'var(--warning)', marginBottom: '0.5rem', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                    <Coffee size={16} />
                    ON BREAK
                  </div>
                  <div style={{ color: 'var(--text-primary)', fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.25rem', fontVariantNumeric: 'tabular-nums' }}>
                    Break Duration: {formatTime(breakTime)}
                  </div>
                  <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
                    {(() => { const allowed = resolveAllowedBreakMinutes(attendanceRecord?.shift_template?.break_duration_minutes ?? currentShift?.break_duration_minutes, appSettings.breakDurationMins); return allowed !== null ? `Allowed: ${allowed} mins` : ''; })()}
                  </div>
                  {findActiveBreak(todayBreaks)?.break_type !== 'AUTO_GPS' ? (
                    <button onClick={confirmBreak} className="btn btn-primary" style={{ width: '100%', padding: '1rem', fontSize: '1.125rem', borderRadius: 'var(--radius-full)' }}>
                      End Break
                    </button>
                  ) : (
                    <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
                      Break will automatically end when you return to the office.
                    </div>
                  )}
                </>
              )}

              {/* Clocked Out */}
              {attendanceState === 'clocked_out' && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginBottom: '1rem' }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Status</div>
                      <div style={{ fontWeight: 600, color: attendanceRecord?.late_minutes > 0 ? 'var(--warning-600)' : 'var(--success-600)' }}>
                        {attendanceRecord?.late_minutes > 0 ? 'LATE' : 'ON TIME'}
                      </div>
                    </div>
                    {attendanceRecord?.late_minutes > 0 && (
                      <div style={{ textAlign: 'center', borderLeft: '1px solid var(--border-color)', paddingLeft: '1rem' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Late By</div>
                        <div style={{ fontWeight: 600, color: 'var(--danger-600)' }}>{attendanceRecord.late_minutes} {attendanceRecord.late_minutes === 1 ? 'minute' : 'minutes'}</div>
                      </div>
                    )}
                    {attendanceRecord?.late_minutes === 0 && (
                      <div style={{ textAlign: 'center', borderLeft: '1px solid var(--border-color)', paddingLeft: '1rem' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Late By</div>
                        <div style={{ fontWeight: 600, color: 'var(--success-600)' }}>0 minutes</div>
                      </div>
                    )}
                    <div style={{ textAlign: 'center', borderLeft: '1px solid var(--border-color)', paddingLeft: '1rem' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Clock In</div>
                      <div style={{ fontWeight: 600 }}>{new Date(attendanceRecord?.clock_in_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</div>
                    </div>
                  </div>
                  
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
              <button className="icon-button" onClick={closeSecurityModal}><X size={20}/></button>
            </div>

            <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              
              <SecurityStatusSteps />

              {/* Dynamic Content Area based on Step */}
              
              {/* Location Processing */}
              {(secStep === 'init' || secStep === 'location_check') && (
                <div style={{ textAlign: 'center', padding: '2rem 0' }}>
                  <Map size={48} color="var(--primary-300)" style={{ margin: '0 auto 1rem auto', animation: 'pulse 2s infinite' }} />
                  <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.5rem' }}>Checking Location...</h3>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Verifying you are within the assigned office area.</p>
                </div>
              )}

              {/* Location Failed */}
              {secStep === 'location_failed' && (
                <div style={{ textAlign: 'center', padding: '1rem 0' }}>
                  <div style={{ width: '64px', height: '64px', backgroundColor: 'var(--danger-50)', color: 'var(--danger)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem auto' }}>
                    <MapPin size={32} />
                  </div>
                  <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--danger)' }}>
                    Location Verification Failed
                  </h3>
                  <p style={{ color: 'var(--gray-700)', fontSize: '0.875rem', marginBottom: '1rem' }}>We could not verify your location. Please check your browser/device permissions or ensure you are inside the assigned office.</p>
                  
                  <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
                    <button onClick={closeSecurityModal} className="btn btn-outline" style={{ flex: 1 }}>Cancel</button>
                    <button onClick={retryLocation} className="btn btn-primary" style={{ flex: 1 }}>Retry Location</button>
                  </div>
                </div>
              )}

              {/* Face Ready */}
              {secStep === 'face_ready' && (
                <div style={{ textAlign: 'center', padding: '1rem 0' }}>
                  <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>Verify Your Identity</h3>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>Look at the camera to verify your identity before clocking {clockAction}.</p>
                  
                  <div style={{ position: 'relative', width: '240px', height: '320px', backgroundColor: '#000', borderRadius: '1rem', margin: '0 auto 1.5rem auto', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                     <video 
                       ref={videoRef}
                       autoPlay 
                       playsInline 
                       muted
                       style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                     />
                     {!streamRef.current && (
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gray-400)', fontSize: '0.875rem' }}>
                          <RefreshCw className="spin" size={24} style={{ marginRight: '0.5rem' }}/> Starting camera...
                        </div>
                     )}
                     <div style={{ position: 'absolute', inset: '10%', border: '2px dashed rgba(255,255,255,0.5)', borderRadius: '50% 50% 40% 40%' }} />
                  </div>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>Position your face inside the frame.</p>

                  <div style={{ display: 'flex', gap: '1rem' }}>
                    <button onClick={closeSecurityModal} className="btn btn-outline" style={{ flex: 1 }}>Cancel</button>
                    <button onClick={startFaceVerification} disabled={!streamRef.current} className="btn btn-primary" style={{ flex: 1 }}>Verify Face</button>
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
                    Face Verification Failed
                  </h3>
                  
                  <p style={{ color: 'var(--gray-700)', fontSize: '0.875rem', marginBottom: '1rem' }}>
                    We could not match your face to the registered profile, or verification encountered an error. Please ensure good lighting and try again.
                  </p>
                  
                  <div style={{ fontSize: '0.875rem', color: 'var(--danger-600)', fontWeight: 600, marginBottom: '1.5rem' }}>
                    Attempt {faceAttempts} of 3
                  </div>

                  {faceAttempts >= 3 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      <div style={{ backgroundColor: 'var(--danger-50)', color: 'var(--danger-800)', padding: '0.75rem', borderRadius: 'var(--radius-md)', fontSize: '0.875rem', border: '1px solid var(--danger-200)' }}>
                        Verification Temporarily Blocked. Exceeded maximum attempts.
                      </div>
                      <button onClick={() => setSecStep('override')} className="btn btn-outline" style={{ borderColor: 'var(--gray-400)' }}>Request Admin Override</button>
                      <button onClick={closeSecurityModal} className="btn btn-outline">Close</button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: '1rem' }}>
                      <button onClick={closeSecurityModal} className="btn btn-outline" style={{ flex: 1 }}>Cancel</button>
                      <button onClick={startCamera} className="btn btn-primary" style={{ flex: 1 }}>Try Again</button>
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
                    <button onClick={closeSecurityModal} className="btn btn-outline" style={{ flex: 1 }}>Cancel</button>
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
                      <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>Assigned Office</span>
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




