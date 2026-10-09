import { describe, it, expect } from 'vitest';
import { decideRouteAccess } from './routeAccess';

const ADMIN_PORTAL = ['ADMIN', 'HR'];
const EMPLOYEE_PORTAL = ['EMPLOYEE'];

describe('decideRouteAccess', () => {
  it('allows an employee into employee routes and an admin/HR into admin routes', () => {
    expect(decideRouteAccess('EMPLOYEE', EMPLOYEE_PORTAL)).toBe('allow');
    expect(decideRouteAccess('ADMIN', ADMIN_PORTAL)).toBe('allow');
    expect(decideRouteAccess('HR', ADMIN_PORTAL)).toBe('allow');
  });

  it('sends an employee who opens /admin back to the employee portal', () => {
    expect(decideRouteAccess('EMPLOYEE', ADMIN_PORTAL)).toBe('redirect-employee');
  });

  it('sends admin/HR who open /employee to the admin portal', () => {
    expect(decideRouteAccess('ADMIN', EMPLOYEE_PORTAL)).toBe('redirect-admin');
    expect(decideRouteAccess('HR', EMPLOYEE_PORTAL)).toBe('redirect-admin');
  });

  it('never redirects a missing/unknown role (no endless redirect loop)', () => {
    for (const role of [null, undefined, '', 'MANAGER', 'superuser']) {
      expect(decideRouteAccess(role as any, EMPLOYEE_PORTAL)).toBe('role-error');
      expect(decideRouteAccess(role as any, ADMIN_PORTAL)).toBe('role-error');
    }
  });

  it('every redirect targets a portal the role is allowed into', () => {
    for (const role of ['ADMIN', 'HR', 'EMPLOYEE']) {
      for (const portal of [ADMIN_PORTAL, EMPLOYEE_PORTAL]) {
        const d = decideRouteAccess(role, portal);
        if (d === 'redirect-admin') expect(decideRouteAccess(role, ADMIN_PORTAL)).toBe('allow');
        if (d === 'redirect-employee') expect(decideRouteAccess(role, EMPLOYEE_PORTAL)).toBe('allow');
      }
    }
  });
});
