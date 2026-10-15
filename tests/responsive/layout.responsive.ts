/**
 * Responsive layout suite — runs only against the in-memory mock backend.
 *
 *   npm run test:responsive
 *
 * Every Supabase call is answered from fixtures in ./mockSupabase.ts and every other external
 * host is aborted. Camera and GPS are NOT exercised for real: geolocation is reported as denied
 * and the browser has no camera permission, so these tests only cover layout and the
 * "unavailable / denied" states, never real capture, face matching or location checks.
 */
import { test, expect, type Page } from '@playwright/test';
import { installMockSupabase, MOCK_HOST, type Role } from './mockSupabase';

type Vp = { width: number; height: number };
const PHONE_SMALL: Vp = { width: 320, height: 568 };
const PHONE: Vp = { width: 390, height: 844 };
const PHONE_LANDSCAPE: Vp = { width: 844, height: 390 };
const TABLET: Vp = { width: 768, height: 1024 };
const LAPTOP: Vp = { width: 1366, height: 768 };
const SWEEP: Vp[] = [PHONE_SMALL, PHONE, PHONE_LANDSCAPE, TABLET, LAPTOP];

const ADMIN_ROUTES = ['dashboard', 'live-tracking', 'employees', 'departments', 'offices', 'shifts', 'attendance', 'breaks', 'wfh', 'leave', 'payroll', 'roster', 'permission', 'overtime', 'reports', 'notifications', 'audit-logs', 'settings', 'face-registration'];
const EMPLOYEE_ROUTES = ['dashboard', 'attendance', 'breaks', 'wfh', 'leave', 'permission', 'overtime', 'payroll', 'payslip', 'profile', 'notifications'];

interface RouteCase { role: Role; path: string; expectPath: string }
const ROUTES: RouteCase[] = [
  ...ADMIN_ROUTES.map(r => ({ role: 'ADMIN' as Role, path: `/admin/${r}`, expectPath: `/admin/${r}` })),
  ...EMPLOYEE_ROUTES.map(r => ({ role: 'EMPLOYEE' as Role, path: `/employee/${r}`, expectPath: `/employee/${r}` })),
  { role: 'ANON', path: '/login', expectPath: '/login' },
  { role: 'ANON', path: '/reset-password', expectPath: '/reset-password' },
  // protected routes: redirects must still happen (RBAC is not changed by layout work)
  { role: 'ANON', path: '/admin/dashboard', expectPath: '/login' },
  { role: 'EMPLOYEE', path: '/admin/dashboard', expectPath: '/employee/dashboard' },
  { role: 'HR', path: '/admin/payroll', expectPath: '/admin/payroll' },
];

async function open(page: Page, role: Role, path: string) {
  const mock = await installMockSupabase(page, role);
  const pageErrors: string[] = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.goto(path);
  // wait for real content (not a blank page or a loading placeholder)
  await page.waitForFunction(() => {
    const t = (document.querySelector('#root') as HTMLElement | null)?.innerText.trim() || '';
    return t.length > 40 && !/^Loading/i.test(t);
  }, null, { timeout: 20_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(400);
  return { ...mock, pageErrors };
}

/** Layout facts measured in the page (same rules as the audit used for the defect inventory). */
function measure(page: Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const SHELL = '.main-content,.main-wrapper,.app-layout,#root';
    const inScroller = (el: Element) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (p.matches(SHELL)) continue;
        const s = getComputedStyle(p);
        if (/(auto|scroll)/.test(s.overflowX) && p.scrollWidth > p.clientWidth + 1) return true;
        if (/(auto|scroll|hidden|clip)/.test(s.overflowX) && p.getBoundingClientRect().right <= vw + 1) return true;
      }
      return false;
    };
    const visible = (e: Element) => {
      const r = e.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const s = getComputedStyle(e);
      return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
    };
    const controls = [...document.querySelectorAll('#root button, #root a[href], #root input:not([type=hidden]), #root select, #root textarea')].filter(visible);
    const clipped = controls.filter(e => {
      const r = e.getBoundingClientRect();
      if (r.right <= 0 && e.closest('.sidebar')) return false; // closed off-canvas drawer
      return (r.right > vw + 1 || r.left < -1) && !inScroller(e) && getComputedStyle(e).position !== 'fixed';
    }).map(e => `${e.tagName.toLowerCase()} "${((e as HTMLElement).innerText || e.getAttribute('aria-label') || '').trim().slice(0, 30)}"`);
    const scrollers = [...document.querySelectorAll('.main-content, .main-wrapper')].map(e => e.scrollWidth - e.clientWidth);
    return {
      pageOverflow: Math.max(document.documentElement.scrollWidth - vw, ...scrollers, 0),
      clipped,
      headerHeight: Math.round(document.querySelector('.header')?.getBoundingClientRect().height || 0),
      unnamedButtons: controls.filter(e => e.tagName === 'BUTTON' && !(e as HTMLElement).innerText.trim() && !e.getAttribute('aria-label') && !e.getAttribute('title')).length,
    };
  });
}

function noRealBackend(blocked: Set<string>) {
  const real = [...blocked].filter(h => /supabase\.(co|in|net)$/.test(h) && h !== MOCK_HOST);
  expect(real, 'a real Supabase host was requested — the app is not running with the mock env').toEqual([]);
}

for (const vp of SWEEP) {
  test.describe(`layout ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp, hasTouch: vp.width < 1024 });
    for (const rc of ROUTES) {
      test(`${rc.role} ${rc.path}`, async ({ page }) => {
        const { blockedHosts, pageErrors } = await open(page, rc.role, rc.path);
        await expect(page).toHaveURL(new RegExp(`${rc.expectPath.replace(/\//g, '\\/')}(\\?|$)`));
        const m = await measure(page);
        expect(m.pageOverflow, 'page scrolls sideways').toBeLessThanOrEqual(1);
        expect(m.clipped, 'controls outside the screen and not in a scroll area').toEqual([]);
        if (vp.width < 768 && m.headerHeight) expect(m.headerHeight, 'phone header should be one row').toBeLessThanOrEqual(80);
        if (vp.width >= 1025 && m.headerHeight) expect(m.headerHeight, 'laptop header should be one row').toBeLessThanOrEqual(80);
        expect(m.unnamedButtons, 'icon-only buttons without an accessible name').toBe(0);
        expect(pageErrors).toEqual([]);
        noRealBackend(blockedHosts);
      });
    }
  });
}

test.describe('mobile navigation drawer', () => {
  test.use({ viewport: PHONE, hasTouch: true });

  test('opens from the menu button, closes with Escape and returns focus', async ({ page }) => {
    await open(page, 'ADMIN', '/admin/dashboard');
    const toggle = page.locator('.menu-toggle');
    const drawer = page.locator('#app-sidebar');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(drawer).toHaveAttribute('inert', '');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(drawer).toHaveAttribute('role', 'dialog');
    await expect(page.getByRole('button', { name: 'Close menu' }).first()).toBeFocused();
    // the drawer slides in; wait for the transition to finish
    await expect.poll(async () => (await drawer.boundingBox())?.x ?? -999).toBeGreaterThanOrEqual(-1);
    // the page behind does not scroll
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('.main-content')!).overflowY)).toBe('hidden');
    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();
  });

  test('closes after navigating and keeps role-based links', async ({ page }) => {
    await open(page, 'ADMIN', '/admin/dashboard');
    await page.locator('.menu-toggle').click();
    await page.locator('#app-sidebar').getByRole('link', { name: /Employees/ }).first().click();
    await expect(page).toHaveURL(/\/admin\/employees/);
    await expect(page.locator('.menu-toggle')).toHaveAttribute('aria-expanded', 'false');
  });

  test('employee drawer shows employee links only', async ({ page }) => {
    await open(page, 'EMPLOYEE', '/employee/dashboard');
    await page.locator('.menu-toggle').click();
    const hrefs = await page.locator('#app-sidebar a[href]').evaluateAll(as => as.map(a => a.getAttribute('href') || ''));
    expect(hrefs.length).toBeGreaterThan(3);
    expect(hrefs.filter(h => h.startsWith('/admin'))).toEqual([]);
  });
});

test.describe('laptop layout is unchanged', () => {
  test.use({ viewport: LAPTOP });
  test('sidebar is visible and the menu button is hidden', async ({ page }) => {
    await open(page, 'ADMIN', '/admin/dashboard');
    const box = await page.locator('#app-sidebar').boundingBox();
    expect(box && box.x).toBeGreaterThanOrEqual(0);
    await expect(page.locator('.menu-toggle')).toBeHidden();
    await expect(page.locator('#app-sidebar')).not.toHaveAttribute('inert', '');
  });
});

for (const vp of [PHONE_SMALL, PHONE_LANDSCAPE]) {
  test.describe(`dialogs ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp, hasTouch: true });
    test('Add Employee dialog fits the screen, scrolls inside, and closes with Escape', async ({ page }) => {
      await open(page, 'ADMIN', '/admin/employees');
      const trigger = page.getByRole('button', { name: /Add Employee/ }).first();
      await trigger.click();
      const dialog = page.getByRole('dialog').first();
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAttribute('aria-modal', 'true');
      // dialogs slide in; wait until the panel has settled inside the viewport
      await expect.poll(async () => { const b = await dialog.boundingBox(); return b ? b.x + b.width : 99999; }).toBeLessThanOrEqual(vp.width + 1);
      const box = (await dialog.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 1);
      expect(box.height).toBeLessThanOrEqual(vp.height + 1);
      await expect(dialog.getByRole('button', { name: 'Close' }).first()).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(trigger).toBeFocused();
    });
  });
}

test.describe('tables on phones', () => {
  test.use({ viewport: PHONE, hasTouch: true });
  test('wide tables scroll inside a named, keyboard-focusable region', async ({ page }) => {
    await open(page, 'ADMIN', '/admin/employees');
    const region = page.locator('[data-scroll-region="true"]').first();
    await expect(region).toHaveAttribute('tabindex', '0');
    await expect(region).toHaveAttribute('role', 'region');
    await expect(region).toHaveAttribute('aria-label', /.+/);
    const before = await region.evaluate(e => e.scrollLeft);
    await region.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    // scrolling may be animated (smooth scroll), so poll
    await expect.poll(() => region.evaluate(e => e.scrollLeft)).toBeGreaterThan(before);
  });

  test('admin payroll records are shown (they were hidden below 900px)', async ({ page }) => {
    await open(page, 'ADMIN', '/admin/payroll');
    await expect(page.locator('.payroll-records table')).toBeVisible();
  });
});

test.describe('camera pages (layout only — no real camera or GPS)', () => {
  test.use({ viewport: PHONE_SMALL, hasTouch: true });
  test('employee attendance fits 320px with GPS denied', async ({ page }) => {
    await open(page, 'EMPLOYEE', '/employee/attendance');
    expect((await measure(page)).pageOverflow).toBeLessThanOrEqual(1);
  });
  test('face registration camera panel fits 320px when the camera is unavailable', async ({ page }) => {
    await open(page, 'ADMIN', '/admin/face-registration');
    const register = page.getByRole('button', { name: /Register Face/ }).first();
    await register.click();
    await page.waitForTimeout(800);
    const widest = await page.evaluate(() => Math.max(0, ...[...document.querySelectorAll('video, [role="dialog"]')].map(e => e.getBoundingClientRect().right)));
    expect(widest).toBeLessThanOrEqual(321);
    expect((await measure(page)).pageOverflow).toBeLessThanOrEqual(1);
  });
});
