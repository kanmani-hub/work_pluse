import { describe, it, expect } from 'vitest';
import { findPermissionOverlap, overlapMessage, toMinutes } from './permissionOverlapRules';

const ex = [
  { id: 'a', start_time: '10:00:00', end_time: '11:00:00', status: 'APPROVED' },
  { id: 'b', start_time: '14:00', end_time: '15:30', status: 'PENDING' },
  { id: 'c', start_time: '16:00', end_time: '17:00', status: 'REJECTED' },
];

describe('permission overlap (B-11)', () => {
  it('parses HH:MM and HH:MM:SS', () => {
    expect(toMinutes('09:30')).toBe(570);
    expect(toMinutes('09:30:00')).toBe(570);
    expect(Number.isNaN(toMinutes('25:00'))).toBe(true);
  });
  it('detects partial, containing and identical overlaps with active requests', () => {
    expect(findPermissionOverlap(ex, '10:30', '11:30')?.id).toBe('a');
    expect(findPermissionOverlap(ex, '09:00', '12:00')?.id).toBe('a');
    expect(findPermissionOverlap(ex, '14:00', '15:30')?.id).toBe('b');
    expect(findPermissionOverlap(ex, '14:15', '14:45')?.id).toBe('b');
  });
  it('touching intervals and rejected / cancelled requests do not count', () => {
    expect(findPermissionOverlap(ex, '11:00', '12:00')).toBeNull();
    expect(findPermissionOverlap(ex, '09:00', '10:00')).toBeNull();
    expect(findPermissionOverlap(ex, '16:00', '17:00')).toBeNull();
  });
  it('ignores the request being edited and invalid ranges', () => {
    expect(findPermissionOverlap(ex, '10:00', '11:00', 'a')).toBeNull();
    expect(findPermissionOverlap(ex, '11:00', '10:00')).toBeNull();
  });
  it('explains the conflict', () => {
    expect(overlapMessage(ex[0])).toBe('This overlaps an existing approved permission (10:00–11:00) on the same day.');
  });
});
