import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import DepartmentDetailPanel from './DepartmentDetailPanel';
import PanelErrorBoundary from '../common/PanelErrorBoundary';
import { toDepartmentEmployeeRows } from '../../services/department/departmentDetailRules';

// Synthetic department rows shaped like departmentService.getDepartments() (incl. its embedded employees array)
const employeesEmbed = [
  { id: 'e1', first_name: 'Asha', last_name: 'Rao', employee_code: 'EMP001', status: 'ACTIVE', office: { name: 'Chennai HQ' } },
  { id: 'e2', first_name: 'Ravi', last_name: 'Kumar', employee_code: 'EMP002', status: 'INACTIVE', office: null },
];
const dept = (over: Record<string, any> = {}) => ({
  id: 'd1', name: 'Engineering', is_active: true, created_at: '2026-01-05T06:00:00Z',
  description: JSON.stringify({ code: 'ENG', manager: 'Ravi Kumar', desc: 'Builds the product' }),
  employees: employeesEmbed, employeeCount: 2, ...over,
});
const noop = () => {};
const render = (department: any, employees: any) =>
  renderToStaticMarkup(<DepartmentDetailPanel department={department} employees={employees} onClose={noop} onRetry={noop} onOpenEmployees={noop} />);

describe('Departments → View Details panel', () => {
  it('a department with several employees renders (this exact row used to crash the app)', () => {
    const rows = toDepartmentEmployeeRows([...employeesEmbed, { id: 'e3', first_name: 'Zara', last_name: 'Iqbal', employee_code: 'EMP003', designation: 'QA Lead', status: 'ACTIVE', office: { name: 'Pune' } }]);
    let html = '';
    expect(() => { html = render(dept(), { status: 'ready', rows }); }).not.toThrow();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('Engineering');
    expect(html).toContain('>ENG<');
    expect(html).toContain('Ravi Kumar');
    expect(html).toContain('Builds the product');
    expect(html).toContain('3 Total');
    for (const t of ['Asha Rao', 'EMP001', 'Chennai HQ', 'Ravi Kumar', 'EMP002', 'Inactive', 'Zara Iqbal', 'QA Lead', 'Pune']) expect(html, t).toContain(t);
    expect(html).toContain('05 Jan 2026');
    expect(html).not.toContain('[object Object]');
  });

  it('a department with no employees shows the empty state and 0 Total', () => {
    const html = render(dept({ employees: [], employeeCount: 0 }), { status: 'ready', rows: [] });
    expect(html).toContain('No employees currently assigned to this department.');
    expect(html).toContain('0 Total');
    expect(html).not.toContain('<table');
  });

  it('missing code, manager, description and date have their own empty text', () => {
    const html = render(dept({ description: null, created_at: null }), { status: 'ready', rows: [] });
    expect(html).toContain('No code');
    expect(html).toContain('No manager assigned');
    expect(html).toContain('No description provided.');
    expect(html).toContain('Not recorded');
  });

  it('legacy plain-text description is shown as the description', () => {
    const html = render(dept({ description: 'Handles payroll' }), { status: 'ready', rows: [] });
    expect(html).toContain('Handles payroll');
    expect(html).toContain('No code');
  });

  it('loading state: a status message, no table and no count yet', () => {
    const html = render(dept(), { status: 'loading' });
    expect(html).toContain('role="status"');
    expect(html).toContain('Loading employees…');
    expect(html).not.toContain('Total</span>');
    expect(html).not.toContain('<table');
  });

  it('database error state: the message and a Retry button, no fake empty list', () => {
    const html = render(dept(), { status: 'error', message: 'permission denied for table employees' });
    expect(html).toContain('role="alert"');
    expect(html).toContain('Employees could not be loaded: permission denied for table employees');
    expect(html).toContain('Retry');
    expect(html).not.toContain('No employees currently assigned');
  });
});

describe('PanelErrorBoundary', () => {
  const Boom: React.FC = () => { throw new Error('Objects are not valid as a React child'); };
  it('catches a render error and shows the fallback instead of unmounting the app', () => {
    expect(PanelErrorBoundary.getDerivedStateFromError(new Error('x'))).toEqual({ error: expect.any(Error) });
    const b = new PanelErrorBoundary({ children: <Boom />, fallback: (e: Error) => <p>Panel failed: {e.message}</p> });
    b.state = { error: new Error('Objects are not valid as a React child') };
    expect(renderToStaticMarkup(<>{b.render()}</>)).toBe('<p>Panel failed: Objects are not valid as a React child</p>');
  });
  it('renders its children when nothing failed', () => {
    expect(renderToStaticMarkup(<PanelErrorBoundary fallback={() => <p>fallback</p>}><span>ok</span></PanelErrorBoundary>)).toBe('<span>ok</span>');
  });
  it('a different record (resetKey) clears the caught error', () => {
    const b = new PanelErrorBoundary({ children: null, fallback: () => null, resetKey: 'd2' });
    b.state = { error: new Error('x') };
    let next: any = null;
    b.setState = ((s: any) => { next = s; }) as any;
    b.componentDidUpdate({ children: null, fallback: () => null, resetKey: 'd1' });
    expect(next).toEqual({ error: null });
  });
});
