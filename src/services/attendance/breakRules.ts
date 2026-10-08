/**
 * Break and working-time rules shared by the employee timers, break service and clock-out.
 * Pure functions: no database access, so every rule can be unit-tested with fixed timestamps.
 *
 * Effective work = elapsed clocked time - completed break time - active break time.
 * Break minutes are whole minutes per break (floor), the same value stored in
 * attendance_breaks.duration_minutes.
 */

export interface BreakLike {
  started_at: string;
  ended_at: string | null;
  duration_minutes?: number | null;
}

const ms = (iso: string) => new Date(iso).getTime();

/** Whole minutes of a completed break, as stored in duration_minutes. */
export function breakDurationMinutes(startedAt: string, endedAt: string): number {
  return Math.max(0, Math.floor((ms(endedAt) - ms(startedAt)) / 60000));
}

export function findActiveBreak<T extends BreakLike>(breaks: T[] | null | undefined): T | null {
  return (breaks || []).find(b => !b.ended_at) ?? null;
}

/** Sum of completed break minutes (uses stored duration when present, otherwise the timestamps). */
export function completedBreakMinutes(breaks: BreakLike[] | null | undefined): number {
  return (breaks || [])
    .filter(b => b.ended_at)
    .reduce((sum, b) => sum + (b.duration_minutes ?? breakDurationMinutes(b.started_at, b.ended_at as string)), 0);
}

/**
 * Live timer values for the employee screens.
 * While a break is active the work time stops growing and the break time grows from started_at.
 */
export function computeWorkTimer(
  attendance: { clock_in_at: string | null; clock_out_at?: string | null },
  breaks: BreakLike[] | null | undefined,
  nowMs: number,
) {
  if (!attendance?.clock_in_at) {
    return { elapsedSeconds: 0, completedBreakSeconds: 0, activeBreakSeconds: 0, breakSeconds: 0, workSeconds: 0, activeBreak: null as BreakLike | null };
  }
  const endMs = attendance.clock_out_at ? ms(attendance.clock_out_at) : nowMs;
  const elapsedSeconds = Math.max(0, Math.floor((endMs - ms(attendance.clock_in_at)) / 1000));
  const completedBreakSeconds = completedBreakMinutes(breaks) * 60;
  const activeBreak = attendance.clock_out_at ? null : findActiveBreak(breaks);
  const activeBreakSeconds = activeBreak ? Math.max(0, Math.floor((nowMs - ms(activeBreak.started_at)) / 1000)) : 0;
  return {
    elapsedSeconds,
    completedBreakSeconds,
    activeBreakSeconds,
    breakSeconds: completedBreakSeconds + activeBreakSeconds,
    workSeconds: Math.max(0, elapsedSeconds - completedBreakSeconds - activeBreakSeconds),
    activeBreak,
  };
}

/**
 * Allowed break minutes: the shift's break_duration_minutes, otherwise the Admin setting.
 * No hard-coded number: if neither is configured the allowance is unknown (null).
 */
export function resolveAllowedBreakMinutes(shiftBreakMinutes: number | null | undefined, settingBreakMinutes: number | null | undefined): number | null {
  if (shiftBreakMinutes !== null && shiftBreakMinutes !== undefined) return shiftBreakMinutes;
  if (settingBreakMinutes !== null && settingBreakMinutes !== undefined) return settingBreakMinutes;
  return null;
}

/** Overrun = actual - allowed (never negative). 0 when detection is disabled or the allowance is unknown. */
export function computeBreakOverrun(actualMinutes: number, allowedMinutes: number | null, detectionEnabled = true): number {
  if (!detectionEnabled || allowedMinutes === null) return 0;
  return Math.max(0, actualMinutes - allowedMinutes);
}
