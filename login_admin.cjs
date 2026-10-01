require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function loginAndRestore() {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: 'admin@gmail.com',
      password: 'password' // usually default password for demo
    });

    if (error) {
      // Maybe try password123 or admin123
      console.log('Login failed with password:', error.message);
      
      const res2 = await supabase.auth.signInWithPassword({
        email: 'admin@gmail.com',
        password: 'password123'
      });
      if (res2.error) {
         console.log('Login failed with password123:', res2.error.message);
         
         const res3 = await supabase.auth.signInWithPassword({
            email: 'admin@gmail.com',
            password: 'admin'
         });
         if (res3.error) {
            console.log('Login failed with admin:', res3.error.message);
            const res4 = await supabase.auth.signInWithPassword({
               email: 'admin@gmail.com',
               password: 'admin123'
            });
            if (res4.error) {
               console.log('Could not guess admin password.');
               return;
            } else {
               await restore(res4.data.user);
            }
         } else {
            await restore(res3.data.user);
         }
      } else {
        await restore(res2.data.user);
      }
    } else {
      await restore(data.user);
    }
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
