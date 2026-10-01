import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const accessToken = authHeader.replace('Bearer ', '').trim();
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(accessToken);

    if (authError || !user) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid token' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const { data: callerProfile } = await supabaseClient
      .from('profiles')
      .select('role_id, roles(name)')
      .eq('auth_user_id', user.id)
      .single();

    let roleName = callerProfile?.roles?.name;
    if (!callerProfile) {
      const { data: callerEmployee } = await supabaseClient.from('employees').select('role_id, roles(name)').eq('email', user.email).single();
      roleName = callerEmployee?.roles?.name;
    }

    if (!roleName || (roleName.toUpperCase() !== 'ADMIN' && roleName.toUpperCase() !== 'HR' && roleName.toUpperCase() !== 'HR/STAFF')) {
      return new Response(JSON.stringify({ success: false, error: 'Forbidden. Only Admins or HR can delete employees.' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const { employeeId } = await req.json();
    if (!employeeId) {
      return new Response(JSON.stringify({ success: false, error: 'Employee ID is required.' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // Initialize Admin client to bypass RLS and delete auth user
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Check for dependent records
    const tables = [
      'attendance', 'attendance_breaks', 'attendance_events',
      'wfh_requests', 'leave_requests', 'permission_requests',
      'leave_balances', 'payroll', 'payslips', 'salary_structures',
      'shift_assignments', 'face_registrations', 'face_verification_events',
      'employee_live_locations', 'employee_location_history', 'geofence_events',
      'notifications', 'audit_logs'
    ];

    for (const table of tables) {
      const column = table === 'notifications' ? 'recipient_employee_id' : 'employee_id';
      
      const { data, error } = await supabaseAdmin
        .from(table)
        .select('id')
        .eq(column, employeeId)
        .limit(1);

      if (!error && data && data.length > 0) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Employee cannot be permanently deleted because related attendance, payroll, leave, or other records exist. Deactivate the employee instead.'
        }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    // If safe, delete employee
    // Find associated auth user (from profiles or email matching)
    const { data: profile } = await supabaseAdmin.from('profiles').select('auth_user_id').eq('employee_id', employeeId).single();
    const { data: employee } = await supabaseAdmin.from('employees').select('email').eq('id', employeeId).single();

    if (profile?.auth_user_id) {
      await supabaseAdmin.auth.admin.deleteUser(profile.auth_user_id);
    } else if (employee?.email) {
      // Find auth user by email if no profile
      const { data: authUsers } = await supabaseAdmin.auth.admin.listUsers();
      const authUser = authUsers?.users?.find(u => u.email === employee.email);
      if (authUser) {
        await supabaseAdmin.auth.admin.deleteUser(authUser.id);
      }
    }

    // Delete profile if exists
    await supabaseAdmin.from('profiles').delete().eq('employee_id', employeeId);

    // Delete employee record
    const { error: deleteError } = await supabaseAdmin.from('employees').delete().eq('id', employeeId);

    if (deleteError) {
      return new Response(JSON.stringify({ success: false, error: 'Failed to delete employee: ' + deleteError.message }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: 'Internal Server Error: ' + err.message }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
