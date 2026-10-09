import { describe, it, expect } from 'vitest';
import { formatLastUpdated, formatSavedAt } from './lastUpdated';

describe('formatLastUpdated (real refresh time, never a fixed string)', () => {
  it('shows "Not loaded yet" before any successful load', () => {
    expect(formatLastUpdated(null)).toBe('Not loaded yet');
    expect(formatLastUpdated(undefined)).toBe('Not loaded yet');
    expect(formatLastUpdated(new Date('invalid'))).toBe('Not loaded yet');
  });
  it('shows Today + company-time clock for a refresh earlier today (IST)', () => {
    const at = new Date('2026-10-09T05:12:00Z'); // 10:42 IST
    const now = new Date('2026-10-09T08:00:00Z');
    expect(formatLastUpdated(at, now)).toBe('Today, 10:42 AM');
  });
  it('uses the company date, not UTC: 00:30 IST is "today" even though UTC is still yesterday', () => {
    const at = new Date('2026-10-08T19:00:00Z'); // 09 Oct 00:30 IST
    const now = new Date('2026-10-08T20:00:00Z'); // 09 Oct 01:30 IST
    expect(formatLastUpdated(at, now)).toBe('Today, 12:30 AM');
  });
  it('shows the full date for an older refresh', () => {
    const at = new Date('2026-10-07T12:00:00Z');
    const now = new Date('2026-10-09T08:00:00Z');
    expect(formatLastUpdated(at, now)).toBe('07 Oct 2026, 05:30 PM');
  });
});

describe('formatSavedAt (Settings "Last saved" from app_settings.updated_at)', () => {
  it('shows the stored timestamp, never "Never" when one exists', () => {
    expect(formatSavedAt('2026-10-09T05:12:00Z', new Date('2026-10-09T08:00:00Z'))).toBe('Today, 10:42 AM');
    expect(formatSavedAt('2026-10-02T09:00:00Z', new Date('2026-10-09T08:00:00Z'))).toBe('02 Oct 2026, 02:30 PM');
  });
  it('no stored timestamp → "Not available" (no invented time)', () => {
    expect(formatSavedAt(undefined)).toBe('Not available');
    expect(formatSavedAt(null)).toBe('Not available');
    expect(formatSavedAt('garbage')).toBe('Not available');
  });
});
