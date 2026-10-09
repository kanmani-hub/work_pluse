import { describe, it, expect } from 'vitest';
import { estimateOvertime, validateOvertimeRequest, validateOvertimeApproval, approvedOvertimeHours, shiftWindow, minutesToHours, formatHours } from './overtimeRules';

const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`).toISOString();
const D = '2026-10-08', N = '2026-10-09';
const day = { start_time: '09:00:00', end_time: '18:00:00', crosses_midnight: false, required_hours: 8 };
const att = (inT: string, outT: string | null, o: any = {}) => ({ attendance_date: D, clock_in_at: at(D, inT), clock_out_at: outT ? at(o.outDate || D, outT) : null, required_hours: 8, ...o });
const brk = (s: string, e: string) => ({ started_at: at(D, s), ended_at: at(D, e), duration_minutes: null });

describe('potential overtime', () => {
  it('normal shift, no extra time → 0', () => {
    const r = estimateOvertime(att('09:00', '18:00'), day, [brk('13:00', '14:00')]);
    expect(r.potentialMinutes).toBe(0);
    expect(r.reason).toBe('NO_EXTRA_TIME');
  });
  it('extra working hours: 09:00 → 20:00 with 1h break = 2h', () => {
    const r = estimateOvertime(att('09:00', '20:00'), day, [brk('13:00', '14:00')]);
    expect(r.workedMinutes).toBe(600);
    expect(r.potentialHours).toBe(2);
    expect(r.eligible).toBe(true);
  });
  it('break deduction: 10h span, 1h break, 8h shift → 1h', () => {
    const s = { start_time: '09:00:00', end_time: '17:00:00', required_hours: 8 };
    const r = estimateOvertime(att('09:00', '19:00'), s, [brk('12:00', '13:00')]);
    expect(r.potentialHours).toBe(1);
  });
  it('automatic break counts like any break (AUTO_GPS 30 min)', () => {
    const r = estimateOvertime(att('09:00', '20:00'), day, [{ ...brk('13:00', '14:00') }, { started_at: at(D, '15:00'), ended_at: at(D, '15:30'), duration_minutes: 30, break_type: 'AUTO_GPS' } as any]);
    expect(r.breakMinutes).toBe(90);
    expect(r.potentialMinutes).toBe(90);
  });
  it('late arrival does not create false OT: 10:00 → 19:00 on a 09–18 shift', () => {
    const r = estimateOvertime(att('10:00', '19:00'), { ...day, required_hours: 9 }, []);
    expect(r.lateMinutes).toBe(60);
    expect(r.potentialMinutes).toBe(0);
    const withLunch = estimateOvertime(att('10:00', '19:00'), day, [brk('13:00', '14:00')]);
    expect(withLunch.potentialMinutes).toBe(0);
  });
  it('late but stayed longer: late time is made up first (09:30→20:00, 1h break = 1h)', () => {
    const r = estimateOvertime(att('09:30', '20:00'), day, [brk('13:00', '14:00')]); // worked 9.5h − 8h − 0.5h late
    expect(r.potentialMinutes).toBe(60);
  });
  it('spec example: 9:00–18:00 shift, worked 9:00→20:00, no breaks = 3h possible', () => {
    const r = estimateOvertime(att('09:00', '20:00'), day, []);
    expect(r.workedMinutes).toBe(660);
    expect(r.scheduledMinutes).toBe(480);
    expect(r.potentialHours).toBe(3);
  });
  it('late 10:00→19:00 without a break is still not overtime', () => {
    expect(estimateOvertime(att('10:00', '19:00'), day, []).potentialMinutes).toBe(0);
  });
  it('overnight 22:00 → 08:00 next day = 2h, same attendance date', () => {
    const night = { start_time: '22:00:00', end_time: '06:00:00', crosses_midnight: true, required_hours: 8 };
    const r = estimateOvertime(att('22:00', '08:00', { outDate: N }), night, []);
    expect(r.potentialHours).toBe(2);
    expect(shiftWindow(D, night)!.endMs).toBe(Date.parse(at(N, '06:00')));
  });
  it('half day / leave / not clocked out → never eligible', () => {
    expect(estimateOvertime(att('09:00', '21:00', { is_half_day: true }), day, []).reason).toBe('HALF_DAY');
    expect(estimateOvertime(att('09:00', '21:00'), day, [], { halfDayLeave: true }).reason).toBe('HALF_DAY');
    expect(estimateOvertime(att('09:00', '21:00'), day, [], { fullDayLeave: true }).reason).toBe('ON_LEAVE');
    expect(estimateOvertime(att('09:00', null), day, []).reason).toBe('NOT_CLOCKED_OUT');
    expect(estimateOvertime(att('09:00', '21:00'), null, []).reason).toBe('NO_SHIFT');
  });
  it('permission time off is simply not worked time (2h permission + 2h late stay = 0)', () => {
    const r = estimateOvertime(att('09:00', '20:00'), day, [brk('13:00', '14:00'), brk('15:00', '17:00')]);
    expect(r.potentialMinutes).toBe(0);
  });
  it('automatic clock-out: uses the stored clock-out, no automatic approval', () => {
    const r = estimateOvertime(att('09:00', '19:30', { is_auto_logged_out: true }), day, [brk('13:00', '14:00')]);
    expect(r.potentialMinutes).toBe(90);
  });
  it('hours are rounded down (never more than worked)', () => {
    expect(minutesToHours(100)).toBe(1.66);
    expect(formatHours(1.5)).toBe('1.5 h');
    expect(formatHours(2)).toBe('2 h');
  });
});

describe('employee request validation', () => {
  it('valid request', () => expect(validateOvertimeRequest(1.5, 2, 'Release deadline')).toBe(null));
  it('zero / negative', () => {
    expect(validateOvertimeRequest(0, 2, 'x reason')).toBe('Requested overtime must be more than 0 hours.');
    expect(validateOvertimeRequest(-1, 2, 'x reason')).toBe('Requested overtime must be more than 0 hours.');
  });
  it('greater than eligible', () => expect(validateOvertimeRequest(2, 1.5, 'deadline')).toBe('You can request at most 1.5 hours for this day.'));
  it('no eligible time / no reason', () => {
    expect(validateOvertimeRequest(1, 0, 'deadline')).toBe('There is no overtime available for this day.');
    expect(validateOvertimeRequest(1, 2, ' ')).toBe('Please give a reason for the overtime.');
  });
});

describe('admin approval validation', () => {
  it('approve fewer hours than requested', () => expect(validateOvertimeApproval(1.5, 2, 2)).toBe(null));
  it('cannot approve more than requested or eligible', () => {
    expect(validateOvertimeApproval(2.5, 2, 3)).toBe('Cannot approve more than the requested 2 hours.');
    expect(validateOvertimeApproval(2, 2, 1.5)).toBe('Cannot approve more than the eligible 1.5 hours.');
  });
  it('cannot approve zero / negative', () => {
    expect(validateOvertimeApproval(0, 2, 2)).toBe('Approved overtime must be more than 0 hours. Reject the request instead.');
    expect(validateOvertimeApproval(-1, 2, 2)).toBe('Approved overtime must be more than 0 hours. Reject the request instead.');
  });
});

describe('payroll boundary', () => {
  it('only APPROVED approved_overtime_hours count — never requested / potential', () => {
    expect(approvedOvertimeHours([
      { status: 'APPROVED', approved_overtime_hours: 1.5 },
      { status: 'PENDING', approved_overtime_hours: null },
      { status: 'REJECTED', approved_overtime_hours: 0 },
      { status: 'APPROVED', approved_overtime_hours: 0.25 },
    ])).toBe(1.75);
  });
});
