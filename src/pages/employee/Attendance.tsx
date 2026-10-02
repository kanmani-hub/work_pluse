import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useGlobalSettings } from '../../services/settings/globalSettingsService';
import { 
  ChevronLeft, ChevronRight, Calendar as CalendarIcon, Clock, Filter, 
  MapPin, AlertCircle, X, Info, Loader2, ArrowRight
} from 'lucide-react';

import { attendanceService } from '../../services/attendance/attendanceService';
import { breakService } from '../../services/attendance/breakService';
import { faceService } from '../../services/face/faceService';
import { locationService } from '../../services/location/locationService';
import { supabase } from '../../lib/supabase';

const SearchIcon = ({size, color}: any) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>;

const EmployeeAttendance: React.FC = () => {
  const { settings } = useGlobalSettings();
  const appSettings = settings.app;
  const payrollSettings = settings.payroll;

  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDateDetail, setSelectedDateDetail] = useState<any>(null);
  
  const [history, setHistory] = useState<any[]>([]);
  const [todayAttendance, setTodayAttendance] = useState<any>(null);
  const [todayBreaks, setTodayBreaks] = useState<any[]>([]);
  const [currentShift, setCurrentShift] = useState<any>(null);
  const [summaryStats, setSummaryStats] = useState({ workingDays: 0, present: 0, late: 0, halfDay: 0, leave: 0, wfh: 0, totalHours: '0h 0m' });
  const [effectiveTime, setEffectiveTime] = useState(0);

  const [filterMode, setFilterMode] = useState('All');
  const [filterStatus, setFilterStatus] = useState('All');
  
  // Location & Face States
  const [assignedOffice, setAssignedOffice] = useState<any>(null);
  const [faceRegistration, setFaceRegistration] = useState<any>(null);
  const [locationVerification, setLocationVerification] = useState<any>(null);
  const [clockInFlowStep, setClockInFlowStep] = useState<number>(0);
  const [cameraAction, setCameraAction] = useState<'REGISTER_FACE' | 'CLOCK_IN'>('CLOCK_IN');
  const [cameraError, setCameraError] = useState<string | null>(null);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const locVerificationIdRef = useRef<string | null>(null);


  useEffect(() => {
    let workingDays = 0, present = 0, late = 0, halfDay = 0, leave = 0, wfh = 0;
    let totalSeconds = 0;
    let totalLateMins = 0;

    const currentMonthHistory = history.filter(item => {
      const d = new Date(item.rawDate);
      return d.getMonth() === currentDate.getMonth() && d.getFullYear() === currentDate.getFullYear();
    });

    currentMonthHistory.forEach(row => {
      workingDays++;
      if (row.status === 'PRESENT' || row.status === 'COMPLETED' || row.status === 'WORKING' || row.status === 'ON_BREAK') present++;
      if (row.lateMin > 0) {
        late++;
        totalLateMins += row.lateMin;
      }
      if (row.originalStatus === 'HALF DAY' || row.is_half_day) halfDay++;
      if (row.originalStatus === 'LEAVE' || row.status === 'LEAVE') leave++;
      if (row.originalStatus === 'WFH' || row.status === 'WFH') wfh++;

      if (row.worked_hours) {
         totalSeconds += Math.floor(row.worked_hours * 3600);
      } else {
         const match = String(row.hours).match(/(\d+)h\s*(\d+)m/);
         if (match) {
            totalSeconds += (parseInt(match[1]) * 3600) + (parseInt(match[2]) * 60);
         }
      }
    });

    const totalH = Math.floor(totalSeconds / 3600);
    const totalM = Math.floor((totalSeconds % 3600) / 60);
    
    setSummaryStats({ workingDays, present, late, halfDay, leave, wfh, totalHours: `${totalH}h ${totalM}m`, totalLateMinutes: totalLateMins } as any);
  }, [history, currentDate]);

  const currentMonthStr = currentDate.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const handlePrevMonth = () => setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  const handleNextMonth = () => setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const emptyCells = Array.from({ length: firstDay }, (_, i) => i);
  const monthDays = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  useEffect(() => {
    fetchData();
    return () => {
      stopCamera();
      locationService.stopLiveTracking();
    };
  }, []);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (todayAttendance?.status === 'WORKING') {
      interval = setInterval(() => setEffectiveTime(t => t + 1), 1000);
    }
    return () => clearInterval(interval);
  }, [todayAttendance?.status]);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  };

  const fetchData = async () => {
    setLoading(true);
    const { data: allData } = await attendanceService.getMyAttendance();
    
    const empId = await attendanceService.getCurrentEmployeeId();
    if (empId) {
      const localDateStr = new Date().toISOString().split('T')[0];
      
      // Shift logic
      const { data: shiftAssignments } = await supabase
        .from('shift_assignments')
        .select('*, shift_template:shift_templates(*)')
        .eq('employee_id', empId)
        .lte('effective_date', localDateStr)
        .order('effective_date', { ascending: false })
        .limit(1)
        .maybeSingle() as any;

      if (shiftAssignments && shiftAssignments.shift_template) {
         setCurrentShift(shiftAssignments.shift_template);
      } else {
         const { data: shiftAssignmentsFallback } = await supabase
           .from('shift_assignments')
           .select('*, shift_template:shift_template_id(*)')
           .eq('employee_id', empId)
           .lte('effective_date', localDateStr)
           .order('effective_date', { ascending: false })
           .limit(1)
           .maybeSingle() as any;
         if (shiftAssignmentsFallback && shiftAssignmentsFallback.shift_template) {
            setCurrentShift(shiftAssignmentsFallback.shift_template);
         } else {
            const { data: fallbackShift } = await supabase.from('shift_templates').select('*').eq('is_active', true).limit(1).maybeSingle() as any;
            setCurrentShift(fallbackShift);
         }
      }

      // Office assignment
      const { data: empData } = await supabase.from('employees').select('office:office_id(*)').eq('id', empId).maybeSingle() as any;
      if (empData && empData.office) {
        setAssignedOffice(empData.office);
      }

      // Face Registration
      const { data: faceReg } = await faceService.getMyFaceRegistration();
      setFaceRegistration(faceReg);

      // Initial GPS Location Check
      const locResult = await locationService.verifyCurrentLocation('LOCATION_CHECK');
      setLocationVerification(locResult);
    }

    if (allData) {
      let workingDays = 0, present = 0, late = 0, halfDay = 0, leave = 0, wfh = 0;
      let totalSeconds = 0;
      let totalLateMins = 0;

      const mapped = allData.map((row: any) => {
        const d = new Date(row.attendance_date);
        const inTime = row.clock_in_at ? new Date(row.clock_in_at).toLocaleTimeString('en-US', {hour: '2-digit', minute:'2-digit'}) : '--:--';
        const outTime = row.clock_out_at ? new Date(row.clock_out_at).toLocaleTimeString('en-US', {hour: '2-digit', minute:'2-digit'}) : '--:--';
        
        let hoursStr = '--:--';
        if (row.worked_hours) {
          const h = Math.floor(row.worked_hours);
          const m = Math.floor((row.worked_hours - h) * 60);
          hoursStr = `${h}h ${m}m`;
          totalSeconds += Math.floor(row.worked_hours * 3600);
        }

        workingDays++;
        if (row.status === 'PRESENT' || row.status === 'COMPLETED' || row.status === 'WORKING' || row.status === 'ON_BREAK') present++;
        if (row.late_minutes > 0) {
          late++;
          totalLateMins += row.late_minutes;
        }
        if (row.is_half_day) halfDay++;
        if (row.status === 'LEAVE') leave++;
        if (row.status === 'WFH') wfh++;

        let displayStatus = row.status;
        if (row.late_minutes > 0 && (row.status === 'WORKING' || row.status === 'COMPLETED' || row.status === 'PRESENT')) {
          displayStatus = 'LATE';
        }

        return {
          id: row.id,
          date: d.toLocaleDateString('en-US', {day:'numeric', month:'short', year:'numeric'}),
          rawDate: row.attendance_date,
          shift: row.shift_template?.name || 'General Shift',
          mode: 'OFFICE',
          in: inTime,
          out: outTime,
          break: `${row.break_minutes || 0}m`,
          hours: hoursStr,
          status: displayStatus,
          originalStatus: row.status,
          overnight: false,
          lateMin: row.late_minutes || 0,
          earlyMin: row.early_logout_minutes || 0,
          autoLogout: row.is_auto_logged_out,
          clock_in_at: row.clock_in_at,
          clock_out_at: row.clock_out_at,
          break_minutes: row.break_minutes,
          shift_template: row.shift_template
        };
      });

      setHistory(mapped);
      
      const localDateStr = new Date().toISOString().split('T')[0];
      const today = mapped.find((m: any) => m.rawDate === localDateStr);
      setTodayAttendance(today || null);

      if (today) {
        if (today.clock_in_at) {
           const inTime = new Date(today.clock_in_at).getTime();
           let currentWorkSecs = Math.floor((new Date().getTime() - inTime) / 1000);
           if (today.break_minutes) currentWorkSecs -= today.break_minutes * 60;
           setEffectiveTime(Math.max(0, currentWorkSecs));
        }

        const { data: breaks } = await breakService.getAttendanceBreaks(today.id);
        if (breaks) {
           setTodayBreaks(breaks);
        }

        // Resume Live Tracking if working
        if (today.status === 'WORKING' || today.status === 'ON_BREAK') {
           locationService.startLiveTracking();
        }
      } else {
        setEffectiveTime(0);
        setTodayBreaks([]);
      }
    }
    setLoading(false);
  };

  const startCameraFlow = async (action: 'REGISTER_FACE' | 'CLOCK_IN') => {
    // 1. Fresh GPS Check
    setClockInFlowStep(2); // Show processing
    const locResult = await locationService.verifyCurrentLocation(action === 'CLOCK_IN' ? 'CLOCK_IN' : 'LOCATION_CHECK');
    setLocationVerification(locResult);
    
    if (locResult.result !== 'INSIDE') {
      alert("You are outside the office location. " + (action === 'CLOCK_IN' ? "Clock In" : "Face Registration") + " is unavailable.");
      setClockInFlowStep(0);
      return;
    }
    locVerificationIdRef.current = locResult.eventId;
    
    // 2. Start Camera
    setCameraAction(action);
    setCameraError(null);
    setClockInFlowStep(1);
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err: any) {
      console.error("Camera access error:", err);
      setCameraError("Camera permission is required for face verification.");
    }
  };

  const cancelClockInFlow = () => {
    stopCamera();
    setClockInFlowStep(0);
  };

  const captureAndVerify = async () => {
    if (!videoRef.current) return;
    
    // In a real provider, we'd draw to canvas and send the dataUrl
    
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    const capturedImage = canvas.toDataURL('image/jpeg');

    stopCamera();
    setClockInFlowStep(2); // Processing

    try {
      if (cameraAction === 'REGISTER_FACE') {
        const empId = await attendanceService.getCurrentEmployeeId();
        if (empId) {
           const { error } = await faceService.registerFaceAdmin(empId, capturedImage);

           if (error) {
             if (error.message.includes('NOT_CONFIGURED')) alert("Face verification provider is not configured.");
             else alert(error.message);
           } else {
             alert("Real face registered!");
           }
        }
      } else if (cameraAction === 'CLOCK_IN') {
        // Perform Face Verification
        const { eventId, error } = await faceService.verifyFaceForAttendance('CLOCK_IN', capturedImage);
        if (error) {
           if (error.message.includes('NOT_CONFIGURED')) alert("Face verification provider is not configured.");
           else alert(error.message);
        } else {
           // Success, call Clock In
           const localDateStr = new Date().toISOString().split('T')[0];
           const res = await attendanceService.clockIn({ 
             localDateStr, 
             locationVerificationId: locVerificationIdRef.current || undefined,
             faceVerificationEventId: eventId || undefined
           });
           
           if (res.error) {
             alert(res.error.message);
           } else {
             locationService.startLiveTracking();
           }
        }
      }
    } catch (e: any) {
      alert(e.message);
    }
    
    setClockInFlowStep(0);
    fetchData();
  };

  const handleClockOut = async () => {
    if (!todayAttendance) return;
    try {
      await locationService.verifyCurrentLocation('CLOCK_OUT');
      const res = await attendanceService.clockOut(todayAttendance.id);
      if (res.error) alert(res.error.message);
      locationService.stopLiveTracking();
      fetchData();
    } catch(e: any) {
      alert(e.message);
    }
  };

  const handleAction = async (action: string) => {
    try {
      if (action === 'startBreak' && todayAttendance) {
        const res = await breakService.startBreak(todayAttendance.id);
        if (res.error) alert(res.error.message);
      } else if (action === 'endBreak' && todayAttendance) {
        const res = await breakService.endBreak(todayAttendance.id);
        if (res.error) alert(res.error.message);
      }
      fetchData();
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleClearFilters = () => {
    setFilterMode('All');
    setFilterStatus('All');
  };

  const filteredHistory = history.filter((item: any) => {
    if (filterMode !== 'All' && item.mode !== filterMode) return false;
    if (filterStatus !== 'All' && item.status !== filterStatus) return false;
    return true;
  });

  const getStatusBadge = (status: string) => {
    switch(status?.toUpperCase()) {
      case 'WORKING': return 'badge-warning';
      case 'ON_BREAK': return 'badge-warning';
      case 'PRESENT': return 'badge-success';
      case 'COMPLETED': return 'badge-success';
      case 'LATE': return 'badge-warning';
      case 'WFH': return 'badge-primary';
      case 'LEAVE': return 'badge-gray';
      case 'AUTO LOGOUT': return 'badge-danger';
      case 'WEEK OFF': return 'badge-gray';
      default: return 'badge-gray';
    }
  };

  const getStatusColorCode = (status: string) => {
    switch(status?.toUpperCase()) {
      case 'WORKING': return 'var(--warning)';
      case 'ON_BREAK': return 'var(--warning)';
      case 'PRESENT': return 'var(--success)';
      case 'COMPLETED': return 'var(--success)';
      case 'LATE': return 'var(--warning)';
      case 'HALF DAY': return '#facc15';
      case 'LEAVE': return '#3b82f6';
      case 'WFH': return 'var(--primary-500)';
      case 'ABSENT': return 'var(--danger)';
      case 'AUTO LOGOUT': return 'var(--danger)';
      default: return 'var(--gray-300)';
    }
  };

  const formatTimeSeconds = (totalSeconds: number) => {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${h}h ${m}m ${s}s`;
  };

  const formatTimeOnly = (isoStr: string) => {
    return new Date(isoStr).toLocaleTimeString('en-US', {hour: '2-digit', minute:'2-digit'});
  };

  const timelineEvents = [];
  if (currentShift?.start_time) {
    timelineEvents.push({ time: currentShift.start_time, desc: 'Scheduled Shift Start', type: 'neutral' });
  }
  if (todayAttendance?.clock_in_at) {
    timelineEvents.push({ time: formatTimeOnly(todayAttendance.clock_in_at), desc: 'Clocked In', type: 'success' });
  }
  todayBreaks.forEach(b => {
    if (b.started_at) {
      timelineEvents.push({ time: formatTimeOnly(b.started_at), desc: 'Break Started', type: 'warning' });
    }
    if (b.ended_at) {
      timelineEvents.push({ time: formatTimeOnly(b.ended_at), desc: 'Break Ended', type: 'success' });
    }
  });
  if (todayAttendance?.clock_out_at) {
    timelineEvents.push({ time: formatTimeOnly(todayAttendance.clock_out_at), desc: 'Clocked Out', type: 'neutral' });
  } else if (todayAttendance) {
    timelineEvents.push({ time: 'Current Time', desc: todayAttendance.status === 'ON_BREAK' ? 'On Break' : 'Working', type: 'active' });
  }
  if (currentShift?.end_time) {
    timelineEvents.push({ time: currentShift.end_time, desc: 'Scheduled Shift End', type: 'outline' });
  }

  const calendarDays = Array.from({length: 30}, (_, i) => i + 1);

  const renderTodayAttendanceCard = () => {
    if (clockInFlowStep === 1) {
      return (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <h3 style={{ marginBottom: '1rem', fontSize: '1.25rem', fontWeight: 600 }}>
            {cameraAction === 'REGISTER_FACE' ? 'Face Registration' : 'Clock In Verification'}
          </h3>
          {cameraError ? (
            <div style={{ color: 'var(--danger)', padding: '1rem', backgroundColor: 'var(--danger-50)', borderRadius: 'var(--radius-md)' }}>
              <AlertCircle style={{ marginBottom: '0.5rem', margin: '0 auto' }} size={24} />
              {cameraError}
            </div>
          ) : (
            <div style={{ position: 'relative', width: '320px', height: '400px', backgroundColor: '#111827', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
              <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              <div style={{ position: 'absolute', inset: 0, opacity: 0.2, backgroundImage: 'linear-gradient(45deg, #000 25%, transparent 25%, transparent 75%, #000 75%, #000), linear-gradient(45deg, #000 25%, transparent 25%, transparent 75%, #000 75%, #000)', backgroundSize: '20px 20px', backgroundPosition: '0 0, 10px 10px', pointerEvents: 'none' }} />
              <div style={{ width: '200px', height: '260px', border: '2px dashed rgba(255,255,255,0.7)', borderRadius: '50% 50% 40% 40%', position: 'absolute', zIndex: 10, top: '50%', left: '50%', transform: 'translate(-50%, -50%)', pointerEvents: 'none' }}></div>
            </div>
          )}
          <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem', width: '320px' }}>
            <button className="btn btn-outline" style={{ flex: 1 }} onClick={cancelClockInFlow}>Cancel</button>
            <button className="btn btn-primary" style={{ flex: 2 }} disabled={!!cameraError} onClick={captureAndVerify}>
              Capture & {cameraAction === 'REGISTER_FACE' ? 'Register' : 'Clock In'}
            </button>
          </div>
        </div>
      );
    }
  
    if (clockInFlowStep === 2) {
      return (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '3rem 1rem' }}>
          <Loader2 className="spin" size={32} style={{ marginBottom: '1rem', color: 'var(--primary-600)' }} />
          <p style={{ fontWeight: 500 }}>Processing verification...</p>
        </div>
      );
    }
  
    return (
      <div className="card">
        <h3 className="card-title" style={{ marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>Today's Attendance</h3>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Date</div>
            <div style={{ fontWeight: 600 }}>{todayAttendance ? todayAttendance.date : new Date().toLocaleDateString('en-US', {day:'numeric', month:'short', year:'numeric'})}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span className={`badge ${todayAttendance ? getStatusBadge(todayAttendance.status) : 'badge-gray'}`} style={{ fontSize: '0.875rem', padding: '0.375rem 0.75rem' }}>
              {todayAttendance?.status === 'WORKING' && <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'currentColor', marginRight: '0.5rem', animation: 'pulse 2s infinite' }} />}
              {todayAttendance ? todayAttendance.status : 'NOT STARTED'}
            </span>
          </div>
        </div>
  
        {!todayAttendance ? (
          <div style={{ marginTop: '1.5rem' }}>
            <div style={{ padding: '1rem', backgroundColor: 'var(--gray-50)', borderRadius: 'var(--radius-md)', marginBottom: '1.5rem', border: '1px solid var(--border-color)' }}>
              <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
                <MapPin size={16} color="var(--primary-600)" /> Office Geofence Status
              </h4>
              {!assignedOffice ? (
                <div style={{ color: 'var(--danger)', fontSize: '0.875rem', fontWeight: 500 }}>Office not assigned. Please contact HR.</div>
              ) : (
                <>
                  <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>{assignedOffice.name}</div>
                  
                  {locationVerification?.result === 'LOADING' || !locationVerification ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                      <Loader2 size={14} className="spin" /> Checking GPS location...
                    </div>
                  ) : locationVerification.result === 'OUTSIDE' || locationVerification.result === 'LOCATION_DENIED' || locationVerification.result === 'LOCATION_UNAVAILABLE' || locationVerification.result === 'ERROR' ? (
                    <div style={{ marginTop: '0.5rem', fontSize: '0.875rem' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.5rem' }}>
                        <div><span style={{ color: 'var(--text-secondary)' }}>Distance:</span> <strong>{locationVerification.distance ? Math.round(locationVerification.distance) + ' m' : '-'}</strong></div>
                        <div><span style={{ color: 'var(--text-secondary)' }}>Radius:</span> <strong>{locationVerification.radius || assignedOffice.geofence_radius} m</strong></div>
                      </div>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', color: 'var(--danger-700)', backgroundColor: 'var(--danger-50)', padding: '0.25rem 0.5rem', borderRadius: '4px', fontWeight: 600 }}>
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--danger)' }} /> Outside Office
                      </div>
                      <p style={{ marginTop: '0.5rem', color: 'var(--danger-600)' }}>
                        {locationVerification.error?.message || 'Clock In is unavailable outside the office.'}
                      </p>
                    </div>
                  ) : locationVerification.result === 'INSIDE' ? (
                    <div style={{ marginTop: '0.5rem', fontSize: '0.875rem' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.5rem' }}>
                        <div><span style={{ color: 'var(--text-secondary)' }}>Distance:</span> <strong>{Math.round(locationVerification.distance || 0)} m</strong></div>
                        <div><span style={{ color: 'var(--text-secondary)' }}>Radius:</span> <strong>{locationVerification.radius} m</strong></div>
                      </div>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', color: 'var(--success-700)', backgroundColor: 'var(--success-50)', padding: '0.25rem 0.5rem', borderRadius: '4px', fontWeight: 600 }}>
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--success)' }} /> Inside Office
                      </div>
                      <p style={{ marginTop: '0.5rem', color: 'var(--text-secondary)' }}>You are within the office location.</p>
                    </div>
                  ) : null}
                </>
              )}
            </div>
            
            {assignedOffice && locationVerification?.result === 'INSIDE' && (
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                {!faceRegistration ? (
                  <button onClick={() => startCameraFlow('REGISTER_FACE')} className="btn btn-primary">Face Registration Required</button>
                ) : (
                  <button onClick={() => startCameraFlow('CLOCK_IN')} className="btn btn-primary" style={{ width: '100%', padding: '0.75rem', fontSize: '1.125rem' }}>Clock In</button>
                )}
              </div>
            )}
          </div>
        ) : (
          <div style={{ marginTop: '1.5rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', backgroundColor: 'var(--gray-50)', padding: '1rem', borderRadius: 'var(--radius-md)', marginBottom: '1.5rem' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Clock In</div>
                <div style={{ fontWeight: 600, fontSize: '1.125rem' }}>{todayAttendance.in}</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Break</div>
                <div style={{ fontWeight: 600, fontSize: '1.125rem' }}>{todayAttendance.break}</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Clock Out</div>
                <div style={{ fontWeight: 600, fontSize: '1.125rem', color: 'var(--text-secondary)' }}>{todayAttendance.out}</div>
              </div>
            </div>
            
            <div style={{ textAlign: 'center', padding: '1rem', border: '1px dashed var(--border-color)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Effective Working Hours</div>
              <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--primary-600)', fontVariantNumeric: 'tabular-nums' }}>
                {todayAttendance.status === 'COMPLETED' ? todayAttendance.hours : formatTimeSeconds(effectiveTime)}
              </div>
            </div>
  
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.5rem', justifyContent: 'center' }}>
              {todayAttendance.originalStatus === 'WORKING' && (
                <>
                  <button onClick={() => handleAction('startBreak')} className="btn btn-warning" style={{ flex: 1 }}>Start Break</button>
                  <button onClick={handleClockOut} className="btn btn-danger" style={{ flex: 1 }}>Clock Out</button>
                </>
              )}
              {todayAttendance.originalStatus === 'ON_BREAK' && (
                <button onClick={() => handleAction('endBreak')} className="btn btn-primary" style={{ flex: 1 }}>End Break</button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', position: 'relative' }}>
      
      {/* Page Header */}
      <div className="page-header" style={{ marginBottom: 0, flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="page-title">My Attendance</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>Track your daily working hours, attendance status, shifts and breaks.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', backgroundColor: 'var(--bg-surface-elevated)', padding: '0.25rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
          <button className="icon-button" onClick={handlePrevMonth} aria-label="Previous month"><ChevronLeft size={20} /></button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0 0.5rem', fontWeight: 600, minWidth: '160px', justifyContent: 'center' }}>
            <CalendarIcon size={18} className="nav-icon" />
            {currentMonthStr}
          </div>
          <button className="icon-button" onClick={handleNextMonth} aria-label="Next month"><ChevronRight size={20} /></button>
        </div>
      </div>

      {loading ? (
        <div className="skeleton-container" style={{ display: 'flex', gap: '1rem', overflowX: 'auto', paddingBottom: '0.5rem' }}>
          {[...Array(7)].map((_, i) => <div key={i} className="skeleton" style={{ minWidth: '120px', height: '80px', borderRadius: 'var(--radius-md)' }} />)}
        </div>
      ) : (
        <div className="tracking-kpi-grid">
          <div className="tracking-kpi-card">
            <div className="sc-title">Working Days</div>
            <div className="sc-val">{summaryStats.workingDays}</div>
          </div>
          <div className="tracking-kpi-card">
            <div className="sc-title">Present</div>
            <div className="sc-val" style={{ color: 'var(--success)' }}>{summaryStats.present}</div>
          </div>
          <div className="tracking-kpi-card">
            <div className="sc-title">Late</div>
            <div className="sc-val" style={{ color: 'var(--warning)' }}>{summaryStats.late}</div>
          </div>
          <div className="tracking-kpi-card">
            <div className="sc-title">Total Late Minutes</div>
            <div className="sc-val" style={{ color: 'var(--danger)' }}>{(summaryStats as any).totalLateMinutes || 0}m</div>
          </div>
          <div className="tracking-kpi-card">
            <div className="sc-title">Half Day</div>
            <div className="sc-val" style={{ color: '#ca8a04' }}>{summaryStats.halfDay}</div>
          </div>
          <div className="tracking-kpi-card">
            <div className="sc-title">Leave</div>
            <div className="sc-val" style={{ color: '#2563eb' }}>{summaryStats.leave}</div>
          </div>
          <div className="tracking-kpi-card">
            <div className="sc-title">WFH</div>
            <div className="sc-val" style={{ color: 'var(--primary-700)' }}>{summaryStats.wfh}</div>
          </div>
          <div className="tracking-kpi-card">
            <div className="sc-title">Total Hours</div>
            <div className="sc-val">{summaryStats.totalHours}</div>
          </div>
        </div>
      )}

      <div className="two-col-grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {renderTodayAttendanceCard()}

          {/* Attendance Timeline */}
          {todayAttendance && (
            <div className="card">
              <h3 className="card-title" style={{ marginBottom: '1rem' }}>Today's Timeline</h3>
              <div className="timeline">
                {timelineEvents.map((evt, i) => (
                  <div key={i} className={`tl-item ${evt.type === 'active' ? 'tl-active' : ''}`}>
                    <div className={`tl-dot tl-${evt.type} ${evt.type === 'active' ? 'pulse-dot' : ''}`}></div>
                    <div className="tl-content">
                      <div className="tl-time" style={{ color: evt.type === 'outline' ? 'var(--text-secondary)' : 'var(--gray-500)' }}>{evt.time}</div>
                      <div className="tl-desc" style={{ 
                        color: evt.type === 'active' ? 'var(--primary-700)' : (evt.type === 'outline' ? 'var(--text-secondary)' : 'var(--gray-900)'), 
                        fontWeight: (evt.type === 'active' || evt.desc === 'Clocked In') ? 600 : 400 
                      }}>
                        {evt.desc}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* Shift Info */}
          {currentShift && (
            <div className="card" style={{ backgroundColor: 'var(--primary-50)', border: '1px solid var(--primary-100)' }}>
               <h3 className="card-title" style={{ fontSize: '1rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Info size={18} color="var(--primary-600)" />
                  Current Assigned Shift
               </h3>
               <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.875rem' }}>
                 <div><span style={{ color: 'var(--text-secondary)' }}>Shift Name:</span> <strong>{currentShift.name}</strong></div>
                 <div><span style={{ color: 'var(--text-secondary)' }}>Hours:</span> <strong>{currentShift.required_hours}h Required</strong></div>
                 <div><span style={{ color: 'var(--text-secondary)' }}>Timing:</span> <strong>{currentShift.start_time} - {currentShift.end_time}</strong></div>
                 <div><span style={{ color: 'var(--text-secondary)' }}>Break:</span> <strong>1h Duration</strong></div>
                 <div><span style={{ color: 'var(--text-secondary)' }}>Mode:</span> <strong>OFFICE</strong></div>
               </div>
            </div>
          )}

        </div>

        {/* Right Col: Calendar & Table */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Monthly Calendar */}
          <div className="card" style={{ padding: '0', overflow: 'hidden', marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem' }}>
              <h3 className="card-title" style={{ margin: 0 }}>{currentMonthStr}</h3>
              <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.75rem', flexWrap: 'wrap' }}>
                <div className="cal-legend"><span style={{ backgroundColor: 'var(--success)' }}/> PR</div>
                <div className="cal-legend"><span style={{ backgroundColor: 'var(--warning)' }}/> LT</div>
                <div className="cal-legend"><span style={{ backgroundColor: 'var(--primary-500)' }}/> WFH</div>
                <div className="cal-legend"><span style={{ backgroundColor: '#3b82f6' }}/> LV</div>
                <div className="cal-legend"><span style={{ backgroundColor: 'var(--danger)' }}/> AB</div>
              </div>
            </div>
            
            {loading ? (
              <div className="skeleton" style={{ height: '240px' }} />
            ) : (
              <div className="calendar-grid">
                {['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map(d => (
                  <div key={d} className="cal-head">{d}</div>
                ))}
                
                {emptyCells.map(i => (
                  <div key={`empty-${i}`} className="cal-day empty"></div>
                ))}
                
                {monthDays.map(day => {
                  const dStr = `${year}-${(month + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
                  const record = history.find((h: any) => h.rawDate === dStr);
                  const isToday = dStr === new Date().toISOString().split('T')[0];
                  let status = record ? record.status : (new Date(year, month, day) > new Date() ? 'FUTURE' : 'WEEK OFF');
                  
                  const dayOfWeek = new Date(year, month, day).getDay();
                  if (!record && (dayOfWeek === 0 || dayOfWeek === 6) && status !== 'FUTURE') status = 'WEEKEND';
                  
                  return (
                    <div 
                      key={day} 
                      className={`cal-day ${isToday ? 'today' : ''} ${status === 'FUTURE' ? 'future' : ''}`}
                      onClick={() => {
                        if (record) setSelectedDateDetail(record);
                        else if (status !== 'FUTURE') setSelectedDateDetail({ date: new Date(year, month, day).toLocaleDateString('en-US', {day:'numeric', month:'short', year:'numeric'}), status: status, mode: '-', shift: '-', in: '-', out: '-', break: '-', hours: '-', lateMin: 0, earlyMin: 0 });
                      }}
                    >
                      <span className="cal-date" aria-label={`${currentMonthStr} ${day}, ${status}`}>{day}</span>
                      {status !== 'FUTURE' && status !== 'WEEK OFF' && status !== 'WEEKEND' && status !== 'WORKING' && status !== 'ON_BREAK' && status !== 'COMPLETED' && status !== 'PRESENT' && (
                        <div className="cal-dot" style={{ backgroundColor: getStatusColorCode(status) }}></div>
                      )}
                      {(status === 'WORKING' || status === 'ON_BREAK') && (
                        <div className="cal-dot pulse-dot" style={{ backgroundColor: 'var(--warning)' }}></div>
                      )}
                      {(status === 'COMPLETED' || status === 'PRESENT') && (
                        <div className="cal-dot" style={{ backgroundColor: 'var(--success)' }}></div>
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
                <option value="PRESENT">Present</option>
                <option value="WORKING">Working</option>
                <option value="COMPLETED">Completed</option>
                <option value="LATE">Late</option>
                <option value="LEAVE">Leave</option>
                <option value="AUTO LOGOUT">Auto Logout</option>
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
                        <th>Late By</th>
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
                          <td style={{ color: row.lateMin > 0 ? 'var(--danger-600)' : 'var(--success-600)', fontWeight: 500 }}>
                            {row.lateMin} min
                          </td>
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
                <div className="avatar">EM</div>
                <div>
                  <div style={{ fontWeight: 600 }}>Employee</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>ID</div>
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
                  <span className="detail-value">{selectedDateDetail.shift_template?.start_time || '09:00 AM'}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Scheduled End</span>
                  <span className="detail-value">{selectedDateDetail.shift_template?.end_time || '06:00 PM'}</span>
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
        .tl-dot.tl-active { border-color: var(--primary-500); }
        .tl-dot.tl-outline { background-color: var(--bg-surface); border-width: 2px; }

        .calendar-grid {
          display: grid;
          grid-template-columns: repeat(7, minmax(0, 1fr));
          gap: 1px;
          background-color: var(--border-color);
          border-top: 1px solid var(--border-color);
        }
        .cal-head {
          background-color: var(--gray-50);
          padding: 0.5rem 0.25rem;
          text-align: center;
          font-size: 0.7rem;
          font-weight: 600;
          color: var(--text-secondary);
        }
        .cal-day {
          background-color: var(--bg-surface);
          min-height: 60px;
          padding: 0.25rem;
          display: flex;
          flex-direction: column;
          align-items: center;
          cursor: pointer;
        }
        .cal-day:hover:not(.empty):not(.future) {
          background-color: var(--gray-50);
        }
        .cal-day.empty {
          background-color: var(--gray-50);
          cursor: default;
        }
        .cal-day.future {
          color: var(--gray-400);
          cursor: default;
          background-color: var(--gray-50);
        }
        .cal-day.future .cal-date {
          color: var(--gray-400);
        }
        .cal-date {
          font-size: 0.875rem;
          font-weight: 500;
          margin-bottom: 0.25rem;
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
        }
        .cal-day.today .cal-date {
          background-color: var(--primary-100);
          color: var(--primary-700);
          border: 1px solid var(--primary-300);
          font-weight: 700;
        }
        .cal-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          margin-top: auto;
          margin-bottom: 4px;
        }
        .cal-legend {
          display: flex;
          align-items: center;
          gap: 0.25rem;
          color: var(--text-secondary);
        }
        .cal-legend span {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          display: inline-block;
        }

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
          margin-bottom: 0.25rem;
        }
        .tl-desc {
          font-size: 0.875rem;
        }
        .spin {
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default EmployeeAttendance;
