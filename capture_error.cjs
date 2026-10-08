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
      const url = new URL('http://localhost:54321'); // using a generic way or passing process.env
      // actually local storage for dev is 'sb-xxx-auth-token'
      // let's just let it be, or better yet, inject session to local storage for any sb-* 
      for(let i = 0; i < localStorage.length; i++){
         const key = localStorage.key(i);
         if(key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
            localStorage.setItem(key, JSON.stringify(session));
            return;
         }
      }
      // If not found, just hardcode the local one if we know it or create it
      localStorage.setItem(`sb-127-auth-token`, JSON.stringify(session)); 
    }, session);
    
    await page.goto('http://localhost:5173/admin/payroll', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    
  } catch (e) {
    console.log('SCRIPT_ERROR:', e.message);
  }
  
  await browser.close();
})();
