require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function run() {
  console.log('--- Roles ---');
  const { data: roles, error: errRoles } = await supabase.from('roles').select('*');
  console.log(roles, errRoles?.message);

  console.log('\n--- Employees (Admin) ---');
  const { data: emps, error: errEmps } = await supabase.from('employees').select('id, first_name, last_name, role_id, email').eq('email', 'admin@gmail.com');
  console.log(emps, errEmps?.message);

  console.log('\n--- Profiles (Admin) ---');
  if (emps && emps.length > 0) {
    const { data: profs, error: errProfs } = await supabase.from('profiles').select('*').eq('id', emps[0].id);
    console.log(profs, errProfs?.message);
  }
}
run();
