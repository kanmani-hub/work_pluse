import React, { useState, useEffect } from 'react';
import { 
  Save, RotateCcw, Building, Clock, MapPin, ShieldCheck, 
  Settings as SettingsIcon, Bell, Users, CheckCircle2,
  AlertTriangle, Upload, Eye, EyeOff, Lock, AlertCircle, X
} from 'lucide-react';

const navCategories = [
  'General', 'Company', 'Working Hours', 'Attendance', 'Breaks', 
  'Shifts', 'Leave', 'WFH', 'Permission', 'Payroll', 
  'Geofencing', 'Face Verification', 'Notifications', 'Roles & Permissions', 'Security'
];

const initialSettings = {
  // General
  appName: 'WorkPulse HR', timezone: 'Asia/Kolkata (IST)', dateFormat: 'DD/MM/YYYY',
  timeFormat: '12 Hour', currency: 'INR (₹)', weekStartsOn: 'Monday', language: 'English', theme: 'Light',
  
  // Company
  companyName: 'Acme Corp', companyCode: 'ACME', companyEmail: 'hr@acme.com', phone: '1800-123-4567',
  
  // Working Hours
  defaultHours: '9:00 AM - 6:00 PM', requiredDaily: 8, minWorkingHours: 4, maxWorkingHours: 12,
  workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
  weeklyOff: ['Saturday', 'Sunday'],
  
  // Attendance
  lateLogin: true, lateGrace: 15, markLateAfter: 15,
  earlyLogout: true, minRequiredHours: 8, earlyThreshold: 15,
  missingPunch: 'Require HR Correction',
  autoLogout: true, autoLogoutGrace: 30,
  allowCorrection: true, maxCorrectionDays: 7, correctionApproval: true,
  
  // Breaks
  breakMode: 'Flexible', defaultBreak: 60, maxBreak: 90, paidBreak: false, multipleBreaks: true,
  
  // Shifts
  shiftAssignment: 'Admin + HR', overnightShifts: true, preventOverlap: true, shiftChangeNotice: 24, rosterLock: true,
  
  // Overtime
  overtime: true, minOvertime: 30, maxOvertimePerDay: 4, otMultiplier: 1.5, otApproval: true,
  
  // Leave
  leaveApproval: 'Manager → HR', allowLeaveCancel: true, pastDateLeave: false, negativeBalance: false,
  
  // WFH
  enableWfh: true, wfhMaxDays: 8, wfhApproval: true, wfhAdvance: true, wfhAdvanceDays: 1, wfhBypassGeofence: true,
  
  // Permission
  enablePermission: true, maxDuration: 2, maxPerMonth: 4, maxHoursPerMonth: 8, permApproval: true,
  
  // Payroll
  payrollCycle: 'Monthly', payrollPeriod: '1st → Last Day', processDate: 25, paymentDate: 30,
  deductLop: true, deductLate: true, deductEarly: false, lockAfterPayment: true,
  
  // Geofencing
  enableGeofence: true, radius: 200, accuracy: 'High', checkInLoc: true, checkOutLoc: true, outsideIn: false,
  
  // Face Verification
  enableFace: true, faceIn: true, faceOut: true, faceWfh: false, adminRegRequired: true,
  unregisteredBehavior: 'Block Attendance', maxAttempts: 3, failedAction: 'Block', adminOverride: true,
  
  // Security
  sessionTimeout: 30, minPassword: 8, maxAttemptsSec: 5, lockDuration: 15, twoFactor: 'Required for Admin'
};

const AdminSettings: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('General');
  const [settings, setSettings] = useState(initialSettings);
  const [hasChanges, setHasChanges] = useState(false);
  const [lastSaved, setLastSaved] = useState('Today, 10:42 AM');
  const [toast, setToast] = useState('');
  
  // Modals
  const [confirmModal, setConfirmModal] = useState<any>(null); // holds config for confirmation

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 500);
    return () => clearTimeout(timer);
  }, []);

  const handleChange = (key: string, value: any) => {
    setSettings(prev => {
      const next = { ...prev, [key]: value };
      setHasChanges(JSON.stringify(next) !== JSON.stringify(initialSettings));
      return next;
    });
  };

  const handleSave = () => {
    if (!hasChanges) return;
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setHasChanges(false);
      setLastSaved('Just now');
      setToast('Settings saved successfully');
      setTimeout(() => setToast(''), 3000);
    }, 800);
  };

  const handleReset = () => {
    setConfirmModal({
      title: 'Reset Changes?',
      msg: 'Are you sure you want to discard all unsaved changes?',
      action: () => {
        setSettings(initialSettings);
        setHasChanges(false);
        setConfirmModal(null);
      }
    });
  };
  
  const handleDangerAction = (title: string, msg: string) => {
    setConfirmModal({
      title, msg, danger: true,
      action: () => {
        setConfirmModal(null);
        setToast(`${title} executed successfully`);
        setTimeout(() => setToast(''), 3000);
      }
    });
  };

  // Content Renderers
  const renderGeneral = () => (
    <div className="settings-section">
      <h3 className="section-title">Application Preferences</h3>
      <div className="form-grid">
        <div><label className="form-label">Application Name</label><input type="text" className="form-control" value={settings.appName} onChange={e => handleChange('appName', e.target.value)}/></div>
        <div><label className="form-label">Company Timezone</label><select className="form-control" value={settings.timezone} onChange={e => handleChange('timezone', e.target.value)}><option>Asia/Kolkata (IST)</option><option>UTC</option></select></div>
        <div><label className="form-label">Date Format</label><select className="form-control" value={settings.dateFormat} onChange={e => handleChange('dateFormat', e.target.value)}><option>DD/MM/YYYY</option><option>MM/DD/YYYY</option></select></div>
        <div><label className="form-label">Currency</label><select className="form-control" value={settings.currency} onChange={e => handleChange('currency', e.target.value)}><option>INR (₹)</option><option>USD ($)</option></select></div>
        <div><label className="form-label">Week Starts On</label><select className="form-control" value={settings.weekStartsOn} onChange={e => handleChange('weekStartsOn', e.target.value)}><option>Monday</option><option>Sunday</option></select></div>
        <div>
          <label className="form-label">Theme</label>
          <div style={{ display: 'flex', gap: '0.5rem', backgroundColor: 'var(--bg-surface-elevated)', padding: '0.25rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
            <button className="btn" style={{ flex: 1, padding: '0.375rem', backgroundColor: settings.theme === 'Light' ? 'var(--primary-600)' : 'transparent', color: settings.theme === 'Light' ? '#fff' : 'var(--text-secondary)', border: 'none', boxShadow: settings.theme === 'Light' ? 'var(--shadow-sm)' : 'none' }} onClick={() => handleChange('theme', 'Light')}>☀️ Light</button>
            <button className="btn" style={{ flex: 1, padding: '0.375rem', backgroundColor: settings.theme === 'Dark' ? 'var(--primary-600)' : 'transparent', color: settings.theme === 'Dark' ? '#fff' : 'var(--text-secondary)', border: 'none', boxShadow: settings.theme === 'Dark' ? 'var(--shadow-sm)' : 'none' }} onClick={() => handleChange('theme', 'Dark')}>🌙 Dark</button>
          </div>
        </div>
      </div>
    </div>
  );

  const renderWorkingHours = () => (
    <div className="settings-section">
      <h3 className="section-title">Global Working Hours</h3>
      <div className="warning-box"><AlertCircle size={16}/> These are default company rules. Individual shifts may override them.</div>
      <div className="form-grid" style={{ marginTop: '1.5rem' }}>
        <div><label className="form-label">Default Working Hours</label><input type="text" className="form-control" value={settings.defaultHours} onChange={e => handleChange('defaultHours', e.target.value)}/></div>
        <div><label className="form-label">Required Daily Hours</label><input type="number" className="form-control" value={settings.requiredDaily} onChange={e => handleChange('requiredDaily', e.target.value)}/></div>
        <div><label className="form-label">Minimum Working Hours</label><input type="number" className="form-control" value={settings.minWorkingHours} onChange={e => handleChange('minWorkingHours', e.target.value)}/>
          {settings.minWorkingHours > settings.requiredDaily && <div className="error-text">Min hours cannot exceed required hours.</div>}
        </div>
        <div><label className="form-label">Maximum Working Hours</label><input type="number" className="form-control" value={settings.maxWorkingHours} onChange={e => handleChange('maxWorkingHours', e.target.value)}/></div>
      </div>
    </div>
  );

  const renderAttendance = () => (
    <div className="settings-section">
      <h3 className="section-title">Late Login & Early Logout</h3>
      
      <div className="toggle-row">
        <div><div style={{ fontWeight: 600 }}>Enable Late Login Detection</div><div className="help-text">Automatically flag employees arriving after their shift starts.</div></div>
        <input type="checkbox" className="toggle" checked={settings.lateLogin} onChange={e => handleChange('lateLogin', e.target.checked)}/>
      </div>
      {settings.lateLogin && (
        <div className="sub-settings">
          <div><label className="form-label">Grace Period (Minutes)</label><input type="number" className="form-control" value={settings.lateGrace} onChange={e => handleChange('lateGrace', e.target.value)}/></div>
          <div><label className="form-label">Mark as Late After (Minutes)</label><input type="number" className="form-control" value={settings.markLateAfter} onChange={e => handleChange('markLateAfter', e.target.value)}/></div>
        </div>
      )}

      <div className="toggle-row" style={{ marginTop: '1.5rem' }}>
        <div><div style={{ fontWeight: 600 }}>Enable Early Logout Detection</div><div className="help-text">Flag employees leaving before completing required hours.</div></div>
        <input type="checkbox" className="toggle" checked={settings.earlyLogout} onChange={e => handleChange('earlyLogout', e.target.checked)}/>
      </div>
      
      <h3 className="section-title" style={{ marginTop: '2rem' }}>System Behaviors</h3>
      <div className="form-grid">
        <div><label className="form-label">Missing Punch Behavior</label><select className="form-control" value={settings.missingPunch} onChange={e => handleChange('missingPunch', e.target.value)}><option>Require HR Correction</option><option>Mark as Missing</option><option>Auto Flag</option></select></div>
      </div>
      
      <div className="toggle-row" style={{ marginTop: '1.5rem' }}>
        <div><div style={{ fontWeight: 600 }}>Enable Auto Logout</div><div className="help-text">Automatically close active shifts if employee forgets to clock out.</div></div>
        <input type="checkbox" className="toggle" checked={settings.autoLogout} onChange={e => handleChange('autoLogout', e.target.checked)}/>
      </div>
    </div>
  );

  const renderGeofencing = () => (
    <div className="settings-section">
      <h3 className="section-title">Location Verification (Geofencing)</h3>
      <div className="warning-box"><AlertCircle size={16}/> This affects employee Clock In/Clock Out eligibility based on assigned office.</div>
      
      <div className="toggle-row" style={{ marginTop: '1.5rem' }}>
        <div><div style={{ fontWeight: 600 }}>Enable Office Geofencing</div><div className="help-text">Require employees to be physically present at their office.</div></div>
        <input type="checkbox" className="toggle" checked={settings.enableGeofence} onChange={e => handleChange('enableGeofence', e.target.checked)}/>
      </div>

      {settings.enableGeofence && (
        <div className="sub-settings">
          <div>
            <label className="form-label">Default Radius (Meters)</label>
            <input type="number" className="form-control" value={settings.radius} onChange={e => handleChange('radius', e.target.value)}/>
            {settings.radius < 0 && <div className="error-text">Radius cannot be negative.</div>}
          </div>
          <div><label className="form-label">Required Accuracy</label><select className="form-control" value={settings.accuracy} onChange={e => handleChange('accuracy', e.target.value)}><option>High</option><option>Good</option><option>Any</option></select></div>
          
          <div className="toggle-row" style={{ gridColumn: '1 / -1' }}><span style={{ fontWeight: 500, fontSize: '0.875rem' }}>Clock In Location Check Required</span><input type="checkbox" checked={settings.checkInLoc} onChange={e => handleChange('checkInLoc', e.target.checked)}/></div>
          <div className="toggle-row" style={{ gridColumn: '1 / -1' }}><span style={{ fontWeight: 500, fontSize: '0.875rem' }}>Clock Out Location Check Required</span><input type="checkbox" checked={settings.checkOutLoc} onChange={e => handleChange('checkOutLoc', e.target.checked)}/></div>
          <div className="toggle-row" style={{ gridColumn: '1 / -1' }}><span style={{ fontWeight: 500, fontSize: '0.875rem' }}>Allow Clock In Outside Geofence (Flags as exception)</span><input type="checkbox" checked={settings.outsideIn} onChange={e => handleChange('outsideIn', e.target.checked)}/></div>
          <div className="toggle-row" style={{ gridColumn: '1 / -1' }}>
            <div>
              <span style={{ fontWeight: 500, fontSize: '0.875rem' }}>WFH Geofence Bypass</span>
              <div className="help-text" style={{ fontSize: '0.75rem', marginTop: '4px' }}>Employees approved for WFH can bypass office geofence when this option is enabled.</div>
            </div>
            <input type="checkbox" checked={settings.wfhBypassGeofence} onChange={e => handleChange('wfhBypassGeofence', e.target.checked)}/>
          </div>
        </div>
      )}
    </div>
  );

  const renderFaceVerification = () => (
    <div className="settings-section">
      <h3 className="section-title">Biometric Security (Face Verification)</h3>
      <div className="warning-box"><AlertCircle size={16}/> This affects secure attendance verification globally.</div>
      
      <div className="toggle-row" style={{ marginTop: '1.5rem' }}>
        <div><div style={{ fontWeight: 600 }}>Enable Face Verification</div><div className="help-text">Use AI face matching for attendance punching.</div></div>
        <input type="checkbox" className="toggle" checked={settings.enableFace} onChange={e => handleChange('enableFace', e.target.checked)}/>
      </div>

      {settings.enableFace && (
        <div className="sub-settings" style={{ gridTemplateColumns: '1fr' }}>
          <div className="toggle-row"><span style={{ fontWeight: 500, fontSize: '0.875rem' }}>Required for Clock In</span><input type="checkbox" checked={settings.faceIn} onChange={e => handleChange('faceIn', e.target.checked)}/></div>
          <div className="toggle-row"><span style={{ fontWeight: 500, fontSize: '0.875rem' }}>Required for Clock Out</span><input type="checkbox" checked={settings.faceOut} onChange={e => handleChange('faceOut', e.target.checked)}/></div>
          <div className="toggle-row"><span style={{ fontWeight: 500, fontSize: '0.875rem' }}>Required during WFH</span><input type="checkbox" checked={settings.faceWfh} onChange={e => handleChange('faceWfh', e.target.checked)}/></div>
          <div className="toggle-row"><span style={{ fontWeight: 500, fontSize: '0.875rem' }}>Admin Face Registration Required</span><input type="checkbox" checked={settings.adminRegRequired} onChange={e => handleChange('adminRegRequired', e.target.checked)}/></div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
            <div><label className="form-label">Unregistered Face Behavior</label><select className="form-control" value={settings.unregisteredBehavior} onChange={e => handleChange('unregisteredBehavior', e.target.value)}><option>Block Attendance</option><option>Require Registration</option><option>Allow with HR Override</option></select></div>
            <div><label className="form-label">Verification Failure Action</label><select className="form-control" value={settings.failedAction} onChange={e => handleChange('failedAction', e.target.value)}><option>Block</option><option>Require HR Review</option><option>Retry</option></select></div>
          </div>
        </div>
      )}

      <h3 className="section-title" style={{ marginTop: '2.5rem' }}>Security Flow Preview</h3>
      <div style={{ backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)', padding: '1.5rem', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '1rem', fontFamily: 'monospace', fontSize: '0.875rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}><span style={{ color: 'var(--text-secondary)' }}>1.</span> <span>Employee Requests Punch</span></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}><span style={{ color: 'var(--text-secondary)' }}>2.</span> <span style={{ color: settings.enableGeofence ? 'var(--primary-400)' : 'var(--gray-400)' }}>Location Check: {settings.enableGeofence ? 'ENABLED' : 'SKIPPED'}</span></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}><span style={{ color: 'var(--text-secondary)' }}>3.</span> <span>Inside Assigned Office? {settings.enableGeofence ? 'YES' : 'N/A'}</span></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}><span style={{ color: 'var(--text-secondary)' }}>4.</span> <span style={{ color: settings.enableFace ? 'var(--primary-400)' : 'var(--gray-400)' }}>Face Verification: {settings.enableFace ? 'ENABLED' : 'SKIPPED'}</span></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}><span style={{ color: 'var(--text-secondary)' }}>5.</span> <span>Matches Registered Face? {settings.enableFace ? 'YES' : 'N/A'}</span></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.5rem', padding: '0.5rem', backgroundColor: 'rgba(34, 197, 94, 0.2)', border: '1px solid var(--success)', borderRadius: '4px' }}>
          <CheckCircle2 size={16} color="var(--success)"/> <span style={{ color: 'var(--success-400)', fontWeight: 600 }}>CLOCK IN / CLOCK OUT ALLOWED</span>
        </div>
        {settings.enableGeofence && !settings.outsideIn && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.5rem', padding: '0.5rem', backgroundColor: 'rgba(239, 68, 68, 0.2)', border: '1px solid var(--danger)', borderRadius: '4px' }}>
            <X size={16} color="var(--danger)"/> <span style={{ color: 'var(--danger-400)', fontWeight: 600 }}>Outside Geofence → CLOCK IN BLOCKED</span>
          </div>
        )}
      </div>
    </div>
  );

  const renderPayroll = () => (
    <div className="settings-section">
      <h3 className="section-title">Payroll Policy</h3>
      <div className="warning-box"><AlertCircle size={16}/> Modifying these rules affects future monthly payroll calculations and payment statuses.</div>
      
      <div className="form-grid" style={{ marginTop: '1.5rem' }}>
        <div><label className="form-label">Payroll Cycle</label><select className="form-control" value={settings.payrollCycle} onChange={e => handleChange('payrollCycle', e.target.value)}><option>Monthly</option><option>Bi-weekly</option></select></div>
        <div><label className="form-label">Payroll Period</label><input type="text" className="form-control" value={settings.payrollPeriod} onChange={e => handleChange('payrollPeriod', e.target.value)}/></div>
        <div><label className="form-label">Processing Date (Day of Month)</label><input type="number" className="form-control" value={settings.processDate} onChange={e => handleChange('processDate', e.target.value)}/></div>
        <div><label className="form-label">Salary Payment Date</label><input type="number" className="form-control" value={settings.paymentDate} onChange={e => handleChange('paymentDate', e.target.value)}/></div>
      </div>

      <h3 className="section-title" style={{ marginTop: '2rem' }}>Deduction Rules</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div className="toggle-row"><span style={{ fontWeight: 500, fontSize: '0.875rem' }}>Enable LOP (Loss of Pay) Deduction</span><input type="checkbox" checked={settings.deductLop} onChange={e => handleChange('deductLop', e.target.checked)}/></div>
        <div className="toggle-row"><span style={{ fontWeight: 500, fontSize: '0.875rem' }}>Enable Late Login Deduction</span><input type="checkbox" checked={settings.deductLate} onChange={e => handleChange('deductLate', e.target.checked)}/></div>
        <div className="toggle-row"><span style={{ fontWeight: 500, fontSize: '0.875rem' }}>Enable Early Logout Deduction</span><input type="checkbox" checked={settings.deductEarly} onChange={e => handleChange('deductEarly', e.target.checked)}/></div>
      </div>

      <h3 className="section-title" style={{ marginTop: '2rem' }}>Payroll Lifecycle Control</h3>
      <div className="toggle-row">
        <div><div style={{ fontWeight: 600 }}>Lock payroll after payment</div><div className="help-text">Paid payroll records cannot be edited without an authorized correction workflow.</div></div>
        <input type="checkbox" className="toggle" checked={settings.lockAfterPayment} onChange={e => handleChange('lockAfterPayment', e.target.checked)}/>
      </div>
    </div>
  );

  const renderDangerZone = () => (
    <div className="settings-section" style={{ border: '1px solid var(--danger-200)', borderRadius: 'var(--radius-lg)' }}>
      <div style={{ backgroundColor: 'var(--danger-50)', padding: '1.5rem', borderTopLeftRadius: 'var(--radius-lg)', borderTopRightRadius: 'var(--radius-lg)', borderBottom: '1px solid var(--danger-200)' }}>
        <h3 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--danger-800)', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}><AlertTriangle size={20}/> Danger Zone</h3>
        <p style={{ color: 'var(--danger)', fontSize: '0.875rem', marginTop: '0.5rem' }}>Destructive actions that cannot be easily undone. Requires explicit confirmation.</p>
      </div>
      <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div><div style={{ fontWeight: 600 }}>Reset Demo Data</div><div className="help-text">Clear all mock reports, attendance, and payroll records.</div></div>
          <button onClick={() => handleDangerAction('Reset Demo Data', 'This will wipe all generated mock data and restore factory defaults.')} className="btn btn-outline" style={{ color: 'var(--danger)', borderColor: 'var(--danger-300)', fontSize: '0.875rem' }}>Reset Demo Data</button>
        </div>

        <div style={{ height: '1px', backgroundColor: 'var(--gray-200)' }}></div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div><div style={{ fontWeight: 600 }}>Deactivate Company Account</div><div className="help-text">Suspend the entire WorkPulse HR instance for all users.</div></div>
          <button onClick={() => handleDangerAction('Deactivate Company', 'Are you absolutely sure? This will lock out all employees and admins.')} className="btn btn-primary" style={{ backgroundColor: 'var(--danger-600)', borderColor: 'var(--danger-600)', fontSize: '0.875rem' }}>Deactivate Company</button>
        </div>

      </div>
    </div>
  );

  const renderContent = () => {
    switch(activeTab) {
      case 'General': return renderGeneral();
      case 'Working Hours': return renderWorkingHours();
      case 'Attendance': return renderAttendance();
      case 'Payroll': return renderPayroll();
      case 'Geofencing': return renderGeofencing();
      case 'Face Verification': return renderFaceVerification();
      case 'Danger Zone': return renderDangerZone();
      default: return (
        <div className="settings-section" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
          <SettingsIcon size={48} color="var(--gray-300)" style={{ margin: '0 auto 1rem auto' }}/>
          <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>{activeTab} Settings</h3>
          <p style={{ color: 'var(--text-secondary)', maxWidth: '400px', margin: '0 auto' }}>This section is stubbed for the UI prototype. The configuration model operates identically to the active sections.</p>
        </div>
      );
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', position: 'relative', height: '100%' }}>
      
      {toast && (
        <div style={{ position: 'fixed', top: '24px', left: '50%', transform: 'translateX(-50%)', backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)', padding: '0.75rem 1.5rem', borderRadius: 'var(--radius-full)', zIndex: 1000, display: 'flex', alignItems: 'center', gap: '0.5rem', boxShadow: 'var(--shadow-lg)', animation: 'slideDown 0.3s forwards' }}>
          <CheckCircle2 size={18} color="var(--success)" />
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="page-header" style={{ marginBottom: '0.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="page-title">Settings</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>Configure company policies and preferences</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '2rem', flex: 1, flexDirection: 'row' }} className="responsive-layout">
        
        {/* Nav Sidebar */}
        <div className="settings-nav card" style={{ padding: '0.5rem 0', minWidth: '220px', height: 'fit-content' }}>
          {navCategories.map(cat => (
            <button key={cat} onClick={() => setActiveTab(cat)} className={`nav-item ${activeTab === cat ? 'active' : ''}`}>
              {cat}
            </button>
          ))}
          <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '1rem 0' }}></div>
          <button onClick={() => setActiveTab('Danger Zone')} className={`nav-item ${activeTab === 'Danger Zone' ? 'active-danger' : ''}`} style={{ color: 'var(--danger-600)' }}>
            Danger Zone
          </button>
        </div>

        {/* Content Area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1.5rem', paddingBottom: '6rem', minWidth: 0 }}>
          {loading && !hasChanges ? (
             <div className="skeleton" style={{ height: '500px', borderRadius: 'var(--radius-lg)' }} />
          ) : (
            <>
              {renderContent()}
              
              <div className="card" style={{ marginTop: '1rem' }}>
                <h3 className="section-title">Recent Configuration Changes</h3>
                <div className="table-container">
                  <table className="table" style={{ width: '100%', fontSize: '0.875rem' }}>
                    <thead><tr><th>Setting</th><th>Old Value</th><th>New Value</th><th>Changed By</th><th>Date</th></tr></thead>
                    <tbody>
                      <tr><td>Late Grace Period</td><td>10 min</td><td>15 min</td><td>System Admin</td><td>Today, 09:12 AM</td></tr>
                      <tr><td>Face Verification</td><td>OFF</td><td>ON</td><td>Security Admin</td><td>Yesterday, 14:30 PM</td></tr>
                      <tr><td>Payroll Overtime</td><td>1.5x</td><td>2.0x</td><td>HR Manager</td><td>21 Sep 2026</td></tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Action Footer */}
      <div className="bottom-action-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {hasChanges ? <span className="badge badge-warning">Unsaved Changes</span> : <span className="badge badge-success">Settings up to date</span>}
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Last saved: {lastSaved}</span>
        </div>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <button onClick={handleReset} className="btn btn-outline" disabled={!hasChanges}><RotateCcw size={16}/> Reset Changes</button>
          <button onClick={handleSave} className="btn btn-primary" disabled={!hasChanges || loading}><Save size={16}/> {loading ? 'Saving...' : 'Save Changes'}</button>
        </div>
      </div>

      {/* Confirmation Modal */}
      {confirmModal && (
        <div className="drawer-overlay" style={{ alignItems: 'center', zIndex: 120 }}>
          <div className="card" style={{ margin: 'auto', width: '100%', maxWidth: '450px', animation: 'slideUp 0.3s', borderTop: confirmModal.danger ? '4px solid var(--danger)' : '4px solid var(--primary-500)' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem', color: confirmModal.danger ? 'var(--danger)' : 'inherit' }}>{confirmModal.title}</h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1.5rem', lineHeight: 1.5 }}>{confirmModal.msg}</p>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button onClick={() => setConfirmModal(null)} className="btn btn-outline" style={{ flex: 1 }}>Cancel</button>
              <button onClick={confirmModal.action} className="btn btn-primary" style={{ flex: 1, backgroundColor: confirmModal.danger ? 'var(--danger-600)' : 'var(--primary-600)', borderColor: confirmModal.danger ? 'var(--danger-600)' : 'var(--primary-600)' }}>Confirm</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        
        
        
        
        
        .settings-section { background-color: var(--bg-surface); padding: 1.5rem; border-radius: var(--radius-xl); border: 1px solid var(--border-color); box-shadow: var(--shadow-sm); }
        .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.5rem; }
        
        .nav-item { width: 100%; text-align: left; padding: 0.75rem 1.25rem; background: none; border: none; font-size: 0.875rem; font-weight: 500; color: var(--text-secondary); cursor: pointer; border-left: 3px solid transparent; transition: all 0.2s; }
        .nav-item:hover { background-color: var(--bg-surface-elevated); color: var(--text-primary); }
        .nav-item.active { border-left-color: var(--primary-500); color: var(--primary-600); background-color: rgba(124, 92, 255, 0.05); font-weight: 600; }
        .nav-item.active-danger { border-left-color: var(--danger); background-color: rgba(251, 113, 133, 0.05); color: var(--danger-600); font-weight: 600; }
        
        .toggle-row { display: flex; justify-content: space-between; align-items: center; padding: 1rem; background-color: var(--bg-surface-elevated); border-radius: var(--radius-md); border: 1px solid var(--border-color); }
        .help-text { font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem; }
        .warning-box { background-color: rgba(251, 191, 36, 0.1); border: 1px dashed var(--warning); padding: 1rem; border-radius: var(--radius-md); color: var(--warning-600); font-size: 0.875rem; display: flex; align-items: center; gap: 0.5rem; }
        .error-text { color: var(--danger); font-size: 0.75rem; margin-top: 0.25rem; font-weight: 500; }
        .sub-settings { display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem; padding: 1rem; border-left: 2px solid var(--border-color); margin-left: 1rem; margin-top: 0.5rem; }

        .drawer-overlay { position: fixed; inset: 0; background-color: rgba(0,0,0,0.4); z-index: 100; display: flex; justify-content: flex-end; }
        
        
        .bottom-action-bar { position: fixed; bottom: 0; left: 0; right: 0; padding: 1rem 2rem; background-color: var(--bg-surface); border-top: 1px solid var(--border-color); z-index: 100; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 -10px 40px rgba(0,0,0,0.1); }
        
        @media (min-width: 901px) { .desktop-inline { display: inline !important; } }
        @media (max-width: 900px) { 
          .responsive-layout { flex-direction: column !important; }
          .settings-nav { display: flex; overflow-x: auto; padding: 0 !important; border-bottom: 1px solid var(--border-color); }
          .nav-item { white-space: nowrap; border-left: none; border-bottom: 3px solid transparent; padding: 1rem; }
          .nav-item.active, .nav-item.active-danger { border-left: none; border-bottom-color: inherit; }
          .form-grid { grid-template-columns: 1fr; gap: 1rem; }
          .sub-settings { grid-template-columns: 1fr; }
          .bottom-action-bar { padding: 1rem; flex-direction: column; gap: 1rem; }
        }
        @media (max-width: 600px) {
          .drawer-overlay { align-items: flex-end; }
        }
        
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes slideDown { from { transform: translate(-50%, -100%); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }
        .skeleton { background: linear-gradient(90deg, var(--gray-200) 25%, var(--gray-100) 50%, var(--gray-200) 75%); background-size: 200% 100%; animation: skeleton-loading 1.5s infinite; }
        @keyframes skeleton-loading { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
      `}</style>
    </div>
  );
};

export default AdminSettings;


