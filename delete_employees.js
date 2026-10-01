import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

// Note: To delete users from auth.users, we need the SERVICE_ROLE_KEY.
// The user hasn't provided the service role key. 
// We can use SQL queries via CLI instead.
