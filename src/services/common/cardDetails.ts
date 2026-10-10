/**
 * Shared helpers for summary-card detail views (pure, unit-tested).
 * A card's number and its detail rows must come from the same filtered list; these helpers
 * keep that convention in one place.
 */
import type React from 'react';

export interface RecordColumn {
  key: string;
  label: string;
  align?: 'left' | 'right';
  /** Optional display formatter (raw values stay searchable) */
  format?: (value: any, row: Record<string, any>) => React.ReactNode;
}

/** Case-insensitive search across the given keys. Empty query returns every row. */
export function filterRecords<T extends Record<string, any>>(rows: T[], query: string, keys: string[]): T[] {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(r => keys.some(k => r[k] !== null && r[k] !== undefined && String(r[k]).toLowerCase().includes(q)));
}

/** Common employee identity fields from the shapes used across the app's queries. */
export function employeeFields(e: any): { employee: string; code: string; department: string; office: string } {
  const name = e?.name || `${e?.first_name || ''} ${e?.last_name || ''}`.trim();
  return {
    employee: name || '—',
    code: e?.employee_code || e?.empCode || e?.empId || '—',
    department: e?.departments?.name || e?.department?.name || e?.dept || '—',
    office: e?.office?.name || e?.offices?.name || e?.officeName || (typeof e?.office === 'string' ? e.office : '') || '—',
  };
}

export const EMPLOYEE_COLUMNS: RecordColumn[] = [
  { key: 'employee', label: 'Employee' }, { key: 'code', label: 'Employee ID' },
  { key: 'department', label: 'Department' }, { key: 'office', label: 'Office' },
];

/** HH:MM in the company time zone (Asia/Kolkata), or — when missing. */
export const istTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }) : '—';

/** Elapsed time between clock-in and clock-out — null (never a guess) when clock-out is missing. */
export function elapsedMinutes(clockIn?: string | null, clockOut?: string | null): number | null {
  if (!clockIn || !clockOut) return null;
  const m = Math.round((new Date(clockOut).getTime() - new Date(clockIn).getTime()) / 60000);
  return Number.isFinite(m) && m >= 0 ? m : null;
}

export const formatDuration = (m: number | null | undefined) =>
  m === null || m === undefined ? '—' : `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, '0')}m`;

/** Activates a card with Enter or Space (keyboard users), like a click. */
export function cardKeyHandler(onActivate: () => void) {
  return (e: { key: string; preventDefault: () => void }) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(); }
  };
}

/** Props that make a summary card an accessible button. */
export function clickableCardProps(label: string, onActivate: () => void) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    'aria-label': `${label} — show details`,
    onClick: onActivate,
    onKeyDown: cardKeyHandler(onActivate),
    style: { cursor: 'pointer' } as React.CSSProperties,
  };
}
