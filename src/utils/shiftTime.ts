/**
 * Shift time helpers shared by the shift form and duration checks.
 *
 * Shift times are stored as Postgres TIME values ("HH:MM" or "HH:MM:SS", 24-hour, no timezone).
 * A normal shift must end later the same day (start < end).
 * An overnight shift ends the next calendar day, so its end clock time is earlier than its start.
 */

/** Parse "HH:MM" / "HH:MM:SS" into minutes since midnight. Returns null for invalid input. */
export function timeToMinutes(time: string | null | undefined): number | null {
  if (!time) return null;
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Returns a validation error message, or null if the start/end/overnight combination is valid.
 * Never modifies the input.
 */
export function validateShiftTimes(start: string, end: string, overnight: boolean): string | null {
  const startMins = timeToMinutes(start);
  const endMins = timeToMinutes(end);
  if (startMins === null || endMins === null) return 'Start Time and End Time must be valid times.';
  if (startMins === endMins) return 'Start Time and End Time cannot be the same.';
  if (!overnight && endMins < startMins) {
    return 'End Time is earlier than Start Time. Check AM/PM, or tick "Overnight Shift" if this shift ends the next day.';
  }
  if (overnight && endMins > startMins) {
    return 'An overnight shift must end the next day (End Time earlier than Start Time, e.g. 9:00 PM → 5:00 AM). Untick "Overnight Shift" for a same-day shift.';
  }
  return null;
}

/** Total scheduled span of a shift in minutes (before breaks), or null if the combination is invalid. */
export function getShiftDurationMinutes(start: string, end: string, overnight: boolean): number | null {
  if (validateShiftTimes(start, end, overnight)) return null;
  const startMins = timeToMinutes(start)!;
  const endMins = timeToMinutes(end)!;
  return overnight ? endMins + 24 * 60 - startMins : endMins - startMins;
}

/** Format minutes as "9h 30m". */
export function formatDurationMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}
