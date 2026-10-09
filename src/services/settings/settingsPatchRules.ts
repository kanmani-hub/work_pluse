/** Pure helpers for settingsPatch (unit-tested). */
export function mergeAppPatch<T extends Record<string, any>>(current: T, patch: Partial<T>): T {
  return { ...current, ...patch };
}

export function patchConfirmed(saved: Record<string, any> | null | undefined, patch: Record<string, any>): boolean {
  if (!saved) return false;
  return Object.keys(patch).every(k => JSON.stringify(saved[k]) === JSON.stringify(patch[k]));
}

/**
 * Build the row to save from the RAW stored settings. Refuses (returns null) when the stored row
 * could not be read or is not in the { app, payroll } shape, so a failed read can never
 * overwrite real settings with defaults.
 */
export function buildPatchedSettings(raw: any, patch: Record<string, any>): any | null {
  if (!raw || typeof raw !== 'object' || !raw.app || typeof raw.app !== 'object') return null;
  return { ...raw, app: mergeAppPatch(raw.app, patch) };
}

