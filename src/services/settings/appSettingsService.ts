/**
 * Application Settings Service
 * 
 * Manages global configuration for the WorkPulse HR platform.
 * Persists to localStorage as primary store (can be migrated to Supabase later).
 */

const SETTINGS_KEY = 'workpulse_app_settings';

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

  // Attendance
  requireFaceVerification: boolean;
  requireGeolocation: boolean;
  lateLoginDetection: boolean;
  earlyLogoutDetection: boolean;
  gracePeriodMins: number;
  autoClockOut: boolean;
  allowCorrection: boolean;

  // Breaks
  breakEnabled: boolean;
  breakDurationMins: number;
  maxBreakDurationMins: number;

  // Shifts
  defaultShift: string;
  shiftGracePeriodMins: number;

  // Leave
  leaveApprovalRequired: boolean;
  allowPastDateLeave: boolean;
  allowNegativeBalance: boolean;

  // WFH
  wfhEnabled: boolean;
  wfhMaxDaysPerMonth: number;
  wfhApprovalRequired: boolean;

  // Permission
  permissionEnabled: boolean;
  permissionMaxHours: number;
  permissionApprovalRequired: boolean;

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
  requireFaceVerification: true,
  requireGeolocation: true,
  lateLoginDetection: true,
  earlyLogoutDetection: true,
  gracePeriodMins: 0,
  autoClockOut: true,
  allowCorrection: true,
  breakEnabled: true,
  breakDurationMins: 60,
  maxBreakDurationMins: 90,
  defaultShift: 'General Shift',
  shiftGracePeriodMins: 0,
  leaveApprovalRequired: true,
  allowPastDateLeave: false,
  allowNegativeBalance: false,
  wfhEnabled: true,
  wfhMaxDaysPerMonth: 4,
  wfhApprovalRequired: true,
  permissionEnabled: true,
  permissionMaxHours: 2,
  permissionApprovalRequired: true,
  geofenceEnabled: true,
  defaultRadiusMeters: 200,
  locationAccuracy: 'High',
  allowOutsideClockIn: false
};

export const appSettingsService = {
  getSettings(): AppSettings {
    try {
      const stored = localStorage.getItem(SETTINGS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return { ...DEFAULT_APP_SETTINGS, ...parsed };
      }
    } catch (e) {
      console.warn('Failed to load app settings from storage:', e);
    }
    return { ...DEFAULT_APP_SETTINGS };
  },

  saveSettings(settings: AppSettings): void {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {
      console.error('Failed to save app settings:', e);
    }
  },

  getDefaults(): AppSettings {
    return { ...DEFAULT_APP_SETTINGS };
  }
};
