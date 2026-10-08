import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

// 1. Environment Safety
dotenv.config({ path: '.env.qa' });

const qaUrl = process.env.SUPABASE_QA_URL;
const qaKey = process.env.SUPABASE_QA_SERVICE_ROLE_KEY;
const qaPassword = process.env.QA_PASSWORD;
if (!qaPassword) {
  console.error('Set QA_PASSWORD in .env.qa (never commit it).');
  process.exit(1);
}

if (!qaUrl || !qaKey) {
  console.error("ERROR: SUPABASE_QA_URL or SUPABASE_QA_SERVICE_ROLE_KEY missing in .env.qa");
  process.exit(1);
}

// 2. Production Safety Check
const prodEnvContent = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf-8') : '';
const prodUrlMatch = prodEnvContent.match(/VITE_SUPABASE_URL=(.*)/);
const prodUrl = prodUrlMatch ? prodUrlMatch[1].trim() : '';

if (qaUrl === prodUrl || qaUrl.includes('jiicnqgafzvkgfcienpm.supabase.co')) {
  console.error("ERROR: Production Supabase detected. QA seed aborted.");
  process.exit(1);
}

const supabase = createClient(qaUrl, qaKey);

const usersToCreate = [
  { email: 'qa_admin@workpulse.com', name: 'QA Admin', role: 'ADMIN', code: 'QA001' },
  { email: 'qa_hr@workpulse.com', name: 'QA HR', role: 'HR', code: 'QA002' },
  { email: 'qa_emp1@workpulse.com', name: 'QA Employee 1', role: 'EMPLOYEE', code: 'QA003' },
  { email: 'qa_emp2@workpulse.com', name: 'QA Employee 2', role: 'EMPLOYEE', code: 'QA004' }
];

async function seed() {
    try {
        let authUserIds = {};
        let employeeIds = {};
        let deptIds = {};
        let officeId;
        let shiftIds = {};
        
        console.log("Starting QA seed script...");
        
        // 3. QA USERS
        for (const u of usersToCreate) {
            const { data: existingUser, error: authListErr } = await supabase.auth.admin.listUsers();
            if (authListErr) throw new Error(`Auth List Error: ${authListErr.message}`);
            
            let authUser = existingUser?.users?.find(x => x.email === u.email);
            
            if (!authUser) {
                console.log(`Creating auth user: ${u.email}`);
                const { data, error } = await supabase.auth.admin.createUser({
                    email: u.email,
                    password: qaPassword,
                    email_confirm: true
                });
                if (error) throw new Error(`Failed to create ${u.email}: ${error.message}`);
                authUser = data.user;
            }
            authUserIds[u.email] = authUser.id;
            
            // Wait for DB triggers if any
            await new Promise(r => setTimeout(r, 1000));
            
            const { data: profile } = await supabase.from('profiles').select('*').eq('auth_user_id', authUser.id).maybeSingle();
            
            const { data: existingEmp } = await supabase.from('employees').select('id').eq('email', u.email).maybeSingle();
            let empId = existingEmp?.id;
            
            if (!empId) {
                console.log(`Creating employee record: ${u.email}`);
                const { data: newEmp, error: empErr } = await supabase.from('employees').insert({
                    email: u.email,
                    first_name: u.name.split(' ')[0],
                    last_name: u.name.split(' ').slice(1).join(' ') || '.',
                    employee_code: u.code,
                    role: u.role,
                    status: 'ACTIVE'
                }).select().single();
                
                if (empErr) throw new Error(`Failed to create employee ${u.email}: ${empErr.message}`);
                empId = newEmp.id;
            }
            employeeIds[u.email] = empId;
            
            if (profile && !profile.employee_id) {
                await supabase.from('profiles').update({ employee_id: empId, role: u.role }).eq('id', profile.id);
            }
        }
        
        // 4. DEPARTMENTS
        const depts = ['QA Department', 'Production Department'];
        for (const d of depts) {
            const { data: existing } = await supabase.from('departments').select('id').eq('name', d).maybeSingle();
            let dId = existing?.id;
            if (!dId) {
                console.log(`Creating department: ${d}`);
                const { data, error } = await supabase.from('departments').insert({ name: d, status: 'ACTIVE' }).select().single();
                if (error) throw new Error(`Failed to create dept ${d}: ${error.message}`);
                dId = data.id;
            }
            deptIds[d] = dId;
        }

        // 5. OFFICE
        const { data: existingOff } = await supabase.from('offices').select('id').eq('name', 'QA Office').maybeSingle();
        officeId = existingOff?.id;
        if (!officeId) {
            console.log(`Creating office: QA Office`);
            const { data, error } = await supabase.from('offices').insert({
                name: 'QA Office',
                latitude: 12.9716,
                longitude: 77.5946,
                radius: 100,
                status: 'ACTIVE'
            }).select().single();
            if (error) throw new Error(`Failed to create office: ${error.message}`);
            officeId = data.id;
        }
        
        // 6. SHIFTS
        const shifts = [
            { name: 'Normal Day Shift', start_time: '09:00:00', end_time: '18:00:00', is_overnight: false },
            { name: 'Overnight Shift', start_time: '22:00:00', end_time: '06:00:00', is_overnight: true }
        ];
        
        for (const s of shifts) {
            const { data: existing } = await supabase.from('shift_templates').select('id').eq('name', s.name).maybeSingle();
            let sId = existing?.id;
            if (!sId) {
                console.log(`Creating shift: ${s.name}`);
                const { data, error } = await supabase.from('shift_templates').insert({
                    name: s.name,
                    start_time: s.start_time,
                    end_time: s.end_time,
                    is_overnight: s.is_overnight,
                    status: 'ACTIVE'
                }).select().single();
                if (error) throw new Error(`Failed to create shift ${s.name}: ${error.message}`);
                sId = data.id;
            }
            shiftIds[s.name] = sId;
        }
        
        // 7. EMPLOYEE ASSIGNMENTS
        const empsToAssign = ['qa_emp1@workpulse.com', 'qa_emp2@workpulse.com'];
        for (let i = 0; i < empsToAssign.length; i++) {
            const email = empsToAssign[i];
            const empId = employeeIds[email];
            
            console.log(`Assigning relationships for ${email}`);
            await supabase.from('employees').update({
                department_id: deptIds['QA Department'],
                office_id: officeId
            }).eq('id', empId);
            
            const shiftName = i === 0 ? 'Normal Day Shift' : 'Overnight Shift';
            
            const { data: existingSA } = await supabase.from('shift_assignments')
                .select('id').eq('employee_id', empId).eq('shift_template_id', shiftIds[shiftName]).maybeSingle();
                
            if (!existingSA) {
                await supabase.from('shift_assignments').insert({
                    employee_id: empId,
                    shift_template_id: shiftIds[shiftName],
                    effective_from: new Date().toISOString().split('T')[0]
                });
            }
        }
        
        // 8. SALARY STRUCTURES
        const salaries = [
            { email: 'qa_emp1@workpulse.com', basic: 25000, allowance: 5000 },
            { email: 'qa_emp2@workpulse.com', basic: 30000, allowance: 5000 }
        ];
        
        for (const s of salaries) {
            const empId = employeeIds[s.email];
            const { data: existing } = await supabase.from('salary_structures').select('id').eq('employee_id', empId).maybeSingle();
            if (!existing) {
                console.log(`Creating salary for ${s.email}`);
                await supabase.from('salary_structures').insert({
                    employee_id: empId,
                    basic_salary: s.basic,
                    allowances: s.allowance,
                    effective_date: new Date().toISOString().split('T')[0],
                    is_active: true
                });
            }
        }
        
        console.log(`\n================================`);
        console.log(`QA SEED COMPLETE`);
        console.log(`================================`);
        console.log(`Users:\nADMIN: 1\nHR: 1\nEMPLOYEE: 2`);
        console.log(`Departments:\n2`);
        console.log(`Offices:\n1`);
        console.log(`Shifts:\n2`);
        console.log(`Salary Structures:\n2`);
        
    } catch (err) {
        console.error("SEED FAILED:", err.message);
        process.exit(1);
    }
}

seed();
