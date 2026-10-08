import { describe, it, expect } from 'vitest';
import { normalizeRole, canManagePayroll, isAdminPortalRole } from './roles';

describe('canonical role mapping', () => {
  it('maps every admin spelling to ADMIN', () => {
    for (const name of ['ADMIN', 'Admin', 'admin', 'System Admin', ' SYSTEM  ADMIN ']) {
      expect(normalizeRole(name)).toBe('ADMIN');
    }
  });

  it('maps HR spellings to HR', () => {
    for (const name of ['HR', 'hr', 'HR Manager', 'HR/Staff']) {
      expect(normalizeRole(name)).toBe('HR');
    }
  });

  it('allows ADMIN and HR to manage payroll, denies EMPLOYEE and unknown roles', () => {
    expect(canManagePayroll('ADMIN')).toBe(true);
    expect(canManagePayroll('Admin')).toBe(true);
    expect(canManagePayroll('System Admin')).toBe(true);
    expect(canManagePayroll('HR')).toBe(true);
    expect(canManagePayroll('HR Manager')).toBe(true);
    expect(canManagePayroll('EMPLOYEE')).toBe(false);
    expect(canManagePayroll('Employee')).toBe(false);
    expect(canManagePayroll('Superuser')).toBe(false);
    expect(canManagePayroll('')).toBe(false);
    expect(canManagePayroll(null)).toBe(false);
  });

  it('only ADMIN and HR enter the admin portal', () => {
    expect(isAdminPortalRole('ADMIN')).toBe(true);
    expect(isAdminPortalRole('HR')).toBe(true);
    expect(isAdminPortalRole('EMPLOYEE')).toBe(false);
  });
});
