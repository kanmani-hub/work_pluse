/**
 * Admin → Departments → View Details (mock backend only; synthetic rows, nothing reaches a real
 * Supabase project). Regression for the crash "Objects are not valid as a React child" when a
 * department has employees, plus the panel's empty, loading and error states and the existing
 * department actions.
 */
import { test, expect, type Page } from '@playwright/test';
import { installMockSupabase, MOCK_HOST } from './mockSupabase';

type Mock = Awaited<ReturnType<typeof installMockSupabase>>;
const EMPTY_DEPT = 'd0000000-0000-4000-8000-0000000000e9';

async function openDepartments(page: Page, prepare?: (m: Mock) => void) {
  const mock = await installMockSupabase(page, 'ADMIN');
  mock.db.departments[0].description = JSON.stringify({ code: 'ENG', manager: 'Ravi Kumar', desc: 'Builds the product' });
  mock.db.departments[0].created_at = '2026-01-05T06:00:00Z';
  mock.db.departments.push({ id: EMPTY_DEPT, name: 'Facilities', description: null, is_active: true, created_at: '2026-02-01T06:00:00Z' });
  prepare?.(mock);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) consoleErrors.push(m.text()); });
  await page.goto('/admin/departments');
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 20_000 });
  return { ...mock, pageErrors, consoleErrors };
}

const row = (page: Page, name: string) => page.locator('table tbody tr', { has: page.getByText(name, { exact: true }) });
async function viewDetails(page: Page, name: string) {
  await row(page, name).getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('button', { name: 'View Details' }).click();
  return page.getByRole('dialog', { name: name });
}

test.describe('department details', () => {
  test.use({ viewport: { width: 1366, height: 900 } });

  test('a department with several employees opens without crashing and lists them', async ({ page }) => {
    const { db, pageErrors, consoleErrors } = await openDepartments(page);
    const deptId = db.departments[0].id;
    const members = db.employees.filter(e => e.department_id === deptId);
    expect(members.length).toBeGreaterThan(1);

    const dialog = await viewDetails(page, 'Engineering');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('department-code')).toHaveText('ENG');
    await expect(dialog.getByTestId('department-manager')).toHaveText('Manager: Ravi Kumar');
    await expect(dialog).toContainText('Builds the product');
    await expect(dialog).toContainText('05 Jan 2026');
    await expect(dialog.getByTestId('department-employee-count')).toHaveText(`${members.length} Total`);
    const rows = dialog.locator('table.department-employees tbody tr');
    await expect(rows).toHaveCount(members.length);
    for (const m of members.slice(0, 4)) {
      const r = rows.filter({ hasText: m.employee_code });
      await expect(r).toContainText(`${m.first_name} ${m.last_name}`);
      await expect(r).toContainText('Chennai Head Office');
    }
    await expect(dialog).not.toContainText('[object Object]');
    // the page behind is still there
    await expect(page.getByRole('heading', { name: 'Departments', level: 1 })).toBeVisible();
    expect(pageErrors).toEqual([]);
    expect(consoleErrors.filter(e => /not valid as a React child/.test(e))).toEqual([]);
  });

  test('a department with no employees shows the empty state; missing code and manager are labelled', async ({ page }) => {
    const { pageErrors } = await openDepartments(page);
    const dialog = await viewDetails(page, 'Facilities');
    await expect(dialog.getByTestId('department-employee-count')).toHaveText('0 Total');
    await expect(dialog).toContainText('No employees currently assigned to this department.');
    await expect(dialog.getByTestId('department-code')).toHaveText('No code');
    await expect(dialog.getByTestId('department-manager')).toHaveText('Manager: No manager assigned');
    await expect(dialog).toContainText('No description provided.');
    expect(pageErrors).toEqual([]);
  });

  test('loading state, then the employees', async ({ page }) => {
    const { pageErrors } = await openDepartments(page);
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    await page.route(`**/rest/v1/employees?*department_id=eq.*`, async route => { await gate; await route.fallback(); });
    const dialog = await viewDetails(page, 'Engineering');
    await expect(dialog.getByRole('status')).toHaveText('Loading employees…');
    await expect(dialog.locator('table')).toHaveCount(0);
    release();
    await expect(dialog.locator('table.department-employees tbody tr').first()).toBeVisible();
    await expect(dialog.getByRole('status')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });

  test('database error state with Retry', async ({ page }) => {
    const { pageErrors } = await openDepartments(page);
    let fail = true;
    await page.route(`**/rest/v1/employees?*department_id=eq.*`, route => fail
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'simulated database error', code: 'XX000' }) })
      : route.fallback());
    const dialog = await viewDetails(page, 'Engineering');
    await expect(dialog.getByRole('alert')).toContainText('Employees could not be loaded: simulated database error');
    await expect(dialog).not.toContainText('No employees currently assigned');
    fail = false;
    await dialog.getByRole('button', { name: 'Retry' }).click();
    await expect(dialog.locator('table.department-employees tbody tr').first()).toBeVisible();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });

  test('Close and Escape close the panel; opening another department shows its own data', async ({ page }) => {
    await openDepartments(page);
    let dialog = await viewDetails(page, 'Engineering');
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    dialog = await viewDetails(page, 'Facilities');
    await expect(dialog.getByTestId('department-employee-count')).toHaveText('0 Total');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

test.describe('existing department actions still work', () => {
  test.use({ viewport: { width: 1366, height: 900 } });

  test('Add, Edit and Deactivate save as before', async ({ page }) => {
    const { db, pageErrors, blockedHosts } = await openDepartments(page);
    const writes: string[] = [];
    page.on('request', r => { if (r.url().includes('/rest/v1/departments') && r.method() !== 'GET') writes.push(`${r.method()} ${r.postData() ?? ''}`); });

    await page.getByRole('button', { name: 'Add Department' }).click();
    await page.getByLabel('Department Name', { exact: true }).fill('Quality');
    await page.getByLabel('Department Code', { exact: true }).fill('QA');
    await page.getByRole('button', { name: 'Create Department' }).click();
    await expect(page.getByText('Department created successfully')).toBeVisible();
    await expect(row(page, 'Quality')).toBeVisible();

    await row(page, 'Engineering').getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('button', { name: 'Edit Department' }).click();
    await expect(page.getByLabel('Department Code', { exact: true })).toHaveValue('ENG');
    await expect(page.getByLabel('Department Manager', { exact: true })).toHaveValue('Ravi Kumar');
    await page.getByLabel('Department Manager', { exact: true }).fill('Asha Admin');
    await page.getByRole('button', { name: 'Update Department' }).click();
    await expect(page.getByText('Department updated successfully')).toBeVisible();
    expect(JSON.parse(db.departments[0].description)).toMatchObject({ code: 'ENG', manager: 'Asha Admin' });

    await row(page, 'Facilities').getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('button', { name: 'Deactivate' }).click();
    await page.locator('button:visible', { hasText: /^Deactivate$/ }).last().click();
    await expect(page.getByText('Department deactivated successfully')).toBeVisible();
    expect(db.departments.find(d => d.id === EMPTY_DEPT)?.is_active).toBe(false);

    expect(writes.map(w => w.split(' ')[0])).toEqual(['POST', 'PATCH', 'PATCH']);
    expect(pageErrors).toEqual([]);
    expect([...blockedHosts].filter(h => /supabase\./.test(h) && h !== MOCK_HOST)).toEqual([]);
  });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('the details panel fits the screen with no sideways page scroll', async ({ page }) => {
    const { pageErrors } = await openDepartments(page);
    const dialog = await viewDetails(page, 'Engineering');
    await expect(dialog.locator('table.department-employees tbody tr').first()).toBeVisible();
    // the drawer slides in (0.3 s animation): measure once it has settled
    await expect.poll(async () => { const b = await dialog.boundingBox(); return b ? b.x + b.width : 9999; }).toBeLessThanOrEqual(391);
    expect((await dialog.boundingBox())!.x).toBeGreaterThanOrEqual(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    expect(pageErrors).toEqual([]);
  });
});
