import { useState, useEffect } from 'react';
/**
 * Application Settings Service
 * 
 * Manages global configuration for the WorkPulse HR platform.
 * Persists to localStorage as primary store (can be migrated to Supabase later).
 */

const SETTINGS_KEY = 'workpulse_app_settings';

import { supabase } from '../../lib/supabase';

export interface AppSettings {
  // General
  appName: string;
  timezone: string;
  dateFormat: string;
  timeFormat: string;
  currency: string;
  weekStartsOn: string;
  theme: string;

  // Company
  companyName: string;
  companyEmail: string;
  companyPhone: string;
  companyAddress: string;
  website: string;

  // Working Hours
  workStartTime: string;
  workEndTime: string;
  workingDays: string[];
  weeklyOff: string[];
  /** Company public holidays (not working days for payroll). */
  publicHolidays: { date: string; name: string }[];

  // Attendance
  requireFaceVerification: boolean;
  requireGeolocation: boolean;
  lateLoginDetection: boolean;
  earlyLogoutDetection: boolean;
  gracePeriodMins: number;
  autoClockOut: boolean;
  autoClockOutGraceHours: number;
  autoClockOutMode: 'after_grace_period' | 'at_shift_end';
  allowCorrection: boolean;

  // Breaks
  breakEnabled: boolean;
  breakDurationMins: number;
  maxBreakDurationMins: number;

  // Shifts
  defaultShift: string;
  shiftGracePeriodMins: number;



  // WFH
  wfhEnabled: boolean;
  wfhMaxDaysPerMonth: number;
  wfhApprovalRequired: boolean;

  // Permission
  permissionEnabled: boolean;
  permissionApprovalRequired: boolean;
  permissionMaxHoursPerMonth: number;
  deductForPermissionExceedingLimit: boolean;
  permissionExceedingLimitMethod: 'LOP' | string;
  permissionDeductionAmountRate: number;

  // Leave
  leaveEnabled: boolean;
  leaveApprovalRequired: boolean;
  allowPastDateLeave: boolean;
  allowHalfDayLeave: boolean; // stored policy; not yet enforced on the employee form
  allowNegativeBalance: boolean;
  casualLeaveEnabled: boolean;
  casualLeaveDaysPerMonth: number;
  
  // Sandwich Leave
  enableSandwichLeave: boolean;
  sandwichRuleAppliesTo: string[];
  sandwichTreatment: 'LOP' | string;
  applySandwichToWeeklyOff: boolean;
  applySandwichToPublicHoliday: boolean;
  requireApprovedLeaveOnBothSides: boolean;

  // Geofencing
  geofenceEnabled: boolean;
  defaultRadiusMeters: number;
  locationAccuracy: 'High' | 'Good' | 'Any';
  allowOutsideClockIn: boolean;
}

const DEFAULT_APP_SETTINGS: AppSettings = {
  appName: 'WorkPulse HR',
  timezone: 'Asia/Kolkata (IST)',
  dateFormat: 'DD/MM/YYYY',
  timeFormat: '12 Hour',
  currency: 'INR (₹)',
  weekStartsOn: 'Monday',
  theme: 'Light',
  companyName: 'Acme Corp',
  companyEmail: 'hr@acme.com',
  companyPhone: '1800-123-4567',
  companyAddress: '123 Tech Park, City',
  website: 'www.acme.com',
  workStartTime: '09:00 AM',
  workEndTime: '06:00 PM',
  workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
  weeklyOff: ['Saturday', 'Sunday'],
  publicHolidays: [],
  requireFaceVerification: true,
  requireGeolocation: true,
  lateLoginDetection: true,
  earlyLogoutDetection: true,
  gracePeriodMins: 0,
  autoClockOut: true,
  autoClockOutGraceHours: 4,
  autoClockOutMode: 'after_grace_period',
  allowCorrection: true,
  breakEnabled: true,
  breakDurationMins: 60,
  maxBreakDurationMins: 90,
  defaultShift: 'General Shift',
  shiftGracePeriodMins: 0,
  leaveEnabled: true,
  leaveApprovalRequired: true,
  allowPastDateLeave: false,
  allowHalfDayLeave: true,
  allowNegativeBalance: false,
  casualLeaveEnabled: true,
  casualLeaveDaysPerMonth: 2,
  wfhEnabled: true,
  wfhMaxDaysPerMonth: 4,
  wfhApprovalRequired: true,
  permissionEnabled: true,
  permissionApprovalRequired: true,
  permissionMaxHoursPerMonth: 3,
  deductForPermissionExceedingLimit: false,
  permissionExceedingLimitMethod: 'LOP',
  permissionDeductionAmountRate: 1,
  enableSandwichLeave: false,
  sandwichRuleAppliesTo: ['Casual Leave'],
  sandwichTreatment: 'LOP',
  applySandwichToWeeklyOff: true,
  applySandwichToPublicHoliday: true,
  requireApprovedLeaveOnBothSides: true,
  geofenceEnabled: true,
  defaultRadiusMeters: 200,
  locationAccuracy: 'High',
  allowOutsideClockIn: false
};

const ALL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/**
 * Company weekly-off days, derived from the saved working days (the single source of truth).
 * Returns null when working days are not configured — callers must not guess a schedule.
 */
export function weeklyOffDaysFrom(app: { workingDays?: string[] | null } | null | undefined): string[] | null {
  const working = Array.isArray(app?.workingDays) ? app!.workingDays!.map(d => String(d).toLowerCase()) : [];
  if (working.length === 0) return null;
  return ALL_DAYS.filter(d => !working.includes(d.toLowerCase()));
}

export const appSettingsService = {
  
  // Local cache
  _settingsCache: null as AppSettings | null,
  _listeners: [] as Array<(settings: AppSettings) => void>,

  _realtimeInitialized: false,

  _initRealtime() {
    if (this._realtimeInitialized) return;
    this._realtimeInitialized = true;
    
    supabase
      .channel('app_settings_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'app_settings'
        },
        (payload: any) => {
          if (payload.new && payload.new.settings) {
            const incoming = payload.new.settings.app || payload.new.settings;
            const newSettings = { ...DEFAULT_APP_SETTINGS, ...incoming };
            this._settingsCache = newSettings;
            this._listeners.forEach(cb => cb(newSettings));
          }
        }
      )
      .subscribe();
  },


  subscribe(callback: (settings: AppSettings) => void) {
    this._listeners.push(callback);
    if (this._settingsCache) callback(this._settingsCache);
    return () => {
      this._listeners = this._listeners.filter(cb => cb !== callback);
    };
  },

  async loadSettings(): Promise<AppSettings> {
    try {
      // @ts-ignore
      const { data, error } = await supabase
        .from('app_settings')
        .select('settings')
        .limit(1)
        .maybeSingle() as any;

      if (error) {
        console.error('Error fetching settings from Supabase:', error);
      }
      
      let finalSettings = { ...DEFAULT_APP_SETTINGS };
      if (data && data.settings) {
        if (data.settings.app) {
          finalSettings = { ...finalSettings, ...data.settings.app };
        } else {
          finalSettings = { ...finalSettings, ...data.settings };
        }
      }
      
      this._settingsCache = finalSettings;
      
      // Notify listeners
      this._listeners.forEach(cb => cb(finalSettings));
      this._initRealtime();
      
      return finalSettings;
    } catch (e) {
      console.error('Failed to load app settings from database:', e);
      return this._settingsCache || { ...DEFAULT_APP_SETTINGS };
    }
  },

  // Fallback for synchronous reads if needed during render, 
  // but we should ensure loadSettings is called on app boot.
  getSettings(): AppSettings {
    if (this._settingsCache) {
      return this._settingsCache;
    }
    // Fallback to local storage or defaults if not loaded yet
    try {
      const stored = localStorage.getItem(SETTINGS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return { ...DEFAULT_APP_SETTINGS, ...parsed };
      }
    } catch (e) {}
    return { ...DEFAULT_APP_SETTINGS };
  },

  async saveSettings(settings: AppSettings): Promise<boolean> {
    try {
      // Local sync only, Supabase is handled by globalSettingsService
      this._settingsCache = settings;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      this._listeners.forEach(cb => cb(settings));
      return true;
    } catch (e) {
      console.error('Failed to save app settings locally:', e);
      return false;
    }
  },


  getDefaults(): AppSettings {
    return { ...DEFAULT_APP_SETTINGS };
  }
};


export function useAppSettings() {
  const [settings, setSettings] = useState<AppSettings>(appSettingsService.getSettings());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    
    // Initial async load
    appSettingsService.loadSettings().then((loaded) => {
      if (isMounted) {
        setSettings(loaded);
        setLoading(false);
      }
    });

    // Subscribe to changes
    const unsubscribe = appSettingsService.subscribe((newSettings) => {
      if (isMounted) {
        setSettings(newSettings);
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  return { settings, loading };
}
