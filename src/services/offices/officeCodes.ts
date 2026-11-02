/**
 * Office display codes (pure, unit-tested). The offices table has no stored code column in use, so the
 * page derives one from the office name (first 8 characters, spaces → "-"). Two offices whose names start
 * the same ("Whitee Lottus" and "Whitee Lottus Digital Studio") got the same code. Codes are now unique:
 * a stored code is used when present; duplicates get -2, -3 … in name order (stable between loads).
 */
export function baseOfficeCode(name: string | null | undefined): string {
  const code = String(name || '').trim().replace(/\s+/g, '-').substring(0, 8).toUpperCase();
  return code || 'OFFICE';
}

export function uniqueOfficeCodes(offices: { id: string; name: string | null; code?: string | null }[]): Record<string, string> {
  const out: Record<string, string> = {};
  const used = new Set<string>();
  const sorted = [...(offices || [])].sort((a, b) =>
    String(a.name || '').localeCompare(String(b.name || '')) || String(a.id).localeCompare(String(b.id)));
  for (const o of sorted) {
    const base = String(o.code || '').trim().toUpperCase() || baseOfficeCode(o.name);
    let code = base;
    for (let n = 2; used.has(code); n++) code = `${base}-${n}`;
    used.add(code);
    out[o.id] = code;
  }
  return out;
}
