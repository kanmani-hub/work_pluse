require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Must use service_role key to bypass RLS and access auth.users
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.log("No service role key found. Cannot query auth.users.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function restoreAdmin() {
  try {
     console.log('Fetching users...');
     const { data: usersData, error: usersError } = await supabase.auth.admin.listUsers();
     
     if (usersError) {
       console.error("Error fetching users:", usersError);
       return;
     }

     const adminUser = usersData.users.find(u => u.email === 'admin@gmail.com');
     if (!adminUser) {
       console.log('No admin@gmail.com user found in auth.users!');
       return;
     }

     console.log('Found admin@gmail.com user:', adminUser.id);
     
     // Upsert profile
     const { error: profileError } = await supabase.from('profiles').upsert({
       id: adminUser.id,
       role: 'Admin',
       first_name: 'System',
       last_name: 'Admin'
     });
     
     if (profileError) {
       console.error('Error restoring profile:', profileError);
     } else {
       console.log('Profile restored for Admin.');
     }

     // Upsert employee
     const { error: empError } = await supabase.from('employees').upsert({
       id: adminUser.id,
       employee_code: 'ADMIN-001',
       first_name: 'System',
       last_name: 'Admin',
       email: 'admin@gmail.com',
       phone: '0000000000',
       designation: 'Administrator',
       status: 'Active',
       join_date: new Date().toISOString().split('T')[0]
     });

     if (empError) {
       console.error('Error restoring employee:', empError);
     } else {
       console.log('Employee restored for Admin.');
     }

  } catch (e) {
     console.error(e);
  }
}
restoreAdmin();
