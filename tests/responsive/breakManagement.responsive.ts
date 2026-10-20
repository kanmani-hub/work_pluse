/**
 * Admin → Break Management on phones, tablets and laptops (mock backend only).
 *
 * The mock adds today's tracking cases (see addBreakTrackingScenario in ./mockSupabase.ts): live,
 * stale (40 min), location permission denied, location unavailable, no location, a location row
 * with no timestamp, and a clocked-out day with excess. Times are relative to the real clock, and
 * staleness is computed by the app from those timestamps (threshold 15 minutes).
 * Nothing here reaches a real Supabase project; "End Break" only changes the in-memory mock.
 */
import { test, expect, type Page } from '@playwright/test';
import { installMockSupabase, MOCK_HOST, type Role } from './mockSupabase';

const WIDTHS = [
  { width: 320, height: 568 }, { width: 360, height: 800 }, { width: 390, height: 844 }, { width: 430, height: 932 },
  { width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1366, height: 768 },
];
const COLUMNS = ['Employee', 'Shift', 'Allowed', 'Break time (live)', 'Completed', 'Stored (payroll)', 'Excess', 'Status', 'Tracking', 'Actions'];

async function openBreaks(page: Page, role: Role = 'ADMIN') {
  const mock = await installMockSupabase(page, role);
  const pageErrors: string[] = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.goto('/admin/breaks');
  await expect(page.locator('.break-table tr.bt-row').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  return { ...mock, pageErrors };
}

const row = (page: Page, tone: string) => page.locator('.break-table tr.bt-row', { has: page.locator(`[data-tracking-tone="${tone}"]`) }).first();
// the live-tracked employee who is ON a break (the signed-in test employee is also live, without a break,
// whenever the company date equals the runner's local date — so "first live row" alone depends on the clock)
const liveOnBreak = (page: Page) => page.locator('.break-table tr.bt-row.bt-row--on_break', { has: page.locator('[data-tracking-tone="current"]') }).first();

for (const vp of WIDTHS) {
  test.describe(`break management ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp, hasTouch: vp.width < 1024 });

    test('no page-level sideways scroll; every column is reachable', async ({ page }) => {
      const { pageErrors, blockedHosts } = await openBreaks(page);
      const overflow = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const main = document.querySelector('.main-content') as HTMLElement;
        return Math.max(document.documentElement.scrollWidth - vw, main.scrollWidth - main.clientWidth);
      });
      expect(overflow, 'page scrolls sideways').toBeLessThanOrEqual(1);

      const first = liveOnBreak(page);
      if (vp.width <= 767) {
        // phone cards: the same cells, each labelled with its column name
        const labels = await first.locator('td[data-label]').evaluateAll(tds => tds.map(td => td.getAttribute('data-label')));
        expect(labels).toEqual(COLUMNS);
        const box = (await first.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 1);
      } else {
        await expect(page.locator('.break-table thead th')).toHaveCount(10);
        // the table either fits or scrolls inside a named, focusable region (never clipped)
        const wrap = page.locator('.break-table-card .table-responsive');
        const { scrolls, fits } = await wrap.evaluate(e => ({ scrolls: getComputedStyle(e).overflowX, fits: e.scrollWidth <= e.clientWidth + 1 }));
        if (!fits) {
          expect(scrolls).toBe('auto');
          await expect(wrap).toHaveAttribute('role', 'region');
          await expect(wrap).toHaveAttribute('tabindex', '0');
        }
      }
      // actions are on screen without scrolling the table
      const endBreak = first.getByRole('button', { name: /End active break/ });
      const eb = (await endBreak.boundingBox())!;
      expect(eb.x + eb.width).toBeLessThanOrEqual(vp.width + 1);
      expect(eb.height).toBeGreaterThanOrEqual(vp.width <= 767 ? 44 : 24);
      expect(pageErrors).toEqual([]);
      expect([...blockedHosts].filter(h => /supabase\./.test(h) && h !== MOCK_HOST)).toEqual([]);
    });
  });
}

test.describe('tracking status', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('each tracking case has its own compact, worded state', async ({ page }) => {
    await openBreaks(page);
    const expected: [string, RegExp][] = [
      ['current', /^Live$/], ['stale', /^Not updating$/], ['permission', /^Location off$/],
      ['unavailable', /^Unavailable$/], ['no-data', /^No location$/],
    ];
    for (const [tone, label] of expected) {
      const chip = row(page, tone).locator('.tracking-chip');
      await expect(chip, tone).toBeVisible();
      await expect(chip, tone).toHaveText(label);
    }
  });

  test('stale: last update time and age come from the timestamp; details expand on demand', async ({ page }) => {
    await openBreaks(page);
    const status = row(page, 'stale').locator('details.tracking-status');
    await expect(status.locator('.tracking-when')).toHaveText(/\d{2}:\d{2} [AP]M · (4\d) min ago/);
    await expect(status.locator('.tracking-where')).toHaveText('Last known location: Outside office');
    const detail = status.locator('.tracking-detail');
    await expect(detail).toBeHidden();
    await status.locator('summary').click();
    await expect(detail).toBeVisible();
    await expect(detail).toContainText('more than 15 minutes');
    await expect(detail).toContainText('reason is not known');
  });

  test('a location row without a timestamp is "not updating", with no invented time', async ({ page }) => {
    await openBreaks(page);
    const statuses = page.locator('details.tracking-status[data-tracking-tone="stale"]');
    const noTime = statuses.filter({ hasNot: page.locator('.tracking-when') });
    await expect(noTime).toHaveCount(1);
    await noTime.locator('summary').click();
    await expect(noTime.locator('.tracking-detail')).toContainText('no readable update time');
  });

  test('permission off and unavailable are different states', async ({ page }) => {
    await openBreaks(page);
    const perm = row(page, 'permission').locator('details.tracking-status');
    await perm.locator('summary').click();
    await expect(perm.locator('.tracking-detail')).toContainText('permission was denied');
    const unav = row(page, 'unavailable').locator('details.tracking-status');
    await unav.locator('summary').click();
    await expect(unav.locator('.tracking-detail')).toContainText('could not determine a location');
    await expect(unav.locator('.tracking-detail')).not.toContainText('permission');
  });
});

test.describe('break actions', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('End Break appears only for breaks that are in progress', async ({ page }) => {
    await openBreaks(page);
    const onBreak = page.locator('.break-table tr.bt-row--on_break');
    const onBreakCount = await onBreak.count();
    expect(onBreakCount).toBeGreaterThan(0);
    await expect(page.getByRole('button', { name: /End active break/ })).toHaveCount(onBreakCount);
    await expect(page.locator('.break-table tr.bt-row:not(.bt-row--on_break)').getByRole('button', { name: /End active break/ })).toHaveCount(0);
  });

  test('HR (an admin-portal role) gets the same actions', async ({ page }) => {
    await openBreaks(page, 'HR');
    await expect(page.getByRole('button', { name: /End active break/ }).first()).toBeVisible();
  });

  test('a double tap on End Break sends one request', async ({ page }) => {
    await openBreaks(page);
    let patches = 0;
    page.on('request', r => { if (r.method() === 'PATCH' && r.url().includes('/rest/v1/attendance_breaks')) patches++; });
    page.on('dialog', d => d.accept());
    const btn = liveOnBreak(page).getByRole('button', { name: /End active break/ });
    await btn.dblclick();
    await expect(page.getByText('Active break successfully ended.')).toBeVisible();
    expect(patches).toBe(1);
  });

  test('View Details opens a dialog that fits the phone and closes with Escape', async ({ page }) => {
    await openBreaks(page);
    const trigger = row(page, 'stale').getByRole('button', { name: /View break details/ });
    await trigger.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Break Details');
    await expect(dialog.locator('.tracking-status.is-expanded .tracking-detail')).toContainText('more than 15 minutes');
    await expect.poll(async () => { const b = await dialog.boundingBox(); return b ? b.x + b.width : 9999; }).toBeLessThanOrEqual(391);
    const box = (await dialog.boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(845);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
});

test.describe('laptop keeps the side panel', () => {
  test.use({ viewport: { width: 1366, height: 768 } });
  test('details open beside the table, not as a dialog', async ({ page }) => {
    await openBreaks(page);
    await row(page, 'stale').getByRole('button', { name: /View break details/ }).click();
    await expect(page.locator('.break-details-pane')).toBeVisible();
    await expect(page.locator('.break-details-overlay')).toHaveCount(0);
  });
});
