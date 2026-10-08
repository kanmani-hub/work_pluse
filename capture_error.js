const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
  throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD in your local .env (never commit them).');
}

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log(`BROWSER CONSOLE ERROR: ${msg.text()}`);
    }
  });

  page.on('pageerror', err => {
    console.log(`BROWSER PAGE ERROR: ${err.message}`);
    console.log(`STACK TRACE: ${err.stack}`);
  });

  try {
    const { data, error } = await supabase.auth.signInWithPassword({email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD});
    const session = data.session;
    
    await page.goto('http://localhost:5173/');
    await page.evaluate((session) => {
      const projectRef = 'jiicnqgafzvkgfcienpm';
      // Adjust if the supabase reference is different. We can also use supabaseUrl to get it.
      const url = new URL(process.env.VITE_SUPABASE_URL);
      const ref = url.hostname.split('.')[0];
      localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(session));
    }, session);
    
    await page.goto('http://localhost:5173/admin/payroll', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    
  } catch (e) {
    console.log('SCRIPT_ERROR:', e.message);
  }
  
  await browser.close();
})();
