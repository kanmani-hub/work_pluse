import React, { useState, useEffect } from 'react';
import { 
  Save, RotateCcw, AlertTriangle, Settings as SettingsIcon, CheckCircle2,
  AlertCircle, X
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { appSettingsService, type AppSettings } from '../../services/settings/appSettingsService';
import { globalSettingsService } from '../../services/settings/globalSettingsService';
import { formatSavedAt } from '../../utils/lastUpdated';
import { addHoliday, removeHoliday } from '../../services/settings/holidayRules';
import { WFH_DEDUCTION_POLICY_APPROVED } from '../../services/payroll/payrollRules';
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
  
  // From app_settings.updated_at (set by the database trigger on every save); never invented
  const [lastSaved, setLastSaved] = useState('Not available');
  const [toast, setToast] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [holidayDraft, setHolidayDraft] = useState({ date: '', name: '' });
  const [holidayError, setHolidayError] = useState<string | null>(null);
  
  // Modals
  const [confirmModal, setConfirmModal] = useState<any>(null);

  const loadSettings = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const combined = await globalSettingsService.loadSettings();
      setLastSaved(formatSavedAt(combined.updated_at));
      setSettings(JSON.parse(JSON.stringify(combined)));
      setInitialState(JSON.parse(JSON.stringify(combined)));
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

  const handleSave = async () => {
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

      // Save to Supabase using globalSettingsService (Single Source of Truth)
      // The error is now thrown directly from globalSettingsService
      await globalSettingsService.saveSettings(settings);
      
      setInitialState(JSON.parse(JSON.stringify(settings)));
      setHasChanges(false);
      
      // Refresh the settings to get the actual updated_at
      const freshSettings = await globalSettingsService.getSettings();
      setLastSaved(formatSavedAt(freshSettings.updated_at));
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
      <h3 className="section-title" style={{ marginTop: '2rem' }}>Public Holidays</h3>
      <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>Holidays are not working days: payroll does not count them as absence (LOP). Click Save Changes to apply.</p>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div><label className="form-label">Date</label><input type="date" className="form-control" value={holidayDraft.date} onChange={e => setHolidayDraft(h => ({ ...h, date: e.target.value }))}/></div>
        <div style={{ flex: 1, minWidth: '12rem' }}><label className="form-label">Holiday name</label><input type="text" className="form-control" value={holidayDraft.name} onChange={e => setHolidayDraft(h => ({ ...h, name: e.target.value }))}/></div>
        <button type="button" className="btn btn-outline" onClick={() => {
          const res = addHoliday(settings.app.publicHolidays, holidayDraft.date, holidayDraft.name);
          setHolidayError(res.error);
          if (!res.error) { handleChangeApp('publicHolidays', res.list); setHolidayDraft({ date: '', name: '' }); }
        }}>Add holiday</button>
      </div>
      {holidayError && <div style={{ color: 'var(--danger)', fontSize: '0.8125rem', marginTop: '0.5rem' }}>{holidayError}</div>}
      <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
        {(settings.app.publicHolidays || []).length === 0
          ? <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>No public holidays configured.</div>
          : (settings.app.publicHolidays || []).map(h => (
            <div key={h.date} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)' }}>
              <span><strong>{h.date}</strong> — {h.name}</span>
              <button type="button" className="btn btn-outline" style={{ fontSize: '0.75rem' }} onClick={() => handleChangeApp('publicHolidays', removeHoliday(settings.app.publicHolidays, h.date))}>Remove</button>
            </div>
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
      
      <h3 className="section-title" style={{ marginTop: '2rem' }}>Automatic Clock-Out</h3>
      <div className="toggle-row">
        <div><div style={{ fontWeight: 600 }}>Enable Automatic Clock-Out</div><div className="help-text">Employees who remain clocked in after their shift will be automatically clocked out after the configured grace period.</div></div>
        <input type="checkbox" className="toggle" checked={settings.app.autoClockOut} onChange={e => handleChangeApp('autoClockOut', e.target.checked)}/>
      </div>
      {settings.app.autoClockOut && (
        <div className="form-grid" style={{ marginTop: '0.5rem', backgroundColor: 'var(--bg-surface-elevated)', padding: '1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
          <div>
            <label className="form-label">Auto Clock-Out After Shift Ends (Hours)</label>
            <input type="number" min="0" className="form-control" value={settings.app.autoClockOutGraceHours} onChange={e => handleChangeApp('autoClockOutGraceHours', parseInt(e.target.value) || 0)}/>
          </div>
          <div>
            <label className="form-label">Auto Clock-Out Mode</label>
            <select className="form-control" value={settings.app.autoClockOutMode} onChange={e => handleChangeApp('autoClockOutMode', e.target.value)}>
              <option value="after_grace_period">After Grace Period</option>
              <option value="at_shift_end">At Shift End</option>
            </select>
          </div>
        </div>
      )}

      <h3 className="section-title" style={{ marginTop: '2rem' }}>System Behaviors</h3>
      <div className="toggle-row">
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
      <h3 className="section-title">Leave Rules</h3>
      <div className="form-grid">
        <label className="checkbox-label" style={{ gridColumn: '1 / -1' }}>
          <input type="checkbox" checked={settings.app.leaveEnabled} onChange={e => handleChangeApp('leaveEnabled', e.target.checked)}/>
          Leave Module Enabled
        </label>
        <label className="checkbox-label" style={{ gridColumn: '1 / -1' }}>
          <input type="checkbox" checked={settings.app.leaveApprovalRequired} onChange={e => handleChangeApp('leaveApprovalRequired', e.target.checked)}/>
          Leave Requires Approval
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={settings.app.allowPastDateLeave} onChange={e => handleChangeApp('allowPastDateLeave', e.target.checked)}/>
          Allow Past Date Application
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={settings.app.allowNegativeBalance} onChange={e => handleChangeApp('allowNegativeBalance', e.target.checked)}/>
          Allow Negative Balance
        </label>
      </div>
      
      <h3 className="section-title" style={{ marginTop: '2rem' }}>Casual Leave</h3>
      <div className="form-grid">
        <label className="checkbox-label" style={{ gridColumn: '1 / -1' }}>
          <input type="checkbox" checked={settings.app.casualLeaveEnabled} onChange={e => handleChangeApp('casualLeaveEnabled', e.target.checked)}/>
          Casual Leave Enabled
        </label>
        <div>
          <label className="form-label">Casual Leave Days Per Month</label>
          <input type="number" min="0" className="form-control" value={settings.app.casualLeaveDaysPerMonth} onChange={e => handleChangeApp('casualLeaveDaysPerMonth', parseInt(e.target.value) || 0)}/>
        </div>
      </div>

      <h3 className="section-title" style={{ marginTop: '2rem' }}>Sandwich Leave Policy</h3>
      <div className="form-grid">
        <label className="checkbox-label" style={{ gridColumn: '1 / -1' }}>
          <input type="checkbox" checked={settings.app.enableSandwichLeave} onChange={e => handleChangeApp('enableSandwichLeave', e.target.checked)}/>
          Enable Sandwich Leave
        </label>
        {settings.app.enableSandwichLeave && (
          <>
            <div>
              <label className="form-label">Sandwich Treatment</label>
              <select className="form-control" value={settings.app.sandwichTreatment} onChange={e => handleChangeApp('sandwichTreatment', e.target.value)}>
                <option value="LOP">Loss of Pay (LOP)</option>
                <option value="DEDUCT_LEAVE">Deduct Leave Balance</option>
              </select>
            </div>
            <label className="checkbox-label" style={{ gridColumn: '1 / -1' }}>
              <input type="checkbox" checked={settings.app.applySandwichToWeeklyOff} onChange={e => handleChangeApp('applySandwichToWeeklyOff', e.target.checked)}/>
              Apply Sandwich Rule to Weekly Off
            </label>
            <label className="checkbox-label" style={{ gridColumn: '1 / -1' }}>
              <input type="checkbox" checked={settings.app.applySandwichToPublicHoliday} onChange={e => handleChangeApp('applySandwichToPublicHoliday', e.target.checked)}/>
              Apply Sandwich Rule to Public Holidays
            </label>
            <label className="checkbox-label" style={{ gridColumn: '1 / -1' }}>
              <input type="checkbox" checked={settings.app.requireApprovedLeaveOnBothSides} onChange={e => handleChangeApp('requireApprovedLeaveOnBothSides', e.target.checked)}/>
              Require Approved Leave On Both Sides
            </label>
          </>
        )}
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
      <h3 className="section-title">Permission Rules</h3>
      <div className="form-grid">
        <label className="checkbox-label" style={{ gridColumn: '1 / -1' }}>
          <input type="checkbox" checked={settings.app.permissionEnabled} onChange={e => handleChangeApp('permissionEnabled', e.target.checked)}/>
          Permission Module Enabled
        </label>
        <label className="checkbox-label" style={{ gridColumn: '1 / -1' }}>
          <input type="checkbox" checked={settings.app.permissionApprovalRequired} onChange={e => handleChangeApp('permissionApprovalRequired', e.target.checked)}/>
          Permission Requires Approval
        </label>
        <div>
          <label className="form-label">Maximum Permission Hours Per Month</label>
          <input type="number" min="0" className="form-control" value={settings.app.permissionMaxHoursPerMonth} onChange={e => handleChangeApp('permissionMaxHoursPerMonth', parseInt(e.target.value) || 0)}/>
        </div>
      </div>
      
      <h3 className="section-title" style={{ marginTop: '2rem' }}>Exceeding Limits</h3>
      <div className="form-grid">
        <label className="checkbox-label" style={{ gridColumn: '1 / -1' }}>
          <input type="checkbox" checked={settings.app.deductForPermissionExceedingLimit} onChange={e => handleChangeApp('deductForPermissionExceedingLimit', e.target.checked)}/>
          Deduct for Permissions Exceeding Limit
        </label>
        {settings.app.deductForPermissionExceedingLimit && (
          <>
            <div>
              <label className="form-label">Permission Exceeding Limit Method</label>
              <select className="form-control" value={settings.app.permissionExceedingLimitMethod} onChange={e => handleChangeApp('permissionExceedingLimitMethod', e.target.value)}>
                <option value="LOP">Loss of Pay (LOP)</option>
                <option value="DEDUCT_LEAVE">Deduct Leave Balance</option>
              </select>
            </div>
            <div>
              <label className="form-label">Permission Deduction Amount/Rate</label>
              <input type="number" min="0" step="0.5" className="form-control" value={settings.app.permissionDeductionAmountRate} onChange={e => handleChangeApp('permissionDeductionAmountRate', parseFloat(e.target.value) || 0)}/>
            </div>
          </>
        )}
      </div>
    </div>
  );

  const renderPayroll = () => (
    <div className="settings-section">
      <h3 className="section-title">Payroll Configuration</h3>
      <div className="warning-box"><AlertCircle size={16}/> Modifying these rules affects dynamic payroll calculations and deductions.</div>
      
      <h3 className="section-title" style={{ marginTop: '2rem' }}>General Settings</h3>
      <div className="form-grid">
        <div>
          <label className="form-label">Payroll Period</label>
          <select className="form-control" value={settings.payroll.payrollPeriod || 'monthly'} onChange={e => handleChangePayroll('payrollPeriod', e.target.value)}>
            <option value="1_day">1 Day</option>
            <option value="10_days">10 Days</option>
            <option value="15_days">15 Days</option>
            <option value="monthly">Monthly</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        <div>
          <label className="form-label">Working Days Basis</label>
          <select className="form-control" value={settings.payroll.workingDaysBasis} onChange={e => handleChangePayroll('workingDaysBasis', e.target.value)}>
            <option value="configured">Configured Working Days</option>
            <option value="calendar">Calendar Days</option>
            <option value="actual">Actual Working Days</option>
          </select>
        </div>
        {settings.payroll.workingDaysBasis === 'configured' && (
          <div><label className="form-label">Configured Working Days</label><input type="number" className="form-control" value={settings.payroll.configuredWorkingDays !== null ? settings.payroll.configuredWorkingDays : ''} onChange={e => handleChangePayroll('configuredWorkingDays', e.target.value === '' ? null : parseInt(e.target.value))}/></div>
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
      {settings.payroll.requireMultiLevelApproval && (
        <div className="form-grid" style={{ marginTop: '0.5rem' }}>
          <div><label className="form-label">Number of Approval Levels</label><input type="number" className="form-control" value={settings.payroll.approvalLevels !== null ? settings.payroll.approvalLevels : ''} onChange={e => handleChangePayroll('approvalLevels', e.target.value === '' ? null : parseInt(e.target.value))}/></div>
        </div>
      )}

      <h3 className="section-title" style={{ marginTop: '2rem' }}>LOP Settings</h3>
      <div className="toggle-row">
        <div><div style={{ fontWeight: 600 }}>Enable LOP (Loss of Pay) Deductions</div></div>
        <input type="checkbox" className="toggle" checked={settings.payroll.enableLopDeductions} onChange={e => handleChangePayroll('enableLopDeductions', e.target.checked)}/>
      </div>
      {settings.payroll.enableLopDeductions && (
        <div className="form-grid" style={{ marginTop: '0.5rem', backgroundColor: 'var(--bg-surface-elevated)', padding: '1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
          <div>
            <label className="form-label">LOP Calculation Basis</label>
            <select className="form-control" value={settings.payroll.lopMethod} onChange={e => handleChangePayroll('lopMethod', e.target.value)}>
              <option value="daily_rate">Daily Rate</option>
              <option value="fixed">Fixed Amount</option>
            </select>
          </div>
          {settings.payroll.lopMethod === 'fixed' && (
            <div><label className="form-label">LOP Amount / Rate (₹)</label><input type="number" className="form-control" value={settings.payroll.lopAmount !== null ? settings.payroll.lopAmount : ''} onChange={e => handleChangePayroll('lopAmount', e.target.value === '' ? null : parseFloat(e.target.value))}/></div>
          )}
        </div>
      )}

      <h3 className="section-title" style={{ marginTop: '2rem' }}>Half-Day Deduction</h3>
      <div className="toggle-row">
        <div><div style={{ fontWeight: 600 }}>Enable Half-Day Deductions</div></div>
        <input type="checkbox" className="toggle" checked={settings.payroll.enableHalfDayDeductions} onChange={e => handleChangePayroll('enableHalfDayDeductions', e.target.checked)}/>
      </div>
      {settings.payroll.enableHalfDayDeductions && (
        <div className="form-grid" style={{ marginTop: '0.5rem', backgroundColor: 'var(--bg-surface-elevated)', padding: '1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
          <div>
            <label className="form-label">Half-Day Deduction Method</label>
            <select className="form-control" value={settings.payroll.halfDayMethod} onChange={e => handleChangePayroll('halfDayMethod', e.target.value)}>
              <option value="50_percent">50% of Daily Salary</option>
              <option value="fixed">Fixed Amount</option>
            </select>
          </div>
          {settings.payroll.halfDayMethod === 'fixed' && (
            <div><label className="form-label">Half-Day Deduction Amount (₹)</label><input type="number" className="form-control" value={settings.payroll.halfDayAmount !== null ? settings.payroll.halfDayAmount : ''} onChange={e => handleChangePayroll('halfDayAmount', e.target.value === '' ? null : parseFloat(e.target.value))}/></div>
          )}
        </div>
      )}

      <h3 className="section-title" style={{ marginTop: '2rem' }}>Late Login Deduction</h3>
      <div className="toggle-row">
        <div><div style={{ fontWeight: 600 }}>Enable Late Login Deduction</div></div>
        <input type="checkbox" className="toggle" checked={settings.payroll.enableLateLoginDeduction} onChange={e => handleChangePayroll('enableLateLoginDeduction', e.target.checked)}/>
      </div>
      {settings.payroll.enableLateLoginDeduction && (
        <div style={{ marginTop: '0.5rem', backgroundColor: 'var(--bg-surface-elevated)', padding: '1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="form-grid">
            <div>
              <label className="form-label">Monthly Late Login Limit</label>
              <input type="number" className="form-control" value={settings.payroll.monthlyLateLoginLimit !== null ? settings.payroll.monthlyLateLoginLimit : ''} onChange={e => handleChangePayroll('monthlyLateLoginLimit', e.target.value === '' ? null : parseInt(e.target.value))}/>
            </div>
            <div>
              <label className="form-label">Deduction Method</label>
              <select className="form-control" value={settings.payroll.lateDeductionMethod} onChange={e => handleChangePayroll('lateDeductionMethod', e.target.value)}>
                <option value="interval_based">Every 15 Minutes</option>
                <option value="fixed">Fixed Amount</option>
                <option value="per_minute">Per Late Minute</option>
                <option value="half_day">Half Day</option>
              </select>
            </div>
          </div>
          <div className="form-grid">
            {settings.payroll.lateDeductionMethod === 'interval_based' && (
              <>
                <div><label className="form-label">Deduction Interval (minutes)</label><input type="number" className="form-control" value={settings.payroll.lateIntervalMinutes !== null ? settings.payroll.lateIntervalMinutes : ''} onChange={e => handleChangePayroll('lateIntervalMinutes', e.target.value === '' ? null : parseInt(e.target.value))}/></div>
                <div><label className="form-label">Deduction Amount (₹)</label><input type="number" className="form-control" value={settings.payroll.lateIntervalAmount !== null ? settings.payroll.lateIntervalAmount : ''} onChange={e => handleChangePayroll('lateIntervalAmount', e.target.value === '' ? null : parseFloat(e.target.value))}/></div>
              </>
            )}
            {settings.payroll.lateDeductionMethod === 'fixed' && (
              <div><label className="form-label">Amount per Late Occurrence (₹)</label><input type="number" className="form-control" value={settings.payroll.lateFixedAmount !== null ? settings.payroll.lateFixedAmount : ''} onChange={e => handleChangePayroll('lateFixedAmount', e.target.value === '' ? null : parseFloat(e.target.value))}/></div>
            )}
            {settings.payroll.lateDeductionMethod === 'per_minute' && (
              <div><label className="form-label">Amount per Late Minute (₹)</label><input type="number" className="form-control" value={settings.payroll.latePerMinuteRate !== null ? settings.payroll.latePerMinuteRate : ''} onChange={e => handleChangePayroll('latePerMinuteRate', e.target.value === '' ? null : parseFloat(e.target.value))}/></div>
            )}
            {settings.payroll.lateDeductionMethod === 'half_day' && (
              <div><label className="form-label">Half-Day Amount (₹)</label><input type="number" className="form-control" value={settings.payroll.lateHalfDayAmount !== null ? settings.payroll.lateHalfDayAmount : ''} onChange={e => handleChangePayroll('lateHalfDayAmount', e.target.value === '' ? null : parseFloat(e.target.value))}/></div>
            )}
          </div>
        </div>
      )}

      <h3 className="section-title" style={{ marginTop: '2rem' }}>Permission Deduction</h3>
      <div className="toggle-row">
        <div><div style={{ fontWeight: 600 }}>Deduct for Permissions Exceeding Limit</div></div>
        <input type="checkbox" className="toggle" checked={settings.payroll.enablePermissionDeduction} onChange={e => handleChangePayroll('enablePermissionDeduction', e.target.checked)}/>
      </div>
      {settings.payroll.enablePermissionDeduction && (
        <div style={{ marginTop: '0.5rem', backgroundColor: 'var(--bg-surface-elevated)', padding: '1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="form-grid">
            <div>
              <label className="form-label">Monthly Permission Limit</label>
              <input type="number" className="form-control" value={settings.payroll.permissionLimit !== null ? settings.payroll.permissionLimit : ''} onChange={e => handleChangePayroll('permissionLimit', e.target.value === '' ? null : parseInt(e.target.value))}/>
            </div>
            <div>
              <label className="form-label">Deduction Method</label>
              <select className="form-control" value={settings.payroll.permissionDeductionMethod} onChange={e => handleChangePayroll('permissionDeductionMethod', e.target.value)}>
                <option value="fixed">Fixed Amount</option>
                <option value="per_minute">Per Excess Minute</option>
                <option value="salary_based">Salary Based</option>
                <option value="half_day">Half Day</option>
              </select>
            </div>
          </div>
          <div className="form-grid">
            {settings.payroll.permissionDeductionMethod === 'fixed' && (
              <div><label className="form-label">Amount (₹)</label><input type="number" className="form-control" value={settings.payroll.permissionFixedAmount !== null ? settings.payroll.permissionFixedAmount : ''} onChange={e => handleChangePayroll('permissionFixedAmount', e.target.value === '' ? null : parseFloat(e.target.value))}/></div>
            )}
            {settings.payroll.permissionDeductionMethod === 'per_minute' && (
              <div><label className="form-label">Rate per Excess Minute (₹)</label><input type="number" className="form-control" value={settings.payroll.permissionPerMinuteRate !== null ? settings.payroll.permissionPerMinuteRate : ''} onChange={e => handleChangePayroll('permissionPerMinuteRate', e.target.value === '' ? null : parseFloat(e.target.value))}/></div>
            )}
            {settings.payroll.permissionDeductionMethod === 'half_day' && (
              <div><label className="form-label">Half-Day Deduction (₹)</label><input type="number" className="form-control" value={settings.payroll.permissionHalfDayAmount !== null ? settings.payroll.permissionHalfDayAmount : ''} onChange={e => handleChangePayroll('permissionHalfDayAmount', e.target.value === '' ? null : parseFloat(e.target.value))}/></div>
            )}
          </div>
        </div>
      )}

      <h3 className="section-title" style={{ marginTop: '2rem' }}>WFH Deduction</h3>
      {!WFH_DEDUCTION_POLICY_APPROVED && (
        <div className="warning-box" style={{ marginBottom: '0.75rem' }}><AlertCircle size={16}/> WFH deductions are disabled in payroll until a WFH deduction policy is approved. This setting currently has no effect on salary.</div>
      )}
      <div className="toggle-row">
        <div><div style={{ fontWeight: 600 }}>Deduct for WFH Days</div></div>
        <input type="checkbox" className="toggle" checked={settings.payroll.enableWfhDeduction} onChange={e => handleChangePayroll('enableWfhDeduction', e.target.checked)}/>
      </div>
      {settings.payroll.enableWfhDeduction && (
        <div style={{ marginTop: '0.5rem', backgroundColor: 'var(--bg-surface-elevated)', padding: '1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="form-grid">
            <div>
              <label className="form-label">Deduction Method</label>
              <select className="form-control" value={settings.payroll.wfhDeductionMethod} onChange={e => handleChangePayroll('wfhDeductionMethod', e.target.value)}>
                <option value="fixed">Fixed Amount</option>
                <option value="per_day">Per WFH Day</option>
                <option value="half_day">Half Day</option>
              </select>
            </div>
          </div>
          <div className="form-grid">
            {settings.payroll.wfhDeductionMethod === 'fixed' && (
              <div><label className="form-label">Amount (₹)</label><input type="number" className="form-control" value={settings.payroll.wfhFixedAmount !== null ? settings.payroll.wfhFixedAmount : ''} onChange={e => handleChangePayroll('wfhFixedAmount', e.target.value === '' ? null : parseFloat(e.target.value))}/></div>
            )}
            {settings.payroll.wfhDeductionMethod === 'per_day' && (
              <div><label className="form-label">Amount per WFH Day (₹)</label><input type="number" className="form-control" value={settings.payroll.wfhPerDayAmount !== null ? settings.payroll.wfhPerDayAmount : ''} onChange={e => handleChangePayroll('wfhPerDayAmount', e.target.value === '' ? null : parseFloat(e.target.value))}/></div>
            )}
            {settings.payroll.wfhDeductionMethod === 'half_day' && (
              <div><label className="form-label">Half-Day Deduction (₹)</label><input type="number" className="form-control" value={settings.payroll.wfhHalfDayAmount !== null ? settings.payroll.wfhHalfDayAmount : ''} onChange={e => handleChangePayroll('wfhHalfDayAmount', e.target.value === '' ? null : parseFloat(e.target.value))}/></div>
            )}
          </div>
        </div>
      )}

      <h3 className="section-title" style={{ marginTop: '2rem' }}>Break Policy</h3>
      <div className="toggle-row">
        <div><div style={{ fontWeight: 600 }}>Enable Break Overrun Detection</div><div className="help-text">Track break duration against allowed time.</div></div>
        <input type="checkbox" className="toggle" checked={settings.payroll.enableBreakOverrunDetection} onChange={e => handleChangePayroll('enableBreakOverrunDetection', e.target.checked)}/>
      </div>
      {settings.payroll.enableBreakOverrunDetection && (
        <div style={{ marginTop: '0.5rem', backgroundColor: 'var(--bg-surface-elevated)', padding: '1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="toggle-row">
            <div><div style={{ fontWeight: 600 }}>Break Overrun Deduction</div></div>
            <input type="checkbox" className="toggle" checked={settings.payroll.enableBreakOverrunDeduction} onChange={e => handleChangePayroll('enableBreakOverrunDeduction', e.target.checked)}/>
          </div>
          {settings.payroll.enableBreakOverrunDeduction && (
            <>
              <div className="form-grid">
                <div>
                  <label className="form-label">Deduction Method</label>
                  <select className="form-control" value={settings.payroll.breakOverrunDeductionMethod} onChange={e => handleChangePayroll('breakOverrunDeductionMethod', e.target.value)}>
                    <option value="salary_based">Salary Based</option>
                    <option value="fixed">Fixed Amount</option>
                    <option value="per_minute">Per Excess Minute</option>
                    <option value="half_day">Half Day</option>
                  </select>
                </div>
              </div>
              <div className="form-grid">
                {settings.payroll.breakOverrunDeductionMethod === 'salary_based' && (
                  <div style={{ gridColumn: '1 / -1', padding: '1rem', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', fontSize: '0.875rem' }}>
                    <strong>Calculation:</strong> Excess break time × employee hourly salary. No fixed amount required.
                  </div>
                )}
                {settings.payroll.breakOverrunDeductionMethod === 'fixed' && (
                  <div><label className="form-label">Amount (₹)</label><input type="number" className="form-control" value={settings.payroll.breakOverrunFixedAmount !== null ? settings.payroll.breakOverrunFixedAmount : ''} onChange={e => handleChangePayroll('breakOverrunFixedAmount', e.target.value === '' ? null : parseFloat(e.target.value))}/></div>
                )}
                {settings.payroll.breakOverrunDeductionMethod === 'per_minute' && (
                  <div><label className="form-label">Rate per Excess Minute (₹)</label><input type="number" className="form-control" value={settings.payroll.breakOverrunPerMinuteRate !== null ? settings.payroll.breakOverrunPerMinuteRate : ''} onChange={e => handleChangePayroll('breakOverrunPerMinuteRate', e.target.value === '' ? null : parseFloat(e.target.value))}/></div>
                )}
                {settings.payroll.breakOverrunDeductionMethod === 'half_day' && (
                  <div><label className="form-label">Half-Day Deduction (₹)</label><input type="number" className="form-control" value={settings.payroll.breakOverrunHalfDayAmount !== null ? settings.payroll.breakOverrunHalfDayAmount : ''} onChange={e => handleChangePayroll('breakOverrunHalfDayAmount', e.target.value === '' ? null : parseFloat(e.target.value))}/></div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      <h3 className="section-title" style={{ marginTop: '2rem' }}>Overtime Settings</h3>
      <div className="toggle-row">
        <div><div style={{ fontWeight: 600 }}>Enable Overtime Pay</div></div>
        <input type="checkbox" className="toggle" checked={settings.payroll.enableOvertimePay} onChange={e => handleChangePayroll('enableOvertimePay', e.target.checked)}/>
      </div>
      {settings.payroll.enableOvertimePay && (
        <div style={{ marginTop: '0.5rem', backgroundColor: 'var(--bg-surface-elevated)', padding: '1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="form-grid">
            <div>
              <label className="form-label">Overtime Rate Type</label>
              <select className="form-control" value={settings.payroll.overtimeRateType} onChange={e => handleChangePayroll('overtimeRateType', e.target.value)}>
                <option value="multiplier">Multiplier</option>
                <option value="fixed">Fixed Rate</option>
              </select>
            </div>
          </div>
          <div className="form-grid">
            {settings.payroll.overtimeRateType === 'multiplier' && (
              <div><label className="form-label">Overtime Multiplier (e.g., 1.5)</label><input type="number" step="0.1" className="form-control" value={settings.payroll.overtimeMultiplier !== null ? settings.payroll.overtimeMultiplier : ''} onChange={e => handleChangePayroll('overtimeMultiplier', e.target.value === '' ? null : parseFloat(e.target.value))}/></div>
            )}
            {settings.payroll.overtimeRateType === 'fixed' && (
              <div><label className="form-label">Overtime Rate Per Hour (₹)</label><input type="number" className="form-control" value={settings.payroll.overtimeFixedRate !== null ? settings.payroll.overtimeFixedRate : ''} onChange={e => handleChangePayroll('overtimeFixedRate', e.target.value === '' ? null : parseFloat(e.target.value))}/></div>
            )}
          </div>
        </div>
      )}
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
        .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); gap: 1.5rem; }
        
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
