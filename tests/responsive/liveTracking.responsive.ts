/**
 * Admin → Live Tracking on phones, tablets and laptops (mock backend only — synthetic rows, nothing
 * reaches a real Supabase project; GPS in the browser is reported as denied by the mock).
 *
 * Today's tracking cases come from addBreakTrackingScenario (./mockSupabase.ts): live (2 min), stale
 * (40 min), permission denied, unavailable, no location, a row without a timestamp. Times are relative
 * to the real clock; the app computes the states itself (threshold 15 minutes).
 */
import { test, expect, type Page } from '@playwright/test';
import { installMockSupabase, MOCK_HOST, type Role } from './mockSupabase';

const WIDTHS = [
  { width: 320, height: 568 }, { width: 360, height: 800 }, { width: 390, height: 844 }, { width: 430, height: 932 },
  { width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1366, height: 768 },
];

type Mock = Awaited<ReturnType<typeof installMockSupabase>>;
async function openLive(page: Page, role: Role = 'ADMIN', prepare?: (m: Mock) => void) {
  const mock = await installMockSupabase(page, role);
  prepare?.(mock);
  const pageErrors: string[] = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.goto('/admin/live-tracking');
  await expect(page.locator('.list-container tbody tr').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  return { ...mock, pageErrors };
}
const row = (page: Page, tone: string) => page.locator('.list-container tbody tr', { has: page.locator(`[data-tracking-tone="${tone}"]`) }).first();
// the stale case WITH a readable time (the row without a timestamp is also "stale")
const staleRow = (page: Page) => page.locator('.list-container tbody tr', { has: page.locator('[data-tracking-tone="stale"] .tracking-when') }).first();

for (const vp of WIDTHS) {
  test.describe(`live tracking ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp, hasTouch: vp.width < 1024 });

    test('no sideways scroll (page or list); View is reachable for every row', async ({ page }) => {
      const { pageErrors, blockedHosts } = await openLive(page);
      const overflow = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const main = document.querySelector('.main-content') as HTMLElement;
        return Math.max(document.documentElement.scrollWidth - vw, main ? main.scrollWidth - main.clientWidth : 0);
      });
      expect(overflow, 'page scrolls sideways').toBeLessThanOrEqual(1);
      const views = page.getByRole('button', { name: /View tracking details for/ });
      const n = await views.count();
      expect(n).toBeGreaterThan(0);
      for (let i = 0; i < n; i++) await expect(views.nth(i), `View ${i}`).toBeEnabled();
      // the employee list itself does not need sideways scrolling either: View is never hidden off to the right
      const list = page.locator('.list-container .lt-list-scroll');
      const { sw, cw } = await list.evaluate(e => ({ sw: e.scrollWidth, cw: e.clientWidth }));
      expect(sw, 'employee list scrolls sideways').toBeLessThanOrEqual(cw + 1);
      const first = views.first();
      await first.scrollIntoViewIfNeeded();
      const b = (await first.boundingBox())!;
      const lb = (await list.boundingBox())!;
      expect(b.x + b.width).toBeLessThanOrEqual(lb.x + lb.width + 1);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(vp.width + 1);
      if (vp.width <= 767) expect(b.height).toBeGreaterThanOrEqual(44);
      expect(pageErrors).toEqual([]);
      expect([...blockedHosts].filter(h => /supabase\./.test(h) && h !== MOCK_HOST)).toEqual([]);
    });
  });
}

test.describe('tracking status on Live Tracking', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('states match Break Management wording; WORKING stays the attendance status', async ({ page }) => {
    await openLive(page);
    const expected: [string, RegExp][] = [
      ['current', /^Live$/], ['stale', /^Not updating$/], ['permission', /^Location off$/],
      ['unavailable', /^Unavailable$/], ['no-data', /^No location$/],
    ];
    for (const [tone, label] of expected) await expect(row(page, tone).locator('.tracking-chip'), tone).toHaveText(label);
    // GPS state never changes the work status to something else (stale ≠ outside, denied ≠ offline)
    for (const tone of ['stale', 'permission', 'unavailable', 'no-data']) {
      await expect(row(page, tone).locator('.badge').first(), tone).not.toHaveText(/Outside Geofence/);
    }
  });

  test('"Location:" only while live; stale rows say "Last known location:" with time and age', async ({ page }) => {
    await openLive(page);
    // every live row says "Location:", never "Last known location:"
    const liveWhere = page.locator('.list-container [data-tracking-tone="current"] .tracking-where');
    expect(await liveWhere.count()).toBeGreaterThan(0);
    for (const t of await liveWhere.allTextContents()) expect(t).toMatch(/^Location: /);
    await expect(page.locator('.list-container [data-tracking-tone="current"] .tracking-where', { hasText: 'Location: Inside office' })).toHaveCount(1);
    const stale = staleRow(page).locator('details.tracking-status');
    await expect(stale.locator('.tracking-where')).toHaveText('Last known location: Outside office');
    await expect(stale.locator('.tracking-when')).toHaveText(/\d{2}:\d{2} [AP]M · 4\d min ago/);
    await expect(page.locator('.list-container .tracking-where', { hasText: /^Last known: / })).toHaveCount(0);
  });

  test('the details toggle is a keyboard disclosure with a visible target', async ({ page }) => {
    await openLive(page);
    const status = staleRow(page).locator('details.tracking-status');
    const summary = status.locator('summary');
    const toggle = summary.locator('.tracking-toggle');
    const tb = (await toggle.boundingBox())!;
    expect(tb.width).toBeGreaterThanOrEqual(24);
    await expect(summary).toContainText('Tracking details');   // accessible name includes the purpose
    await expect(status.locator('.tracking-detail')).toBeHidden();
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(status).toHaveAttribute('open', '');
    await expect(status.locator('.tracking-detail')).toContainText('more than 15 minutes');
    await page.keyboard.press('Space');
    await expect(status).not.toHaveAttribute('open', '');
  });

  test('a future update time is never shown as live', async ({ page }) => {
    await openLive(page, 'ADMIN', ({ db }) => {
      // the LIVE scenario row, with a device time an hour ahead and no server time
      const live = db.employee_live_locations.find(l => l.last_seen_at && Date.now() - Date.parse(l.last_seen_at) < 3 * 60000 && l.location_status === 'INSIDE_GEOFENCE');
      live!.last_seen_at = new Date(Date.now() + 60 * 60000).toISOString();
    });
    const ahead = page.locator('.list-container details.tracking-status', { has: page.locator('.tracking-chip', { hasText: 'Time ahead' }) });
    await expect(ahead).toHaveCount(1);
    await expect(ahead).toHaveAttribute('data-tracking-tone', 'stale');
    await expect(ahead.locator('.tracking-when')).toHaveText(/· 6\d min ahead$/);
    await expect(ahead.locator('.tracking-where')).toHaveText(/^Last known location: /);
    // the row it replaced (live, inside office) is no longer counted as live
    await expect(page.locator('.list-container [data-tracking-tone="current"] .tracking-where', { hasText: 'Inside office' })).toHaveCount(0);
  });
});

test.describe('details (View)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('View works without coordinates: dialog, "No coordinates received", Escape returns focus', async ({ page }) => {
    await openLive(page);
    const trigger = row(page, 'no-data').getByRole('button', { name: /View tracking details for/ });
    await expect(trigger).toBeEnabled();
    await trigger.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('lt-coordinates')).toHaveText('No coordinates received');
    await expect(dialog.locator('.tracking-status.is-expanded .tracking-chip')).toHaveText('No location');
    // the drawer slides in (0.3 s animation): measure once it has settled
    await expect.poll(async () => { const b = await dialog.boundingBox(); return b ? b.x + b.width : 9999; }).toBeLessThanOrEqual(391);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('stale details label coordinates as last known and keep the warning', async ({ page }) => {
    await openLive(page);
    await staleRow(page).getByRole('button', { name: /View tracking details for/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Last known coordinates');
    await expect(dialog.locator('.tracking-detail')).toContainText('reason is not known');
    await dialog.getByRole('button', { name: 'Close details' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

test.describe('refresh when realtime is missed', () => {
  test.use({ viewport: { width: 1366, height: 768 } });

  test('returning to the tab reloads locations (a new reading becomes Live)', async ({ page }) => {
    const { db } = await openLive(page);
    const current = page.locator('.list-container [data-tracking-tone="current"]');
    const before = await current.count();
    // the stale employee's phone reports again while realtime is not delivering (synthetic, in-memory only)
    const stale = db.employee_live_locations.find(l => l.last_seen_at && Math.abs(Date.now() - Date.parse(l.last_seen_at) - 40 * 60000) < 5 * 60000);
    const fresh = new Date().toISOString();
    stale!.last_seen_at = fresh; stale!.updated_at = fresh;
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(current).toHaveCount(before + 1);
    await expect(page.locator('.list-container [data-tracking-tone="current"] .tracking-where', { hasText: 'Outside office' })).toHaveCount(1);
  });

  test('a failed realtime channel is reported, not hidden', async ({ page }) => {
    await installMockSupabase(page, 'ADMIN');
    // registered after the mock's handler, so it answers first: the live-locations channel join fails
    await page.routeWebSocket(/.*/, ws => {
      ws.onMessage(msg => {
        try {
          const m = JSON.parse(String(msg));
          const [topic, event, ref, joinRef] = Array.isArray(m) ? [m[2], m[3], m[1], m[0]] : [m.topic, m.event, m.ref, m.join_ref];
          if (event !== 'phx_join' && event !== 'heartbeat') return;
          const status = event === 'phx_join' && String(topic).includes('live_locations') ? 'error' : 'ok';
          const payload = { status, response: status === 'error' ? { reason: 'test: join refused' } : {} };
          ws.send(JSON.stringify(Array.isArray(m) ? [joinRef, ref, topic, 'phx_reply', payload] : { topic, event: 'phx_reply', payload, ref }));
        } catch { /* not a realtime frame */ }
      });
    });
    await page.goto('/admin/live-tracking');
    await expect(page.locator('.list-container tbody tr').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('status').filter({ hasText: 'Live updates interrupted' })).toBeVisible({ timeout: 15_000 });
  });
});
