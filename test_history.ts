import { supabase } from './src/lib/supabase';

async function test() {
  const { data } = await supabase
      .from('location_verification_events')
      .select(`
        *,
        employees (first_name, last_name, employee_code, departments(name)),
        offices (name)
      `)
      .order('verified_at', { ascending: false })
      .limit(500);

  if (data) {
    const ids = data.map(d => d.id);
    const uniqueIds = [...new Set(ids)];
    console.log(`Total: ${ids.length}, Unique: ${uniqueIds.length}`);
    if (ids.length !== uniqueIds.length) {
      console.log('DUPLICATE IDS FOUND!');
    }
  } else {
    console.log('No data');
  }
}

test();
