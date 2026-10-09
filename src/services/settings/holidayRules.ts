/** Company public-holiday list (Admin → Settings → Working Hours). Used by payroll: a holiday is not a working day. */
export interface PublicHoliday {
  date: string; // YYYY-MM-DD
  name: string;
}

/** Returns the new sorted list, or an error message when the entry is invalid or a duplicate. */
export function addHoliday(list: PublicHoliday[] | undefined, date: string, name: string): { list: PublicHoliday[]; error: string | null } {
  const current = Array.isArray(list) ? list : [];
  const d = String(date || '').trim();
  const n = String(name || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(new Date(`${d}T12:00:00Z`).getTime())) return { list: current, error: 'Choose a valid holiday date.' };
  if (!n) return { list: current, error: 'Enter the holiday name.' };
  if (current.some(h => h.date === d)) return { list: current, error: 'That date is already in the holiday list.' };
  return { list: [...current, { date: d, name: n }].sort((a, b) => a.date.localeCompare(b.date)), error: null };
}

export function removeHoliday(list: PublicHoliday[] | undefined, date: string): PublicHoliday[] {
  return (Array.isArray(list) ? list : []).filter(h => h.date !== date);
}
