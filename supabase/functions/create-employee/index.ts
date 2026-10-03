import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 1. Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    )

    // 2. Verify Caller is Authenticated & Admin
    const authHeader = req.headers.get('Authorization');

    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Unauthorized',
          details: 'Missing Bearer token'
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    const accessToken = authHeader.replace('Bearer ', '').trim();

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(accessToken);

    if (authError || !user) {
      console.error('Auth validation failed:', authError?.message);
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Unauthorized',
          details: authError?.message || 'Invalid access token'
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    console.log('Authorization header present:', !!authHeader);
    console.log('Authenticated user ID:', user.id);
    console.log('Auth error:', authError?.message || null);

    // Verify role mapping based on actual schema: 
    // Auth user -> profiles.auth_user_id -> roles.name
    // (public.employees does not store auth UUID)
    const { data: callerProfile } = await supabaseClient
      .from('profiles')
      .select('role_id, roles(name)')
      .eq('auth_user_id', user.id)
      .single();

    // Fallback if profile trigger missed but employee email matches
    let roleName = callerProfile?.roles?.name;
    let found = !!callerProfile;

    if (!callerProfile) {
      const { data: callerEmployee } = await supabaseClient
        .from('employees')
        .select('role_id, roles(name)')
        .eq('email', user.email)
        .single();
      
      roleName = callerEmployee?.roles?.name;
      found = !!callerEmployee;
    }

    console.log('Caller employee found:', found);
    console.log('Caller role name:', roleName || 'none');

    if (!found || roleName !== 'ADMIN') {
      return new Response(JSON.stringify({ success: false, error: 'Forbidden: Admin access required.' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 3. Parse input
    const body = await req.json()
    const { email, first_name, last_name, employee_code, department_id, role_id, office_id, status, joining_date, phone, designation, employment_type, password } = body

    if (!email || !first_name || !last_name || !password) {
      return new Response(JSON.stringify({ success: false, error: 'Missing required fields' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 4. Initialize Admin Client with Service Role Key
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    console.log('SUPABASE_URL_PRESENT:', !!supabaseUrl);
    console.log('SERVICE_ROLE_KEY_PRESENT:', !!serviceRoleKey);

    const supabaseAdmin = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    // DIAGNOSTIC: Test admin client privileges with a SELECT
    const { data: testData, error: testError } = await supabaseAdmin
      .from('employees')
      .select('id')
      .limit(1);

    console.log('ADMIN_CLIENT_TEST_SUCCESS:', !testError);
    console.log('ADMIN_CLIENT_TEST_ERROR:', testError?.message || null);

    if (testError) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Admin client cannot access employees table',
        details: testError.message,
        diagnostics: {
          SUPABASE_URL_PRESENT: !!supabaseUrl,
          SERVICE_ROLE_KEY_PRESENT: !!serviceRoleKey,
          ADMIN_CLIENT_SELECT_ERROR: testError.message
        }
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 5. Prevent Duplicate Auth User
    const { data: existingUsers, error: listError } = await supabaseAdmin.auth.admin.listUsers()
    if (!listError) {
      const userExists = existingUsers.users.some(u => u.email === email)
      if (userExists) {
        return new Response(JSON.stringify({ success: false, error: 'An account already exists for this email.' }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    }

    // 6. Create Auth User
    const { data: newAuthUser, error: createUserError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: password,
      email_confirm: true,
      user_metadata: {
        first_name,
        last_name,
        force_password_change: true
      }
    });

    if (createUserError || !newAuthUser.user) {
      console.error('Create Auth Error:', createUserError)
      return new Response(JSON.stringify({ success: false, error: 'Failed to create auth user', details: createUserError?.message }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 6.5 Generate Unique Employee Code
    const { data: latestEmp, error: latestErr } = await supabaseAdmin
      .from('employees')
      .select('employee_code')
      .order('employee_code', { ascending: false })
      .limit(1)
      .single();

    let newEmployeeCode = 'EMP001';
    if (!latestErr && latestEmp?.employee_code) {
      const match = latestEmp.employee_code.match(/EMP(\d+)/);
      if (match) {
        const nextNum = parseInt(match[1], 10) + 1;
        newEmployeeCode = `EMP${nextNum.toString().padStart(3, '0')}`;
      }
    }

    // 7. Create Employee Record
    const { data: newEmployee, error: employeeError } = await supabaseAdmin
      .from('employees')
      .insert({
        employee_code: newEmployeeCode,
        email,
        first_name,
        last_name,
        department_id,
        role_id,
        office_id,
        joining_date,
        phone,
        designation,
        employment_type,
        status: status ? status.toUpperCase() : 'ACTIVE',
      })
      .select()
      .single()

    if (employeeError) {
      // Rollback Auth user if employee creation fails
      console.error('Employee creation failed. Rolling back Auth user...', employeeError)
      await supabaseAdmin.auth.admin.deleteUser(newAuthUser.user.id)

      return new Response(JSON.stringify({
        success: false,
        error: 'Failed to create employee record. Rolled back.',
        details: employeeError.message,
        diagnostics: {
          SERVICE_ROLE_KEY_PRESENT: !!serviceRoleKey,
          ADMIN_CLIENT_SELECT: 'PASS',
          INSERT_ERROR_CODE: employeeError.code,
          INSERT_ERROR_HINT: employeeError.hint,
          INSERT_ERROR_DETAILS: employeeError.details,
        }
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 7.5 Create Profile Record to link Auth User to Employee
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .insert({
        auth_user_id: newAuthUser.user.id,
        employee_id: newEmployee.id,
        role_id: role_id,
        is_active: status ? status.toUpperCase() === 'ACTIVE' : true
      });

    if (profileError) {
      console.error('Profile creation failed. Rolling back...', profileError);
      // Attempt best-effort rollback
      await supabaseAdmin.from('employees').delete().eq('id', newEmployee.id);
      await supabaseAdmin.auth.admin.deleteUser(newAuthUser.user.id);
      
      return new Response(JSON.stringify({
        success: false,
        error: 'Failed to create profile record. Rolled back.',
        details: profileError.message
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 8. Return Success
    return new Response(JSON.stringify({ success: true, employee: newEmployee }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error: any) {
    console.error('Edge Function Exception:', error)
    return new Response(JSON.stringify({ success: false, error: 'Internal Server Error', message: error.message }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
