import { attendanceService } from './src/services/attendance/attendanceService';
import { breakService } from './src/services/attendance/breakService';
import { supabase } from './src/lib/supabase';
import { config } from 'dotenv';
config();
if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
  throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD in your local .env (never commit them).');
}

async function runTest() {
  console.log('--- STARTING AUTO BREAK E2E TEST ---');

  // 1. Authenticate as Admin
  const { data: { user }, error: authErr } = await supabase.auth.signInWithPassword({
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD
  });
  if (authErr) throw authErr;
  
  // Find Kanz S
  const { data: employees } = await supabase.from('employees').select('id, employee_code, first_name');
  if (!employees || employees.length === 0) throw new Error('No employees');
  
  const kanz = employees.find(e => e.first_name.includes('Kanz')) || employees[1] || employees[0];
  const empId = kanz.id;
  console.log('Testing against Employee:', kanz.first_name);

  // Clear today's attendance for a clean test
  const dateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  await supabase.from('attendance_breaks').delete().eq('employee_id', empId);
  await supabase.from('attendance_events').delete().eq('employee_id', empId);
  await supabase.from('employee_location_history').delete().eq('employee_id', empId);
  await supabase.from('employee_live_locations').delete().eq('employee_id', empId);
  await supabase.from('attendance').delete().eq('employee_id', empId).eq('attendance_date', dateStr);

  attendanceService.getCurrentEmployeeId = async () => empId;

  // 2. Clock In
  console.log('\n--- CLOCKING IN ---');
  const inRes = await attendanceService.clockIn({
    localDateStr: dateStr,
    locationVerificationId: null,
    faceVerificationEventId: null
  });
  console.log('Clock In Result:', inRes.error ? inRes.error.message : 'SUCCESS');

  let att = await attendanceService.getTodayAttendance(dateStr);
  console.log('Status after clock in:', att.data?.status);
  
  // Force clock_in_at to be exactly 30 mins ago
  const thirtyMinsAgoMs = Date.now() - 30 * 60000;
  const thirtyMinsAgo = new Date(thirtyMinsAgoMs).toISOString();
  await supabase.from('attendance').update({ clock_in_at: thirtyMinsAgo }).eq('id', att.data?.id);
  console.log(`Clock in time forcefully set to 30 minutes ago`);

  // 3. Verify Active Time Before Break
  console.log('\n--- UI CALCULATION (WORKING - BEFORE BREAK) ---');
  let grossTime = Math.floor((Date.now() - thirtyMinsAgoMs) / 1000);
  console.log(`Gross work time so far: ${Math.floor(grossTime / 60)} mins`);

  // 4. Simulate Leaving Geofence (10 mins ago)
  console.log('\n--- LEAVING GEOFENCE (Triggering AUTO BREAK) ---');
  const tenMinsAgoMs = Date.now() - 10 * 60000;
  const leaveTime = new Date(tenMinsAgoMs).toISOString();
  
  await breakService.handleAutoBreakTransition(empId, 'START', leaveTime);
  
  att = await attendanceService.getTodayAttendance(dateStr);
  console.log('Status after leaving geofence:', att.data?.status); // should be ON_BREAK

  const { data: activeBreaks } = await breakService.getAttendanceBreaks(att.data?.id);
  
  // 5. Test Active Break Time UI Calculation Logic (from Dashboard/Attendance.tsx)
  console.log('\n--- SIMULATING UI LOGIC WHILE ON BREAK ---');
  let currentWorkSecs = 0;
  if (att.data?.clock_in_at) {
      const inTimeMs = new Date(att.data.clock_in_at).getTime();
      currentWorkSecs = Math.floor((Date.now() - inTimeMs) / 1000);
      
      if (att.data.break_minutes) currentWorkSecs -= att.data.break_minutes * 60;
      
      if (att.data.status === 'ON_BREAK' && activeBreaks && activeBreaks.length > 0) {
          const activeBreak = activeBreaks.find(b => b.ended_at === null);
          if (activeBreak) {
              const breakStart = new Date(activeBreak.started_at).getTime();
              const currentBreakSecs = Math.floor((Date.now() - breakStart) / 1000);
              console.log(`Active break duration to subtract: ${Math.floor(currentBreakSecs / 60)} mins`);
              currentWorkSecs -= currentBreakSecs;
          }
      }
      console.log(`Effective UI working time (PAUSED!): ${Math.floor(currentWorkSecs / 60)} mins`);
      console.log(`(Should precisely match gross time 30m - 10m break = 20 mins)`);
  }

  // 6. Return to Geofence (End Auto Break NOW)
  console.log('\n--- RETURNING TO GEOFENCE (Ending AUTO BREAK NOW) ---');
  const returnTime = new Date().toISOString(); 
  await breakService.handleAutoBreakTransition(empId, 'END', returnTime);

  att = await attendanceService.getTodayAttendance(dateStr);
  console.log('Status after returning:', att.data?.status);
  console.log('Total Break Minutes recorded in DB:', att.data?.break_minutes);

  console.log('\n--- SIMULATING UI LOGIC AFTER RETURN ---');
  if (att.data?.clock_in_at) {
      const inTimeMs = new Date(att.data.clock_in_at).getTime();
      currentWorkSecs = Math.floor((Date.now() - inTimeMs) / 1000);
      if (att.data.break_minutes) currentWorkSecs -= att.data.break_minutes * 60;
      console.log(`Effective UI working time (RESUMED!): ${Math.floor(currentWorkSecs / 60)} mins`);
  }

  console.log('\n--- TEST COMPLETE ---');
  process.exit(0);
}

runTest().catch(console.error);
