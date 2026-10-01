require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function main() {
  try {
    // 1. Identify Admin
    const { data: adminProfile } = await supabase.from('profiles').select('id').eq('role', 'admin').single();
    const adminId = adminProfile ? adminProfile.id : null;
    console.log('Admin Profile ID:', adminId);

    // 2. Clear remaining transactional data just in case
    console.log('Clearing remaining transactional data...');
    await supabase.from('attendance').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('leave_requests').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('wfh_requests').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('permission_requests').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('shift_assignments').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('employee_live_locations').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('location_verification_events').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('face_registrations').delete().neq('id', '00000000-0000-0000-0000-000000000000');

    // 3. Delete non-admin Employees
    console.log('Deleting non-admin employees...');
    if (adminId) {
      await supabase.from('employees').delete().neq('id', adminId);
      await supabase.from('profiles').delete().neq('id', adminId);
    } else {
      await supabase.from('employees').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('profiles').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    }

    // 4. Delete Offices
    console.log('Deleting offices...');
    // We should delete all offices if none are strictly required for Admin system record.
    // Let's check if the admin employee has an office assigned.
    const { data: adminEmp } = await supabase.from('employees').select('office_id, department_id').eq('id', adminId).single();
    
    if (adminEmp) {
      if (adminEmp.office_id) {
         // Temporarily nullify admin office_id to allow deleting all offices
         await supabase.from('employees').update({ office_id: null }).eq('id', adminId);
      }
      if (adminEmp.department_id) {
         await supabase.from('employees').update({ department_id: null }).eq('id', adminId);
      }
    }
    
    await supabase.from('offices').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('departments').delete().neq('id', '00000000-0000-0000-0000-000000000000');

    console.log('Cleanup complete. Reporting counts:');
    
    const tables = ['employees', 'profiles', 'departments', 'offices', 'attendance', 'employee_live_locations', 'leave_requests', 'wfh_requests', 'permission_requests', 'shift_assignments', 'face_registrations'];
    for (const t of tables) {
      const { count, error } = await supabase.from(t).select('*', { count: 'exact', head: true });
      console.log(`${t}: ${count}`);
    }

  } catch(e) {
    console.error(e);
  }
}
main();
