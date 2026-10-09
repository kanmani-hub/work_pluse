import { describe, it, expect, vi } from 'vitest';
import { weeklyOffDaysFrom } from './appSettingsService';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));

describe('company weekly offs come from the saved working days (no hardcoded Saturday/Sunday)', () => {
  it('Mon–Sat working → Sunday off; Mon–Fri → Saturday and Sunday off; Sun–Thu → Friday and Saturday off', () => {
    expect(weeklyOffDaysFrom({ workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] })).toEqual(['Sunday']);
    expect(weeklyOffDaysFrom({ workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] })).toEqual(['Saturday', 'Sunday']);
    expect(weeklyOffDaysFrom({ workingDays: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday'] })).toEqual(['Friday', 'Saturday']);
  });

  it('no saved working days → null (callers must not guess)', () => {
    expect(weeklyOffDaysFrom({ workingDays: [] })).toBeNull();
    expect(weeklyOffDaysFrom({})).toBeNull();
    expect(weeklyOffDaysFrom(null)).toBeNull();
  });
});
