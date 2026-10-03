import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
    const today = new Date().toISOString().split('T')[0];
    
    console.log('Running tests...');

    const tests = [
      { name: 'employees', promise: supabase.from('employees').select('id, employment_type, office_id').eq('status', 'ACTIVE') },
      { name: 'wfh_pending', promise: supabase.from('wfh_requests').select('*', { count: 'exact', head: true }).eq('status', 'PENDING') },
      { name: 'leave_pending', promise: supabase.from('leave_requests').select('*', { count: 'exact', head: true }).eq('status', 'PENDING') },
      { name: 'perm_pending', promise: supabase.from('permission_requests').select('*', { count: 'exact', head: true }).eq('status', 'PENDING') },
      { name: 'attendance', promise: supabase.from('attendance').select('status, clock_in_at, clock_out_at').eq('attendance_date', today) },
      { name: 'shifts', promise: supabase.from('shift_templates').select('*').eq('is_active', true).order('start_time') },
      { name: 'wfh_approved', promise: supabase.from('wfh_requests').select('*', { count: 'exact', head: true }).eq('status', 'APPROVED').eq('request_date', today) }
    ];

    for (const test of tests) {
        const res = await test.promise;
        if (res.error) {
            console.error(`FAILED: ${test.name}`, res.error);
        } else {
            console.log(`SUCCESS: ${test.name}`);
        }
    }
}

test();
