import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

async function signUpAdmin() {
  const { data, error } = await supabase.auth.signUp({
    email: 'admin@gmail.com',
    password: 'admin@123',
  });

  if (error) {
    console.error('Signup error:', error.message);
  } else {
    console.log('User created successfully:', data.user.id);
  }
}

signUpAdmin();
