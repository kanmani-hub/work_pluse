import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  console.log("Logging in as admin...");
  await supabase.auth.signInWithPassword({ email: 'admin@gmail.com', password: 'admin@123' });
  
  const empId = '28d3e56c-cc78-4842-83df-09e91c2a031c';
  const shiftId = 'fa04986e-a27f-4059-b781-15871624db98';
  
  const dates = ['2026-10-05', '2026-10-06'];
  for (const date of dates) {
    const { data: att } = await supabase.from('attendance')
      .select('*')
      .eq('employee_id', empId)
      .eq('attendance_date', date);
      
    if (!att || att.length === 0) {
       console.log(`Inserting attendance for ${date}...`);
       const { error: insErr } = await supabase.from('attendance').insert({
         employee_id: empId,
         shift_template_id: shiftId,
         attendance_date: date,
         clock_in_at: `${date}T09:00:00+00:00`,
         clock_out_at: `${date}T18:00:00+00:00`,
         required_hours: 9,
         worked_hours: 9,
         status: 'PRESENT',
         late_minutes: 0,
         early_logout_minutes: 0,
         break_minutes: 60,
         is_half_day: false
       });
       console.log(`Insert ${date} error:`, insErr);
    } else {
       console.log(`Attendance for ${date} exists, updating...`);
       await supabase.from('attendance').update({
         clock_out_at: `${date}T18:00:00+00:00`,
         status: 'PRESENT',
         worked_hours: 9
       }).eq('id', att[0].id);
    }
  }

  const { data: finalAtt } = await supabase.from('attendance').select('*').eq('employee_id', empId).in('attendance_date', dates);
  console.log("Final Attendance:", finalAtt);
}

run();
