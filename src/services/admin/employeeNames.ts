import { supabase } from '../../lib/supabase';

/** id → "First Last" for the given employee ids. Failures return an empty map (callers show "name unavailable"). */
export async function fetchEmployeeNames(ids: (string | null | undefined)[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (unique.length === 0) return {};
  const { data, error } = await (supabase.from('employees') as any).select('id, first_name, last_name').in('id', unique);
  if (error || !data) return {};
  const out: Record<string, string> = {};
  for (const e of data as any[]) out[e.id] = `${e.first_name || ''} ${e.last_name || ''}`.trim() || 'Unnamed employee';
  return out;
}
