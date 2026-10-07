import { supabase } from './src/lib/supabase';
import { config } from 'dotenv';
config();

async function listEmployees() {
  const { data: employees, error } = await supabase
    .from('employees')
    .select('id, first_name, last_name, employee_code, status');
    
  if (error) {
    console.error(error);
    process.exit(1);
  }

  console.log("All Employees:");
  employees?.forEach(e => {
    console.log(`- ${e.first_name} ${e.last_name} (${e.employee_code}) - Active: ${e.status}`);
  });
  
  process.exit(0);
}

listEmployees().catch(console.error);
