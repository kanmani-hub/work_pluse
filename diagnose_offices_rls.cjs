const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://jiicnqgafzvkgfcienpm.supabase.co';
const ANON_KEY = 'sb_publishable_rJLFFgFLILGSiPGd6v4Vyw_n3DY1-2B';

async function diagnose() {
  // 1. Sign in as admin
  const supabase = createClient(SUPABASE_URL, ANON_KEY);
  const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
    email: 'admin@gmail.com',
    password: 'admin@123'
  });
  if (authErr) {
    console.error('AUTH ERROR:', authErr.message);
    return;
  }
  console.log('=== AUTHENTICATED ===');
  console.log('User ID:', authData.user.id);
  console.log('Email:', authData.user.email);

  // 2. Check get_auth_role()
  const { data: roleData, error: roleErr } = await supabase.rpc('get_auth_role');
  console.log('\n=== get_auth_role() ===');
  if (roleErr) console.log('ERROR:', roleErr.message);
  else console.log('Role:', roleData);

  // 3. Check get_auth_employee_id()
  const { data: empIdData, error: empIdErr } = await supabase.rpc('get_auth_employee_id');
  console.log('\n=== get_auth_employee_id() ===');
  if (empIdErr) console.log('ERROR:', empIdErr.message);
  else console.log('Employee ID:', empIdData);

  // 4. Check profile exists
  const { data: profileData, error: profileErr } = await supabase
    .from('profiles')
    .select('id, auth_user_id, employee_id, role_id, is_active')
    .eq('auth_user_id', authData.user.id);
  console.log('\n=== Profile for admin ===');
  if (profileErr) console.log('ERROR:', profileErr.message);
  else console.log(JSON.stringify(profileData, null, 2));

  // 5. Check employees record
  const { data: empData, error: empErr } = await supabase
    .from('employees')
    .select('id, employee_code, first_name, last_name, email, role_id, status')
    .eq('email', 'admin@gmail.com');
  console.log('\n=== Employee for admin@gmail.com ===');
  if (empErr) console.log('ERROR:', empErr.message);
  else console.log(JSON.stringify(empData, null, 2));

  // 6. Check roles table
  const { data: rolesData, error: rolesErr } = await supabase
    .from('roles')
    .select('id, name');
  console.log('\n=== Roles ===');
  if (rolesErr) console.log('ERROR:', rolesErr.message);
  else console.log(JSON.stringify(rolesData, null, 2));

  // 7. Try INSERT test
  console.log('\n=== TEST INSERT ===');
  const { data: insertData, error: insertErr } = await supabase
    .from('offices')
    .insert({
      name: '__TEST_RLS_CHECK__',
      address: 'Test address',
      latitude: 13.05,
      longitude: 80.23,
      geofence_radius: 100,
      is_active: true
    })
    .select();
  if (insertErr) {
    console.log('INSERT FAILED:', insertErr.message);
    console.log('Code:', insertErr.code);
    console.log('Details:', insertErr.details);
    console.log('Hint:', insertErr.hint);
  } else {
    console.log('INSERT SUCCESS:', JSON.stringify(insertData, null, 2));
    // Clean up the test
    if (insertData && insertData[0]) {
      await supabase.from('offices').delete().eq('id', insertData[0].id);
      console.log('Test row cleaned up.');
    }
  }

  // 8. List existing offices
  const { data: officesData, error: officesErr } = await supabase
    .from('offices')
    .select('id, name, address, latitude, longitude, geofence_radius, is_active')
    .order('created_at', { ascending: false });
  console.log('\n=== Existing Offices ===');
  if (officesErr) console.log('ERROR:', officesErr.message);
  else console.log(JSON.stringify(officesData, null, 2));
}

diagnose().catch(console.error);
