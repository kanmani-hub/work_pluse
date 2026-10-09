import { describe, it, expect } from 'vitest';
import { buildPatchedSettings, patchConfirmed, mergeAppPatch } from './settingsPatchRules';

describe('settings patch (only the changed keys, never defaults over real settings)', () => {
  it('changes only the patched keys and keeps payroll + other app keys', () => {
    const raw = { app: { allowPastDateLeave: false, workingDays: ['Monday'] }, payroll: { x: 1 } };
    expect(buildPatchedSettings(raw, { allowPastDateLeave: true })).toEqual({ app: { allowPastDateLeave: true, workingDays: ['Monday'] }, payroll: { x: 1 } });
    expect(mergeAppPatch({ a: 1, b: 2 }, { b: 3 })).toEqual({ a: 1, b: 3 });
  });
  it('refuses when the stored row is missing or not in { app } shape', () => {
    expect(buildPatchedSettings(null, { a: true })).toBeNull();
    expect(buildPatchedSettings({ allowPastDateLeave: true }, { a: true })).toBeNull();
  });
  it('confirms only when the re-fetched values match', () => {
    expect(patchConfirmed({ a: true, b: 1 }, { a: true })).toBe(true);
    expect(patchConfirmed({ a: false }, { a: true })).toBe(false);
    expect(patchConfirmed(null, { a: true })).toBe(false);
  });
});
