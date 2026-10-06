import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

import { supabase } from './src/lib/supabase';
import { payrollService } from './src/services/payroll/payrollService';

async function run() {
  console.log("Generating payroll...");
  await supabase.auth.signInWithPassword({ email: 'admin@gmail.com', password: 'admin@123' });
  const startDate = new Date(Date.UTC(2026, 9, 1)).toISOString();
  const endDate = new Date(Date.UTC(2026, 10, 0, 23, 59, 59)).toISOString();
  
  const empId = '28d3e56c-cc78-4842-83df-09e91c2a031c'; // Kanz S
  const res = await payrollService.recalculatePayroll(empId, 2026, 10, startDate, endDate);
  console.log("Calculate result:", res);

  if (res.data?.id) {
    console.log("Approving payroll...");
    await supabase.from('payroll').update({ status: 'APPROVED', approved_at: new Date().toISOString() }).eq('id', res.data.id);
    
    console.log("Marking as PAID...");
    await supabase.from('payroll').update({ status: 'PAID' }).eq('id', res.data.id);
    
  const { data: kanz, error: err } = await supabase.auth.admin.updateUserById(
    '28d3e56c-cc78-4842-83df-09e91c2a031c',
    { password: 'password123' }
  );
  console.log("Changed Kanz password:", err);
}

run();
