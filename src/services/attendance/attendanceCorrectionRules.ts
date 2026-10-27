/**
 * Attendance Correction Rules (pure logic, unit-tested).
 * Handles validation, shift-boundary calculations, worked hours, and audit payload construction.
 */
import { COMPANY_TIMEZONE } from '../../utils/companyDate';
export { COMPANY_TIMEZONE };

export const ALLOWED_CORRECTION_STATUSES = ['PRESENT', 'HALF_DAY', 'ABSENT', 'ON_LEAVE', 'WFH'] as const;
export type AttendanceCorrectionStatus = (typeof ALLOWED_CORRECTION_STATUSES)[number];

export interface AttendanceCorrectionInput {
  attendanceId?: string | null;
  employeeId: string;
  dateStr?: string;
  date?: string;
  clockInTime?: string | null;
  clockIn?: string | null;
  clockOutTime?: string | null;
  clockOut?: string | null;
  breakMinutes?: number;
  status?: string;
  reason: string;
  actorId?: string | null;
  actorRole?: string | null;
  isOvernight?: boolean;
  crossesMidnight?: boolean;
  requiredHours?: number | null;
}

export interface AttendanceCorrectionResult {
  isValid: boolean;
  errors: string[];
  clockInIso: string | null;
  clockOutIso: string | null;
  hoursWorked: number;
  status: string;
  breakMinutes: number;
}

export interface ValidatedCorrection {
  clockInISO: string | null;
  clockOutISO: string | null;
  breakMinutes: number;
  workedHours: number | null;
  status: string;
  reason: string;
}

/** Converts date and HH:MM(:SS) in Asia/Kolkata (+05:30) to ISO string. */
export function toCompanyISO(date: string, time: string, dayOffset = 0): string {
  const parts = time.split(':').map(Number);
  const hh = parts[0];
  const mm = parts[1] || 0;
  const ss = parts[2] || 0;
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dayOffset);
  const targetDateStr = d.toISOString().slice(0, 10);
  const hStr = String(hh).padStart(2, '0');
  const mStr = String(mm).padStart(2, '0');
  const sStr = String(ss).padStart(2, '0');
  return `${targetDateStr}T${hStr}:${mStr}:${sStr}+05:30`;
}

/**
 * Validates attendance correction parameters and prepares calculated timestamps and worked hours.
 */
export function validateAndPrepareCorrection(input: AttendanceCorrectionInput): AttendanceCorrectionResult {
  const errors: string[] = [];
  const date = input.dateStr || input.date || '';
  const reason = (input.reason || '').trim();
  const rawStatus = input.status || 'PRESENT';
  const status = rawStatus.toUpperCase();
  const isOvernight = Boolean(input.isOvernight ?? input.crossesMidnight ?? false);
  const breakMinutes = input.breakMinutes !== undefined ? Number(input.breakMinutes) : 0;

  // 1. Reason validation (mandatory, non-empty)
  if (!reason) {
    errors.push('A non-empty correction reason is required for auditing.');
  }

  // 2. Status validation
  if (!ALLOWED_CORRECTION_STATUSES.includes(status as any)) {
    errors.push(`Invalid status: ${rawStatus}. Allowed: PRESENT, HALF_DAY, ABSENT, ON_LEAVE, WFH.`);
  }

  // 3. Break minutes non-negative check
  if (breakMinutes < 0) {
    errors.push('Break minutes cannot be negative.');
  }

  const rawClockIn = input.clockInTime !== undefined ? input.clockInTime : (input.clockIn !== undefined ? input.clockIn : null);
  const rawClockOut = input.clockOutTime !== undefined ? input.clockOutTime : (input.clockOut !== undefined ? input.clockOut : null);

  const cleanClockIn = rawClockIn ? rawClockIn.trim() : null;
  const cleanClockOut = rawClockOut ? rawClockOut.trim() : null;

  const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)(:([0-5]\d))?$/;

  let clockInIso: string | null = null;
  let clockOutIso: string | null = null;
  let hoursWorked = 0;

  const isAbsentOrLeave = status === 'ABSENT' || status === 'ON_LEAVE';

  if (!cleanClockIn && isAbsentOrLeave) {
    clockInIso = null;
    clockOutIso = null;
    hoursWorked = 0;
  } else {
    if (!cleanClockIn || !timeRegex.test(cleanClockIn)) {
      errors.push('Clock-in time must be in HH:MM format.');
    } else {
      clockInIso = toCompanyISO(date, cleanClockIn, 0);
    }
  }

  if (cleanClockOut) {
    if (!timeRegex.test(cleanClockOut)) {
      errors.push('Clock-out time must be in HH:MM format.');
    } else if (clockInIso) {
      clockOutIso = toCompanyISO(date, cleanClockOut, isOvernight ? 1 : 0);
      const inMs = Date.parse(clockInIso);
      const outMs = Date.parse(clockOutIso);

      if (outMs <= inMs) {
        errors.push('Clock-out time must be after clock-in time.');
      } else {
        const totalElapsedMins = (outMs - inMs) / 60000;
        if (breakMinutes > totalElapsedMins) {
          errors.push('Break minutes cannot exceed total time between clock-in and clock-out.');
        } else {
          const netWorkedMins = Math.max(0, totalElapsedMins - Math.max(0, breakMinutes));
          hoursWorked = Number((netWorkedMins / 60).toFixed(2));
        }
      }
    }
  }

  const isValid = errors.length === 0;

  return {
    isValid,
    errors,
    clockInIso: isValid ? clockInIso : null,
    clockOutIso: isValid ? clockOutIso : null,
    hoursWorked: isValid ? hoursWorked : 0,
    status,
    breakMinutes: Math.max(0, breakMinutes),
  };
}

/**
 * Validates attendance correction for service layer execution.
 */
export function validateAttendanceCorrection(input: AttendanceCorrectionInput): { data?: ValidatedCorrection; error?: string } {
  // 1. Authorization check
  const role = input.actorRole ? input.actorRole.trim().toUpperCase() : null;
  if (role && !['ADMIN', 'HR', 'SYSTEM ADMIN', 'HR MANAGER', 'HR/STAFF'].includes(role)) {
    return { error: 'Unauthorized: Only Admin and HR roles can perform attendance corrections.' };
  }

  // 2. Prepare & validate correction
  const prep = validateAndPrepareCorrection(input);
  if (!prep.isValid) {
    return { error: prep.errors[0] || 'Validation failed.' };
  }

  return {
    data: {
      clockInISO: prep.clockInIso,
      clockOutISO: prep.clockOutIso,
      breakMinutes: prep.breakMinutes,
      workedHours: prep.hoursWorked,
      status: prep.status,
      reason: (input.reason || '').trim(),
    },
  };
}

