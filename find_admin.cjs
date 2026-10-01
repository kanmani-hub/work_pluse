require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function findAdmin() {
  const tables = ['company_settings', 'roles', 'audit_logs', 'notifications'];
  for (const t of tables) {
    const { data, error } = await supabase.from(t).select('*').limit(5);
    console.log(`Table ${t}:`, data ? JSON.stringify(data) : error.message);
  }
}

findAdmin();
