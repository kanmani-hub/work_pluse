/**
 * Attendance Correction Rules (pure logic, unit-tested).
 * Handles validation, shift-boundary calculations, worked hours, and audit payload construction.
 */
import { COMPANY_TIMEZONE } from '../../utils/companyDate';

export interface AttendanceCorrectionInput {
  attendanceId?: string | null;
  employeeId: string;
  date: string; // YYYY-MM-DD
  clockIn: string; // HH:MM or HH:MM:SS
  clockOut?: string | null; // HH:MM or HH:MM:SS or empty
  breakMinutes?: number;
  status?: string;
  reason: string;
  crossesMidnight?: boolean;
  requiredHours?: number | null;
  actorRole?: string | null;
}

export interface ValidatedCorrection {
  clockInISO: string;
  clockOutISO: string | null;
  breakMinutes: number;
  workedHours: number | null;
  status: string;
  reason: string;
}

/** Converts date and HH:MM(:SS) in Asia/Kolkata (+05:30) to ISO string. */
export function toCompanyISO(date: string, time: string, dayOffset = 0): string {
  const [hh, mm, ss] = time.split(':').map(Number);
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dayOffset);
  const targetDateStr = d.toISOString().slice(0, 10);
  const hStr = String(hh).padStart(2, '0');
  const mStr = String(mm || 0).padStart(2, '0');
  const sStr = String(ss || 0).padStart(2, '0');
  return new Date(`${targetDateStr}T${hStr}:${mStr}:${sStr}+05:30`).toISOString();
}

export function validateAttendanceCorrection(input: AttendanceCorrectionInput): { data?: ValidatedCorrection; error?: string } {
  // 1. Authorization check
  const role = input.actorRole ? input.actorRole.trim().toUpperCase() : null;
  if (role && !['ADMIN', 'HR', 'SYSTEM ADMIN', 'HR MANAGER', 'HR/STAFF'].includes(role)) {
    return { error: 'Unauthorized: Only Admin and HR roles can perform attendance corrections.' };
  }

  // 2. Reason validation (mandatory, non-empty, meaningful)
  const trimmedReason = (input.reason || '').trim();
  if (!trimmedReason || trimmedReason.length < 3) {
    return { error: 'A valid correction reason of at least 3 characters is required.' };
  }

  // 3. Time format validation
  const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)(:([0-5]\d))?$/;
  const cleanClockIn = (input.clockIn || '').trim();
  if (!cleanClockIn || !timeRegex.test(cleanClockIn)) {
    return { error: 'Clock In time is required and must be in HH:MM format (24-hour).' };
  }

  const cleanClockOut = (input.clockOut || '').trim();
  if (cleanClockOut && !timeRegex.test(cleanClockOut)) {
    return { error: 'Clock Out time must be in HH:MM format (24-hour).' };
  }

  const breakMins = Math.max(0, Number(input.breakMinutes) || 0);

  // 4. Chronological & shift boundary validation
  const clockInISO = toCompanyISO(input.date, cleanClockIn);
  let clockOutISO: string | null = null;
  let workedHours: number | null = null;

  if (cleanClockOut) {
    const clockInMs = new Date(clockInISO).getTime();
    let clockOutMs = new Date(toCompanyISO(input.date, cleanClockOut)).getTime();

    if (input.crossesMidnight && clockOutMs <= clockInMs) {
      // Overnight shift ending next calendar day
      clockOutMs = new Date(toCompanyISO(input.date, cleanClockOut, 1)).getTime();
    }

    if (clockOutMs <= clockInMs) {
      return { error: 'Clock Out time must be after Clock In time.' };
    }

    clockOutISO = new Date(clockOutMs).toISOString();

    const totalElapsedMins = (clockOutMs - clockInMs) / 60000;
    const netWorkedMins = Math.max(0, totalElapsedMins - breakMins);
    workedHours = Number((netWorkedMins / 60).toFixed(2));
  }

  const rawStatus = (input.status || 'PRESENT').toUpperCase();
  const allowedStatuses = ['PRESENT', 'COMPLETED', 'LATE', 'HALF_DAY', 'ON_BREAK', 'ABSENT', 'AUTO LOGOUT'];
  const status = allowedStatuses.includes(rawStatus) ? rawStatus : 'PRESENT';

  return {
    data: {
      clockInISO,
      clockOutISO,
      breakMinutes: breakMins,
      workedHours,
      status,
      reason: trimmedReason,
    },
  };
}
