/**
 * Permission requests may not overlap in time for the same employee on the same day (QA finding B-11).
 * Touching intervals (10:00–11:00 and 11:00–12:00) do not overlap. Only PENDING and APPROVED requests
 * count; REJECTED / CANCELLED ones free the time again. The database enforces the same rule
 * (migration 20261022100100_permission_overlap_guard.sql); this check gives the clear message first.
 */
export const ACTIVE_PERMISSION_STATUSES = ['PENDING', 'APPROVED'];

export function toMinutes(t: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(t || '');
  if (!m) return NaN;
  const h = Number(m[1]), min = Number(m[2]);
  return h > 23 || min > 59 ? NaN : h * 60 + min;
}

export function findPermissionOverlap<T extends { start_time: string; end_time: string; status?: string; id?: string }>(
  existing: T[], start: string, end: string, ignoreId?: string,
): T | null {
  const s = toMinutes(start), e = toMinutes(end);
  if (!(e > s)) return null;
  return existing.find((x) => x.id !== ignoreId
    && (!x.status || ACTIVE_PERMISSION_STATUSES.includes(x.status))
    && toMinutes(x.start_time) < e && s < toMinutes(x.end_time)) || null;
}

export function overlapMessage(o: { start_time: string; end_time: string; status?: string }): string {
  return `This overlaps an existing ${String(o.status || '').toLowerCase() || 'active'} permission (${o.start_time.slice(0, 5)}–${o.end_time.slice(0, 5)}) on the same day.`;
}
