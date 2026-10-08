import { supabase } from './src/lib/supabase';
import { config } from 'dotenv';
config();
if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
  throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD in your local .env (never commit them).');
}

async function removeRavi() {
  const { data: { user }, error: authErr } = await supabase.auth.signInWithPassword({
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD
  });
  if (authErr) throw authErr;
  
  console.log('Searching for employee with name containing "ravi"...');
  
  // First, find the employee ID
  const { data: employees, error: searchErr } = await supabase
    .from('employees')
    .select('*')
    .or('first_name.ilike.%ravi%,last_name.ilike.%ravi%,employee_code.ilike.%ravi%');
    
  if (searchErr) {
    console.error('Error finding employee:', searchErr);
    process.exit(1);
  }

  if (!employees || employees.length === 0) {
    console.log('No employee named "ravi" found.');
    process.exit(0);
  }

  console.log(`Found ${employees.length} employee(s) matching "ravi".`);
  
  for (const emp of employees) {
    console.log(`Deleting employee: ${emp.first_name} ${emp.last_name} (${emp.employee_code}) - ID: ${emp.id}`);
    
    // Delete related records
    await supabase.from('employee_live_locations').delete().eq('employee_id', emp.id);
    await supabase.from('employee_location_history').delete().eq('employee_id', emp.id);
    await supabase.from('attendance_breaks').delete().eq('employee_id', emp.id);
    await supabase.from('attendance_events').delete().eq('employee_id', emp.id);
    
    // Some tables need a direct delete
    const { data: atts } = await supabase.from('attendance').select('id').eq('employee_id', emp.id);
    if (atts) {
        for (const a of atts) {
            await supabase.from('attendance_events').delete().eq('attendance_id', a.id);
            await supabase.from('attendance_breaks').delete().eq('attendance_id', a.id);
            await supabase.from('attendance').delete().eq('id', a.id);
        }
    }
    await supabase.from('wfh_requests').delete().eq('employee_id', emp.id);
    await supabase.from('leave_requests').delete().eq('employee_id', emp.id);
    await supabase.from('permission_requests').delete().eq('employee_id', emp.id);
    
    // payroll depends on payroll_payments and payroll_items
    const { data: payrolls } = await supabase.from('payroll').select('id').eq('employee_id', emp.id);
    if (payrolls && payrolls.length > 0) {
      for (const p of payrolls) {
         await supabase.from('payroll_payments').delete().eq('payroll_id', p.id);
         await supabase.from('payroll_items').delete().eq('payroll_id', p.id);
         await supabase.from('payroll').delete().eq('id', p.id);
      }
    }
    await supabase.from('salary_structures').delete().eq('employee_id', emp.id);
    
    await supabase.from('shift_assignments').delete().eq('employee_id', emp.id);
    await supabase.from('profiles').delete().eq('employee_id', emp.id);
    
    const { error: delErr } = await supabase
      .from('employees')
      .delete()
      .eq('id', emp.id);
      
    if (delErr) {
      console.error(`Failed to delete employee ${emp.id}:`, delErr);
      
      console.log('Attempting to deactivate instead...');
      const { error: updateErr } = await supabase
        .from('employees')
        .update({ status: 'INACTIVE' } as any)
        .eq('id', emp.id);
        
      if (updateErr) {
        console.error('Also failed to deactivate:', updateErr);
      } else {
        console.log(`Successfully deactivated employee ${emp.first_name}.`);
      }
    } else {
      console.log(`Successfully deleted employee ${emp.first_name}.`);
    }
  }
}

removeRavi().catch(console.error);
