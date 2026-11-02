import { describe, it, expect } from 'vitest';
import {
  normalizeShiftCode,
  findShiftCodeConflict,
  validateShiftCode,
  suggestNextShiftCode,
  generateUniqueShiftCode,
  formatShiftDatabaseError,
} from './shiftValidation';

describe('shiftValidation', () => {
  const existingShifts = [
    { id: 'shift-1', code: 'MORINING', name: 'General Shift' },
    { id: 'shift-2', code: '03', name: 'Morinig_shift_01' },
    { id: 'shift-3', code: '02', name: 'Morinig_shift_02' },
  ];

  describe('normalizeShiftCode', () => {
    it('trims and converts to uppercase', () => {
      expect(normalizeShiftCode('  afternoon  ')).toBe('AFTERNOON');
      expect(normalizeShiftCode('03')).toBe('03');
      expect(normalizeShiftCode(null)).toBe('');
      expect(normalizeShiftCode(undefined)).toBe('');
    });
  });

  describe('findShiftCodeConflict', () => {
    it('finds existing conflict regardless of casing and spaces', () => {
      const conflict = findShiftCodeConflict('  03  ', existingShifts);
      expect(conflict).toBeDefined();
      expect(conflict?.id).toBe('shift-2');
      expect(conflict?.name).toBe('Morinig_shift_01');
    });

    it('finds existing conflict for named codes', () => {
      const conflict = findShiftCodeConflict('morining', existingShifts);
      expect(conflict).toBeDefined();
      expect(conflict?.id).toBe('shift-1');
    });

    it('returns null when editing the shift itself', () => {
      const conflict = findShiftCodeConflict('03', existingShifts, 'shift-2');
      expect(conflict).toBeNull();
    });

    it('returns conflict when editing shift-3 and choosing code of shift-2', () => {
      const conflict = findShiftCodeConflict('03', existingShifts, 'shift-3');
      expect(conflict).toBeDefined();
      expect(conflict?.id).toBe('shift-2');
    });

    it('returns null for an unused code', () => {
      expect(findShiftCodeConflict('04', existingShifts)).toBeNull();
      expect(findShiftCodeConflict('AFTERNOON', existingShifts)).toBeNull();
    });
  });

  describe('validateShiftCode', () => {
    it('rejects empty or whitespace-only code', () => {
      const res = validateShiftCode('   ', existingShifts);
      expect(res.isValid).toBe(false);
      expect(res.error).toBe('Shift code is required.');
    });

    it('rejects code exceeding 50 characters', () => {
      const longCode = 'A'.repeat(51);
      const res = validateShiftCode(longCode, existingShifts);
      expect(res.isValid).toBe(false);
      expect(res.error).toBe('Shift code cannot exceed 50 characters.');
    });

    it('rejects invalid characters', () => {
      const res = validateShiftCode('CODE with spaces', existingShifts);
      expect(res.isValid).toBe(false);
      expect(res.error).toContain('can only contain letters, numbers, hyphens');
    });

    it('rejects duplicate code with informative error naming the conflicting shift', () => {
      const res = validateShiftCode('03', existingShifts);
      expect(res.isValid).toBe(false);
      expect(res.error).toContain('Shift code "03" is already in use by "Morinig_shift_01". Please choose a different code.');
      expect(res.conflictWith?.name).toBe('Morinig_shift_01');
    });

    it('allows valid unique code', () => {
      const res = validateShiftCode('04', existingShifts);
      expect(res.isValid).toBe(true);
      expect(res.error).toBeNull();
    });

    it('allows valid new shift name code', () => {
      const res = validateShiftCode('AFTERNOON', existingShifts);
      expect(res.isValid).toBe(true);
      expect(res.error).toBeNull();
    });
  });

  describe('suggestNextShiftCode', () => {
    it('suggests clean code from shift name if unique', () => {
      const code = suggestNextShiftCode('Afternoon', existingShifts);
      expect(code).toBe('AFTERNOON');
    });

    it('suggests next sequential number when no name is provided', () => {
      const code = suggestNextShiftCode('', existingShifts);
      expect(code).toBe('04');
    });

    it('increments suffix if derived code is already taken', () => {
      const shiftsWithAfternoon = [...existingShifts, { id: '4', code: 'AFTERNOON', name: 'Afternoon' }];
      const code = suggestNextShiftCode('Afternoon', shiftsWithAfternoon);
      expect(code).toBe('AFT'); // tries abbreviation
    });
  });

  describe('generateUniqueShiftCode', () => {
    it('appends _COPY for duplicate', () => {
      const code = generateUniqueShiftCode('03', existingShifts);
      expect(code).toBe('03_COPY');
    });

    it('increments _COPY_2 if _COPY already exists', () => {
      const shiftsWithCopy = [...existingShifts, { id: '4', code: '03_COPY' }];
      const code = generateUniqueShiftCode('03_COPY', shiftsWithCopy);
      expect(code).toBe('03_COPY_2');
    });
  });

  describe('formatShiftDatabaseError', () => {
    it('translates Postgres unique constraint error', () => {
      const pgError = {
        code: '23505',
        message: 'duplicate key value violates unique constraint "shift_templates_code_key"',
      };
      const formatted = formatShiftDatabaseError(pgError, { code: '03' });
      expect(formatted.message).toBe('Shift code "03" is already in use by another shift. Please enter a different unique shift code.');
    });

    it('preserves other errors', () => {
      const otherError = new Error('Network timeout');
      const formatted = formatShiftDatabaseError(otherError);
      expect(formatted.message).toBe('Network timeout');
    });
  });
});
