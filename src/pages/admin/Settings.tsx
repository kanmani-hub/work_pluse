import React, { useState, useEffect } from 'react';
import { 
  Save, RotateCcw, AlertTriangle, Settings as SettingsIcon, CheckCircle2,
  AlertCircle, X
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { appSettingsService, type AppSettings } from '../../services/settings/appSettingsService';
import { payrollSettingsService, type PayrollSettings } from '../../services/payroll/payrollSettingsService';

const navCategories = [
  'General', 'Company', 'Working Hours', 'Attendance', 'Breaks', 
  'Shifts', 'Leave', 'WFH', 'Permission', 'Payroll', 'Geofencing'
];

type CombinedSettings = {
  app: AppSettings;
  payroll: PayrollSettings;
};

const AdminSettings: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialSection = searchParams.get('section') || 'Company';
  
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(initialSection);
  
  const [settings, setSettings] = useState<CombinedSettings | null>(null);
  const [initialState, setInitialState] = useState<CombinedSettings | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  
  const [lastSaved, setLastSaved] = useState('Never');
  const [toast, setToast] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  
  // Modals
  const [confirmModal, setConfirmModal] = useState<any>(null);

  const loadSettings = () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const appSettings = appSettingsService.getSettings();
      const payrollSettings = payrollSettingsService.getSettings();
      const combined = { app: appSettings, payroll: payrollSettings };
      
      setSettings(combined);
      setInitialState(JSON.parse(JSON.stringify(combined))); // Deep copy
      setHasChanges(false);
    } catch (e) {
      setErrorMsg('Unable to load settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    if (activeTab !== searchParams.get('section')) {
      setSearchParams({ section: activeTab });
    }
  }, [activeTab, setSearchParams]);

  useEffect(() => {
    const sectionInUrl = searchParams.get('section');
    if (sectionInUrl && sectionInUrl !== activeTab && navCategories.includes(sectionInUrl)) {
      setActiveTab(sectionInUrl);
    }
  }, [searchParams]);

  const handleChangeApp = (key: keyof AppSettings, value: any) => {
    if (!settings) return;
    setSettings(prev => {
      if (!prev) return prev;
      const next = { ...prev, app: { ...prev.app, [key]: value } };
      setHasChanges(JSON.stringify(next) !== JSON.stringify(initialState));
      return next;
    });
  };

  const handleChangePayroll = (key: keyof PayrollSettings, value: any) => {
    if (!settings) return;
    setSettings(prev => {
      if (!prev) return prev;
      const next = { ...prev, payroll: { ...prev.payroll, [key]: value } };
      setHasChanges(JSON.stringify(next) !== JSON.stringify(initialState));
      return next;
    });
  };

  const handleSave = () => {
    if (!hasChanges || !settings) return;
    setLoading(true);
    setErrorMsg('');
    try {
      // Validate
      if (settings.app.gracePeriodMins < 0) throw new Error("Grace Period cannot be negative.");
      if (settings.app.defaultRadiusMeters < 0) throw new Error("Geofence Radius cannot be negative.");
      if (settings.payroll.configuredWorkingDays < 0) throw new Error("Working Days cannot be negative.");
      if (settings.payroll.monthlyLateLoginLimit < 0) throw new Error("Late Login Limit cannot be negative.");
      if (settings.payroll.permissionLimit < 0) throw new Error("Permission Limit cannot be negative.");

      // Save to services
      appSettingsService.saveSettings(settings.app);
      payrollSettingsService.saveSettings(settings.payroll);
      
      setInitialState(JSON.parse(JSON.stringify(settings)));
      setHasChanges(false);
      setLastSaved(`Today, ${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`);
      setToast('Settings saved successfully');
      setTimeout(() => setToast(''), 3000);
    } catch (e: any) {
      setErrorMsg(e.message || 'Failed to save settings. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    if (!initialState) return;
    setSettings(JSON.parse(JSON.stringify(initialState)));
    setHasChanges(false);
    setErrorMsg('');
  };

  if (!settings) {
    return (
      <div style={{ padding: '2rem' }}>
        {errorMsg ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'flex-start' }}>
            <div style={{ color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><AlertCircle size={20}/> {errorMsg}</div>
            <button className="btn btn-outline" onClick={loadSettings}>Retry</button>
          </div>
        ) : (
          <div className="skeleton-container" style={{ display: 'flex', gap: '1rem' }}>
            <div className="skeleton" style={{ width: '220px', height: '500px' }} />
            <div className="skeleton" style={{ flex: 1, height: '500px' }} />
          </div>
        )}
      </div>
    );
  }

  // Content Renderers
  const renderGeneral = () => (
    <div className="settings-section">
      <h3 className="section-title">Application Preferences</h3>
      <div className="form-grid">
        <div><label className="form-label">Application Name</label><input type="text" className="form-control" value={settings.app.appName} onChange={e => handleChangeApp('appName', e.target.value)}/></div>
        <div><label className="form-label">Company Timezone</label><select className="form-control" value={settings.app.timezone} onChange={e => handleChangeApp('timezone', e.target.value)}><option>Asia/Kolkata (IST)</option><option>UTC</option></select></div>
        <div><label className="form-label">Date Format</label><select className="form-control" value={settings.app.dateFormat} onChange={e => handleChangeApp('dateFormat', e.target.value)}><option>DD/MM/YYYY</option><option>MM/DD/YYYY</option></select></div>
        <div><label className="form-label">Currency</label><select className="form-control" value={settings.app.currency} onChange={e => handleChangeApp('currency', e.target.value)}><option>INR (₹)</option><option>USD ($)</option></select></div>
        <div><label className="form-label">Week Starts On</label><select className="form-control" value={settings.app.weekStartsOn} onChange={e => handleChangeApp('weekStartsOn', e.target.value)}><option>Monday</option><option>Sunday</option></select></div>
        <div>
          <label className="form-label">Theme</label>
          <div style={{ display: 'flex', gap: '0.5rem', backgroundColor: 'var(--bg-surface-elevated)', padding: '0.25rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
            <button className="btn" style={{ flex: 1, padding: '0.375rem', backgroundColor: settings.app.theme === 'Light' ? 'var(--primary-600)' : 'transparent', color: settings.app.theme === 'Light' ? '#fff' : 'var(--text-secondary)', border: 'none', boxShadow: settings.app.theme === 'Light' ? 'var(--shadow-sm)' : 'none' }} onClick={() => handleChangeApp('theme', 'Light')}>☀️ Light</button>
            <button className="btn" style={{ flex: 1, padding: '0.375rem', backgroundColor: settings.app.theme === 'Dark' ? 'var(--primary-600)' : 'transparent', color: settings.app.theme === 'Dark' ? '#fff' : 'var(--text-secondary)', border: 'none', boxShadow: settings.app.theme === 'Dark' ? 'var(--shadow-sm)' : 'none' }} onClick={() => handleChangeApp('theme', 'Dark')}>🌙 Dark</button>
          </div>
        </div>
      </div>
    </div>
  );

  const renderCompany = () => (
    <div className="settings-section">
      <h3 className="section-title">Company Profile</h3>
      <div className="form-grid">
        <div><label className="form-label">Company Name</label><input type="text" className="form-control" value={settings.app.companyName} onChange={e => handleChangeApp('companyName', e.target.value)}/></div>
        <div><label className="form-label">Company Email</label><input type="email" className="form-control" value={settings.app.companyEmail} onChange={e => handleChangeApp('companyEmail', e.target.value)}/></div>
        <div><label className="form-label">Company Phone</label><input type="text" className="form-control" value={settings.app.companyPhone} onChange={e => handleChangeApp('companyPhone', e.target.value)}/></div>
        <div><label className="form-label">Website</label><input type="text" className="form-control" value={settings.app.website} onChange={e => handleChangeApp('website', e.target.value)}/></div>
        <div style={{ gridColumn: '1 / -1' }}><label className="form-label">Company Address</label><textarea className="form-control" rows={3} value={settings.app.companyAddress} onChange={e => handleChangeApp('companyAddress', e.target.value)}></textarea></div>
      </div>
    </div>
  );

  const renderWorkingHours = () => (
    <div className="settings-section">
      <h3 className="section-title">Global Working Hours</h3>
      <div className="warning-box"><AlertCircle size={16}/> These are default company rules. Individual shifts/rosters override them.</div>
      <div className="form-grid" style={{ marginTop: '1.5rem' }}>
        <div><label className="form-label">Work Start Time</label><input type="time" className="form-control" value={settings.app.workStartTime} onChange={e => handleChangeApp('workStartTime', e.target.value)}/></div>
        <div><label className="form-label">Work End Time</label><input type="time" className="form-control" value={settings.app.workEndTime} onChange={e => handleChangeApp('workEndTime', e.target.value)}/></div>
      </div>
      <h3 className="section-title" style={{ marginTop: '2rem' }}>Working Days</h3>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => (
          <label key={day} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', backgroundColor: settings.app.workingDays.includes(day) ? 'var(--primary-50)' : 'transparent', cursor: 'pointer' }}>
            <input 
              type="checkbox" 
              checked={settings.app.workingDays.includes(day)} 
              onChange={e => {
                const arr = e.target.checked 
                  ? [...settings.app.workingDays, day] 
                  : settings.app.workingDays.filter(d => d !== day);
                handleChangeApp('workingDays', arr);
              }}
            />
            {day}
          </label>
        ))}
      </div>
    </div>
  );

  const renderAttendance = () => (
    <div className="settings-section">
      <h3 className="section-title">Attendance Policies</h3>
      
      <div className="toggle-row">
        <div><div style={{ fontWeight: 600 }}>Require Face Verification</div><div className="help-text">Use AI face matching for attendance punching.</div></div>
        <input type="checkbox" className="toggle" checked={settings.app.requireFaceVerification} onChange={e => handleChangeApp('requireFaceVerification', e.target.checked)}/>
      </div>
      <div className="toggle-row" style={{ marginTop: '1rem' }}>
        <div><div style={{ fontWeight: 600 }}>Require Geolocation</div><div className="help-text">Record GPS coordinates when punching in/out.</div></div>
        <input type="checkbox" className="toggle" checked={settings.app.requireGeolocation} onChange={e => handleChangeApp('requireGeolocation', e.target.checked)}/>
      </div>
      <div className="toggle-row" style={{ marginTop: '1rem' }}>
        <div><div style={{ fontWeight: 600 }}>Late Login Detection</div><div className="help-text">Automatically flag employees arriving after their shift starts.</div></div>
        <input type="checkbox" className="toggle" checked={settings.app.lateLoginDetection} onChange={e => handleChangeApp('lateLoginDetection', e.target.checked)}/>
      </div>
      <div className="toggle-row" style={{ marginTop: '1rem' }}>
        <div><div style={{ fontWeight: 600 }}>Early Logout Detection</div><div className="help-text">Flag employees leaving before shift ends.</div></div>
        <input type="checkbox" className="toggle" checked={settings.app.earlyLogoutDetection} onChange={e => handleChangeApp('earlyLogoutDetection', e.target.checked)}/>
      </div>

      <div className="form-grid" style={{ marginTop: '1.5rem' }}>
        <div>
          <label className="form-label">Grace Period (Minutes)</label>
          <input type="number" className="form-control" value={settings.app.gracePeriodMins} onChange={e => handleChangeApp('gracePeriodMins', parseInt(e.target.value) || 0)}/>
        </div>
      </div>
      
      <h3 className="section-title" style={{ marginTop: '2rem' }}>System Behaviors</h3>
      <div className="toggle-row">
        <div><div style={{ fontWeight: 600 }}>Enable Auto Clock-Out</div><div className="help-text">Automatically close active shifts if employee forgets to clock out.</div></div>
        <input type="checkbox" className="toggle" checked={settings.app.autoClockOut} onChange={e => handleChangeApp('autoClockOut', e.target.checked)}/>
      </div>
      <div className="toggle-row" style={{ marginTop: '1rem' }}>
        <div><div style={{ fontWeight: 600 }}>Allow Attendance Correction</div><div className="help-text">Let employees request fixes for missed punches.</div></div>
        <input type="checkbox" className="toggle" checked={settings.app.allowCorrection} onChange={e => handleChangeApp('allowCorrection', e.target.checked)}/>
      </div>
    </div>
  );

  const renderBreaks = () => (
    <div className="settings-section">
      <h3 className="section-title">Break Settings</h3>
      <div className="toggle-row">
        <div><div style={{ fontWeight: 600 }}>Enable Break Tracking</div><div className="help-text">Allow employees to clock out for breaks.</div></div>
        <input type="checkbox" className="toggle" checked={settings.app.breakEnabled} onChange={e => handleChangeApp('breakEnabled', e.target.checked)}/>
      </div>
      {settings.app.breakEnabled && (
        <div className="form-grid" style={{ marginTop: '1.5rem' }}>
          <div><label className="form-label">Default Break Duration (Mins)</label><input type="number" className="form-control" value={settings.app.breakDurationMins} onChange={e => handleChangeApp('breakDurationMins', parseInt(e.target.value) || 0)}/></div>
          <div><label className="form-label">Maximum Break Duration (Mins)</label><input type="number" className="form-control" value={settings.app.maxBreakDurationMins} onChange={e => handleChangeApp('maxBreakDurationMins', parseInt(e.target.value) || 0)}/></div>
        </div>
      )}
    </div>
  );

  const renderShifts = () => (
    <div className="settings-section">
      <h3 className="section-title">Shift Settings</h3>
      <div className="form-grid">
        <div><label className="form-label">Default Shift Name</label><input type="text" className="form-control" value={settings.app.defaultShift} onChange={e => handleChangeApp('defaultShift', e.target.value)}/></div>
        <div><label className="form-label">Shift Grace Period (Mins)</label><input type="number" className="form-control" value={settings.app.shiftGracePeriodMins} onChange={e => handleChangeApp('shiftGracePeriodMins', parseInt(e.target.value) || 0)}/></div>
      </div>
    </div>
  );

  const renderLeave = () => (
    <div className="settings-section">
      <h3 className="section-title">Leave Policies</h3>
      <div className="toggle-row">
        <div><div style={{ fontWeight: 600 }}>Leave Approval Required</div><div className="help-text">Leaves must be approved by HR/Manager before taking effect.</div></div>
        <input type="checkbox" className="toggle" checked={settings.app.leaveApprovalRequired} onChange={e => handleChangeApp('leaveApprovalRequired', e.target.checked)}/>
      </div>
      <div className="toggle-row" style={{ marginTop: '1rem' }}>
        <div><div style={{ fontWeight: 600 }}>Allow Past Date Leave</div><div className="help-text">Employees can apply for leave on dates that have already passed.</div></div>
        <input type="checkbox" className="toggle" checked={settings.app.allowPastDateLeave} onChange={e => handleChangeApp('allowPastDateLeave', e.target.checked)}/>
      </div>
      <div className="toggle-row" style={{ marginTop: '1rem' }}>
        <div><div style={{ fontWeight: 600 }}>Allow Negative Balance</div><div className="help-text">Employees can apply for leave even if their balance is zero.</div></div>
        <input type="checkbox" className="toggle" checked={settings.app.allowNegativeBalance} onChange={e => handleChangeApp('allowNegativeBalance', e.target.checked)}/>
      </div>
    </div>
  );

  const renderWFH = () => (
    <div className="settings-section">
      <h3 className="section-title">Work From Home (WFH) Policies</h3>
      <div className="toggle-row">
        <div><div style={{ fontWeight: 600 }}>Enable WFH</div><div className="help-text">Allow employees to request Work From Home days.</div></div>
        <input type="checkbox" className="toggle" checked={settings.app.wfhEnabled} onChange={e => handleChangeApp('wfhEnabled', e.target.checked)}/>
      </div>
      {settings.app.wfhEnabled && (
        <>
          <div className="form-grid" style={{ marginTop: '1.5rem' }}>
            <div><label className="form-label">Maximum WFH Days Per Month</label><input type="number" className="form-control" value={settings.app.wfhMaxDaysPerMonth} onChange={e => handleChangeApp('wfhMaxDaysPerMonth', parseInt(e.target.value) || 0)}/></div>
          </div>
          <div className="toggle-row" style={{ marginTop: '1rem' }}>
            <div><div style={{ fontWeight: 600 }}>WFH Approval Required</div><div className="help-text">WFH requests must be approved before being active.</div></div>
            <input type="checkbox" className="toggle" checked={settings.app.wfhApprovalRequired} onChange={e => handleChangeApp('wfhApprovalRequired', e.target.checked)}/>
          </div>
        </>
      )}
    </div>
  );

  const renderPermission = () => (
    <div className="settings-section">
      <h3 className="section-title">Permission Policies (Hourly Time-Off)</h3>
      <div className="toggle-row">
        <div><div style={{ fontWeight: 600 }}>Enable Permissions</div><div className="help-text">Allow employees to request a few hours off during a shift.</div></div>
        <input type="checkbox" className="toggle" checked={settings.app.permissionEnabled} onChange={e => handleChangeApp('permissionEnabled', e.target.checked)}/>
      </div>
      {settings.app.permissionEnabled && (
        <>
          <div className="form-grid" style={{ marginTop: '1.5rem' }}>
            <div><label className="form-label">Max Hours Per Request</label><input type="number" step="0.5" className="form-control" value={settings.app.permissionMaxHours} onChange={e => handleChangeApp('permissionMaxHours', parseFloat(e.target.value) || 0)}/></div>
          </div>
          <div className="toggle-row" style={{ marginTop: '1rem' }}>
            <div><div style={{ fontWeight: 600 }}>Approval Required</div><div className="help-text">Permissions must be approved before being valid.</div></div>
            <input type="checkbox" className="toggle" checked={settings.app.permissionApprovalRequired} onChange={e => handleChangeApp('permissionApprovalRequired', e.target.checked)}/>
          </div>
        </>
      )}
    </div>
  );

  const renderPayroll = () => (
    <div className="settings-section">
      <h3 className="section-title">Payroll Configuration</h3>
      <div className="warning-box"><AlertCircle size={16}/> Modifying these rules affects dynamic payroll calculations and deductions.</div>
      
      <h3 className="section-title" style={{ marginTop: '2rem' }}>General Settings</h3>
      <div className="form-grid">
        <div>
          <label className="form-label">Working Days Basis</label>
          <select className="form-control" value={settings.payroll.workingDaysBasis} onChange={e => handleChangePayroll('workingDaysBasis', e.target.value)}>
            <option value="configured">Configured Working Days</option>
            <option value="calendar">Calendar Days</option>
            <option value="actual">Actual Working Days</option>
          </select>
        </div>
        {settings.payroll.workingDaysBasis === 'configured' && (
          <div><label className="form-label">Configured Working Days</label><input type="number" className="form-control" value={settings.payroll.configuredWorkingDays} onChange={e => handleChangePayroll('configuredWorkingDays', parseInt(e.target.value) || 0)}/></div>
        )}
        <div>
          <label className="form-label">Salary Rounding</label>
          <select className="form-control" value={settings.payroll.salaryRounding} onChange={e => handleChangePayroll('salaryRounding', e.target.value)}>
            <option value="round">Round to nearest integer</option>
            <option value="exact">Exact decimals</option>
          </select>
        </div>
      </div>
      
      <div className="toggle-row" style={{ marginTop: '1rem' }}>
        <div><div style={{ fontWeight: 600 }}>Require Multi-Level Approval</div><div className="help-text">Require multiple admins to approve payroll runs.</div></div>
        <input type="checkbox" className="toggle" checked={settings.payroll.requireMultiLevelApproval} onChange={e => handleChangePayroll('requireMultiLevelApproval', e.target.checked)}/>
      </div>

      <h3 className="section-title" style={{ marginTop: '2rem' }}>Deduction Rules</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div className="toggle-row"><span style={{ fontWeight: 500, fontSize: '0.875rem' }}>Enable LOP (Loss of Pay) Deductions</span><input type="checkbox" checked={settings.payroll.enableLopDeductions} onChange={e => handleChangePayroll('enableLopDeductions', e.target.checked)}/></div>
        <div className="toggle-row"><span style={{ fontWeight: 500, fontSize: '0.875rem' }}>Enable Half-Day Deductions</span><input type="checkbox" checked={settings.payroll.enableHalfDayDeductions} onChange={e => handleChangePayroll('enableHalfDayDeductions', e.target.checked)}/></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '1rem', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 500, fontSize: '0.875rem' }}>Enable Late Login Deduction</span>
            <input type="checkbox" checked={settings.payroll.enableLateLoginDeduction} onChange={e => handleChangePayroll('enableLateLoginDeduction', e.target.checked)}/>
          </div>
          {settings.payroll.enableLateLoginDeduction && (
            <div className="form-grid" style={{ marginTop: '0.5rem' }}>
              <div>
                <label className="form-label">Monthly Late Login Limit</label>
                <input type="number" className="form-control" value={settings.payroll.monthlyLateLoginLimit} onChange={e => handleChangePayroll('monthlyLateLoginLimit', parseInt(e.target.value) || 0)}/>
              </div>
              <div>
                <label className="form-label">Deduction Method</label>
                <select className="form-control" value={settings.payroll.lateDeductionMethod} onChange={e => handleChangePayroll('lateDeductionMethod', e.target.value)}>
                  <option value="fixed">Fixed Amount</option>
                  <option value="per_minute">Per Late Minute</option>
                  <option value="half_day">Half Day (existing)</option>
                </select>
              </div>
              <div>
                <label className="form-label">Amount / Rate</label>
                <input type="number" className="form-control" value={settings.payroll.lateDeductionAmountOrRate} onChange={e => handleChangePayroll('lateDeductionAmountOrRate', parseFloat(e.target.value) || 0)}/>
              </div>
            </div>
          )}
        </div>
        <div className="toggle-row">
          <div>
            <span style={{ fontWeight: 500, fontSize: '0.875rem' }}>Deduct for Permissions Exceeding Limit</span>
            {settings.payroll.enablePermissionDeduction && <div style={{ marginTop: '0.5rem' }}><label className="form-label">Permission Limit</label><input type="number" className="form-control" style={{ width: '100px', display: 'inline-block', padding: '0.25rem 0.5rem' }} value={settings.payroll.permissionLimit} onChange={e => handleChangePayroll('permissionLimit', parseInt(e.target.value) || 0)}/></div>}
          </div>
          <input type="checkbox" checked={settings.payroll.enablePermissionDeduction} onChange={e => handleChangePayroll('enablePermissionDeduction', e.target.checked)}/>
        </div>
        <div className="toggle-row"><span style={{ fontWeight: 500, fontSize: '0.875rem' }}>Deduct for WFH Days</span><input type="checkbox" checked={settings.payroll.enableWfhDeduction} onChange={e => handleChangePayroll('enableWfhDeduction', e.target.checked)}/></div>
      </div>
      
      <h3 className="section-title" style={{ marginTop: '2rem' }}>Overtime Rules</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div className="toggle-row"><span style={{ fontWeight: 500, fontSize: '0.875rem' }}>Enable Overtime Pay</span><input type="checkbox" checked={settings.payroll.enableOvertimePay} onChange={e => handleChangePayroll('enableOvertimePay', e.target.checked)}/></div>
        {settings.payroll.enableOvertimePay && (
          <div className="sub-settings" style={{ gridTemplateColumns: '1fr' }}>
            <div style={{ marginBottom: '1rem' }}>
              <label className="form-label">Overtime Rate Type</label>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><input type="radio" checked={settings.payroll.overtimeRateType === 'multiplier'} onChange={() => handleChangePayroll('overtimeRateType', 'multiplier')}/> Multiplier</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><input type="radio" checked={settings.payroll.overtimeRateType === 'fixed'} onChange={() => handleChangePayroll('overtimeRateType', 'fixed')}/> Fixed Rate</label>
              </div>
            </div>
            {settings.payroll.overtimeRateType === 'multiplier' && (
              <div><label className="form-label">Overtime Multiplier (e.g., 1.5)</label><input type="number" step="0.1" className="form-control" value={settings.payroll.overtimeMultiplier} onChange={e => handleChangePayroll('overtimeMultiplier', parseFloat(e.target.value) || 0)}/></div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  const renderGeofencing = () => (
    <div className="settings-section">
      <h3 className="section-title">Location Verification (Geofencing)</h3>
      <div className="warning-box"><AlertCircle size={16}/> This affects employee Clock In/Clock Out eligibility based on assigned office.</div>
      
      <div className="toggle-row" style={{ marginTop: '1.5rem' }}>
        <div><div style={{ fontWeight: 600 }}>Enable Office Geofencing</div><div className="help-text">Require employees to be physically present at their office.</div></div>
        <input type="checkbox" className="toggle" checked={settings.app.geofenceEnabled} onChange={e => handleChangeApp('geofenceEnabled', e.target.checked)}/>
      </div>

      {settings.app.geofenceEnabled && (
        <div className="sub-settings">
          <div>
            <label className="form-label">Default Radius (Meters)</label>
            <input type="number" className="form-control" value={settings.app.defaultRadiusMeters} onChange={e => handleChangeApp('defaultRadiusMeters', parseInt(e.target.value) || 0)}/>
          </div>
          <div><label className="form-label">Required Accuracy</label><select className="form-control" value={settings.app.locationAccuracy} onChange={e => handleChangeApp('locationAccuracy', e.target.value as any)}><option>High</option><option>Good</option><option>Any</option></select></div>
          <div className="toggle-row" style={{ gridColumn: '1 / -1' }}><span style={{ fontWeight: 500, fontSize: '0.875rem' }}>Allow Clock In Outside Geofence (Flags as exception)</span><input type="checkbox" checked={settings.app.allowOutsideClockIn} onChange={e => handleChangeApp('allowOutsideClockIn', e.target.checked)}/></div>
        </div>
      )}
    </div>
  );

  const renderContent = () => {
    switch(activeTab) {
      case 'General': return renderGeneral();
      case 'Company': return renderCompany();
      case 'Working Hours': return renderWorkingHours();
      case 'Attendance': return renderAttendance();
      case 'Breaks': return renderBreaks();
      case 'Shifts': return renderShifts();
      case 'Leave': return renderLeave();
      case 'WFH': return renderWFH();
      case 'Permission': return renderPermission();
      case 'Payroll': return renderPayroll();
      case 'Geofencing': return renderGeofencing();
      default: return (
        <div className="settings-section" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
          <SettingsIcon size={48} color="var(--gray-300)" style={{ margin: '0 auto 1rem auto' }}/>
          <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>{activeTab} Settings</h3>
          <p style={{ color: 'var(--text-secondary)' }}>Configure {activeTab} settings.</p>
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

      {errorMsg && (
        <div style={{ position: 'fixed', top: '24px', left: '50%', transform: 'translateX(-50%)', backgroundColor: 'var(--danger)', color: '#fff', padding: '0.75rem 1.5rem', borderRadius: 'var(--radius-full)', zIndex: 1000, display: 'flex', alignItems: 'center', gap: '0.5rem', boxShadow: 'var(--shadow-lg)', animation: 'slideDown 0.3s forwards' }}>
          <AlertCircle size={18} />
          {errorMsg}
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
        <div className="settings-nav card" style={{ padding: '0.5rem 0', width: '220px', flexShrink: 0, height: 'fit-content' }}>
          {navCategories.map(cat => (
            <button key={cat} onClick={() => setActiveTab(cat)} className={`nav-item ${activeTab === cat ? 'active' : ''}`}>
              {cat}
            </button>
          ))}
        </div>

        {/* Content Area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1.5rem', paddingBottom: '6rem', minWidth: 0 }}>
          {renderContent()}
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

      <style>{`
        .settings-section { background-color: var(--bg-surface); padding: 1.5rem; border-radius: var(--radius-xl); border: 1px solid var(--border-color); box-shadow: var(--shadow-sm); }
        .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.5rem; }
        
        .nav-item { width: 100%; text-align: left; padding: 0.75rem 1.25rem; background: none; border: none; font-size: 0.875rem; font-weight: 500; color: var(--text-secondary); cursor: pointer; border-left: 3px solid transparent; transition: all 0.2s; }
        .nav-item:hover { background-color: var(--bg-surface-elevated); color: var(--text-primary); }
        .nav-item.active { border-left-color: var(--primary-500); color: var(--primary-600); background-color: rgba(124, 92, 255, 0.05); font-weight: 600; }
        
        .toggle-row { display: flex; justify-content: space-between; align-items: center; padding: 1rem; background-color: var(--bg-surface-elevated); border-radius: var(--radius-md); border: 1px solid var(--border-color); }
        .help-text { font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem; }
        .warning-box { background-color: rgba(251, 191, 36, 0.1); border: 1px dashed var(--warning); padding: 1rem; border-radius: var(--radius-md); color: var(--warning-600); font-size: 0.875rem; display: flex; align-items: center; gap: 0.5rem; }
        .sub-settings { display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem; padding: 1rem; border-left: 2px solid var(--border-color); margin-left: 1rem; margin-top: 0.5rem; }

        .bottom-action-bar { position: fixed; bottom: 0; left: 0; right: 0; padding: 1rem 2rem; background-color: var(--bg-surface); border-top: 1px solid var(--border-color); z-index: 100; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 -10px 40px rgba(0,0,0,0.1); }
        
        @media (max-width: 900px) { 
          .responsive-layout { flex-direction: column !important; }
          .settings-nav { display: flex; overflow-x: auto; padding: 0 !important; border-bottom: 1px solid var(--border-color); }
          .nav-item { white-space: nowrap; border-left: none; border-bottom: 3px solid transparent; padding: 1rem; }
          .nav-item.active { border-left: none; border-bottom-color: inherit; }
          .form-grid { grid-template-columns: 1fr; gap: 1rem; }
          .sub-settings { grid-template-columns: 1fr; }
          .bottom-action-bar { padding: 1rem; flex-direction: column; gap: 1rem; }
        }
        
        @keyframes slideDown { from { transform: translate(-50%, -100%); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }
        .skeleton { background: linear-gradient(90deg, var(--gray-200) 25%, var(--gray-100) 50%, var(--gray-200) 75%); background-size: 200% 100%; animation: skeleton-loading 1.5s infinite; }
        @keyframes skeleton-loading { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
      `}</style>
    </div>
  );
};

export default AdminSettings;
