import { supabase } from './src/lib/supabase';
import { config } from 'dotenv';
config();

async function run() {
  const { data } = await supabase.from('employees').select('id, email').ilike('first_name', '%Kanz%').limit(1).single();
  console.log('KANZ:', data);
  process.exit(0);
}
run();
