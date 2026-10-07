import { test, expect } from '@playwright/test';

test.describe('Auto Break Pause Logic', () => {
  test('should pause working timer when on auto break and resume after returning', async ({ page }) => {
    // 1. Login
    await page.goto('http://localhost:5013/login');
    
    // Fill credentials
    await page.fill('input[type="email"]', 'admin@gmail.com');
    await page.fill('input[type="password"]', 'admin@123');
    await page.click('button[type="submit"]');

    // Wait for dashboard to load
    await expect(page.locator('text=Employee Dashboard').first()).toBeVisible({ timeout: 15000 });

    // 2. Check Clock In status
    const clockInBtn = page.locator('button:has-text("Clock In")').first();
    if (await clockInBtn.isVisible()) {
      console.log('Clocking in...');
      await clockInBtn.click();
      
      // Handle potential verification steps
      const verifyLocBtn = page.locator('button:has-text("Verify Location")').first();
      if (await verifyLocBtn.isVisible()) await verifyLocBtn.click();
      
      const captureBtn = page.locator('button:has-text("Capture & Match")').first();
      if (await captureBtn.isVisible()) await captureBtn.click();
      
      const finishBtn = page.locator('button:has-text("Clock In Now")').first();
      if (await finishBtn.isVisible()) await finishBtn.click();
    }

    // Wait for WORKING status to appear
    await expect(page.locator('text=WORKING').first()).toBeVisible({ timeout: 15000 });
    console.log('User is clocked in and WORKING.');

    // 3. Observe initial timer
    const timeDisplay = page.locator('div.text-4xl.font-mono.font-bold.tracking-wider').first();
    let initialTimeText = await timeDisplay.innerText();
    console.log('Initial Working Time:', initialTimeText);
    
    // Wait 2 seconds to see it tick
    await page.waitForTimeout(2000);
    let tickedTimeText = await timeDisplay.innerText();
    console.log('Working Time after 2s tick:', tickedTimeText);
    expect(initialTimeText).not.toEqual(tickedTimeText); // Make sure it is ticking

    // 4. Simulate Auto Break START via exposed hook (10 mins ago)
    console.log('Simulating Geofence EXIT (Auto Break START)...');
    await page.evaluate(async () => {
      // Need to find window._testAutoBreak or just wait for it
      // Wait for 1s just in case
      await new Promise(r => setTimeout(r, 1000));
      if (typeof (window as any)._testAutoBreak === 'function') {
        await (window as any)._testAutoBreak('START', 10); // started 10 minutes ago
      } else {
        throw new Error('_testAutoBreak not found on window');
      }
    });

    // 5. Verify UI Updates to ON BREAK
    await expect(page.locator('text=ON BREAK').first()).toBeVisible({ timeout: 15000 });
    console.log('UI successfully updated to ON BREAK.');

    // 6. Check that working timer is PAUSED
    const pausedTime1 = await timeDisplay.innerText();
    console.log('Working Time on break (1):', pausedTime1);
    await page.waitForTimeout(3000);
    const pausedTime2 = await timeDisplay.innerText();
    console.log('Working Time on break (2):', pausedTime2);
    
    expect(pausedTime1).toEqual(pausedTime2); // IT MUST NOT INCREASE

    // Verify Break Timer exists and is > 0 (should be around 10:xx because of 10 mins ago)
    const breakTimerStr = await page.locator('text=Break Time >> xpath=..').innerText();
    console.log('Break Timer Display:', breakTimerStr);

    // 7. Simulate Auto Break END
    console.log('Simulating Geofence RETURN (Auto Break END)...');
    await page.evaluate(async () => {
      if (typeof (window as any)._testAutoBreak === 'function') {
        await (window as any)._testAutoBreak('END', 0); // Ended now
      }
    });

    // 8. Verify UI Updates to WORKING
    await expect(page.locator('text=WORKING').first()).toBeVisible({ timeout: 15000 });
    console.log('UI successfully updated back to WORKING.');

    // 9. Verify Working Timer resumes correctly
    const resumedTime1 = await timeDisplay.innerText();
    console.log('Working Time after resume (1):', resumedTime1);
    await page.waitForTimeout(3000);
    const resumedTime2 = await timeDisplay.innerText();
    console.log('Working Time after resume (2):', resumedTime2);
    
    expect(resumedTime1).not.toEqual(resumedTime2); // IT MUST RESUME INCREASING

    console.log('SUCCESS: Auto Break pause logic verified!');
  });
});
