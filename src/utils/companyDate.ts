/**
 * Company business date (single implementation for the whole app).
 * WorkPulse operates in India Standard Time (Asia/Kolkata, UTC+05:30, no daylight saving).
 * Never use new Date().toISOString().slice(0, 10) as the business date: that is the UTC date,
 * which is still "yesterday" between 00:00 and 05:30 IST.
 */
export const COMPANY_TIMEZONE = 'Asia/Kolkata';

/** YYYY-MM-DD in the company timezone for the given instant (default: now). */
export function companyDateStr(at: Date | number | string = new Date()): string {
  return new Date(at).toLocaleDateString('en-CA', { timeZone: COMPANY_TIMEZONE });
}

/** The company date before the given YYYY-MM-DD date. */
export function previousDateStr(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
