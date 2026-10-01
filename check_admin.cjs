require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Must use service_role key to bypass RLS and access auth.users
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY);

async function checkAdmin() {
  try {
     // If we only have anon key, we can't query auth.users directly. 
     // We will try inserting a profile for a known ID or using service_role key if available.
     const { data, error } = await supabase.from('profiles').select('*');
     console.log('Profiles currently:', data);
     
     // Let's check environment variables for a service role key or just use anon.
  } catch (e) {
     console.error(e);
  }
}
checkAdmin();
