import { describe, it, expect } from 'vitest';
import { validateShiftTimes, getShiftDurationMinutes, timeToMinutes } from './shiftTime';

describe('shift time validation and duration', () => {
  it('Case 1: 10:00 AM -> 7:30 PM is a valid normal shift of 9h 30m', () => {
    expect(validateShiftTimes('10:00', '19:30', false)).toBeNull();
    expect(getShiftDurationMinutes('10:00', '19:30', false)).toBe(570);
  });

  it('Case 2: 9:00 AM -> 6:00 PM is a valid normal shift of 9h', () => {
    expect(validateShiftTimes('09:00', '18:00', false)).toBeNull();
    expect(getShiftDurationMinutes('09:00', '18:00', false)).toBe(540);
  });

  it('Case 3: 9:00 PM -> 5:00 AM overnight is valid and lasts 8h', () => {
    expect(validateShiftTimes('21:00', '05:00', true)).toBeNull();
    expect(getShiftDurationMinutes('21:00', '05:00', true)).toBe(480);
  });

  it('rejects end before start when overnight is false (the AM/PM mistake)', () => {
    expect(validateShiftTimes('10:00', '07:30', false)).toMatch(/earlier than Start Time/);
    expect(validateShiftTimes('21:00', '05:00', false)).toMatch(/earlier than Start Time/);
    expect(getShiftDurationMinutes('10:00', '07:30', false)).toBeNull();
  });

  it('rejects overnight when the shift actually ends the same day', () => {
    expect(validateShiftTimes('10:00', '19:30', true)).toMatch(/overnight shift must end the next day/);
  });

  it('rejects equal or invalid times', () => {
    expect(validateShiftTimes('09:00', '09:00', false)).toMatch(/cannot be the same/);
    expect(validateShiftTimes('', '18:00', false)).toMatch(/valid times/);
    expect(timeToMinutes('25:00')).toBeNull();
  });

  it('accepts database TIME values with seconds', () => {
    expect(getShiftDurationMinutes('10:00:00', '19:30:00', false)).toBe(570);
  });
});
