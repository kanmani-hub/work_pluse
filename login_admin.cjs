require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function loginAndRestore() {
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
    console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD in your local .env (never commit them).');
    return;
  }
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD
    });
    if (error) {
      console.log('Login failed:', error.message);
      return;
    }
    await restore(data.user);
  } catch (e) {
    console.error(e);
  }
}

async function restore(user) {
   console.log('Logged in as:', user.id);
   
   // Insert into profiles
   const { error: pError } = await supabase.from('profiles').insert({
     id: user.id,
     role: 'Admin',
     first_name: 'System',
     last_name: 'Admin'
   });
   console.log('Profiles restore:', pError ? pError.message : 'Success');

   // Insert into employees
   const { error: eError } = await supabase.from('employees').insert({
     id: user.id,
     employee_code: 'ADMIN-001',
     first_name: 'System',
     last_name: 'Admin',
     email: 'admin@gmail.com',
     phone: '0000000000',
     designation: 'System Administrator',
     status: 'Active',
     join_date: new Date().toISOString().split('T')[0]
   });
   console.log('Employees restore:', eError ? eError.message : 'Success');
}

loginAndRestore();
