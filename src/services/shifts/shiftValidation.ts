/**
 * Shift code validation and uniqueness helper rules.
 * Enforces PostgreSQL varchar(50) unique constraint on shift_templates(code)
 * with user-friendly messages and intelligent suggestions.
 */

export interface ShiftCodeHolder {
  id?: string;
  code?: string;
  name?: string;
}

export interface ShiftCodeValidationResult {
  isValid: boolean;
  error: string | null;
  conflictWith?: ShiftCodeHolder;
}

/** Normalize shift code to trimmed uppercase */
export function normalizeShiftCode(code: string | null | undefined): string {
  return (code || '').trim().toUpperCase();
}

/** Find if any existing shift conflicts with the provided code */
export function findShiftCodeConflict(
  code: string | null | undefined,
  existingShifts: ShiftCodeHolder[],
  currentShiftId?: string | boolean | null
): ShiftCodeHolder | null {
  const normalized = normalizeShiftCode(code);
  if (!normalized) return null;

  for (const shift of existingShifts) {
    if (typeof currentShiftId === 'string' && shift.id === currentShiftId) {
      continue; // Allow current shift to keep its own code when editing
    }
    if (normalizeShiftCode(shift.code) === normalized) {
      return shift;
    }
  }

  return null;
}

/**
 * Validates a shift code for presence, length, character format, and uniqueness.
 */
export function validateShiftCode(
  code: string | null | undefined,
  existingShifts: ShiftCodeHolder[],
  currentShiftId?: string | boolean | null
): ShiftCodeValidationResult {
  const normalized = normalizeShiftCode(code);

  if (!normalized) {
    return {
      isValid: false,
      error: 'Shift code is required.',
    };
  }

  if (normalized.length > 50) {
    return {
      isValid: false,
      error: 'Shift code cannot exceed 50 characters.',
    };
  }

  // Allow alphanumeric, underscores, hyphens
  if (!/^[A-Z0-9_-]+$/.test(normalized)) {
    return {
      isValid: false,
      error: 'Shift code can only contain letters, numbers, hyphens (-), and underscores (_).',
    };
  }

  const conflict = findShiftCodeConflict(code, existingShifts, currentShiftId);
  if (conflict) {
    const shiftLabel = conflict.name ? `"${conflict.name}"` : 'another shift';
    return {
      isValid: false,
      error: `Shift code "${normalized}" is already in use by ${shiftLabel}. Please choose a different code.`,
      conflictWith: conflict,
    };
  }

  return {
    isValid: true,
    error: null,
  };
}

/**
 * Suggests an available, unique shift code based on the shift name or next sequential number.
 */
export function suggestNextShiftCode(
  shiftName: string | null | undefined,
  existingShifts: ShiftCodeHolder[]
): string {
  const existingSet = new Set(existingShifts.map(s => normalizeShiftCode(s.code)));

  // If a name is provided, try deriving a meaningful code (e.g. "Afternoon" -> "AFTERNOON" or "AFT")
  if (shiftName && shiftName.trim()) {
    const clean = shiftName.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (clean) {
      const candidate = clean.slice(0, 15);
      if (!existingSet.has(candidate)) {
        return candidate;
      }
      // Try 3-letter abbreviation if available
      const abbrev = clean.slice(0, 3);
      if (abbrev && !existingSet.has(abbrev)) {
        return abbrev;
      }
      // Try candidate with number suffix
      let suffix = 2;
      while (suffix < 100) {
        const withSuffix = `${candidate.slice(0, 45)}_${suffix}`;
        if (!existingSet.has(withSuffix)) return withSuffix;
        suffix++;
      }
    }
  }

  // Look for numeric code patterns (e.g. "01", "02", "03" -> next "04")
  const numericCodes = existingShifts
    .map(s => (s.code || '').trim())
    .filter(c => /^\d+$/.test(c))
    .map(Number);

  if (numericCodes.length > 0) {
    const max = Math.max(...numericCodes);
    let nextNum = max + 1;
    while (nextNum < 1000) {
      const formatted = String(nextNum).padStart(2, '0');
      if (!existingSet.has(formatted)) return formatted;
      nextNum++;
    }
  }

  // Fallback to SHIFT_1, SHIFT_2, etc.
  let index = 1;
  while (index < 1000) {
    const candidate = `SHIFT_${index}`;
    if (!existingSet.has(candidate)) return candidate;
    index++;
  }

  return 'SHIFT_NEW';
}

/**
 * Generates a unique code for duplicated shifts (e.g. "03" -> "03_COPY", or "03_COPY_2").
 */
export function generateUniqueShiftCode(
  baseCode: string,
  existingShifts: ShiftCodeHolder[]
): string {
  const existingSet = new Set(existingShifts.map(s => normalizeShiftCode(s.code)));
  let candidate = normalizeShiftCode(baseCode).slice(0, 50);

  if (!existingSet.has(candidate)) {
    return candidate;
  }

  // Try appending _COPY or incrementing suffix
  const match = candidate.match(/^(.*)_COPY(?:_(\d+))?$/);
  let prefix = candidate;
  let counter = 1;

  if (match) {
    prefix = match[1];
    counter = match[2] ? parseInt(match[2], 10) + 1 : 2;
  } else {
    const candidateCopy = `${prefix.slice(0, 45)}_COPY`;
    if (!existingSet.has(candidateCopy)) {
      return candidateCopy;
    }
    counter = 2;
  }

  while (counter < 1000) {
    const candidateWithNum = `${prefix.slice(0, 42)}_COPY_${counter}`;
    if (!existingSet.has(candidateWithNum)) {
      return candidateWithNum;
    }
    counter++;
  }

  return `${prefix.slice(0, 40)}_${Date.now()}`;
}

/**
 * Translates PostgreSQL unique constraint errors into clear, user-friendly errors.
 */
export function formatShiftDatabaseError(
  error: any,
  shiftData?: { code?: string; name?: string }
): Error {
  if (!error) return new Error('Unknown shift error');

  const message = error.message || String(error);
  const code = error.code || '';

  if (code === '23505' || message.includes('shift_templates_code_key') || message.includes('duplicate key value')) {
    const codeLabel = shiftData?.code ? ` "${shiftData.code.trim().toUpperCase()}"` : '';
    return new Error(`Shift code${codeLabel} is already in use by another shift. Please enter a different unique shift code.`);
  }

  return error instanceof Error ? error : new Error(message || 'Failed to save shift.');
}

/**
 * Required working hours must fit inside the shift (start → end, overnight +24h). Required hours are
 * compared with the whole shift span, breaks included, which is how every existing shift is defined
 * (e.g. 10:00–19:30 = 9.5h with 9.5h required). A shift shorter than its required hours makes every
 * employee on it "short" and causes wrong deductions.
 * Returns an error message, or null when valid / when the times are not valid yet (checked elsewhere).
 */
export function requiredHoursError(shiftMinutes: number | null, requiredHours: unknown): string | null {
  const req = Number(requiredHours);
  if (!Number.isFinite(req) || req <= 0) return 'Required hours must be greater than 0.';
  if (shiftMinutes === null || !(shiftMinutes > 0)) return null;
  if (req * 60 > shiftMinutes + 0.5) {
    const h = Math.floor(shiftMinutes / 60), m = shiftMinutes % 60;
    return `Required hours (${req}h) are longer than the shift itself (${m ? `${h}h ${m}m` : `${h}h`}). Shorten the required hours or extend the shift times.`;
  }
  return null;
}
