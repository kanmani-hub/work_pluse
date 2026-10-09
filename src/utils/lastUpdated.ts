/**
 * "Last updated" label for admin pages. The timestamp is the moment the page's data was
 * actually (successfully) loaded — never a fixed string. null = nothing loaded yet.
 */
import { COMPANY_TIMEZONE, companyDateStr } from './companyDate';

export function formatLastUpdated(at: Date | number | null | undefined, now: Date | number = new Date(), timeZone = COMPANY_TIMEZONE): string {
  if (at === null || at === undefined) return 'Not loaded yet';
  const d = new Date(at);
  if (isNaN(d.getTime())) return 'Not loaded yet';
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone });
  if (companyDateStr(d) === companyDateStr(now)) return `Today, ${time}`;
  const date = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone });
  return `${date}, ${time}`;
}

/** "Last saved" label from a stored timestamp (e.g. app_settings.updated_at). */
export function formatSavedAt(at: string | number | Date | null | undefined, now: Date | number = new Date()): string {
  if (at === null || at === undefined || at === '') return 'Not available';
  const label = formatLastUpdated(at as any, now);
  return label === 'Not loaded yet' ? 'Not available' : label;
}
