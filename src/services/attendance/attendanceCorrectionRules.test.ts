import { describe, it, expect } from 'vitest';
import {
  validateAndPrepareCorrection,
  type AttendanceCorrectionInput,
} from './attendanceCorrectionRules';

describe('attendanceCorrectionRules', () => {
  const baseInput: AttendanceCorrectionInput = {
    employeeId: 'emp-123',
    dateStr: '2026-10-24',
    clockInTime: '09:00',
    clockOutTime: '17:30',
    breakMinutes: 45,
    status: 'PRESENT',
    reason: 'Employee card swipe did not register at turnstile.',
    actorId: 'admin-001',
    isOvernight: false,
  };

  it('validates and prepares a standard day shift attendance correction', () => {
    const res = validateAndPrepareCorrection(baseInput);
    expect(res.isValid).toBe(true);
    expect(res.errors).toHaveLength(0);
    expect(res.clockInIso).toBe('2026-10-24T09:00:00+05:30');
    expect(res.clockOutIso).toBe('2026-10-24T17:30:00+05:30');
    // 8.5 hours total (510 min) - 45 min break = 465 min = 7.75 hours
    expect(res.hoursWorked).toBe(7.75);
    expect(res.status).toBe('PRESENT');
    expect(res.breakMinutes).toBe(45);
  });

  it('correctly handles overnight shifts spanning across midnight into next calendar day', () => {
    const overnightInput: AttendanceCorrectionInput = {
      ...baseInput,
      clockInTime: '22:00',
      clockOutTime: '06:00',
      breakMinutes: 60,
      isOvernight: true,
      reason: 'Night shift attendance correction',
    };

    const res = validateAndPrepareCorrection(overnightInput);
    expect(res.isValid).toBe(true);
    expect(res.clockInIso).toBe('2026-10-24T22:00:00+05:30');
    expect(res.clockOutIso).toBe('2026-10-25T06:00:00+05:30');
    // 8 hours total (480 min) - 60 min break = 420 min = 7.00 hours
    expect(res.hoursWorked).toBe(7);
  });

  it('rejects an empty or whitespace-only reason', () => {
    const res = validateAndPrepareCorrection({
      ...baseInput,
      reason: '   ',
    });
    expect(res.isValid).toBe(false);
    expect(res.errors).toContain('A non-empty correction reason is required for auditing.');
  });

  it('rejects clock-out before clock-in for non-overnight shifts', () => {
    const res = validateAndPrepareCorrection({
      ...baseInput,
      clockInTime: '17:00',
      clockOutTime: '09:00',
      isOvernight: false,
    });
    expect(res.isValid).toBe(false);
    expect(res.errors).toContain('Clock-out time must be after clock-in time.');
  });

  it('rejects negative break minutes', () => {
    const res = validateAndPrepareCorrection({
      ...baseInput,
      breakMinutes: -15,
    });
    expect(res.isValid).toBe(false);
    expect(res.errors).toContain('Break minutes cannot be negative.');
  });

  it('rejects break minutes exceeding total duration between clock-in and clock-out', () => {
    const res = validateAndPrepareCorrection({
      ...baseInput,
      clockInTime: '09:00',
      clockOutTime: '10:00', // 60 minutes
      breakMinutes: 90,
    });
    expect(res.isValid).toBe(false);
    expect(res.errors).toContain('Break minutes cannot exceed total time between clock-in and clock-out.');
  });

  it('rejects invalid time formats', () => {
    const res = validateAndPrepareCorrection({
      ...baseInput,
      clockInTime: '25:70',
    });
    expect(res.isValid).toBe(false);
    expect(res.errors).toContain('Clock-in time must be in HH:MM format.');
  });

  it('rejects invalid status', () => {
    const res = validateAndPrepareCorrection({
      ...baseInput,
      status: 'INVALID_STATUS' as any,
    });
    expect(res.isValid).toBe(false);
    expect(res.errors).toContain('Invalid status: INVALID_STATUS. Allowed: PRESENT, HALF_DAY, ABSENT, ON_LEAVE, WFH.');
  });

  it('allows ABSENT with no clock-in or clock-out', () => {
    const res = validateAndPrepareCorrection({
      employeeId: 'emp-123',
      dateStr: '2026-10-24',
      clockInTime: null,
      clockOutTime: null,
      breakMinutes: 0,
      status: 'ABSENT',
      reason: 'Marked absent by HR after verification.',
      actorId: 'admin-001',
      isOvernight: false,
    });
    expect(res.isValid).toBe(true);
    expect(res.clockInIso).toBeNull();
    expect(res.clockOutIso).toBeNull();
    expect(res.hoursWorked).toBe(0);
    expect(res.status).toBe('ABSENT');
  });
});
