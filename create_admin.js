import { createClient } from '@supabase/supabase-js';
if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
  throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD in your local .env (never commit them).');
}

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

async function signUpAdmin() {
  const { data, error } = await supabase.auth.signUp({
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  });

  if (error) {
    console.error('Signup error:', error.message);
  } else {
    console.log('User created successfully:', data.user.id);
  }
}

signUpAdmin();
